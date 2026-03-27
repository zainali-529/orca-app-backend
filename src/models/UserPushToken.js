'use strict';

/**
 * UserPushToken
 *
 * Stores Expo push notification tokens per device.
 * One user can have multiple tokens (multiple devices).
 *
 * Token format: ExponentPushToken[xxxxxxxxxxxxxx]
 *
 * Lifecycle:
 *   App start → registerToken()
 *   Logout    → deregisterToken()
 *   Push fail → auto-deactivate (DeviceNotRegistered)
 */

const mongoose = require('mongoose');

const userPushTokenSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    // Expo push token — unique per device install
    token: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
    },

    // Device info for debugging
    deviceId:    { type: String, default: null, trim: true },
    deviceName:  { type: String, default: null, trim: true, maxlength: 100 },

    platform: {
      type:    String,
      enum:    ['ios', 'android', 'web', null],
      default: null,
    },

    appVersion: { type: String, default: null, trim: true },

    // Active = receive pushes
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    lastUsedAt: {
      type:    Date,
      default: Date.now,
    },

    // Set when Expo returns DeviceNotRegistered
    invalidatedAt: {
      type:    Date,
      default: null,
    },
    invalidationReason: {
      type:    String,
      default: null,
      select:  false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        delete ret.invalidationReason;
        return ret;
      },
    },
  }
);

userPushTokenSchema.index({ user: 1, isActive: 1 });
userPushTokenSchema.index({ token: 1 });

module.exports = mongoose.model('UserPushToken', userPushTokenSchema);