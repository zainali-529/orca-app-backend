const mongoose = require('mongoose');

/**
 * UK Energy Tariff
 *
 * Rates stored in pence (not pounds) for precision:
 *   unitRate      → p/kWh
 *   standingCharge → p/day
 *
 * Annual cost formula:
 *   cost = (unitRate/100 * annualKwh) + (standingCharge/100 * 365)
 */
const tariffSchema = new mongoose.Schema(
  {
    // ── Supplier ─────────────────────────────────────────────
    supplier: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
      index: true,
    },
    supplierLogo: {
      type: String, // URL to logo image
      default: null,
    },
    supplierRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    // ── Tariff identity ───────────────────────────────────────
    tariffName: {
      type: String,
      required: [true, 'Tariff name is required'],
      trim: true,
    },
    tariffCode: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Fuel type ─────────────────────────────────────────────
    fuelType: {
      type: String,
      enum: ['electricity', 'gas', 'dual'],
      required: true,
      index: true,
    },

    // ── Tariff type ───────────────────────────────────────────
    tariffType: {
      type: String,
      enum: ['fixed', 'variable', 'flexible', 'prepayment'],
      required: true,
      index: true,
    },

    // ── Region ────────────────────────────────────────────────
    // 'national' means available everywhere in the UK
    region: {
      type: String,
      enum: [
        'national',
        'eastern',
        'east_midlands',
        'london',
        'merseyside_north_wales',
        'midlands',
        'north_eastern',
        'north_western',
        'scotland_north',
        'scotland_south',
        'south_eastern',
        'southern',
        'south_western',
        'yorkshire',
      ],
      default: 'national',
      index: true,
    },

    // ── Rates (pence) ─────────────────────────────────────────
    // For dual fuel tariffs, rates are stored as electricity + gas
    electricity: {
      unitRate:       { type: Number, default: null }, // p/kWh
      standingCharge: { type: Number, default: null }, // p/day
    },
    gas: {
      unitRate:       { type: Number, default: null }, // p/kWh
      standingCharge: { type: Number, default: null }, // p/day
    },

    // ── Contract ──────────────────────────────────────────────
    contractLengthMonths: {
      type: Number,
      default: 12,
    },
    exitFee: {
      type: Number, // £ per fuel
      default: 0,
    },

    // ── Features ──────────────────────────────────────────────
    isGreen:         { type: Boolean, default: false },
    onlineDiscount:  { type: Boolean, default: false },
    cashback:        { type: Number,  default: 0 }, // £
    features:        [{ type: String, trim: true }],
    smartMeterRequired: { type: Boolean, default: false },

    // ── Ofgem / external reference ────────────────────────────
    ofgemProductCode: { type: String, default: null },

    // ── Validity ──────────────────────────────────────────────
    availableFrom: { type: Date, default: Date.now },
    availableTo:   { type: Date, default: null }, // null = currently available
    isActive:      { type: Boolean, default: true, index: true },

    // ── Meta ──────────────────────────────────────────────────
    source: {
      type: String,
      enum: ['ofgem', 'ofgem_cap', 'octopus', 'supplier', 'manual', 'seed'],
      default: 'seed',
    },
    lastUpdated: { type: Date, default: Date.now },
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

// ── Compound index ─────────────────────────────────────────────
tariffSchema.index({ supplier: 1, fuelType: 1, tariffType: 1 });
tariffSchema.index({ isActive: 1, fuelType: 1, tariffType: 1 });

// ── Virtual: annual electricity cost at average usage ─────────
tariffSchema.virtual('annualCostElecAvg').get(function () {
  if (!this.electricity?.unitRate || !this.electricity?.standingCharge) return null;
  // UK average electricity usage: 2,900 kWh/yr
  const AVG_KWH = 2900;
  return Math.round(
    (this.electricity.unitRate / 100) * AVG_KWH +
    (this.electricity.standingCharge / 100) * 365
  );
});

// ── Virtual: annual gas cost at average usage ─────────────────
tariffSchema.virtual('annualCostGasAvg').get(function () {
  if (!this.gas?.unitRate || !this.gas?.standingCharge) return null;
  // UK average gas usage: 11,500 kWh/yr
  const AVG_KWH = 11500;
  return Math.round(
    (this.gas.unitRate / 100) * AVG_KWH +
    (this.gas.standingCharge / 100) * 365
  );
});

module.exports = mongoose.model('Tariff', tariffSchema);