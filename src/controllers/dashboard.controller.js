/**
 * Dashboard Controller
 *
 * Thin HTTP layer — all business logic lives in dashboard.service.js
 *
 * Endpoints:
 *   GET /api/dashboard          → client dashboard
 *   GET /api/admin/dashboard    → admin dashboard (wired from admin.routes.js)
 */

'use strict';

const dashboardService        = require('../services/dashboard.service');
const { sendSuccess, sendError } = require('../utils/response');

// ─── CLIENT dashboard ─────────────────────────────────────────────
// GET /api/dashboard
const getClientDashboard = async (req, res) => {
  try {
    const data = await dashboardService.getClientDashboard(req.user._id);
    return sendSuccess(res, 200, 'Dashboard loaded', data);
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid user ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ─── ADMIN dashboard ──────────────────────────────────────────────
// GET /api/admin/dashboard
const getAdminDashboard = async (req, res) => {
  try {
    const data = await dashboardService.getAdminDashboard();
    return sendSuccess(res, 200, 'Admin dashboard loaded', data);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
};

module.exports = { getClientDashboard, getAdminDashboard };