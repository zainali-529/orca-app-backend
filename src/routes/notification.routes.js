'use strict';

/**
 * Notification Routes
 *
 * All routes require authentication.
 *
 * IMPORTANT: Static routes (/unread-count, /read-all, etc.)
 * MUST be defined before parameterized routes (/:id)
 * to prevent 'read-all' etc. being treated as an ID.
 */

const express    = require('express');
const router     = express.Router();

const notificationController = require('../controllers/notification.controller');
const { protect }     = require('../middleware/auth');
const validate        = require('../middleware/validate');
const validateQuery   = require('../middleware/validateQuery');
const {
  registerPushTokenSchema,
  listNotificationsSchema,
  markAllReadSchema,
  deregisterPushTokenSchema,
} = require('../validators/notification.validators');

// All notification routes require auth
router.use(protect);

// ── Static routes (must come before /:id) ──────────────────────────

// GET  /api/notifications/unread-count
router.get('/unread-count', notificationController.getUnreadCount);

// PATCH /api/notifications/read-all
router.patch(
  '/read-all',
  validate(markAllReadSchema),
  notificationController.markAllRead
);

// DELETE /api/notifications/clear-read
router.delete('/clear-read', notificationController.clearRead);

// POST /api/notifications/push-token  — register Expo push token
router.post(
  '/push-token',
  validate(registerPushTokenSchema),
  notificationController.registerPushToken
);

// DELETE /api/notifications/push-token  — deregister on logout / device change
router.delete(
  '/push-token',
  validate(deregisterPushTokenSchema),
  notificationController.deregisterPushToken
);

// ── List (paginated) ───────────────────────────────────────────────

// GET /api/notifications
router.get(
  '/',
  validateQuery(listNotificationsSchema),
  notificationController.getMyNotifications
);

// ── Parameterized routes ───────────────────────────────────────────

// PATCH /api/notifications/:id/read
router.patch('/:id/read', notificationController.markRead);

// DELETE /api/notifications/:id
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;