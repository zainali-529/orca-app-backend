'use strict';

/**
 * Notification Service
 *
 * Core CRUD + delivery logic.
 * Every notification is:
 *   1. Saved in MongoDB (persistent, readable in-app)
 *   2. Pushed via Expo (real-time, optional)
 *
 * Push send is fire-and-forget via setImmediate()
 * so it never blocks the HTTP response.
 */

const mongoose         = require('mongoose');
const Notification     = require('../models/Notification');
const User             = require('../models/User');
const pushService      = require('./expo.push.service');

const { Types: { ObjectId } } = mongoose;

// ── Admin ID cache (5 min) ─────────────────────────────────────────
let _adminCache     = null;
let _adminCacheTime = 0;

const getAdminIds = async () => {
  const now = Date.now();
  if (_adminCache && now - _adminCacheTime < 5 * 60 * 1000) return _adminCache;
  const admins       = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  _adminCache     = admins.map((a) => a._id);
  _adminCacheTime = now;
  return _adminCache;
};

// ── Category default icons ─────────────────────────────────────────
const CATEGORY_ICONS = {
  account:      '👤',
  quote:        '📋',
  document:     '📄',
  switch:       '🔄',
  consultation: '💡',
  meter:        '📡',
  tariff:       '⚡',
  admin:        '🔧',
  system:       '🔔',
};

// ── Channel IDs for Android (matches front-end channel setup) ──────
const CATEGORY_CHANNELS = {
  account:      'account',
  quote:        'quotes',
  document:     'documents',
  switch:       'switches',
  consultation: 'consultations',
  meter:        'meter',
  tariff:       'tariff',
  admin:        'admin',
  system:       'default',
};

// ─────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────

/**
 * Create one notification + async push.
 *
 * @param {object} opts
 * @param {ObjectId|string} opts.recipient
 * @param {string}          opts.type
 * @param {string}          opts.category
 * @param {string}          opts.title
 * @param {string}          opts.body
 * @param {string}          [opts.icon]
 * @param {string}          [opts.actionRoute]   — deep-link route in app
 * @param {object}          [opts.data]          — extra payload
 * @param {ObjectId}        [opts.relatedId]
 * @param {string}          [opts.relatedModel]
 * @param {string}          [opts.priority]      — low|medium|high|urgent
 * @param {boolean}         [opts.sendPush]      — default true
 */
const create = async (opts) => {
  const {
    recipient,
    type,
    category,
    title,
    body,
    icon,
    actionRoute  = null,
    data         = {},
    relatedId    = null,
    relatedModel = null,
    priority     = 'medium',
    sendPush     = true,
  } = opts;

  // Persist to DB
  const notification = await Notification.create({
    recipient,
    type,
    category,
    title,
    body,
    icon:        icon ?? CATEGORY_ICONS[category] ?? '🔔',
    actionRoute,
    data,
    relatedId,
    relatedModel,
    priority,
    pushStatus: 'pending',
  });

  // Send push — non-blocking
  if (sendPush) {
    setImmediate(async () => {
      try {
        const result = await pushService.sendToUser(recipient, {
          title,
          body,
          priority,
          channelId: CATEGORY_CHANNELS[category] ?? 'default',
          data: {
            notificationId: notification._id.toString(),
            type,
            category,
            actionRoute,
            ...data,
          },
        });

        let pushUpdate;
        if (result.skipped || result.noTokens) {
          pushUpdate = { pushStatus: 'skipped' };
        } else if (result.sent > 0) {
          pushUpdate = { pushStatus: 'sent', pushSentAt: new Date() };
          if (result.ticketIds?.[0]) {
            pushUpdate.pushTicketId = result.ticketIds[0];
          }
        } else {
          pushUpdate = { pushStatus: 'failed', pushError: 'All tokens failed' };
        }

        await Notification.findByIdAndUpdate(notification._id, pushUpdate);
      } catch (err) {
        console.error('[Notification] Push delivery error:', err.message);
        await Notification.findByIdAndUpdate(notification._id, {
          pushStatus: 'failed',
          pushError:  err.message,
        });
      }
    });
  }

  return notification;
};

