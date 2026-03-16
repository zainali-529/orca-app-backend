const profileService = require('../services/profile.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET /api/profile ────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const { profile, user } = await profileService.getMyProfile(req.user._id);

    return sendSuccess(res, 200, 'Profile fetched', {
      profile,
      user: {
        id:          user._id,
        firstName:   user.firstName,
        lastName:    user.lastName,
        email:       user.email,
        phone:       user.phone,
        isVerified:  user.isVerified,
        createdAt:   user.createdAt,
      },
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── PATCH /api/profile ──────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const profile = await profileService.updateProfile(req.user._id, req.body);
    return sendSuccess(res, 200, 'Profile updated', { profile });
  } catch (error) {
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ── GET /api/profile/onboarding/status ─────────────────────────
const getOnboardingStatus = async (req, res) => {
  try {
    const status = await profileService.getOnboardingStatus(req.user._id);
    return sendSuccess(res, 200, 'Onboarding status fetched', status);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/profile/onboarding/step/1 ─────────────────────────
const saveStep1 = async (req, res) => {
  try {
    const profile = await profileService.saveStep1(req.user._id, req.body);
    return sendSuccess(res, 200, 'Step 1 saved — business type selected', {
      profile,
      nextStep: profile.onboarding.currentStep,
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/profile/onboarding/step/2 ─────────────────────────
const saveStep2 = async (req, res) => {
  try {
    const profile = await profileService.saveStep2(req.user._id, req.body);
    return sendSuccess(res, 200, 'Step 2 saved — business details', {
      profile,
      nextStep: profile.onboarding.currentStep,
      skipped: profile.businessType === 'residential',
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/profile/onboarding/step/3 ─────────────────────────
const saveStep3 = async (req, res) => {
  try {
    const profile = await profileService.saveStep3(req.user._id, req.body);
    return sendSuccess(res, 200, 'Step 3 saved — address', {
      profile,
      nextStep: profile.onboarding.currentStep,
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/profile/onboarding/step/4 ─────────────────────────
const saveStep4 = async (req, res) => {
  try {
    const profile = await profileService.saveStep4(req.user._id, req.body);
    return sendSuccess(res, 200, 'Step 4 saved — energy details', {
      profile,
      nextStep: profile.onboarding.currentStep,
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/profile/onboarding/step/5 ─────────────────────────
const saveStep5 = async (req, res) => {
  try {
    const profile = await profileService.saveStep5(req.user._id, req.body);
    return sendSuccess(res, 200, 'Onboarding complete!', {
      profile,
      isCompleted: profile.onboarding.isCompleted,
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getOnboardingStatus,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  saveStep5,
};