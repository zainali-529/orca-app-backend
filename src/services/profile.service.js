const UserProfile = require('../models/UserProfile');
const User        = require('../models/User');

// ── Helpers ────────────────────────────────────────────────────

/**
 * Get or create a profile for a user.
 * Profile is created empty on first access — no blocking step.
 */
const getOrCreateProfile = async (userId) => {
  let profile = await UserProfile.findOne({ user: userId });
  if (!profile) {
    profile = await UserProfile.create({ user: userId });
  }
  return profile;
};

/**
 * Recalculate which onboarding steps are complete and
 * update isCompleted + currentStep accordingly.
 */
const recalculateOnboarding = (profile) => {
  const s = profile.onboarding.steps;

  s.businessType    = !!profile.businessType;
  s.businessDetails = profile.businessType === 'residential'
    ? true  // residential users skip company details
    : !!(profile.companyName);
  s.address        = !!(profile.billingAddress?.line1 && profile.billingAddress?.postcode);
  s.energyDetails  = !!(profile.energy?.mpan || profile.energy?.mprn);
  s.review         = Object.values(s).every(Boolean);

  // currentStep = first incomplete step (1-indexed)
  const stepOrder = ['businessType', 'businessDetails', 'address', 'energyDetails', 'review'];
  const firstIncomplete = stepOrder.findIndex((k) => !s[k]);
  profile.onboarding.currentStep = firstIncomplete === -1 ? 5 : firstIncomplete + 1;

  // If they already completed it once, we don't force them back to false
  // unless they completely wipe required fields. But for UX, let's keep isCompleted true
  // so they don't get trapped in onboarding.
  if (!profile.onboarding.completedAt) {
    profile.onboarding.isCompleted = s.review;
    if (s.review) {
      profile.onboarding.completedAt = new Date();
    }
  } else {
    // If it was already completed, we just update the steps but leave isCompleted true
    // so they aren't trapped in the app layout redirect
    profile.onboarding.isCompleted = true;
  }

  return profile;
};

// ── Service methods ────────────────────────────────────────────

/**
 * GET /api/profile
 * Returns profile + user info merged
 */
const getMyProfile = async (userId) => {
  const [profile, user] = await Promise.all([
    getOrCreateProfile(userId),
    User.findById(userId),
  ]);
  return { profile, user };
};

/**
 * POST /api/profile/onboarding/step/1
 * Business type selection
 */
const saveStep1 = async (userId, data) => {
  const profile = await getOrCreateProfile(userId);
  profile.businessType = data.businessType;
  recalculateOnboarding(profile);
  await profile.save();
  return profile;
};

/**
 * POST /api/profile/onboarding/step/2
 * Business details — skipped automatically for residential
 */
const saveStep2 = async (userId, data) => {
  const profile = await getOrCreateProfile(userId);

  if (profile.businessType === 'residential') {
    // Mark step complete automatically
    profile.onboarding.steps.businessDetails = true;
    recalculateOnboarding(profile);
    await profile.save();
    return profile;
  }

  Object.assign(profile, {
    companyName:       data.companyName       ?? profile.companyName,
    companyNumber:     data.companyNumber     ?? profile.companyNumber,
    vatNumber:         data.vatNumber         ?? profile.vatNumber,
    sicCode:           data.sicCode           ?? profile.sicCode,
    numberOfEmployees: data.numberOfEmployees ?? profile.numberOfEmployees,
    businessPhone:     data.businessPhone     ?? profile.businessPhone,
    businessEmail:     data.businessEmail     ?? profile.businessEmail,
  });

  recalculateOnboarding(profile);
  await profile.save();
  return profile;
};

/**
 * POST /api/profile/onboarding/step/3
 * Address
 */
const saveStep3 = async (userId, data) => {
  const profile = await getOrCreateProfile(userId);

  profile.billingAddress = data.billingAddress;
  profile.sameAddress    = data.sameAddress ?? true;
  profile.supplyAddress  = data.sameAddress
    ? data.billingAddress        // copy billing to supply
    : (data.supplyAddress ?? profile.supplyAddress);

  recalculateOnboarding(profile);
  await profile.save();
  return profile;
};

