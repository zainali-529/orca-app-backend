const mongoose = require('mongoose');

/**
 * Document — Enhanced
 *
 * New features vs v1:
 *  ✓ signerDetails pre-filled at CREATION from profile
 *  ✓ supplier — specific supplier this LOA covers (null = any)
 *  ✓ fuelType — electricity / gas / dual / any
 *  ✓ sentByAdmin + assignedAdmin — admin can send docs to clients
 *  ✓ adminNotes — internal notes, never exposed to client
 *  ✓ expiryNotified — has 30-day reminder been sent?
 *  ✓ daysUntilExpiry virtual
 *  ✓ linkedQuote is properly populated via populate()
 */

const signatureSchema = new mongoose.Schema(
  {
    data:      { type: String, default: null, select: false },
    signedAt:  { type: Date,   default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { _id: false }
);

const signerDetailsSchema = new mongoose.Schema(
  {
    fullName:    { type: String, default: null },
    email:       { type: String, default: null },
    phone:       { type: String, default: null },
    companyName: { type: String, default: null },
    address: {
      line1:    { type: String, default: null },
      city:     { type: String, default: null },
      postcode: { type: String, default: null },
    },
    mpan:            { type: String, default: null },
    mprn:            { type: String, default: null },
    currentSupplier: { type: String, default: null },
  },
  { _id: false }
);

const pdfSchema = new mongoose.Schema(
  {
    url:         { type: String, default: null },
    publicId:    { type: String, default: null },
    generatedAt: { type: Date,   default: null },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    // ── Identity ───────────────────────────────────────────
    docNumber: { type: String, unique: true }, // LOA-2025-000001

    // ── Ownership ──────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      required: true, index: true,
    },

    // ── Admin who sent this (null if client-initiated) ─────
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null,
    },

    // ── Linked quote (optional) ────────────────────────────
    quote: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null,
    },

    // ── Document type ──────────────────────────────────────
    type: {
      type: String, enum: ['loa', 'contract', 'bill', 'vat_declaration', 'other'],
      default: 'loa', index: true,
    },

    title: { type: String, trim: true, default: 'Document' },

    // ── Description — extra context for the client ─────────
    description: {
      type: String, trim: true, maxlength: 500, default: null,
    },

    // ── Status ─────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending_signature', 'signed', 'expired'],
      default: 'pending_signature', index: true,
    },

    // ── NEW: Specific supplier covered ─────────────────────
    // null = generic LOA (works with any supplier)
    // e.g. 'British Gas', 'Octopus Energy'
    supplier: { type: String, trim: true, default: null },

    // ── NEW: Fuel scope ────────────────────────────────────
    fuelType: {
      type: String,
      enum: ['electricity', 'gas', 'dual', 'any'],
      default: 'any',
    },

    // ── NEW: Was this sent BY admin TO client? ─────────────
    sentByAdmin: { type: Boolean, default: false, index: true },

    // ── Signature ──────────────────────────────────────────
    signature: { type: signatureSchema, default: () => ({}) },

    // ── Signer details ─────────────────────────────────────
    // Pre-filled at CREATION from UserProfile
    // Finalised (locked) at signing time
    signerDetails: { type: signerDetailsSchema, default: () => ({}) },

    // ── PDF ────────────────────────────────────────────────
    pdf: { type: pdfSchema, default: () => ({}) },

    // ── Admin-only fields ──────────────────────────────────
    adminNotes: {
      type: String, trim: true, maxlength: 2000,
      default: null, select: false, // never auto-returned
    },

    // ── Expiry ─────────────────────────────────────────────
    expiresAt:       { type: Date,    default: null },
    expiryNotified:  { type: Boolean, default: false }, // 30-day reminder sent?
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        if (ret.signature) delete ret.signature.data; // never expose base64
        delete ret.adminNotes;                         // never expose to client
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────
documentSchema.index({ client: 1, status: 1 });
documentSchema.index({ client: 1, createdAt: -1 });
documentSchema.index({ assignedAdmin: 1, createdAt: -1 });
documentSchema.index({ status: 1, expiresAt: 1 });     // for expiry cron
documentSchema.index({ sentByAdmin: 1, status: 1 });
documentSchema.index({ supplier: 1, status: 1 });

// ── Auto-generate docNumber ────────────────────────────────────
documentSchema.pre('save', async function (next) {
  if (!this.docNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    
    // Prefix based on type
    const prefix = this.type ? this.type.toUpperCase().slice(0, 3) : 'DOC';
    this.docNumber = `${prefix}-${year}-${seq}`;

    // Auto-generate title if using default 'Document'
    if (this.title === 'Document') {
      const sup  = this.supplier ? ` — ${this.supplier}` : '';
      const fuel = this.fuelType && this.fuelType !== 'any'
        ? ` (${this.fuelType.charAt(0).toUpperCase() + this.fuelType.slice(1)})`
        : '';
      
      const typeLabel = this.type === 'loa' ? 'Letter of Authority' 
                      : this.type === 'vat_declaration' ? 'VAT Declaration'
                      : this.type.charAt(0).toUpperCase() + this.type.slice(1);

      this.title = `${typeLabel}${sup}${fuel}`;
    }

    // 6-month expiry
    const exp = new Date();
    exp.setMonth(exp.getMonth() + 6);
    this.expiresAt = exp;
  }
  next();
});

// ── Virtuals ───────────────────────────────────────────────────
documentSchema.virtual('isSigned').get(function () {
  return this.status === 'signed';
});

documentSchema.virtual('isExpired').get(function () {
  if (!this.expiresAt) return false;
  return this.expiresAt < new Date() && this.status !== 'signed';
});

documentSchema.virtual('hasPdf').get(function () {
  return !!this.pdf?.url;
});

documentSchema.virtual('daysUntilExpiry').get(function () {
  if (!this.expiresAt || this.status === 'signed') return null;
  const diff = this.expiresAt.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

module.exports = mongoose.model('Document', documentSchema);