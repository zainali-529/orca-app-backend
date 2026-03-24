/**
 * Dashboard Routes — Client
 *
 * GET /api/dashboard   →  personalised client dashboard
 *
 * Admin dashboard is wired separately in admin.routes.js:
 *   GET /api/admin/dashboard  →  dashboardController.getAdminDashboard
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboard.controller');

// ── All dashboard routes require authentication ────────────────────
router.use(protect);

// GET /api/dashboard
router.get('/', dashboardController.getClientDashboard);

module.exports = router;