/**
 * Create notifications for multiple recipients.
 */
const createBulk = async (recipients, opts) => {
  if (!recipients || recipients.length === 0) return [];
  // Parallel — each gets its own push
  return Promise.all(recipients.map((recipient) => create({ ...opts, recipient })));
};

/**
 * Notify all admin users.
 */
const notifyAdmins = async (opts) => {
  const adminIds = await getAdminIds();
  if (!adminIds.length) return [];
  return createBulk(adminIds, opts);
};

// ─────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────

/**
 * List notifications for a user — paginated, filterable.
 */
const listForUser = async (userId, query) => {
  const {
    category,
    isRead,
    priority,
    page  = 1,
    limit = 20,
  } = query;

  const filter = { recipient: new ObjectId(String(userId)) };
  if (category !== undefined) filter.category = category;
  if (priority !== undefined) filter.priority = priority;
  if (isRead   !== undefined) {
    filter.isRead = isRead === 'true' || isRead === true;
  }

  const skip  = (page - 1) * limit;
  const total = await Notification.countDocuments(filter);

  const notifications = await Notification
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const unreadCount = await Notification.countDocuments({
    recipient: new ObjectId(String(userId)),
    isRead:    false,
  });

  return {
    notifications,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext:    page * limit < total,
      hasPrev:    page > 1,
    },
    unreadCount,
  };
};

/**
 * Unread count + breakdown by category (for badge display).
 */
const getUnreadCount = async (userId) => {
  const recipientId = new ObjectId(String(userId));

  const [total, byCategory] = await Promise.all([
    Notification.countDocuments({ recipient: recipientId, isRead: false }),
    Notification.aggregate([
      { $match: { recipient: recipientId, isRead: false } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);

  const categories = {};
  for (const c of byCategory) categories[c._id] = c.count;

  return { total, categories };
};

// ─────────────────────────────────────────────────────────────────
// MARK READ
// ─────────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 */
const markRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId, isRead: false },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
};

/**
 * Mark all (or all in a category) as read for a user.
 */
const markAllRead = async (userId, category) => {
  const filter = { recipient: userId, isRead: false };
  if (category) filter.category = category;

  const result = await Notification.updateMany(filter, {
    isRead: true,
    readAt: new Date(),
  });

  return { modifiedCount: result.modifiedCount };
};

// ─────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────

/**
 * Hard-delete a single notification (user's own only).
 */
const deleteNotification = async (userId, notificationId) => {
  const result = await Notification.deleteOne({ _id: notificationId, recipient: userId });
  return result.deletedCount > 0;
};

/**
 * Delete all read notifications for a user (spring-clean).
 */
const clearRead = async (userId) => {
  const result = await Notification.deleteMany({ recipient: userId, isRead: true });
  return { deletedCount: result.deletedCount };
};

// ─────────────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────────────

const adminGetStats = async () => {
  const [typeBreakdown, pushStats, categoryBreakdown, recentFailures] =
    await Promise.all([
      Notification.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Notification.aggregate([
        { $group: { _id: '$pushStatus', count: { $sum: 1 } } },
      ]),
      Notification.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Notification
        .find({ pushStatus: 'failed' })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('+pushError type recipient createdAt')
        .lean(),
    ]);

  const byPushStatus = {};
  for (const s of pushStats) byPushStatus[s._id] = s.count;

  return {
    topTypes:       typeBreakdown,
    byCategory:     categoryBreakdown,
    pushStatus:     byPushStatus,
    recentFailures,
  };
};

module.exports = {
  create,
  createBulk,
  notifyAdmins,
  listForUser,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearRead,
  getAdminIds,
  adminGetStats,
};