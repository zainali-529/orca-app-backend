const mongoose = require('mongoose');

/**
 * Quote Request
 *
 * A client requests an energy quote. The admin/broker then
 * contacts them directly (phone, email, WhatsApp) to discuss
 * and finalise the switch.
 *
 * Status lifecycle:
 *   pending → contacted → completed | cancelled
 *
 * Most details are auto-populated from the client's profile
 * at the time of request. Client can override or add extra info.
 */

const quoteRequestSchema = new mongoose.Schema(
  {
    // ── Who requested ─────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Reference number ──────────────────────────────────────
    quoteNumber: {
      type: String,
      unique: true,
      // Auto-generated: QR-2025-000001
    },

    // ── Tariff they are interested in (optional) ──────────────
    // Client can request a quote for a specific tariff they saw
    // OR just request a general quote (tariffId = null)
    interestedTariff: {
      tariffId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tariff', default: null },
      supplier:   { type: String, default: null },
      tariffName: { type: String, default: null },
      fuelType:   { type: String, default: null },
      tariffType: { type: String, default: null },
      isGreen:    { type: Boolean, default: false },
      estimatedAnnualCost:   { type: Number, default: null },
      estimatedAnnualSaving: { type: Number, default: null },
    },

    // ── Energy snapshot at time of request ────────────────────
    energySnapshot: {
      businessType: { type: String, default: null },
      companyName:  { type: String, default: null },
      postcode:     { type: String, default: null },
      city:         { type: String, default: null },
      mpan:  { type: String, default: null },
      mprn:  { type: String, default: null },
      currentElectricitySupplier: { type: String, default: null },
      currentGasSupplier:         { type: String, default: null },
      annualElectricityKwh:       { type: Number, default: null },
      annualGasKwh:               { type: Number, default: null },
      electricityTariffType:      { type: String, default: null },
      gasTariffType:              { type: String, default: null },
      hasSmartMeter:              { type: Boolean, default: false },
    },

    // ── Client preferences for this request ───────────────────
    preferences: {
      fuelType:       { type: String, enum: ['electricity', 'gas', 'dual', null], default: null },
      preferGreen:    { type: Boolean, default: false },
      preferFixed:    { type: Boolean, default: true  },
      contractLength: {
        type: String,
        enum: ['no_preference', 'short', 'long', null],
        default: 'no_preference',
      },
    },

    // ── Contact details for this request ──────────────────────
    contactDetails: {
      name:  { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true, default: null },
      phone: { type: String, trim: true, default: null },
      preferredContactMethod: {
        type: String,
        enum: ['email', 'phone', 'whatsapp'],
        default: 'phone',
      },
      bestTimeToContact: { type: String, trim: true, default: null },
    },

    // ── Client's message / requirements ──────────────────────
    message: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    // ── Status ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'contacted', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },

    // ── Admin notes (internal — never sent to client) ─────────
    adminNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    contactedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
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
quoteRequestSchema.index({ client: 1, status: 1 });
quoteRequestSchema.index({ client: 1, createdAt: -1 });
quoteRequestSchema.index({ status: 1, createdAt: -1 });

// ── Auto-generate quote number ────────────────────────────────
quoteRequestSchema.pre('save', async function (next) {
  if (!this.quoteNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    this.quoteNumber = `QR-${year}-${seq}`;
  }
  next();
});

quoteRequestSchema.virtual('isActive').get(function () {
  return ['pending', 'contacted'].includes(this.status);
});

module.exports = mongoose.model('Quote', quoteRequestSchema);
