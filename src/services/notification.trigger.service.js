'use strict';

/**
 * Notification Trigger Service
 *
 * This is the single integration point.
 * Every other service calls these trigger functions
 * AFTER their main operation completes.
 *
 * PATTERN:
 *   All triggers are wrapped in safeNotify() so a
 *   notification failure NEVER breaks the main flow.
 *
 * USAGE EXAMPLE (in quote.service.js):
 *   const notifyTrigger = require('./notification.trigger.service');
 *   // after saving:
 *   await notifyTrigger.onQuoteStatusChanged(quote, newStatus);
 *
 * INTEGRATION POINTS (add these calls to existing services):
 *   auth.service.js          → onUserRegistered(user)
 *   admin.service.js         → onAccountDeactivated(user)
 *                            → onQuoteStatusChanged(quote, newStatus)
 *   quote.service.js         → onQuoteCreated(quote)
 *   document.service.js      → onDocumentSentToClient(document)
 *                            → onDocumentSigned(document)
 *   switch.service.js        → onSwitchInitiated(sw)
 *                            → onSwitchStatusChanged(sw, newStatus)
 *   consultation.service.js  → onConsultationBooked(consultation)
 *                            → onConsultationPaymentConfirmed(consultation)
 *                            → onConsultationPaymentFailed(consultation)
 *                            → onConsultationScheduled(consultation)
 *                            → onConsultationCompleted(consultation)
 *                            → onConsultationCancelled(consultation, cancelledBy)
 *                            → onConsultationRefunded(consultation)
 *                            → onConsultationNoShow(consultation)
 *   meter.service.js         → onMeterReadingRequested(reading)
 *                            → onMeterReadingProcessing(reading)
 *                            → onMeterReadingFulfilled(reading)
 *                            → onMeterReadingFailed(reading)
 */

const notificationService = require('./notification.service');

// ── Failure-safe wrapper ───────────────────────────────────────────
const safeNotify = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.error('[NotifyTrigger] Error (non-fatal):', err.message);
  }
};

// ═════════════════════════════════════════════════════════════════
// ACCOUNT
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: auth.service.js → registerUser()
 */
const onUserRegistered = (user) => safeNotify(async () => {
  // Welcome the new client
  await notificationService.create({
    recipient:   user._id,
    type:        'welcome',
    category:    'account',
    title:       `Welcome to Energy Broker, ${user.firstName}! 👋`,
    body:        'Your account is ready. Complete your profile to get personalised energy quotes and start saving.',
    icon:        '👋',
    actionRoute: 'profile/onboarding',
    priority:    'medium',
  });

  // Alert all admins
  await notificationService.notifyAdmins({
    type:         'admin_new_client',
    category:     'admin',
    title:        '👤 New Client Registered',
    body:         `${user.firstName} ${user.lastName} (${user.email}) just signed up.`,
    icon:         '👤',
    actionRoute:  `admin/clients/${user._id}`,
    relatedId:    user._id,
    relatedModel: 'User',
    priority:     'low',
  });
});

/**
 * Called from: admin.service.js → updateClient() when isActive → false
 */
const onAccountDeactivated = (user) => safeNotify(async () => {
  await notificationService.create({
    recipient: user._id,
    type:      'account_deactivated',
    category:  'account',
    title:     '🔒 Account Deactivated',
    body:      'Your account has been deactivated. Please contact support if you think this is an error.',
    icon:      '🔒',
    priority:  'high',
  });
});

// ═════════════════════════════════════════════════════════════════
// QUOTES
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: quote.service.js → createQuoteRequest()
 */
const onQuoteCreated = (quote) => safeNotify(async () => {
  const tariffInfo = quote.interestedTariff?.supplier
    ? ` for ${quote.interestedTariff.supplier}`
    : '';

  await notificationService.notifyAdmins({
    type:         'admin_new_quote',
    category:     'admin',
    title:        '📋 New Quote Request',
    body:         `${quote.contactDetails?.name ?? 'A client'} submitted a quote request${tariffInfo} (${quote.quoteNumber}).`,
    icon:         '📋',
    actionRoute:  `admin/quotes/${quote._id}`,
    relatedId:    quote._id,
    relatedModel: 'Quote',
    data:         { quoteNumber: quote.quoteNumber },
    priority:     'medium',
  });
});

/**
 * Called from: admin.service.js → updateQuote()
 */
