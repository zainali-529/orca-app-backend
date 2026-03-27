'use strict';

/**
 * Expo Push Service
 *
 * Sends push notifications to React Native / Expo apps.
 * Install: npm install expo-server-sdk
 *
 * Handles:
 *  - Token validation
 *  - Chunked sending (Expo limit: 100 per request)
 *  - Auto-deactivation of invalid / unregistered tokens
 *  - Graceful no-op if SDK not installed
 */

const UserPushToken = require('../models/UserPushToken');

// ── Expo client singleton ──────────────────────────────────────────
let _expoClient = null;
let _ExpoClass  = null;

const getExpoClient = () => {
  if (_expoClient) return _expoClient;
  try {
    const { Expo } = require('expo-server-sdk');
    _ExpoClass  = Expo;
    _expoClient = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
      useFcmV1:    true,
    });
    return _expoClient;
  } catch {
    console.warn('[ExpoPush] expo-server-sdk not installed — push notifications disabled');
    console.warn('[ExpoPush] Run: npm install expo-server-sdk');
    return null;
  }
};

// ── Helpers ────────────────────────────────────────────────────────

const isValidExpoToken = (token) => {
  if (!token) return false;
  if (_ExpoClass) return _ExpoClass.isExpoPushToken(token);
  // Fallback check without SDK
  return (
    token.startsWith('ExponentPushToken[') ||
    token.startsWith('ExpoPushToken[')
  );
};

// ── Token registry ─────────────────────────────────────────────────

/**
 * Register or refresh an Expo push token for a user.
 */
const registerToken = async (userId, tokenData) => {
  const { token, deviceId, deviceName, platform, appVersion } = tokenData;

  if (!isValidExpoToken(token)) {
    const e = new Error(
      'Invalid Expo push token. Must start with ExponentPushToken[...]'
    );
    e.statusCode = 400;
    throw e;
  }

  const result = await UserPushToken.findOneAndUpdate(
    { token },
    {
      user:               userId,
      token,
      deviceId:           deviceId   ?? null,
      deviceName:         deviceName ?? null,
      platform:           platform   ?? null,
      appVersion:         appVersion ?? null,
      isActive:           true,
      lastUsedAt:         new Date(),
      invalidatedAt:      null,
      invalidationReason: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return result;
};

/**
 * Deregister token on logout from a specific device.
 */
const deregisterToken = async (userId, token) => {
  await UserPushToken.findOneAndUpdate(
    { user: userId, token },
    { isActive: false }
  );
};

/**
 * Get all active tokens for a single user.
 */
const getTokensForUser = async (userId) => {
  const rows = await UserPushToken.find({ user: userId, isActive: true }).lean();
  return rows.map((r) => r.token);
};

/**
 * Get active tokens for a list of users.
 * Returns flat array of all tokens (used for bulk admin pushes).
 */
const getTokensForUsers = async (userIds) => {
  const rows = await UserPushToken.find({
    user:     { $in: userIds },
    isActive: true,
  }).lean();
  return rows.map((r) => r.token);
};

/**
 * Mark invalid tokens as deactivated.
 */
const deactivateInvalidTokens = async (tokens) => {
  if (!tokens.length) return;
  await UserPushToken.updateMany(
    { token: { $in: tokens } },
    {
      isActive:           false,
      invalidatedAt:      new Date(),
      invalidationReason: 'DeviceNotRegistered or InvalidCredentials',
    }
  );
  console.log(`[ExpoPush] Deactivated ${tokens.length} invalid token(s)`);
};

// ── Core send function ─────────────────────────────────────────────

/**
 * Send push notifications to a list of tokens.
 *
 * @param {string[]} tokens   - Expo push tokens
 * @param {object}  message   - { title, body, data, priority }
 * @returns {Promise<{ sent, failed, invalidTokens, skipped? }>}
 */
const sendPushNotifications = async (tokens, message) => {
  const expo = getExpoClient();

  if (!expo) {
    return { sent: 0, failed: 0, invalidTokens: [], skipped: true };
  }

  if (!tokens || tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  // Keep only valid Expo tokens
  const validTokens = tokens.filter(isValidExpoToken);
  if (validTokens.length === 0) {
    return { sent: 0, failed: tokens.length, invalidTokens: tokens };
  }

  // Build message objects
  const messages = validTokens.map((pushToken) => ({
    to:        pushToken,
    sound:     'default',
    title:     message.title,
    body:      message.body,
    data:      message.data   ?? {},
    priority:  message.priority === 'urgent' ? 'high' : 'default',
    channelId: message.channelId ?? 'default', // Android channel
    badge:     message.badge ?? undefined,
  }));

  // Expo allows max 100 messages per request
  const chunks       = expo.chunkPushNotifications(messages);
  let   sent         = 0;
  let   failed       = 0;
  const invalidTokens = [];
  const ticketIds     = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          sent++;
          if (ticket.id) ticketIds.push(ticket.id);
        } else {
          failed++;
          console.warn(`[ExpoPush] Ticket error for token ${validTokens[i]}: ${ticket.message}`);

          const errCode = ticket.details?.error;
          if (
            errCode === 'DeviceNotRegistered' ||
            errCode === 'InvalidCredentials'
          ) {
            invalidTokens.push(validTokens[i]);
          }
        }
      });
    } catch (chunkErr) {
      console.error('[ExpoPush] Chunk send failed:', chunkErr.message);
      failed += chunk.length;
    }
  }

  // Clean up bad tokens
  if (invalidTokens.length > 0) {
    await deactivateInvalidTokens(invalidTokens);
  }

  return { sent, failed, invalidTokens, ticketIds };
};

// ── Convenience wrappers ───────────────────────────────────────────

/**
 * Send to a single user (all their active devices).
 */
const sendToUser = async (userId, message) => {
  const tokens = await getTokensForUser(userId);
  if (!tokens.length) return { sent: 0, failed: 0, noTokens: true };
  return sendPushNotifications(tokens, message);
};

/**
 * Send to multiple users (all their active devices).
 */
const sendToUsers = async (userIds, message) => {
  const tokens = await getTokensForUsers(userIds);
  if (!tokens.length) return { sent: 0, failed: 0, noTokens: true };
  return sendPushNotifications(tokens, message);
};

module.exports = {
  registerToken,
  deregisterToken,
  getTokensForUser,
  getTokensForUsers,
  sendPushNotifications,
  sendToUser,
  sendToUsers,
  isValidExpoToken,
};