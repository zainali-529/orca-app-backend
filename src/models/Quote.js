const mongoose = require('mongoose');

/**
 * Energy Quote
 *
 * A broker creates a quote for a client based on a specific tariff.
 * The quote can be generated as a PDF and shared with the client.
 * Cloudinary stores the PDF; we keep the secure URL + publicId.
 *
 * Quote lifecycle:
 *   draft → sent → accepted | rejected | expired
 */

// ── Client info snapshot ────────────────────────────────────────
// We snapshot client data at quote creation so the quote is immutable
// even if the broker updates the client record later.
const clientSnapshotSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    company: { type: String, trim: true, default: null },
    email:   { type: String, trim: true, lowercase: true, default: null },
    phone:   { type: String, trim: true, default: null },
    address: {
      line1:    { type: String, trim: true, default: null },
      line2:    { type: String, trim: true, default: null },
      city:     { type: String, trim: true, default: null },
      postcode: { type: String, trim: true, default: null },
    },
    mpan:    { type: String, trim: true, default: null },
    mprn:    { type: String, trim: true, default: null },
  },
  { _id: false }
);

// ── Tariff snapshot ─────────────────────────────────────────────
// Snapshot the tariff at quote creation time so rates don't drift
const tariffSnapshotSchema = new mongoose.Schema(
  {
    tariffId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Tariff', default: null },
    supplier:    { type: String, required: true, trim: true },
    tariffName:  { type: String, required: true, trim: true },
    tariffCode:  { type: String, trim: true, default: null },
    fuelType:    { type: String, enum: ['electricity', 'gas', 'dual'] },
    tariffType:  { type: String, enum: ['fixed', 'variable', 'flexible', 'prepayment'] },
    isGreen:     { type: Boolean, default: false },
    electricity: {
      unitRate:       { type: Number, default: null }, // p/kWh
      standingCharge: { type: Number, default: null }, // p/day
    },
    gas: {
      unitRate:       { type: Number, default: null },
      standingCharge: { type: Number, default: null },
    },
    contractLengthMonths: { type: Number, default: 12 },
    exitFee:     { type: Number, default: 0 },
    cashback:    { type: Number, default: 0 },
    features:    [{ type: String }],
    isLive:      { type: Boolean, default: false },
    dataLabel:   { type: String, default: 'Ofgem cap rate' },
  },
  { _id: false }
);

// ── Usage + pricing snapshot ────────────────────────────────────
const pricingSchema = new mongoose.Schema(
  {
    // Input usage
    annualElectricityKwh: { type: Number, default: null },
    annualGasKwh:         { type: Number, default: null },

    // Calculated costs (£)
    electricityAnnualCost: { type: Number, default: null },
    gasAnnualCost:         { type: Number, default: null },
    totalAnnualCost:       { type: Number, required: true },
    monthlyAverage:        { type: Number, default: null },
    weeklyAverage:         { type: Number, default: null },

    // Savings vs current supplier
    currentSupplierAnnualCost: { type: Number, default: null },
    annualSaving:              { type: Number, default: null },
    monthlySaving:             { type: Number, default: null },

    // VAT note (5% already included in rates)
    vatIncluded: { type: Boolean, default: true },
  },
  { _id: false }
);

// ── Main Quote schema ──────────────────────────────────────────
const quoteSchema = new mongoose.Schema(
  {
    // ── Identity ───────────────────────────────────────────────
    quoteNumber: {
      type: String,
      unique: true,
      // Auto-generated: EB-2025-001234
    },

    // ── Broker (creator) ──────────────────────────────────────
    broker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Client (who the quote is for) ─────────────────────────
    // For now we store client info inline as a snapshot.
    // Week 3 will add a proper Client model.
    client: {
      type: clientSnapshotSchema,
      required: true,
    },

    // ── Tariff snapshot ────────────────────────────────────────
    tariff: {
      type: tariffSnapshotSchema,
      required: true,
    },

    // ── Pricing breakdown ──────────────────────────────────────
    pricing: {
      type: pricingSchema,
      required: true,
    },

    // ── Quote metadata ─────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
      default: 'draft',
      index: true,
    },

    validDays: {
      type: Number,
      default: 30,
    },
    validUntil: {
      type: Date,
      default: null,
    },

    // ── Broker notes ───────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    // ── PDF ────────────────────────────────────────────────────
    pdf: {
      url:       { type: String, default: null }, // Cloudinary secure URL
      publicId:  { type: String, default: null }, // Cloudinary public_id for deletion
      generatedAt: { type: Date, default: null },
    },

    // ── Tracking ───────────────────────────────────────────────
    sentAt:     { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────
quoteSchema.index({ broker: 1, status: 1 });
quoteSchema.index({ broker: 1, createdAt: -1 });
quoteSchema.index({ quoteNumber: 1 });

// ── Auto-generate quote number before save ────────────────────
quoteSchema.pre('save', async function (next) {
  if (!this.quoteNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    this.quoteNumber = `EB-${year}-${seq}`;
  }

  // Set validUntil on first save
  if (!this.validUntil && this.validDays) {
    const d = new Date();
    d.setDate(d.getDate() + this.validDays);
    this.validUntil = d;
  }

  next();
});

// ── Virtual: isExpired ─────────────────────────────────────────
quoteSchema.virtual('isExpired').get(function () {
  if (!this.validUntil) return false;
  return this.validUntil < new Date() && this.status !== 'accepted';
});

// ── Virtual: hasPdf ────────────────────────────────────────────
quoteSchema.virtual('hasPdf').get(function () {
  return !!this.pdf?.url;
});

module.exports = mongoose.model('Quote', quoteSchema);
