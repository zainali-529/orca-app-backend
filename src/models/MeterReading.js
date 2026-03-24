const mongoose = require('mongoose');

/**
 * MeterReading
 *
 * Manual workflow (Phase 1):
 *   Client requests usage data → Admin manually pulls from meter provider
 *   → Admin submits readings → Client sees their consumption data
 *
 * Future (Phase 2 — n3rgy API):
 *   Same model, same flow — just the admin fulfillment step gets automated.
 *   Only change: fulfillment source tag switches from 'manual' to 'n3rgy_api'
 *
 * Status flow:
 *   requested → processing → fulfilled
 *                         ↘ failed
 */

// ── Individual reading data point ─────────────────────────────────
const readingPointSchema = new mongoose.Schema(
  {
    timestamp:   { type: Date,   required: true },
    value:       { type: Number, required: true },    // kWh consumed
    unit:        { type: String, default: 'kWh' },
    readingType: {
      type: String,
      enum: ['actual', 'estimated', 'substituted'],
      default: 'actual',
    },
  },
  { _id: false }
);

// ── Consumption summary (what client sees) ────────────────────────
const consumptionSummarySchema = new mongoose.Schema(
  {
    totalKwh:        { type: Number, default: null },
    dailyAvgKwh:     { type: Number, default: null },
    monthlyAvgKwh:   { type: Number, default: null },
    peakDemandKw:    { type: Number, default: null },   // for HH data
    periodDays:      { type: Number, default: null },
    estimatedAnnualKwh: { type: Number, default: null },

    // Cost estimate at current tariff rates
    estimatedAnnualCost: { type: Number, default: null },  // £
    currency: { type: String, default: 'GBP' },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────
const meterReadingSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────
    readingNumber: {
      type: String, unique: true,
      // Auto-generated: MR-2026-000001
    },

    // ── Ownership ─────────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      required: true, index: true,
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      default: null, index: true,
    },

    // ── Meter identifiers (snapshot at request time) ──────────
    mpan: { type: String, trim: true, default: null },   // electricity
    mprn: { type: String, trim: true, default: null },   // gas

    // ── Request details ───────────────────────────────────────
    fuelType: {
      type: String,
      enum: ['electricity', 'gas', 'both'],
      required: true,
      default: 'electricity',
      index: true,
    },

    requestType: {
      type: String,
      enum: [
        'current_usage',   // latest available reading
        'historical',      // specific date range
        'annual_estimate', // estimated annual consumption
      ],
      default: 'current_usage',
    },

    // Requested period (for historical requests)
    periodFrom: { type: Date, default: null },
    periodTo:   { type: Date, default: null },

    // Client's message / context
    clientNotes: {
      type: String, trim: true, maxlength: 1000, default: null,
    },

    // ── Status ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['requested', 'processing', 'fulfilled', 'failed'],
      default: 'requested',
      index: true,
    },

    // ── Fulfillment data (populated by admin) ─────────────────
    // Actual period data was pulled for
    dataFrom: { type: Date, default: null },
    dataTo:   { type: Date, default: null },

    // Data source — 'manual' for now, 'n3rgy_api' in Phase 2
    dataSource: {
      type: String,
      enum: ['manual', 'n3rgy_api', 'supplier_portal', 'smart_meter_app'],
      default: 'manual',
    },

    // Electricity consumption
    electricity: {
      type: consumptionSummarySchema,
      default: null,
    },

    // Gas consumption
    gas: {
      type: consumptionSummarySchema,
      default: null,
    },

    // Individual data points (optional — for detailed charts)
    // Admin can submit raw readings for future chart support
    readings: {
      type: [readingPointSchema],
      default: [],
    },

    // Admin notes (internal — never sent to client)
    adminNotes: {
      type: String, trim: true, maxlength: 2000,
      default: null, select: false,
    },

    // Failure reason (if status = failed)
    failureReason: {
      type: String, trim: true, maxlength: 500, default: null,
    },

    // Key timestamps
    processingAt: { type: Date, default: null },
    fulfilledAt:  { type: Date, default: null },
    failedAt:     { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.adminNotes;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────
meterReadingSchema.index({ client: 1, status: 1 });
meterReadingSchema.index({ client: 1, createdAt: -1 });
meterReadingSchema.index({ assignedAdmin: 1, status: 1 });
meterReadingSchema.index({ status: 1, createdAt: -1 });
meterReadingSchema.index({ mpan: 1 }, { sparse: true });
meterReadingSchema.index({ mprn: 1 }, { sparse: true });

// ── Auto-generate readingNumber ────────────────────────────────────
meterReadingSchema.pre('save', async function (next) {
  if (!this.readingNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    this.readingNumber = `MR-${year}-${seq}`;
  }
  next();
});

// ── Virtuals ──────────────────────────────────────────────────────
meterReadingSchema.virtual('isPending').get(function () {
  return ['requested', 'processing'].includes(this.status);
});

meterReadingSchema.virtual('hasFuelData').get(function () {
  return (this.electricity?.totalKwh != null) || (this.gas?.totalKwh != null);
});

// Total combined annual estimate (electricity + gas)
meterReadingSchema.virtual('combinedAnnualKwh').get(function () {
  const elec = this.electricity?.estimatedAnnualKwh ?? 0;
  const gas  = this.gas?.estimatedAnnualKwh ?? 0;
  return elec + gas || null;
});

module.exports = mongoose.model('MeterReading', meterReadingSchema);