const onQuoteStatusChanged = (quote, newStatus) => safeNotify(async () => {
  const MAP = {
    contacted: {
      title:    '📞 Your Broker Is On It!',
      body:     `Our team will contact you shortly about your quote request (${quote.quoteNumber}).`,
      icon:     '📞',
      priority: 'high',
    },
    completed: {
      title:    '✅ Quote Process Completed',
      body:     `Your quote request ${quote.quoteNumber} has been completed. Check your quotes for a summary.`,
      icon:     '✅',
      priority: 'medium',
    },
    cancelled: {
      title:    'Quote Request Cancelled',
      body:     `Your quote request ${quote.quoteNumber} has been cancelled.`,
      icon:     '❌',
      priority: 'low',
    },
  };

  const config = MAP[newStatus];
  if (!config) return;

  await notificationService.create({
    recipient:    quote.client,
    type:         `quote_${newStatus}`,
    category:     'quote',
    actionRoute:  `quotes/${quote._id}`,
    relatedId:    quote._id,
    relatedModel: 'Quote',
    data:         { quoteNumber: quote.quoteNumber, status: newStatus },
    ...config,
  });
});

// ═════════════════════════════════════════════════════════════════
// DOCUMENTS
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: document.service.js → adminSendDocument()
 */
const onDocumentSentToClient = (document) => safeNotify(async () => {
  await notificationService.create({
    recipient:    document.client,
    type:         'document_sent',
    category:     'document',
    title:        '📩 Document Ready to Sign',
    body:         `Your broker sent you a document to sign: "${document.title}". Please review and sign it as soon as possible.`,
    icon:         '📩',
    actionRoute:  `documents/${document._id}`,
    relatedId:    document._id,
    relatedModel: 'Document',
    data:         { docNumber: document.docNumber, supplier: document.supplier ?? null },
    priority:     'high',
  });
});

/**
 * Called from: document.service.js → signLOA()
 */
const onDocumentSigned = (document) => safeNotify(async () => {
  await notificationService.notifyAdmins({
    type:         'admin_document_signed',
    category:     'admin',
    title:        '✅ Document Signed',
    body:         `"${document.title}" (${document.docNumber}) has been signed by the client.`,
    icon:         '✅',
    actionRoute:  `admin/documents/${document._id}`,
    relatedId:    document._id,
    relatedModel: 'Document',
    data:         { docNumber: document.docNumber },
    priority:     'medium',
  });
});

/**
 * Called from: notification.cron.js
 */
