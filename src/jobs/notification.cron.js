'use strict';

/**
 * Notification Cron Jobs
 *
 * Scheduled checks that fire notifications based on time:
 *
 * Daily at 09:00  → document expiry warnings (30, 14, 7, 3 days)
 * Daily at 09:00  → contract renewal alerts (60, 30, 14 days)
 * Daily at 09:00  → cooling-off ending soon (3, 1 days left)
 * Every 30 min    → consultation reminders (24h before, 1h before)
 *
 * Duplicate prevention:
 *   wasAlreadyNotified() checks DB so re-runs are safe.
 *   A notification of the same type for the same record
 *   within the de-dup window is never sent twice.
 */

const Document     = require('../models/Document');
const UserProfile  = require('../models/UserProfile');
const Switch       = require('../models/Switch');
const Consultation = require('../models/Consultation');
const Notification = require('../models/Notification');
const notifyTrigger = require('../services/notification.trigger.service');

// ── Duplicate guard ───────────────────────────────────────────────

/**
 * Returns true if a notification of this type was already
 * sent for this record within `withinHours` hours.
 */
const wasAlreadyNotified = async (recipientId, type, relatedId, withinHours = 20) => {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000);
  const filter = { recipient: recipientId, type, createdAt: { $gte: since } };
  if (relatedId) filter.relatedId = relatedId;
  const existing = await Notification.findOne(filter).lean();
  return !!existing;
};

// ─────────────────────────────────────────────────────────────────
// JOB: Document expiry
// ─────────────────────────────────────────────────────────────────

const checkDocumentExpiry = async () => {
  const now  = new Date();
  let notified = 0;

  // Unsigned documents expiring within 31 days
  const documents = await Document.find({
    status:    'pending_signature',
    expiresAt: {
      $gte: now,
      $lte: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
    },
  }).lean({ virtuals: true });

  for (const doc of documents) {
    const daysLeft = Math.ceil(
      (new Date(doc.expiresAt) - now) / (1000 * 60 * 60 * 24),
    );

    // Only alert on specific milestone days
    if (![30, 14, 7, 3].includes(daysLeft)) continue;

    const alreadySent = await wasAlreadyNotified(doc.client, 'document_expiring', doc._id, 20);
    if (alreadySent) continue;

    await notifyTrigger.onDocumentExpiringSoon(doc, daysLeft);
    notified++;
  }

  // Documents that JUST expired (status not yet updated)
  const justExpired = await Document.find({
    status:    'pending_signature',
    expiresAt: { $lt: now },
  }).lean();

  for (const doc of justExpired) {
    const alreadySent = await wasAlreadyNotified(doc.client, 'document_expired', doc._id, 48);
    if (!alreadySent) {
      await notifyTrigger.onDocumentExpired(doc);
      notified++;
    }
    // Update status
    await Document.findByIdAndUpdate(doc._id, { status: 'expired' });
  }

  if (notified > 0) {
    console.log(`[NotifCron] Document expiry: ${notified} notification(s) sent`);
  }
  return notified;
};

// ─────────────────────────────────────────────────────────────────
// JOB: Contract renewal alerts
// ─────────────────────────────────────────────────────────────────

const checkContractRenewals = async () => {
  const now  = new Date();
  const in62 = new Date(now.getTime() + 62 * 24 * 60 * 60 * 1000);
  let notified = 0;

  const profiles = await UserProfile.find({
    $or: [
      { 'energy.electricityContractEndDate': { $gte: now, $lte: in62 } },
      { 'energy.gasContractEndDate':         { $gte: now, $lte: in62 } },
    ],
  }).lean();

  for (const profile of profiles) {
    const checks = [
      {
        date:     profile.energy?.electricityContractEndDate,
        fuelType: 'electricity',
        supplier: profile.energy?.currentElectricitySupplier,
      },
      {
        date:     profile.energy?.gasContractEndDate,
        fuelType: 'gas',
        supplier: profile.energy?.currentGasSupplier,
      },
    ];

    for (const check of checks) {
      if (!check.date) continue;
      const end       = new Date(check.date);
      if (end <= now) continue;
      const daysUntil = Math.ceil((end - now) / (1000 * 60 * 60 * 24));

      if (![60, 30, 14].includes(daysUntil)) continue;

      const type       = `contract_renewal_${daysUntil}`;
      const alreadySent = await wasAlreadyNotified(profile.user, type, null, 20);
      if (alreadySent) continue;

      await notifyTrigger.onContractRenewalAlert(
        profile, check.fuelType, check.supplier, daysUntil
      );
      notified++;
    }
  }

  if (notified > 0) {
    console.log(`[NotifCron] Contract renewals: ${notified} notification(s) sent`);
  }
  return notified;
};

