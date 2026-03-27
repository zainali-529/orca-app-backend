'use strict';

const mongoose = require('mongoose');

// ── All notification types ─────────────────────────────────────────
const NOTIFICATION_TYPES = [
  // Account
  'welcome',
  'password_changed',
  'account_deactivated',

  // Quote
  'quote_received',      // admin
  'quote_contacted',     // client
  'quote_completed',     // client
  'quote_cancelled',     // client

  // Document
  'document_sent',       // client — broker sent LOA
  'document_signed',     // admin  — client signed
  'document_expiring',   // client — N days left
  'document_expired',    // client — expired unsigned

  // Switch
  'switch_initiated',
  'switch_submitted',
  'switch_cooling_off',
  'switch_cooling_off_ending',
  'switch_objected',
  'switch_objection_resolved',
  'switch_in_progress',
  'switch_completed',
  'switch_cancelled',
  'switch_failed',

  // Consultation
  'consultation_booked',
  'consultation_payment_confirmed',
  'consultation_payment_failed',
  'consultation_scheduled',
  'consultation_reminder_24h',
  'consultation_reminder_1h',
  'consultation_completed',
  'consultation_cancelled',
  'consultation_refunded',
  'consultation_no_show',

  // Meter readings
  'meter_request_received', // admin
  'meter_processing',       // client
  'meter_fulfilled',        // client
  'meter_failed',           // client

  // Tariff / Energy contract
  'contract_renewal_60',
  'contract_renewal_30',
  'contract_renewal_14',
  'better_deal_available',

  // Admin notifications
  'admin_new_client',
  'admin_new_quote',
  'admin_document_signed',
  'admin_payment_received',
  'admin_switch_objection',
  'admin_meter_pending',
  'admin_consultation_payment',
];

const NOTIFICATION_CATEGORIES = [
  'account',
  'quote',
  'document',
  'switch',
  'consultation',
  'meter',
  'tariff',
  'admin',
  'system',
];

// ── Schema ─────────────────────────────────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    // Who receives this notification
    recipient: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    // ── Content ───────────────────────────────────────────────
    type: {
      type:     String,
      enum:     NOTIFICATION_TYPES,
      required: true,
      index:    true,
    },

    category: {
      type:     String,
      enum:     NOTIFICATION_CATEGORIES,
      required: true,
      index:    true,
    },

    title: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 200,
    },

    body: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 1000,
    },

    icon: {
      type:    String,
      default: '🔔',
    },

    // Deep-link route in mobile app  e.g. 'switches/abc123'
    actionRoute: {
      type:    String,
      default: null,
      trim:    true,
    },

    // Extra payload for in-app navigation / display
    data: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Related record ─────────────────────────────────────────
    relatedId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
    },
    relatedModel: {
      type:    String,
      enum:    ['Quote', 'Document', 'Switch', 'Consultation', 'MeterReading', 'Tariff', 'User', null],
      default: null,
    },

    // ── Read state ─────────────────────────────────────────────
    isRead: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    readAt: {
      type:    Date,
      default: null,
    },

    // ── Push status ────────────────────────────────────────────
    pushStatus: {
      type:    String,
      enum:    ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
      index:   true,
    },
    pushSentAt: {
      type:    Date,
      default: null,
    },
    // Never returned to client
    pushError: {
      type:    String,
      default: null,
      select:  false,
    },
    pushTicketId: {
      type:    String,
      default: null,
      select:  false,
    },

    // ── Priority ───────────────────────────────────────────────
    priority: {
      type:    String,
      enum:    ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
      index:   true,
    },

    // Auto-expire after 90 days via MongoDB TTL index
    expiresAt: {
      type:    Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      index:   { expires: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        delete ret.pushError;
        delete ret.pushTicketId;
        return ret;
      },
    },
  }
);

// ── Compound indexes ───────────────────────────────────────────────
notificationSchema.index({ recipient: 1, isRead: 1,    createdAt: -1 });
notificationSchema.index({ recipient: 1, category: 1,  createdAt: -1 });
notificationSchema.index({ recipient: 1,               createdAt: -1 });
notificationSchema.index({ pushStatus: 1,              createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports          = Notification;
module.exports.NOTIFICATION_TYPES      = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES;