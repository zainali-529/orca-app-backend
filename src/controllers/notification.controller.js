'use strict';

/**
 * Notification Controller
 *
 * Thin HTTP layer — all logic in notification.service.js
 *
 * Routes:
 *   GET    /api/notifications              — list (paginated, filterable)
 *   GET    /api/notifications/unread-count — badge number + breakdown
 *   PATCH  /api/notifications/read-all    — mark all (or category) as read
 *   DELETE /api/notifications/clear-read  — delete all read notifications
 *   POST   /api/notifications/push-token  — register Expo push token
 *   DELETE /api/notifications/push-token  — deregister on logout
 *   PATCH  /api/notifications/:id/read    — mark single as read
 *   DELETE /api/notifications/:id         — delete one
 *
 * Admin:
 *   GET /api/admin/notifications/stats    — push delivery stats
 */

const notificationService = require('../services/notification.service');
const pushService          = require('../services/expo.push.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET /api/notifications ─────────────────────────────────────────
const getMyNotifications = async (req, res) => {
  try {
    const result = await notificationService.listForUser(req.user._id, req.query);
    return sendSuccess(res, 200, 'Notifications fetched', result);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

// ── GET /api/notifications/unread-count ───────────────────────────
const getUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user._id);
    return sendSuccess(res, 200, 'Unread count', count);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

// ── PATCH /api/notifications/:id/read ────────────────────────────
const markRead = async (req, res) => {
  try {
    const notification = await notificationService.markRead(req.user._id, req.params.id);
    if (!notification) return sendError(res, 404, 'Notification not found or already read');
    return sendSuccess(res, 200, 'Marked as read', { notification });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid notification ID');
    return sendError(res, 500, e.message);
  }
};

// ── PATCH /api/notifications/read-all ────────────────────────────
const markAllRead = async (req, res) => {
  try {
    const { category } = req.body;
    const result = await notificationService.markAllRead(req.user._id, category ?? null);
    return sendSuccess(
      res, 200,
      `${result.modifiedCount} notification(s) marked as read`,
      result
    );
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

// ── DELETE /api/notifications/:id ────────────────────────────────
const deleteNotification = async (req, res) => {
  try {
    const deleted = await notificationService.deleteNotification(req.user._id, req.params.id);
    if (!deleted) return sendError(res, 404, 'Notification not found');
    return sendSuccess(res, 200, 'Notification deleted');
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid notification ID');
    return sendError(res, 500, e.message);
  }
};

// ── DELETE /api/notifications/clear-read ─────────────────────────
const clearRead = async (req, res) => {
  try {
    const result = await notificationService.clearRead(req.user._id);
    return sendSuccess(res, 200, `${result.deletedCount} read notification(s) cleared`, result);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

// ── POST /api/notifications/push-token ───────────────────────────
const registerPushToken = async (req, res) => {
  try {
    const token = await pushService.registerToken(req.user._id, req.body);
    return sendSuccess(res, 200, 'Push token registered', {
      token: {
        id:         token._id,
        platform:   token.platform,
        deviceName: token.deviceName,
        isActive:   token.isActive,
      },
    });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ── DELETE /api/notifications/push-token ─────────────────────────
const deregisterPushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return sendError(res, 422, 'token is required in request body');
    await pushService.deregisterToken(req.user._id, token);
    return sendSuccess(res, 200, 'Push token deregistered');
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

// ── ADMIN: GET /api/admin/notifications/stats ─────────────────────
const adminGetStats = async (req, res) => {
  try {
    const stats = await notificationService.adminGetStats();
    return sendSuccess(res, 200, 'Notification stats', { stats });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearRead,
  registerPushToken,
  deregisterPushToken,
  adminGetStats,
};