const onDocumentExpiringSoon = (document, daysLeft) => safeNotify(async () => {
  await notificationService.create({
    recipient:    document.client,
    type:         'document_expiring',
    category:     'document',
    title:        `⏰ Document Expiring in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
    body:         `"${document.title}" (${document.docNumber}) expires in ${daysLeft} days. Please sign before it expires.`,
    icon:         '⏰',
    actionRoute:  `documents/${document._id}`,
    relatedId:    document._id,
    relatedModel: 'Document',
    data:         { docNumber: document.docNumber, daysLeft },
    priority:     daysLeft <= 7 ? 'high' : 'medium',
  });
});

/**
 * Called from: notification.cron.js
 */
const onDocumentExpired = (document) => safeNotify(async () => {
  await notificationService.create({
    recipient:    document.client,
    type:         'document_expired',
    category:     'document',
    title:        '⚠️ Document Has Expired',
    body:         `"${document.title}" (${document.docNumber}) expired unsigned. Please create a new document to continue.`,
    icon:         '⚠️',
    actionRoute:  'documents',
    relatedId:    document._id,
    relatedModel: 'Document',
    priority:     'medium',
  });
});

// ═════════════════════════════════════════════════════════════════
// SWITCHES
// ═════════════════════════════════════════════════════════════════

const SWITCH_MAP = {
  submitted_to_supplier: {
    type:     'switch_submitted',
    title:    '📤 Switch Submitted to Supplier',
    body:     (sw) => `Your switch from ${sw.currentSupplier} to ${sw.newSupplier} has been submitted. Your new supplier is processing it.`,
    icon:     '📤',
    priority: 'high',
  },
  cooling_off: {
    type:     'switch_cooling_off',
    title:    '❄️ 14-Day Cooling-Off Period Started',
    body:     (sw) => `Your ${sw.currentSupplier} → ${sw.newSupplier} switch is in the cooling-off period. You can still cancel within 14 days.`,
    icon:     '❄️',
    priority: 'medium',
  },
  objected: {
    type:     'switch_objected',
    title:    '⚠️ Objection Raised on Your Switch',
    body:     (sw) => `${sw.currentSupplier} has raised an objection on your switch to ${sw.newSupplier}. Your broker is resolving this.`,
    icon:     '⚠️',
    priority: 'urgent',
  },
  objection_resolved: {
    type:     'switch_objection_resolved',
    title:    '✅ Objection Resolved — Switch Continues',
    body:     (sw) => `The objection on your ${sw.currentSupplier} → ${sw.newSupplier} switch has been resolved. The switch will continue.`,
    icon:     '✅',
    priority: 'high',
  },
  in_progress: {
    type:     'switch_in_progress',
    title:    '⚡ Your Switch Is Now In Progress',
    body:     (sw) => `Your switch from ${sw.currentSupplier} to ${sw.newSupplier} is now in progress!`,
    icon:     '⚡',
    priority: 'medium',
  },
  completed: {
    type:     'switch_completed',
    title:    '🎉 Switch Complete! Welcome to Your New Supplier',
    body:     (sw) => `You have successfully switched from ${sw.currentSupplier} to ${sw.newSupplier}. Enjoy your new tariff and savings!`,
    icon:     '🎉',
    priority: 'high',
  },
  cancelled: {
    type:     'switch_cancelled',
    title:    'Switch Cancelled',
    body:     (sw) => `Your switch from ${sw.currentSupplier} to ${sw.newSupplier} has been cancelled.`,
    icon:     '❌',
    priority: 'medium',
  },
  failed: {
    type:     'switch_failed',
    title:    '❌ Switch Failed — Contact Your Broker',
    body:     (sw) => `Unfortunately your switch from ${sw.currentSupplier} to ${sw.newSupplier} has failed. Your broker will be in touch.`,
    icon:     '❌',
    priority: 'urgent',
  },
};

/**
 * Called from: switch.service.js → adminCreateSwitch()
 */
const onSwitchInitiated = (sw) => safeNotify(async () => {
  await notificationService.create({
    recipient:    sw.client,
    type:         'switch_initiated',
    category:     'switch',
    title:        '🔄 Switch Initiated by Your Broker',
    body:         `Your broker has started the switching process from ${sw.currentSupplier} to ${sw.newSupplier}. We'll keep you updated every step of the way.`,
    icon:         '🔄',
    actionRoute:  `switches/${sw._id}`,
    relatedId:    sw._id,
    relatedModel: 'Switch',
    data:         { switchNumber: sw.switchNumber, currentSupplier: sw.currentSupplier, newSupplier: sw.newSupplier },
    priority:     'high',
  });
});

/**
 * Called from: switch.service.js → adminUpdateStatus()
 */
const onSwitchStatusChanged = (sw, newStatus) => safeNotify(async () => {
  const config = SWITCH_MAP[newStatus];
  if (!config) return;

  const body = typeof config.body === 'function' ? config.body(sw) : config.body;

  await notificationService.create({
    recipient:    sw.client,
    type:         config.type,
    category:     'switch',
    title:        config.title,
    body,
    icon:         config.icon,
    actionRoute:  `switches/${sw._id}`,
    relatedId:    sw._id,
    relatedModel: 'Switch',
    data: {
      switchNumber:    sw.switchNumber,
      currentSupplier: sw.currentSupplier,
      newSupplier:     sw.newSupplier,
      status:          newStatus,
    },
    priority: config.priority,
  });

  // Additional admin alert for objections
  if (newStatus === 'objected') {
    await notificationService.notifyAdmins({
      type:         'admin_switch_objection',
      category:     'admin',
      title:        '⚠️ Switch Objection Needs Resolution',
      body:         `Switch ${sw.switchNumber} (${sw.currentSupplier} → ${sw.newSupplier}) has an objection. Please resolve it urgently.`,
      icon:         '⚠️',
      actionRoute:  `admin/switches/${sw._id}`,
      relatedId:    sw._id,
      relatedModel: 'Switch',
      data:         { switchNumber: sw.switchNumber },
      priority:     'urgent',
    });
  }
});

/**
 * Called from: notification.cron.js
 */
