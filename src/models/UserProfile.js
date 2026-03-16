const mongoose = require('mongoose');

// ── UK Address sub-schema ──────────────────────────────────────
const addressSchema = new mongoose.Schema(
  {
    line1:    { type: String, trim: true, default: null },
    line2:    { type: String, trim: true, default: null },
    city:     { type: String, trim: true, default: null },
    county:   { type: String, trim: true, default: null },
    postcode: { type: String, trim: true, uppercase: true, default: null },
    country:  { type: String, trim: true, default: 'United Kingdom' },
  },
  { _id: false }
);

// ── Energy site sub-schema ─────────────────────────────────────
// A broker client may have multiple sites (multi-site feature later)
// For MVP, we store primary energy data directly on the profile
const energyDetailsSchema = new mongoose.Schema(
  {
    // Electricity
    mpan: {
      type: String,
      trim: true,
      default: null,
      // UK MPAN is 13 digits
    },
    currentElectricitySupplier: { type: String, trim: true, default: null },
    annualElectricityKwh:       { type: Number, default: null, min: 0 },
    electricityContractEndDate: { type: Date,   default: null },
    electricityTariffType: {
      type: String,
      enum: ['fixed', 'variable', 'flexible', 'unknown', null],
      default: null,
    },

    // Gas
    mprn: {
      type: String,
      trim: true,
      default: null,
      // UK MPRN is 6-10 digits
    },
    currentGasSupplier: { type: String, trim: true, default: null },
    annualGasKwh:       { type: Number, default: null, min: 0 },
    gasContractEndDate: { type: Date,   default: null },
    gasTariffType: {
      type: String,
      enum: ['fixed', 'variable', 'flexible', 'unknown', null],
      default: null,
    },

    // Smart meter
    hasSmartMeter: { type: Boolean, default: false },
  },
  { _id: false }
);

// ── Onboarding progress tracking ──────────────────────────────
const onboardingSchema = new mongoose.Schema(
  {
    isCompleted:  { type: Boolean, default: false },
    completedAt:  { type: Date,    default: null  },
    currentStep:  { type: Number,  default: 1, min: 1, max: 5 },
    // Which steps are done
    steps: {
      businessType:    { type: Boolean, default: false }, // step 1
      businessDetails: { type: Boolean, default: false }, // step 2
      address:         { type: Boolean, default: false }, // step 3
      energyDetails:   { type: Boolean, default: false }, // step 4
      review:          { type: Boolean, default: false }, // step 5
    },
  },
  { _id: false }
);

// ── Main UserProfile schema ────────────────────────────────────
const userProfileSchema = new mongoose.Schema(
  {
    // One-to-one with User
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── Business Type ────────────────────────────────────────
    businessType: {
      type: String,
      enum: ['residential', 'sme', 'commercial', 'industrial'],
      default: null,
    },

    // ── Business Details (for non-residential) ──────────────
    companyName:   { type: String, trim: true, default: null },
    companyNumber: { type: String, trim: true, default: null }, // Companies House
    vatNumber:     { type: String, trim: true, default: null },
    sicCode:       { type: String, trim: true, default: null }, // Standard Industry Code
    numberOfEmployees: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+', null],
      default: null,
    },

    // ── Contact & Address ────────────────────────────────────
    businessPhone:   { type: String, trim: true, default: null },
    businessEmail:   { type: String, trim: true, lowercase: true, default: null },
    billingAddress:  { type: addressSchema, default: () => ({}) },
    supplyAddress:   { type: addressSchema, default: () => ({}) },
    // Flag — if supply same as billing
    sameAddress: { type: Boolean, default: true },

    // ── Energy Details ───────────────────────────────────────
    energy: { type: energyDetailsSchema, default: () => ({}) },

    // ── Preferences ─────────────────────────────────────────
    preferGreenEnergy:    { type: Boolean, default: false },
    preferFixedTariff:    { type: Boolean, default: true  },
    contactPreference: {
      type: String,
      enum: ['email', 'phone', 'whatsapp'],
      default: 'email',
    },

    // ── Onboarding progress ──────────────────────────────────
    onboarding: { type: onboardingSchema, default: () => ({}) },

    // ── Avatar / profile picture ─────────────────────────────
    avatarUrl: { type: String, default: null },

    // ── Notes (broker internal note about themselves) ────────
    notes: { type: String, trim: true, maxlength: 1000, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────
userProfileSchema.index({ user: 1 });
userProfileSchema.index({ 'energy.mpan': 1 }, { sparse: true });
userProfileSchema.index({ 'energy.mprn': 1 }, { sparse: true });
userProfileSchema.index({ companyNumber: 1 },  { sparse: true });

module.exports = mongoose.model('UserProfile', userProfileSchema);