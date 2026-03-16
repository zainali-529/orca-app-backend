const express = require('express');
const router  = express.Router();

const profileController = require('../controllers/profile.controller');
const { protect }       = require('../middleware/auth');
const validate          = require('../middleware/validate');
const {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  updateProfileSchema,
} = require('../validators/profile.validators');

// All profile routes require authentication
router.use(protect);

// ── Profile ────────────────────────────────────────────────────

// GET  /api/profile          — get my full profile + user info
router.get('/', profileController.getProfile);

// PATCH /api/profile         — update any profile field
router.patch('/', validate(updateProfileSchema), profileController.updateProfile);

// ── Onboarding ─────────────────────────────────────────────────

// GET  /api/profile/onboarding/status  — current progress
router.get('/onboarding/status', profileController.getOnboardingStatus);

// POST /api/profile/onboarding/step/1  — business type
router.post('/onboarding/step/1', validate(step1Schema), profileController.saveStep1);

// POST /api/profile/onboarding/step/2  — business details
router.post('/onboarding/step/2', validate(step2Schema), profileController.saveStep2);

// POST /api/profile/onboarding/step/3  — address
router.post('/onboarding/step/3', validate(step3Schema), profileController.saveStep3);

// POST /api/profile/onboarding/step/4  — energy details (MPAN, MPRN, suppliers)
router.post('/onboarding/step/4', validate(step4Schema), profileController.saveStep4);

// POST /api/profile/onboarding/step/5  — preferences + complete
router.post('/onboarding/step/5', validate(step5Schema), profileController.saveStep5);

module.exports = router;