const onCoolingOffEndingSoon = (sw, daysLeft) => safeNotify(async () => {
  await notificationService.create({
    recipient:    sw.client,
    type:         'switch_cooling_off_ending',
    category:     'switch',
    title:        `❄️ Cooling-Off Ends in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
    body:         `Your ${sw.currentSupplier} → ${sw.newSupplier} cooling-off period ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. After this you cannot cancel without penalties.`,
    icon:         '❄️',
    actionRoute:  `switches/${sw._id}`,
    relatedId:    sw._id,
    relatedModel: 'Switch',
    data:         { switchNumber: sw.switchNumber, daysLeft },
    priority:     'high',
  });
});

// ═════════════════════════════════════════════════════════════════
// CONSULTATIONS
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: consultation.service.js → requestConsultation()
 */
const onConsultationBooked = (consultation) => safeNotify(async () => {
  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_booked',
    category:     'consultation',
    title:        '💡 Consultation Booked',
    body:         `Your ${consultation.label ?? `${consultation.duration} min consultation`} has been booked. Complete payment to confirm your session.`,
    icon:         '💡',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data:         { consultationNumber: consultation.consultationNumber, price: consultation.price },
    priority:     'medium',
  });
});

/**
 * Called from: consultation.service.js → handleStripeWebhookEvent() on payment_intent.succeeded
 */
const onConsultationPaymentConfirmed = (consultation) => safeNotify(async () => {
  // Notify client
  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_payment_confirmed',
    category:     'consultation',
    title:        '✅ Payment Confirmed — You\'re Booked!',
    body:         `Payment of £${consultation.price} received for "${consultation.label ?? 'your consultation'}". Your broker will schedule your session shortly.`,
    icon:         '💳',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data:         { consultationNumber: consultation.consultationNumber, price: consultation.price },
    priority:     'high',
  });

  // Notify all admins
  await notificationService.notifyAdmins({
    type:         'admin_consultation_payment',
    category:     'admin',
    title:        '💳 Consultation Payment Received',
    body:         `£${consultation.price} received for ${consultation.consultationNumber}. Please schedule this consultation with the client.`,
    icon:         '💳',
    actionRoute:  `admin/consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data:         { consultationNumber: consultation.consultationNumber, price: consultation.price },
    priority:     'high',
  });
});

/**
 * Called from: consultation.service.js → handleStripeWebhookEvent() on payment_intent.payment_failed
 */
const onConsultationPaymentFailed = (consultation) => safeNotify(async () => {
  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_payment_failed',
    category:     'consultation',
    title:        '❌ Payment Failed',
    body:         `Your payment for "${consultation.label ?? 'the consultation'}" (${consultation.consultationNumber}) was declined. Tap to retry with a different card.`,
    icon:         '❌',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data:         { consultationNumber: consultation.consultationNumber },
    priority:     'urgent',
  });
});

/**
 * Called from: consultation.service.js → adminConfirm() when scheduledAt is set
 */
const onConsultationScheduled = (consultation) => safeNotify(async () => {
  const scheduledDate = consultation.scheduledAt
    ? new Date(consultation.scheduledAt).toLocaleDateString('en-GB', {
        weekday: 'long',
        day:     'numeric',
        month:   'long',
        hour:    '2-digit',
        minute:  '2-digit',
      })
    : 'TBC';

  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_scheduled',
    category:     'consultation',
    title:        '📅 Consultation Scheduled',
    body:         `Your "${consultation.label ?? 'consultation'}" is scheduled for ${scheduledDate} via ${consultation.meetingMethod}.${consultation.meetingLink ? ' Meeting link added.' : ''}`,
    icon:         '📅',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data: {
      consultationNumber: consultation.consultationNumber,
      scheduledAt:        consultation.scheduledAt,
      meetingMethod:      consultation.meetingMethod,
      meetingLink:        consultation.meetingLink  ?? null,
      meetingPhone:       consultation.meetingPhone ?? null,
    },
    priority: 'high',
  });
});

/**
 * Called from: notification.cron.js (24h and 1h before)
 */
const onConsultationReminder = (consultation, hoursUntil) => safeNotify(async () => {
  const type    = hoursUntil <= 1 ? 'consultation_reminder_1h' : 'consultation_reminder_24h';
  const timeStr = hoursUntil <= 1 ? '1 hour' : '24 hours';

  const timeOnly = consultation.scheduledAt
    ? new Date(consultation.scheduledAt).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  let body = `Your "${consultation.label ?? 'consultation'}" starts in ${timeStr}`;
  if (timeOnly) body += ` at ${timeOnly}`;
  body += ` via ${consultation.meetingMethod}.`;
  if (consultation.meetingLink)  body += ` Link: ${consultation.meetingLink}`;
  if (consultation.meetingPhone) body += ` Phone: ${consultation.meetingPhone}`;

  await notificationService.create({
    recipient:    consultation.client,
    type,
    category:     'consultation',
    title:        `⏰ Reminder: Consultation in ${timeStr}`,
    body,
    icon:         '⏰',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    data: {
      consultationNumber: consultation.consultationNumber,
      scheduledAt:        consultation.scheduledAt,
      meetingMethod:      consultation.meetingMethod,
      meetingLink:        consultation.meetingLink  ?? null,
      meetingPhone:       consultation.meetingPhone ?? null,
    },
    priority: 'urgent',
  });
});