/**
 * POST /api/profile/onboarding/step/4
 * Energy details — MPAN, MPRN, suppliers, consumption
 */
const saveStep4 = async (userId, data) => {
  const profile = await getOrCreateProfile(userId);

  // Merge into existing energy subdocument
  profile.energy = {
    ...profile.energy?.toObject?.() ?? {},
    mpan:                       data.mpan                       ?? profile.energy?.mpan,
    currentElectricitySupplier: data.currentElectricitySupplier ?? profile.energy?.currentElectricitySupplier,
    annualElectricityKwh:       data.annualElectricityKwh       ?? profile.energy?.annualElectricityKwh,
    electricityContractEndDate: data.electricityContractEndDate
      ? new Date(data.electricityContractEndDate)
      : profile.energy?.electricityContractEndDate,
    electricityTariffType:      data.electricityTariffType      ?? profile.energy?.electricityTariffType,
    mprn:                       data.mprn                       ?? profile.energy?.mprn,
    currentGasSupplier:         data.currentGasSupplier         ?? profile.energy?.currentGasSupplier,
    annualGasKwh:               data.annualGasKwh               ?? profile.energy?.annualGasKwh,
    gasContractEndDate:         data.gasContractEndDate
      ? new Date(data.gasContractEndDate)
      : profile.energy?.gasContractEndDate,
    gasTariffType:              data.gasTariffType              ?? profile.energy?.gasTariffType,
    hasSmartMeter:              data.hasSmartMeter              ?? profile.energy?.hasSmartMeter,
  };

  recalculateOnboarding(profile);
  await profile.save();
  return profile;
};

/**
 * POST /api/profile/onboarding/step/5
 * Preferences + mark onboarding complete
 */
const saveStep5 = async (userId, data) => {
  const profile = await getOrCreateProfile(userId);

  profile.preferGreenEnergy  = data.preferGreenEnergy  ?? profile.preferGreenEnergy;
  profile.preferFixedTariff  = data.preferFixedTariff  ?? profile.preferFixedTariff;
  profile.contactPreference  = data.contactPreference  ?? profile.contactPreference;

  // Force review complete
  profile.onboarding.steps.review = true;
  recalculateOnboarding(profile);
  await profile.save();
  return profile;
};

/**
 * GET /api/profile/onboarding/status
 * Returns current onboarding progress
 */
const getOnboardingStatus = async (userId) => {
  const profile = await getOrCreateProfile(userId);
  return {
    isCompleted:  profile.onboarding.isCompleted,
    completedAt:  profile.onboarding.completedAt,
    currentStep:  profile.onboarding.currentStep,
    totalSteps:   5,
    steps:        profile.onboarding.steps,
    businessType: profile.businessType,
  };
};

/**
 * PATCH /api/profile
 * Update any profile field(s) — also updates User name/phone
 */
const updateProfile = async (userId, data) => {
  const { firstName, lastName, phone, energy, billingAddress, supplyAddress, ...rest } = data;

  // Update User model if name or phone changed
  if (firstName || lastName || phone !== undefined) {
    await User.findByIdAndUpdate(userId, {
      ...(firstName && { firstName }),
      ...(lastName  && { lastName }),
      ...(phone !== undefined && { phone }),
    });
  }

  const profile = await getOrCreateProfile(userId);

  // Merge nested energy object
  if (energy) {
    profile.energy = { ...profile.energy?.toObject?.() ?? {}, ...energy };
  }

  // Merge addresses
  if (billingAddress) {
    profile.billingAddress = { ...profile.billingAddress?.toObject?.() ?? {}, ...billingAddress };
  }
  if (supplyAddress) {
    profile.supplyAddress = { ...profile.supplyAddress?.toObject?.() ?? {}, ...supplyAddress };
  }

  // Apply top-level fields
  Object.assign(profile, rest);

  // Re-evaluate onboarding after any update
  recalculateOnboarding(profile);
  await profile.save();

  return profile;
};

module.exports = {
  getMyProfile,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  saveStep5,
  getOnboardingStatus,
  updateProfile,
};