// ─────────────────────────────────────────────────────────────────
// JOB: Cooling-off period ending
// ─────────────────────────────────────────────────────────────────

const checkCoolingOffEnding = async () => {
  const now  = new Date();
  const in4d = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  let notified = 0;

  const switches = await Switch.find({
    status:          'cooling_off',
    coolingOffEndsAt: { $gte: now, $lte: in4d },
  }).lean();

  for (const sw of switches) {
    const daysLeft = Math.ceil(
      (new Date(sw.coolingOffEndsAt) - now) / (1000 * 60 * 60 * 24),
    );

    if (![3, 1].includes(daysLeft)) continue;

    const alreadySent = await wasAlreadyNotified(
      sw.client, 'switch_cooling_off_ending', sw._id, 20
    );
    if (alreadySent) continue;

    await notifyTrigger.onCoolingOffEndingSoon(sw, daysLeft);
    notified++;
  }

  if (notified > 0) {
    console.log(`[NotifCron] Cooling-off ending: ${notified} notification(s) sent`);
  }
  return notified;
};

// ─────────────────────────────────────────────────────────────────
// JOB: Consultation reminders (time-sensitive — runs every 30 min)
// ─────────────────────────────────────────────────────────────────

const checkConsultationReminders = async () => {
  const now = new Date();
  let notified = 0;

  const consultations = await Consultation.find({
    status:      { $in: ['confirmed', 'scheduled'] },
    scheduledAt: {
      $gte: new Date(now.getTime() + 45  * 60 * 1000),   // at least 45 min from now
      $lte: new Date(now.getTime() + 26  * 60 * 60 * 1000), // up to 26 hours from now
    },
  }).lean();

  for (const c of consultations) {
    const msUntil    = new Date(c.scheduledAt) - now;
    const hoursUntil = msUntil / (1000 * 60 * 60);

    // ── 24h reminder: 23h–25h window ──────────────────────────
    if (hoursUntil >= 23 && hoursUntil <= 25) {
      const alreadySent = await wasAlreadyNotified(
        c.client, 'consultation_reminder_24h', c._id, 20
      );
      if (!alreadySent) {
        await notifyTrigger.onConsultationReminder(c, 24);
        notified++;
      }
    }

    // ── 1h reminder: 50min–75min window ───────────────────────
    if (hoursUntil >= 0.83 && hoursUntil <= 1.25) {
      const alreadySent = await wasAlreadyNotified(
        c.client, 'consultation_reminder_1h', c._id, 2
      );
      if (!alreadySent) {
        await notifyTrigger.onConsultationReminder(c, 1);
        notified++;
      }
    }
  }

  if (notified > 0) {
    console.log(`[NotifCron] Consultation reminders: ${notified} sent`);
  }
  return notified;
};

// ─────────────────────────────────────────────────────────────────
// START SCHEDULER
// ─────────────────────────────────────────────────────────────────

const startScheduler = () => {
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('[NotifCron] node-cron not found — notification cron disabled');
    return;
  }

  // Daily at 09:00 — document expiry, renewals, cooling-off
  cron.schedule('0 9 * * *', async () => {
    console.log('[NotifCron] Daily checks running...');
    await checkDocumentExpiry();
    await checkContractRenewals();
    await checkCoolingOffEnding();
  });

  // Every 30 minutes — consultation reminders (time-sensitive)
  cron.schedule('*/30 * * * *', async () => {
    await checkConsultationReminders();
  });

  console.log('[NotifCron] Scheduler started — daily 09:00, reminders every 30 min');
};

// Run all jobs once (useful for admin manual trigger / testing)
const runAll = async () => {
  const results = await Promise.allSettled([
    checkDocumentExpiry(),
    checkContractRenewals(),
    checkConsultationReminders(),
    checkCoolingOffEnding(),
  ]);
  return results.map((r, i) => ({
    job:    ['documentExpiry', 'contractRenewals', 'consultationReminders', 'coolingOff'][i],
    status: r.status,
    value:  r.value ?? r.reason?.message,
  }));
};

module.exports = {
  startScheduler,
  runAll,
  checkDocumentExpiry,
  checkContractRenewals,
  checkConsultationReminders,
  checkCoolingOffEnding,
};