/**
 * Called from: consultation.service.js → adminComplete()
 */
const onConsultationCompleted = (consultation) => safeNotify(async () => {
  const nextStepsSnippet = consultation.nextSteps
    ? ` Next steps: ${consultation.nextSteps.substring(0, 80)}${consultation.nextSteps.length > 80 ? '...' : ''}`
    : ' Please leave a rating to help us improve.';

  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_completed',
    category:     'consultation',
    title:        '🎯 Consultation Completed',
    body:         `Your "${consultation.label ?? 'consultation'}" session has been completed.${nextStepsSnippet}`,
    icon:         '🎯',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    priority:     'medium',
  });
});

/**
 * Called from: consultation.service.js → cancelConsultation() and adminComplete()
 */
const onConsultationCancelled = (consultation, cancelledBy) => safeNotify(async () => {
  // Only notify client if admin cancelled (client already knows they cancelled)
  if (cancelledBy === 'client') return;

  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_cancelled',
    category:     'consultation',
    title:        'Consultation Cancelled',
    body:         `Your "${consultation.label ?? 'consultation'}" (${consultation.consultationNumber}) has been cancelled. ${consultation.cancellationReason ?? 'Please contact us to reschedule.'}`,
    icon:         '❌',
    actionRoute:  'consultations',
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    priority:     'high',
  });
});

/**
 * Called from: consultation.service.js → adminRefund()
 */
const onConsultationRefunded = (consultation) => safeNotify(async () => {
  const refundPounds = consultation.payment?.refundAmount
    ? (consultation.payment.refundAmount / 100).toFixed(2)
    : consultation.price;

  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_refunded',
    category:     'consultation',
    title:        '💰 Refund Processed',
    body:         `A refund of £${refundPounds} has been processed for ${consultation.consultationNumber}. It should appear in your account within 5–10 business days.`,
    icon:         '💰',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    priority:     'high',
  });
});

/**
 * Called from: consultation.service.js → adminNoShow()
 */
const onConsultationNoShow = (consultation) => safeNotify(async () => {
  await notificationService.create({
    recipient:    consultation.client,
    type:         'consultation_no_show',
    category:     'consultation',
    title:        '⚠️ Missed Consultation',
    body:         `You missed your scheduled consultation (${consultation.consultationNumber}). Please contact your broker to reschedule.`,
    icon:         '⚠️',
    actionRoute:  `consultations/${consultation._id}`,
    relatedId:    consultation._id,
    relatedModel: 'Consultation',
    priority:     'high',
  });
});

// ═════════════════════════════════════════════════════════════════
// METER READINGS
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: meter.service.js → requestReading()
 */
const onMeterReadingRequested = (reading) => safeNotify(async () => {
  await notificationService.notifyAdmins({
    type:         'admin_meter_pending',
    category:     'admin',
    title:        '📡 Meter Reading Request',
    body:         `A client requested ${reading.fuelType} usage data (${reading.readingNumber}). Please retrieve and fulfill it.`,
    icon:         '📡',
    actionRoute:  `admin/meter-readings/${reading._id}`,
    relatedId:    reading._id,
    relatedModel: 'MeterReading',
    data:         { readingNumber: reading.readingNumber, fuelType: reading.fuelType },
    priority:     'medium',
  });
});

/**
 * Called from: meter.service.js → adminMarkProcessing()
 */
const onMeterReadingProcessing = (reading) => safeNotify(async () => {
  await notificationService.create({
    recipient:    reading.client,
    type:         'meter_processing',
    category:     'meter',
    title:        '⚙️ Retrieving Your Meter Data',
    body:         `Our team is retrieving your ${reading.fuelType} usage data (${reading.readingNumber}). We'll notify you when it's ready.`,
    icon:         '⚙️',
    actionRoute:  `meter-readings/${reading._id}`,
    relatedId:    reading._id,
    relatedModel: 'MeterReading',
    data:         { readingNumber: reading.readingNumber, fuelType: reading.fuelType },
    priority:     'low',
  });
});

