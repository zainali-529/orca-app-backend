'use strict';

const { z } = require('zod');

const CATEGORIES = [
  'account', 'quote', 'document', 'switch',
  'consultation', 'meter', 'tariff', 'admin', 'system',
];

// ── POST /api/notifications/push-token ───────────────────────────
const registerPushTokenSchema = z.object({
  token: z
    .string({ required_error: 'Expo push token is required' })
    .trim()
    .min(10, 'Invalid push token'),

  deviceId:   z.string().trim().max(200).optional().nullable(),
  deviceName: z.string().trim().max(100).optional().nullable(),
  platform:   z.enum(['ios', 'android', 'web']).optional().nullable(),
  appVersion: z.string().trim().max(20).optional().nullable(),
});

// ── DELETE /api/notifications/push-token ─────────────────────────
const deregisterPushTokenSchema = z.object({
  token: z
    .string({ required_error: 'token is required' })
    .trim()
    .min(10, 'Invalid push token'),
});

// ── GET /api/notifications ────────────────────────────────────────
const listNotificationsSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  isRead:   z.enum(['true', 'false']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
});

// ── PATCH /api/notifications/read-all ────────────────────────────
const markAllReadSchema = z.object({
  // Optionally restrict to one category
  category: z.enum(CATEGORIES).optional().nullable(),
});

module.exports = {
  registerPushTokenSchema,
  deregisterPushTokenSchema,
  listNotificationsSchema,
  markAllReadSchema,
};