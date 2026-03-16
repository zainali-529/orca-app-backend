const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, refreshSchema } = require('../validators/auth.validators');

// ── Public routes ──────────────────────────────────────────

// POST /api/auth/register
router.post('/register', validate(registerSchema), authController.register);

// POST /api/auth/login
router.post('/login', validate(loginSchema), authController.login);

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), authController.refresh);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// ── Protected routes ───────────────────────────────────────

// GET /api/auth/me
router.get('/me', protect, authController.getMe);

// POST /api/auth/logout-all (revoke all devices)
router.post('/logout-all', protect, authController.logoutAll);

module.exports = router;