/**
 * Called from: meter.service.js → adminFulfillReading()
 */
const onMeterReadingFulfilled = (reading) => safeNotify(async () => {
  const elecKwh = reading.electricity?.estimatedAnnualKwh;
  const gasKwh  = reading.gas?.estimatedAnnualKwh;

  const usageStr = elecKwh
    ? `~${Math.round(elecKwh / 100) * 100} kWh/yr electricity`
    : gasKwh
    ? `~${Math.round(gasKwh / 100) * 100} kWh/yr gas`
    : 'your usage data';

  await notificationService.create({
    recipient:    reading.client,
    type:         'meter_fulfilled',
    category:     'meter',
    title:        '📡 Your Meter Data Is Ready!',
    body:         `Your ${reading.fuelType} usage data is ready: ${usageStr}. View detailed consumption and compare tariffs now.`,
    icon:         '📡',
    actionRoute:  `meter-readings/${reading._id}`,
    relatedId:    reading._id,
    relatedModel: 'MeterReading',
    data: {
      readingNumber: reading.readingNumber,
      fuelType:      reading.fuelType,
      annualElecKwh: elecKwh ?? null,
      annualGasKwh:  gasKwh  ?? null,
    },
    priority: 'high',
  });
});

/**
 * Called from: meter.service.js → adminFailReading()
 */
const onMeterReadingFailed = (reading) => safeNotify(async () => {
  await notificationService.create({
    recipient:    reading.client,
    type:         'meter_failed',
    category:     'meter',
    title:        '❌ Meter Data Unavailable',
    body:         `We were unable to retrieve your ${reading.fuelType} meter data (${reading.readingNumber}). ${reading.failureReason ?? 'Please try requesting again or contact support.'}`,
    icon:         '❌',
    actionRoute:  'meter-readings',
    relatedId:    reading._id,
    relatedModel: 'MeterReading',
    priority:     'medium',
  });
});

// ═════════════════════════════════════════════════════════════════
// TARIFF / CONTRACT RENEWALS
// ═════════════════════════════════════════════════════════════════

/**
 * Called from: notification.cron.js
 */
const onContractRenewalAlert = (profile, fuelType, supplier, daysUntil) => safeNotify(async () => {
  const typeMap = { 60: 'contract_renewal_60', 30: 'contract_renewal_30', 14: 'contract_renewal_14' };
  const type    = typeMap[daysUntil] ?? 'contract_renewal_30';
  const emoji   = fuelType === 'electricity' ? '⚡' : '🔥';
  const label   = fuelType === 'electricity' ? 'Electricity' : 'Gas';

  await notificationService.create({
    recipient:   profile.user,
    type,
    category:    'tariff',
    title:       `${emoji} ${label} Contract Renews in ${daysUntil} Days`,
    body:        `Your ${supplier ? `${supplier}` : label.toLowerCase()} contract expires in ${daysUntil} days. Compare tariffs now to avoid rolling onto a higher rate.`,
    icon:        emoji,
    actionRoute: 'tariffs',
    data:        { fuelType, supplier: supplier ?? null, daysUntil },
    priority:    daysUntil <= 14 ? 'urgent' : daysUntil <= 30 ? 'high' : 'medium',
  });
});

// ── Exports ────────────────────────────────────────────────────────
module.exports = {
  // Account
  onUserRegistered,
  onAccountDeactivated,

  // Quotes
  onQuoteCreated,
  onQuoteStatusChanged,

  // Documents
  onDocumentSentToClient,
  onDocumentSigned,
  onDocumentExpiringSoon,
  onDocumentExpired,

  // Switches
  onSwitchInitiated,
  onSwitchStatusChanged,
  onCoolingOffEndingSoon,

  // Consultations
  onConsultationBooked,
  onConsultationPaymentConfirmed,
  onConsultationPaymentFailed,
  onConsultationScheduled,
  onConsultationReminder,
  onConsultationCompleted,
  onConsultationCancelled,
  onConsultationRefunded,
  onConsultationNoShow,

  // Meter
  onMeterReadingRequested,
  onMeterReadingProcessing,
  onMeterReadingFulfilled,
  onMeterReadingFailed,

  // Tariff / energy
  onContractRenewalAlert,
};