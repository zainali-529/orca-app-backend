/**
 * Dashboard Service
 *
 * Two separate dashboards, both fully parallelised for speed:
 *
 * ─── CLIENT  GET /api/dashboard ──────────────────────────────────
 *   Personalised for the logged-in client:
 *   greeting · profile completion · pipeline counts · savings
 *   potential · active switch · upcoming events · smart alerts ·
 *   recent activity · energy snapshot · lifetime quick-stats ·
 *   latest meter reading
 *
 * ─── ADMIN   GET /api/admin/dashboard ────────────────────────────
 *   Business overview:
 *   KPIs (MoM growth) · pending actions · switch funnel ·
 *   revenue chart (6 mo) · top suppliers · client health ·
 *   contract renewal alerts · recent cross-client activity
 *
 * Zero N+1 queries — every list uses aggregation or a single find
 * with a reasonable limit.  All parallel with Promise.all.
 */

'use strict';

const mongoose    = require('mongoose');
const User        = require('../models/User');
const UserProfile = require('../models/UserProfile');
const Quote       = require('../models/Quote');
const Document    = require('../models/Document');
const Switch      = require('../models/Switch');
const Consultation = require('../models/Consultation');
const Tariff      = require('../models/Tariff');
const MeterReading = require('../models/MeterReading');

const { Types: { ObjectId } } = mongoose;

// ─────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Convert an array of { _id, count } aggregation results into a plain object.
 * e.g. [{ _id: 'pending', count: 3 }] → { pending: 3 }
 */
const toCounts = (agg) =>
  agg.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});

/**
 * Time-of-day greeting string.
 */
const greeting = (firstName) => {
  const h    = new Date().getHours();
  const tod  = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return {
    timeOfDay: tod,
    message:   `Good ${tod}, ${firstName}!`,
    firstName,
  };
};

/**
 * Profile completion % + list of missing fields.
 * Based on the 8 most impactful energy-brokerage fields.
 */
const calcProfileCompletion = (profile) => {
  if (!profile) return { percent: 0, missing: ['profile'] };

  const checks = {
    businessType:    !!profile.businessType,
    businessDetails: profile.businessType === 'residential' ? true : !!profile.companyName,
    billingAddress:  !!(profile.billingAddress?.line1 && profile.billingAddress?.postcode),
    mpan:            !!profile.energy?.mpan,
    mprn:            !!profile.energy?.mprn,
    currentSupplier: !!(profile.energy?.currentElectricitySupplier ||
                        profile.energy?.currentGasSupplier),
    annualUsage:     !!(profile.energy?.annualElectricityKwh ||
                        profile.energy?.annualGasKwh),
    preferences:     profile.onboarding?.steps?.review === true,
  };

  const done    = Object.values(checks).filter(Boolean).length;
  const total   = Object.keys(checks).length;
  const percent = Math.round((done / total) * 100);
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

  return { percent, missing };
};

/**
 * Estimate current annual energy cost using UK Ofgem cap rates
 * as a baseline, then compare against the cheapest live tariff.
 * Returns null silently if Tariff collection is empty.
 */
const calcSavingsPotential = async (profile) => {
  try {
    // UK price-cap fallback unit rates (Q2 2025, incl. VAT)
    const CAP = {
      elecUnit: 24.50,   // p/kWh
      elecSC:   53.37,   // p/day
      gasUnit:   6.24,   // p/kWh
      gasSC:    29.60,   // p/day
    };

    const elecKwh = profile?.energy?.annualElectricityKwh ?? 2900;
    const gasKwh  = profile?.energy?.annualGasKwh         ?? 11500;

    const currentElecCost = Math.round(
      (CAP.elecUnit / 100) * elecKwh + (CAP.elecSC / 100) * 365,
    );
    const currentGasCost = Math.round(
      (CAP.gasUnit / 100) * gasKwh + (CAP.gasSC / 100) * 365,
    );
    const currentAnnualCost = currentElecCost + currentGasCost;

    // Best available dual-fuel fixed tariff in our database
    const best = await Tariff
      .findOne({
        isActive:   true,
        fuelType:   'dual',
        tariffType: 'fixed',
        'electricity.unitRate':    { $ne: null },
        'electricity.standingCharge': { $ne: null },
        'gas.unitRate':            { $ne: null },
        'gas.standingCharge':      { $ne: null },
      })
      .sort({ 'electricity.unitRate': 1 })
      .select('supplier tariffName tariffType fuelType electricity gas cashback isGreen contractLengthMonths exitFee')
      .lean();

    if (!best) {
      return {
        currentAnnualCost,
        bestAvailableCost:    null,
        potentialSaving:      null,
        annualSavingMonthly:  null,
        bestTariff:           null,
        dataQuality:          'estimated',
        basedOn:              { annualElecKwh: elecKwh, annualGasKwh: gasKwh },
      };
    }

    const bestElecCost = Math.round(
      (best.electricity.unitRate    / 100) * elecKwh +
      (best.electricity.standingCharge / 100) * 365,
    );
    const bestGasCost = Math.round(
      (best.gas.unitRate    / 100) * gasKwh +
      (best.gas.standingCharge / 100) * 365,
    );
    const bestAnnualCost  = bestElecCost + bestGasCost;
    const cashback        = best.cashback ?? 0;
    const potentialSaving = Math.max(0, currentAnnualCost - bestAnnualCost + cashback);

    // Data quality: 'actual' if client has real fulfilled meter data
    const hasMeterData = profile?.user
      ? await MeterReading.exists({ client: profile.user, status: 'fulfilled' })
      : false;

    return {
      currentAnnualCost,
      currentElecCost,
      currentGasCost,
      bestAvailableCost:    bestAnnualCost,
      bestElecCost,
      bestGasCost,
      potentialSaving,
      annualSavingMonthly:  Math.round(potentialSaving / 12),
      bestTariff: {
        _id:                  best._id,
        supplier:             best.supplier,
        tariffName:           best.tariffName,
        isGreen:              best.isGreen,
        cashback,
        contractLengthMonths: best.contractLengthMonths,
        exitFee:              best.exitFee,
        electricityUnitRate:  best.electricity.unitRate,
        gasUnitRate:          best.gas.unitRate,
      },
      dataQuality: hasMeterData ? 'from_meter' : 'estimated',
      basedOn:     { annualElecKwh: elecKwh, annualGasKwh: gasKwh },
    };
  } catch (err) {
    console.warn('[Dashboard] savingsPotential error:', err.message);
    return null;
  }
};

/**
 * Upcoming events list for a client.
 * Combines scheduled consultations + contract end-date warnings.
 */
const buildUpcomingEvents = async (clientObjId, profile) => {
  const events = [];
  const now    = new Date();

  // ── Upcoming scheduled consultations ──────────────────────────
  const upcoming = await Consultation
    .find({
      client:      clientObjId,
      status:      { $in: ['confirmed', 'scheduled'] },
      scheduledAt: { $gte: now },
    })
    .sort({ scheduledAt: 1 })
    .limit(3)
    .select('_id consultationNumber label duration scheduledAt meetingMethod status category')
    .lean();

  for (const c of upcoming) {
    const daysUntil = Math.ceil(
      (new Date(c.scheduledAt) - now) / (1000 * 60 * 60 * 24),
    );
    events.push({
      type:         'consultation',
      id:           c._id,
      title:        c.label ?? `${c.duration} min Consultation`,
      category:     c.category,
      date:         c.scheduledAt,
      status:       c.status,
      meetingMethod: c.meetingMethod,
      reference:    c.consultationNumber,
      daysUntil,
      urgency:      daysUntil <= 1 ? 'high' : daysUntil <= 3 ? 'medium' : 'low',
    });
  }

  // ── Contract renewal warnings (within 60 days) ─────────────────
  const sixty = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const addContractEvent = (dateStr, fuelType, supplier) => {
    if (!dateStr) return;
    const end = new Date(dateStr);
    if (end < now || end > sixty) return;
    const daysUntil = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    events.push({
      type:        'contract_renewal',
      fuelType,
      supplier:    supplier ?? `your ${fuelType} supplier`,
      date:        end,
      daysUntil,
      urgency:     daysUntil <= 14 ? 'high' : daysUntil <= 30 ? 'medium' : 'low',
      title:       `${fuelType === 'electricity' ? '⚡' : '🔥'} ${
                     fuelType.charAt(0).toUpperCase() + fuelType.slice(1)
                   } contract renewal`,
      description: `Contract with ${supplier ?? 'your supplier'} ends in ${daysUntil} days`,
    });
  };

  addContractEvent(
    profile?.energy?.electricityContractEndDate,
    'electricity',
    profile?.energy?.currentElectricitySupplier,
  );
  addContractEvent(
    profile?.energy?.gasContractEndDate,
    'gas',
    profile?.energy?.currentGasSupplier,
  );

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events.slice(0, 5);
};

/**
 * Smart alerts for client dashboard — priority-sorted action items.
 */
const buildClientAlerts = async (clientObjId, profile) => {
  const alerts = [];
  const now    = new Date();

  // ── Run all alert checks in parallel ──────────────────────────
  const [
    pendingDocs,
    paymentPendingCount,
    paymentFailedCount,
    objectedSwitch,
    recentMeterFulfilled,
    pendingMeterCount,
  ] = await Promise.all([
    Document
      .find({ client: clientObjId, status: 'pending_signature' })
      .sort({ expiresAt: 1 })
      .limit(3)
      .select('_id docNumber title supplier sentByAdmin expiresAt')
      .lean({ virtuals: true }),

    Consultation.countDocuments({
      client: clientObjId, status: 'awaiting_payment',
    }),

    Consultation.countDocuments({
      client: clientObjId, status: 'payment_failed',
    }),

    Switch
      .findOne({ client: clientObjId, status: 'objected' })
      .select('_id switchNumber currentSupplier newSupplier objectionReason')
      .lean(),

    MeterReading
      .findOne({
        client:     clientObjId,
        status:     'fulfilled',
        fulfilledAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      })
      .sort({ fulfilledAt: -1 })
      .select('_id readingNumber electricity gas')
      .lean(),

    MeterReading.countDocuments({ client: clientObjId, status: 'requested' }),
  ]);

  // ── Documents awaiting signature ───────────────────────────────
  for (const doc of pendingDocs) {
    const daysLeft = doc.daysUntilExpiry ?? null;
    const expiring = daysLeft !== null && daysLeft <= 14;
    alerts.push({
      id:          doc._id,
      type:        'document_pending',
      severity:    expiring ? 'high' : (doc.sentByAdmin ? 'medium' : 'low'),
      icon:        doc.sentByAdmin ? '📩' : '✍️',
      title:       doc.sentByAdmin
        ? 'Your broker sent a document to sign'
        : 'Document awaiting your signature',
      description: `${doc.title}${
        doc.supplier ? ` — ${doc.supplier}` : ''
      }${daysLeft !== null ? ` · Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : ''}`,
      actionRoute: `documents/${doc._id}`,
      priority:    expiring ? 0 : (doc.sentByAdmin ? 1 : 2),
    });
  }

  // ── Consultation payment needed ────────────────────────────────
  if (paymentPendingCount > 0) {
    alerts.push({
      type:        'consultation_payment',
      severity:    'high',
      icon:        '💳',
      title:       `${paymentPendingCount} consultation${paymentPendingCount > 1 ? 's' : ''} awaiting payment`,
      description: 'Complete payment to confirm your session booking',
      actionRoute: 'consultations',
      priority:    0,
    });
  }

  if (paymentFailedCount > 0) {
    alerts.push({
      type:        'consultation_payment_failed',
      severity:    'high',
      icon:        '❌',
      title:       'Consultation payment failed — please retry',
      description: 'Your payment was declined. Tap to retry with a different card.',
      actionRoute: 'consultations',
      priority:    0,
    });
  }

  // ── Switch objection ───────────────────────────────────────────
  if (objectedSwitch) {
    alerts.push({
      id:          objectedSwitch._id,
      type:        'switch_objection',
      severity:    'high',
      icon:        '⚠️',
      title:       'Objection raised on your switch',
      description: `${objectedSwitch.currentSupplier} → ${objectedSwitch.newSupplier}: ${
        objectedSwitch.objectionReason ?? 'Your broker is working to resolve this'
      }`,
      actionRoute: `switches/${objectedSwitch._id}`,
      priority:    1,
    });
  }

  // ── Contract renewals (within 30 days) ────────────────────────
  const thirty = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const addRenewalAlert = (dateStr, fuelType, supplier, basePriority) => {
    if (!dateStr) return;
    const end = new Date(dateStr);
    if (end < now || end > thirty) return;
    const d = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    alerts.push({
      type:        `contract_renewal_${fuelType}`,
      severity:    d <= 14 ? 'high' : 'medium',
      icon:        fuelType === 'electricity' ? '⚡' : '🔥',
      title:       `${fuelType === 'electricity' ? 'Electricity' : 'Gas'} contract renews in ${d} days`,
      description: `${supplier ?? 'Your supplier'} — compare new deals now to avoid rollover rates`,
      actionRoute: 'tariffs',
      priority:    basePriority,
    });
  };

  addRenewalAlert(
    profile?.energy?.electricityContractEndDate,
    'electricity',
    profile?.energy?.currentElectricitySupplier,
    2,
  );
  addRenewalAlert(
    profile?.energy?.gasContractEndDate,
    'gas',
    profile?.energy?.currentGasSupplier,
    2,
  );

  // ── Meter data just ready ──────────────────────────────────────
  if (recentMeterFulfilled) {
    const kwhStr =
      recentMeterFulfilled.electricity?.estimatedAnnualKwh
        ? `~${Math.round(recentMeterFulfilled.electricity.estimatedAnnualKwh / 100) * 100} kWh/yr electricity`
        : recentMeterFulfilled.gas?.estimatedAnnualKwh
        ? `~${Math.round(recentMeterFulfilled.gas.estimatedAnnualKwh / 100) * 100} kWh/yr gas`
        : 'consumption data ready';
    alerts.push({
      id:          recentMeterFulfilled._id,
      type:        'meter_data_ready',
      severity:    'info',
      icon:        '📡',
      title:       'Your meter data is ready to view',
      description: `Annual usage: ${kwhStr}`,
      actionRoute: `meter-readings/${recentMeterFulfilled._id}`,
      priority:    3,
    });
  }

  // ── Profile incomplete ─────────────────────────────────────────
  const { percent } = calcProfileCompletion(profile);
  if (percent < 60) {
    alerts.push({
      type:        'profile_incomplete',
      severity:    'info',
      icon:        '📋',
      title:       `Profile ${percent}% complete`,
      description: 'Add your MPAN, MPRN and annual usage for accurate tariff comparisons',
      actionRoute: 'profile',
      priority:    4,
    });
  }

  // ── Pending meter reading requests ─────────────────────────────
  if (pendingMeterCount > 0) {
    alerts.push({
      type:        'meter_pending',
      severity:    'info',
      icon:        '⚙️',
      title:       `${pendingMeterCount} meter reading request${pendingMeterCount > 1 ? 's' : ''} in progress`,
      description: 'Our team is retrieving your consumption data',
      actionRoute: 'meter-readings',
      priority:    3,
    });
  }

  // Sort by priority → severity
  const sevOrder = { high: 0, medium: 1, info: 2 };
  alerts.sort(
    (a, b) =>
      (a.priority ?? 9) - (b.priority ?? 9) ||
      (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9),
  );

  return alerts.slice(0, 8);
};

/**
 * Recent activity feed for the client — last 30 days, cross-module.
 */
const buildClientActivity = async (clientObjId) => {
  const activity = [];
  const cutoff   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [switches, consultations, meterReadings, documents] = await Promise.all([
    Switch
      .find({ client: clientObjId, updatedAt: { $gte: cutoff } })
      .sort({ updatedAt: -1 }).limit(4)
      .select('_id switchNumber status currentSupplier newSupplier fuelType updatedAt contractDetails')
      .lean(),

    Consultation
      .find({
        client:    clientObjId,
        updatedAt: { $gte: cutoff },
        status:    { $in: ['payment_confirmed', 'confirmed', 'scheduled', 'completed', 'cancelled'] },
      })
      .sort({ updatedAt: -1 }).limit(3)
      .select('_id consultationNumber label status scheduledAt updatedAt price')
      .lean(),

    MeterReading
      .find({
        client:    clientObjId,
        updatedAt: { $gte: cutoff },
        status:    { $in: ['processing', 'fulfilled', 'failed'] },
      })
      .sort({ updatedAt: -1 }).limit(3)
      .select('_id readingNumber status fuelType fulfilledAt updatedAt electricity gas')
      .lean(),

    Document
      .find({
        client:    clientObjId,
        updatedAt: { $gte: cutoff },
        status:    { $in: ['signed', 'pending_signature'] },
      })
      .sort({ updatedAt: -1 }).limit(2)
      .select('_id docNumber title status updatedAt sentByAdmin')
      .lean(),
  ]);

  const SWITCH_LABELS = {
    requested:             { text: 'Switch request submitted',           icon: '📋' },
    submitted_to_supplier: { text: 'Switch submitted to supplier',       icon: '📤' },
    cooling_off:           { text: 'Cooling-off period started (14 days)', icon: '❄️' },
    objected:              { text: 'Objection raised — broker is resolving', icon: '⚠️' },
    objection_resolved:    { text: 'Objection resolved — switch continuing', icon: '✅' },
    in_progress:           { text: 'Switch in progress',                  icon: '⚡' },
    pending_completion:    { text: 'Switch finalising with supplier',      icon: '🔄' },
    completed:             { text: 'Switch completed!',                   icon: '🎉' },
    cancelled:             { text: 'Switch cancelled',                    icon: '❌' },
    failed:                { text: 'Switch failed — contact your broker',  icon: '💔' },
  };

  for (const sw of switches) {
    const meta    = SWITCH_LABELS[sw.status] ?? { text: sw.status, icon: '🔄' };
    const saving  = sw.contractDetails?.estimatedAnnualSaving;
    activity.push({
      type:        'switch',
      id:          sw._id,
      icon:        meta.icon,
      title:       `${sw.currentSupplier} → ${sw.newSupplier}`,
      description: `${meta.text}${saving ? ` · £${Math.round(saving)}/yr saving` : ''}`,
      timestamp:   sw.updatedAt,
      status:      sw.status,
      reference:   sw.switchNumber,
      route:       'switches',
    });
  }

  const CONSULT_LABELS = {
    payment_confirmed: { text: 'Consultation booked',             icon: '✅' },
    confirmed:         { text: 'Consultation confirmed',           icon: '✅' },
    scheduled:         { text: 'Consultation scheduled',          icon: '📅' },
    completed:         { text: 'Consultation completed',          icon: '🎯' },
    cancelled:         { text: 'Consultation cancelled',          icon: '❌' },
  };

  for (const c of consultations) {
    const meta = CONSULT_LABELS[c.status] ?? { text: c.status, icon: '💡' };
    activity.push({
      type:        'consultation',
      id:          c._id,
      icon:        meta.icon,
      title:       c.label ?? 'Energy Consultation',
      description: `${meta.text}${c.price ? ` · £${c.price}` : ''}`,
      timestamp:   c.updatedAt,
      status:      c.status,
      reference:   c.consultationNumber,
      route:       'consultations',
    });
  }

  for (const mr of meterReadings) {
    const kwhStr = mr.electricity?.estimatedAnnualKwh
      ? `~${Math.round(mr.electricity.estimatedAnnualKwh / 100) * 100} kWh/yr`
      : mr.gas?.estimatedAnnualKwh
      ? `~${Math.round(mr.gas.estimatedAnnualKwh / 100) * 100} kWh/yr`
      : null;

    activity.push({
      type:        'meter',
      id:          mr._id,
      icon:        mr.status === 'fulfilled' ? '📡' : mr.status === 'processing' ? '⚙️' : '❌',
      title:       `${mr.fuelType === 'both' ? 'Dual-fuel' : mr.fuelType} meter data`,
      description: mr.status === 'fulfilled'
        ? `Data retrieved${kwhStr ? ` — ${kwhStr}` : ''}`
        : mr.status === 'processing'
        ? 'Being retrieved by our team'
        : 'Data retrieval failed',
      timestamp:   mr.updatedAt,
      status:      mr.status,
      reference:   mr.readingNumber,
      route:       'meter-readings',
    });
  }

  for (const doc of documents) {
    activity.push({
      type:        'document',
      id:          doc._id,
      icon:        doc.status === 'signed' ? '✅' : (doc.sentByAdmin ? '📩' : '✍️'),
      title:       doc.title,
      description: doc.status === 'signed'
        ? 'Document signed'
        : doc.sentByAdmin
        ? 'Broker sent a document — tap to review and sign'
        : 'Document ready to sign',
      timestamp:   doc.updatedAt,
      status:      doc.status,
      reference:   doc.docNumber,
      route:       'documents',
    });
  }

  activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return activity.slice(0, 10);
};

/**
 * Lifetime quick-stats for the client.
 */
const buildClientQuickStats = async (clientObjId) => {
  const [
    switchesCompleted,
    totalSavingsAgg,
    consultationsCompleted,
    documentsSignedCount,
    consultRevenueAgg,
    totalQuotes,
  ] = await Promise.all([
    Switch.countDocuments({ client: clientObjId, status: 'completed' }),

    Switch.aggregate([
      {
        $match: {
          client: clientObjId,
          status: 'completed',
          'contractDetails.estimatedAnnualSaving': { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$contractDetails.estimatedAnnualSaving' } } },
    ]),

    Consultation.countDocuments({ client: clientObjId, status: 'completed' }),

    Document.countDocuments({ client: clientObjId, status: 'signed' }),

    Consultation.aggregate([
      { $match: { client: clientObjId, 'payment.status': 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$pricePence' } } },
    ]),

    Quote.countDocuments({ client: clientObjId }),
  ]);

  return {
    switchesCompleted,
    totalSavingsDelivered:       Math.round(totalSavingsAgg[0]?.total ?? 0),
    consultationsCompleted,
    documentsSignedCount,
    totalSpentOnConsultations:   parseFloat(
      ((consultRevenueAgg[0]?.total ?? 0) / 100).toFixed(2),
    ),
    totalQuoteRequests:          totalQuotes,
  };
};

// ─────────────────────────────────────────────────────────────────
// CLIENT DASHBOARD
// ─────────────────────────────────────────────────────────────────

const getClientDashboard = async (userId) => {
  const clientObjId = new ObjectId(String(userId));

  // ── Load user + profile ───────────────────────────────────────
  const [user, profile] = await Promise.all([
    User.findById(clientObjId).lean(),
    UserProfile.findOne({ user: clientObjId }).lean(),
  ]);

  if (!user) {
    const e = new Error('User not found');
    e.statusCode = 404;
    throw e;
  }

  // ── All sections in parallel ──────────────────────────────────
  const [
    pipelineAgg,
    savingsPotential,
    upcomingEvents,
    alerts,
    recentActivity,
    quickStats,
    latestMeterReading,
    activeSwitch,
  ] = await Promise.all([

    // ── Full pipeline counts (one aggregate per collection) ───
    Promise.all([
      Quote.aggregate([
        { $match: { client: clientObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Document.aggregate([
        { $match: { client: clientObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Switch.aggregate([
        { $match: { client: clientObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Consultation.aggregate([
        { $match: { client: clientObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MeterReading.aggregate([
        { $match: { client: clientObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]),

    calcSavingsPotential(profile),
    buildUpcomingEvents(clientObjId, profile),
    buildClientAlerts(clientObjId, profile),
    buildClientActivity(clientObjId),
    buildClientQuickStats(clientObjId),

    // Latest fulfilled meter reading
    MeterReading
      .findOne({ client: clientObjId, status: 'fulfilled' })
      .sort({ fulfilledAt: -1 })
      .select('_id readingNumber electricity gas fuelType fulfilledAt dataSource')
      .lean(),

    // Most recent non-terminal switch
    Switch
      .findOne({
        client: clientObjId,
        status: { $nin: ['completed', 'cancelled', 'failed'] },
      })
      .sort({ updatedAt: -1 })
      .select(
        '_id switchNumber status currentSupplier newSupplier fuelType ' +
        'estimatedSwitchDate coolingOffEndsAt contractDetails updatedAt',
      )
      .lean({ virtuals: true }),
  ]);

  // ── Unpack pipeline aggregations ──────────────────────────────
  const [quotesAgg, docsAgg, switchesAgg, consultsAgg, meterAgg] = pipelineAgg;

  const qC  = toCounts(quotesAgg);
  const dC  = toCounts(docsAgg);
  const swC = toCounts(switchesAgg);
  const cC  = toCounts(consultsAgg);
  const mC  = toCounts(meterAgg);

  const SWITCH_ACTIVE = [
    'requested', 'submitted_to_supplier', 'cooling_off',
    'objected', 'objection_resolved', 'in_progress', 'pending_completion',
  ];
  const activeSwitchCount = SWITCH_ACTIVE.reduce((s, k) => s + (swC[k] ?? 0), 0);

  // ── Profile completion ────────────────────────────────────────
  const profileCompletion = calcProfileCompletion(profile);

  // ── Summary (for header badges) ───────────────────────────────
  const summary = {
    activeSwitches:          activeSwitchCount,
    pendingDocuments:        dC['pending_signature']  ?? 0,
    upcomingConsultations:   upcomingEvents.filter((e) => e.type === 'consultation').length,
    pendingMeterRequests:    (mC['requested'] ?? 0) + (mC['processing'] ?? 0),
    pendingQuotes:           (qC['pending'] ?? 0) + (qC['contacted'] ?? 0),
    highPriorityAlerts:      alerts.filter((a) => a.severity === 'high').length,
    hasBrokerDocuments:      (dC['pending_signature'] ?? 0) > 0,
  };

  return {
    greeting: greeting(user.firstName),

    profile: {
      completionPercent: profileCompletion.percent,
      missing:           profileCompletion.missing,
      businessType:      profile?.businessType  ?? null,
      companyName:       profile?.companyName   ?? null,
      hasMpan:           !!(profile?.energy?.mpan),
      hasMprn:           !!(profile?.energy?.mprn),
    },

    summary,

    pipeline: {
      quotes: {
        pending:   qC['pending']   ?? 0,
        contacted: qC['contacted'] ?? 0,
        completed: qC['completed'] ?? 0,
        cancelled: qC['cancelled'] ?? 0,
        total:     Object.values(qC).reduce((s, c) => s + c, 0),
      },
      documents: {
        pendingSignature: dC['pending_signature'] ?? 0,
        signed:           dC['signed']            ?? 0,
        expired:          dC['expired']           ?? 0,
        total:            Object.values(dC).reduce((s, c) => s + c, 0),
      },
      switches: {
        active:    activeSwitchCount,
        completed: swC['completed']   ?? 0,
        coolingOff: swC['cooling_off'] ?? 0,
        objected:  swC['objected']    ?? 0,
        cancelled: swC['cancelled']   ?? 0,
        failed:    swC['failed']      ?? 0,
        total:     Object.values(swC).reduce((s, c) => s + c, 0),
      },
      consultations: {
        awaitingPayment:   cC['awaiting_payment']   ?? 0,
        paymentConfirmed:  cC['payment_confirmed']  ?? 0,
        confirmed:         cC['confirmed']          ?? 0,
        scheduled:         cC['scheduled']          ?? 0,
        completed:         cC['completed']          ?? 0,
        cancelled:         cC['cancelled']          ?? 0,
        total:             Object.values(cC).reduce((s, c) => s + c, 0),
      },
      meterReadings: {
        requested:  mC['requested']  ?? 0,
        processing: mC['processing'] ?? 0,
        fulfilled:  mC['fulfilled']  ?? 0,
        failed:     mC['failed']     ?? 0,
        total:      Object.values(mC).reduce((s, c) => s + c, 0),
      },
    },

    savingsPotential,
    upcomingEvents,
    alerts,
    recentActivity,
    quickStats,

    energySnapshot: {
      mpan:                  profile?.energy?.mpan                        ?? null,
      mprn:                  profile?.energy?.mprn                        ?? null,
      currentElecSupplier:   profile?.energy?.currentElectricitySupplier  ?? null,
      currentGasSupplier:    profile?.energy?.currentGasSupplier          ?? null,
      annualElecKwh:         profile?.energy?.annualElectricityKwh        ?? null,
      annualGasKwh:          profile?.energy?.annualGasKwh                ?? null,
      hasSmartMeter:         profile?.energy?.hasSmartMeter               ?? false,
      elecContractEnds:      profile?.energy?.electricityContractEndDate   ?? null,
      gasContractEnds:       profile?.energy?.gasContractEndDate           ?? null,
      elecTariffType:        profile?.energy?.electricityTariffType        ?? null,
      gasTariffType:         profile?.energy?.gasTariffType                ?? null,
    },

    latestMeterReading: latestMeterReading ?? null,
    activeSwitch:       activeSwitch       ?? null,

    meta: {
      generatedAt: new Date().toISOString(),
      version:     '1',
    },
  };
};

// ─────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD — HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Build 6-month chart using aggregations (no loop).
 */
const buildRevenueChart = async () => {
  const now          = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [revenueByMonth, switchesByMonth, clientsByMonth] = await Promise.all([
    Consultation.aggregate([
      {
        $match: {
          'payment.status': 'succeeded',
          'payment.paidAt': { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id:   { year: { $year: '$payment.paidAt' }, month: { $month: '$payment.paidAt' } },
          total: { $sum: '$pricePence' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),

    Switch.aggregate([
      {
        $match: { status: 'completed', completedAt: { $gte: sixMonthsAgo } },
      },
      {
        $group: {
          _id:   { year: { $year: '$completedAt' }, month: { $month: '$completedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),

    User.aggregate([
      {
        $match: { role: 'client', createdAt: { $gte: sixMonthsAgo } },
      },
      {
        $group: {
          _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  // Build lookup maps for O(1) access
  const revMap    = {};
  const switchMap = {};
  const clientMap = {};

  revenueByMonth.forEach((r) => {
    revMap[`${r._id.year}-${r._id.month}`] = r.total;
  });
  switchesByMonth.forEach((r) => {
    switchMap[`${r._id.year}-${r._id.month}`] = r.count;
  });
  clientsByMonth.forEach((r) => {
    clientMap[`${r._id.year}-${r._id.month}`] = r.count;
  });

  // Fill arrays for all 6 months (including zeros)
  const labels       = [];
  const consultRevenue = [];
  const switchesCount  = [];
  const newClients     = [];

  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    labels.push(
      d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    );
    consultRevenue.push(parseFloat(((revMap[key] ?? 0) / 100).toFixed(2)));
    switchesCount.push(switchMap[key] ?? 0);
    newClients.push(clientMap[key] ?? 0);
  }

  return { labels, consultRevenue, switchesCount, newClients };
};

/**
 * Pending actions for admin — priority-sorted things to do TODAY.
 */
const buildPendingActions = async () => {
  const [
    meterRequested,
    meterProcessing,
    quotePending,
    switchObjected,
    consultPaymentConfirmed,
    docsExpiring,
    paymentFailedConsults,
  ] = await Promise.all([
    MeterReading.countDocuments({ status: 'requested' }),
    MeterReading.countDocuments({ status: 'processing' }),
    Quote.countDocuments({ status: 'pending' }),
    Switch.countDocuments({ status: 'objected' }),
    Consultation.countDocuments({ status: 'payment_confirmed' }),
    Document.countDocuments({
      status:    'pending_signature',
      expiresAt: { $lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
    }),
    Consultation.countDocuments({ status: 'payment_failed' }),
  ]);

  const actions = [];

  if (meterRequested > 0) {
    actions.push({
      type:     'meter_requested',
      priority: 'urgent',
      icon:     '📡',
      title:    `${meterRequested} meter reading request${meterRequested > 1 ? 's' : ''} waiting`,
      subtitle: 'Client is waiting for usage data — retrieve and fulfill',
      count:    meterRequested,
      route:    'meter-readings',
    });
  }

  if (switchObjected > 0) {
    actions.push({
      type:     'switch_objection',
      priority: 'urgent',
      icon:     '⚠️',
      title:    `${switchObjected} switch${switchObjected > 1 ? 'es' : ''} with unresolved objection`,
      subtitle: 'Old supplier raised objection — contact them to resolve',
      count:    switchObjected,
      route:    'switches',
    });
  }

  if (consultPaymentConfirmed > 0) {
    actions.push({
      type:     'consultation_schedule',
      priority: 'high',
      icon:     '📅',
      title:    `${consultPaymentConfirmed} paid consultation${consultPaymentConfirmed > 1 ? 's' : ''} need scheduling`,
      subtitle: 'Payment received — confirm date and time with clients',
      count:    consultPaymentConfirmed,
      route:    'consultations',
    });
  }

  if (meterProcessing > 0) {
    actions.push({
      type:     'meter_processing',
      priority: 'high',
      icon:     '⚙️',
      title:    `${meterProcessing} meter reading${meterProcessing > 1 ? 's' : ''} in progress`,
      subtitle: 'Mark as fulfilled once data has been retrieved',
      count:    meterProcessing,
      route:    'meter-readings',
    });
  }

  if (quotePending > 0) {
    actions.push({
      type:     'quote_followup',
      priority: 'medium',
      icon:     '📋',
      title:    `${quotePending} quote request${quotePending > 1 ? 's' : ''} need follow-up`,
      subtitle: 'Clients submitted requests — contact them to discuss options',
      count:    quotePending,
      route:    'quotes',
    });
  }

  if (docsExpiring > 0) {
    actions.push({
      type:     'document_expiring',
      priority: 'medium',
      icon:     '⏰',
      title:    `${docsExpiring} unsigned document${docsExpiring > 1 ? 's' : ''} expiring in 14 days`,
      subtitle: 'Send reminder to clients — expired LOAs block switching',
      count:    docsExpiring,
      route:    'documents',
    });
  }

  if (paymentFailedConsults > 0) {
    actions.push({
      type:     'consultation_payment_failed',
      priority: 'medium',
      icon:     '💳',
      title:    `${paymentFailedConsults} consultation${paymentFailedConsults > 1 ? 's' : ''} with failed payment`,
      subtitle: 'Client\'s payment was declined — follow up',
      count:    paymentFailedConsults,
      route:    'consultations',
    });
  }

  // Sort: urgent → high → medium → low
  const order = { urgent: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));

  return actions;
};

/**
 * Clients with electricity or gas contracts expiring in next 60 days.
 */
const buildRenewalAlerts = async () => {
  const now    = new Date();
  const sixty  = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const profiles = await UserProfile
    .find({
      $or: [
        { 'energy.electricityContractEndDate': { $gte: now, $lte: sixty } },
        { 'energy.gasContractEndDate':         { $gte: now, $lte: sixty } },
      ],
    })
    .populate('user', 'firstName lastName email phone')
    .select('user energy companyName businessType')
    .lean();

  const alerts = [];

  for (const p of profiles) {
    if (!p.user) continue;

    const addAlert = (dateStr, fuelType, supplier) => {
      if (!dateStr) return;
      const end       = new Date(dateStr);
      if (end < now || end > sixty) return;
      const daysUntil = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      alerts.push({
        clientId:    p.user._id,
        clientName:  `${p.user.firstName} ${p.user.lastName}`,
        email:       p.user.email,
        phone:       p.user.phone   ?? null,
        companyName: p.companyName  ?? null,
        businessType: p.businessType ?? null,
        fuelType,
        supplier:    supplier ?? 'Unknown',
        contractEndsAt: end,
        daysUntil,
        urgency:     daysUntil <= 14 ? 'urgent' : daysUntil <= 30 ? 'high' : 'medium',
      });
    };

    addAlert(
      p.energy?.electricityContractEndDate,
      'electricity',
      p.energy?.currentElectricitySupplier,
    );
    addAlert(
      p.energy?.gasContractEndDate,
      'gas',
      p.energy?.currentGasSupplier,
    );
  }

  alerts.sort((a, b) => a.daysUntil - b.daysUntil);
  return alerts;
};

/**
 * Admin recent activity — significant events across all clients (last 7 days).
 */
const buildAdminRecentActivity = async () => {
  const cutoff   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activity = [];

  const [switches, payments, newClients, quotes, meterFulfilled] = await Promise.all([
    Switch
      .find({ updatedAt: { $gte: cutoff } })
      .populate('client', 'firstName lastName')
      .sort({ updatedAt: -1 }).limit(6)
      .select('_id switchNumber status currentSupplier newSupplier client updatedAt contractDetails')
      .lean(),

    Consultation
      .find({ 'payment.paidAt': { $gte: cutoff }, 'payment.status': 'succeeded' })
      .populate('client', 'firstName lastName')
      .sort({ 'payment.paidAt': -1 }).limit(5)
      .select('_id consultationNumber label price client payment.paidAt status')
      .lean(),

    User
      .find({ role: 'client', createdAt: { $gte: cutoff } })
      .sort({ createdAt: -1 }).limit(4)
      .select('_id firstName lastName email createdAt')
      .lean(),

    Quote
      .find({ createdAt: { $gte: cutoff } })
      .populate('client', 'firstName lastName')
      .sort({ createdAt: -1 }).limit(4)
      .select('_id quoteNumber status interestedTariff client createdAt')
      .lean(),

    MeterReading
      .find({ status: 'fulfilled', fulfilledAt: { $gte: cutoff } })
      .populate('client', 'firstName lastName')
      .sort({ fulfilledAt: -1 }).limit(3)
      .select('_id readingNumber fuelType client electricity gas fulfilledAt')
      .lean(),
  ]);

  for (const sw of switches) {
    const clientName = sw.client
      ? `${sw.client.firstName} ${sw.client.lastName}`
      : 'Unknown client';
    const saving = sw.contractDetails?.estimatedAnnualSaving;
    activity.push({
      type:        'switch',
      id:          sw._id,
      icon:        sw.status === 'completed' ? '🎉' : sw.status === 'objected' ? '⚠️' : '🔄',
      clientName,
      title:       `${sw.currentSupplier} → ${sw.newSupplier}`,
      description: `${sw.status.replace(/_/g, ' ')}${saving ? ` · £${Math.round(saving)}/yr saved` : ''}`,
      timestamp:   sw.updatedAt,
      status:      sw.status,
      reference:   sw.switchNumber,
    });
  }

  for (const c of payments) {
    const clientName = c.client
      ? `${c.client.firstName} ${c.client.lastName}`
      : 'Unknown client';
    activity.push({
      type:        'consultation_payment',
      id:          c._id,
      icon:        '💳',
      clientName,
      title:       c.label ?? 'Consultation',
      description: `Payment received · £${c.price}`,
      timestamp:   c.payment?.paidAt,
      status:      c.status,
      reference:   c.consultationNumber,
    });
  }

  for (const u of newClients) {
    activity.push({
      type:        'new_client',
      id:          u._id,
      icon:        '👤',
      clientName:  `${u.firstName} ${u.lastName}`,
      title:       'New client registered',
      description: u.email,
      timestamp:   u.createdAt,
      status:      'new',
    });
  }

  for (const q of quotes) {
    const clientName = q.client
      ? `${q.client.firstName} ${q.client.lastName}`
      : 'Unknown client';
    activity.push({
      type:        'quote',
      id:          q._id,
      icon:        '📋',
      clientName,
      title:       q.interestedTariff?.supplier
        ? `Quote: ${q.interestedTariff.supplier}`
        : 'General quote request',
      description: `New quote request submitted`,
      timestamp:   q.createdAt,
      status:      q.status,
      reference:   q.quoteNumber,
    });
  }

  for (const mr of meterFulfilled) {
    const clientName = mr.client
      ? `${mr.client.firstName} ${mr.client.lastName}`
      : 'Unknown client';
    const kwhStr = mr.electricity?.estimatedAnnualKwh
      ? `${Math.round(mr.electricity.estimatedAnnualKwh / 100) * 100} kWh/yr electricity`
      : mr.gas?.estimatedAnnualKwh
      ? `${Math.round(mr.gas.estimatedAnnualKwh / 100) * 100} kWh/yr gas`
      : 'data fulfilled';
    activity.push({
      type:        'meter',
      id:          mr._id,
      icon:        '📡',
      clientName,
      title:       'Meter reading fulfilled',
      description: kwhStr,
      timestamp:   mr.fulfilledAt,
      status:      'fulfilled',
      reference:   mr.readingNumber,
    });
  }

  activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return activity.slice(0, 15);
};

// ─────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD
// ─────────────────────────────────────────────────────────────────

const getAdminDashboard = async () => {
  const now            = new Date();
  const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const thirtyDaysAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── All queries in parallel ───────────────────────────────────
  const [
    totalClients,
    activeClientsThisMonth,
    newClientsThisMonth,
    newClientsLastMonth,

    quoteCounts,
    docCounts,
    switchCounts,
    consultCounts,
    meterCounts,

    topSuppliersAgg,
    avgSavingAgg,
    totalSavingsAgg,
    completedSwitchesThisMonth,

    consultRevenueTotal,
    consultRevenueThisMonth,
    consultRevenueLastMonth,
    upcomingConsultationsCount,

    profilesWithMpan,
    profilesWithSmartMeter,
    onboardingComplete,
    lOASignedClients,

    revenueChart,
    pendingActions,
    renewalAlerts,
    recentActivity,
  ] = await Promise.all([

    // ── Client counts ─────────────────────────────────────────
    User.countDocuments({ role: 'client' }),

    User.countDocuments({
      role:          'client',
      lastLoginAt:   { $gte: thirtyDaysAgo },
    }),

    User.countDocuments({
      role:       'client',
      createdAt:  { $gte: monthStart },
    }),

    User.countDocuments({
      role:       'client',
      createdAt:  { $gte: lastMonthStart, $lte: lastMonthEnd },
    }),

    // ── Pipeline aggregations ─────────────────────────────────
    Quote.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    Document.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    Switch.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    Consultation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    MeterReading.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    // ── Switch analytics ──────────────────────────────────────
    Switch.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$newSupplier', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),

    Switch.aggregate([
      {
        $match: {
          status: 'completed',
          'contractDetails.estimatedAnnualSaving': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          avg: { $avg: '$contractDetails.estimatedAnnualSaving' },
          count: { $sum: 1 },
        },
      },
    ]),

    Switch.aggregate([
      {
        $match: {
          status: 'completed',
          'contractDetails.estimatedAnnualSaving': { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$contractDetails.estimatedAnnualSaving' } } },
    ]),

    Switch.countDocuments({
      status:      'completed',
      completedAt: { $gte: monthStart },
    }),

    // ── Revenue ───────────────────────────────────────────────
    Consultation.aggregate([
      { $match: { 'payment.status': 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$pricePence' } } },
    ]),

    Consultation.aggregate([
      {
        $match: {
          'payment.status': 'succeeded',
          'payment.paidAt': { $gte: monthStart },
        },
      },
      { $group: { _id: null, total: { $sum: '$pricePence' } } },
    ]),

    Consultation.aggregate([
      {
        $match: {
          'payment.status': 'succeeded',
          'payment.paidAt': { $gte: lastMonthStart, $lte: lastMonthEnd },
        },
      },
      { $group: { _id: null, total: { $sum: '$pricePence' } } },
    ]),

    Consultation.countDocuments({
      status:      { $in: ['confirmed', 'scheduled'] },
      scheduledAt: { $gte: now },
    }),

    // ── Client health ─────────────────────────────────────────
    UserProfile.countDocuments({
      'energy.mpan': { $exists: true, $ne: null, $ne: '' },
    }),

    UserProfile.countDocuments({ 'energy.hasSmartMeter': true }),

    UserProfile.countDocuments({ 'onboarding.isCompleted': true }),

    Document.distinct('client', { status: 'signed', type: 'loa' }),

    // ── Charts + actions ──────────────────────────────────────
    buildRevenueChart(),
    buildPendingActions(),
    buildRenewalAlerts(),
    buildAdminRecentActivity(),
  ]);

  // ── Format pipeline counts ────────────────────────────────────
  const qC  = toCounts(quoteCounts);
  const dC  = toCounts(docCounts);
  const swC = toCounts(switchCounts);
  const cC  = toCounts(consultCounts);
  const mC  = toCounts(meterCounts);

  const SWITCH_ACTIVE = [
    'requested', 'submitted_to_supplier', 'cooling_off',
    'objected', 'objection_resolved', 'in_progress', 'pending_completion',
  ];
  const activeSwitchTotal  = SWITCH_ACTIVE.reduce((s, k) => s + (swC[k] ?? 0), 0);
  const totalSwitches      = Object.values(swC).reduce((s, c) => s + c, 0);
  const completedSwitches  = swC['completed'] ?? 0;
  const completionRatePct  = totalSwitches > 0
    ? parseFloat(((completedSwitches / totalSwitches) * 100).toFixed(1))
    : 0;

  // ── Revenue with MoM growth ───────────────────────────────────
  const revTotal   = parseFloat(((consultRevenueTotal[0]?.total   ?? 0) / 100).toFixed(2));
  const revThisM   = parseFloat(((consultRevenueThisMonth[0]?.total ?? 0) / 100).toFixed(2));
  const revLastM   = parseFloat(((consultRevenueLastMonth[0]?.total ?? 0) / 100).toFixed(2));
  const revGrowth  = revLastM > 0
    ? parseFloat((((revThisM - revLastM) / revLastM) * 100).toFixed(1))
    : null;

  // ── Client MoM growth ─────────────────────────────────────────
  const clientGrowth = newClientsLastMonth > 0
    ? parseFloat(
        (((newClientsThisMonth - newClientsLastMonth) / newClientsLastMonth) * 100).toFixed(1),
      )
    : null;

  // ── Switch funnel ─────────────────────────────────────────────
  const submitted   = (swC['submitted_to_supplier'] ?? 0) + (swC['cooling_off'] ?? 0) +
                      (swC['in_progress'] ?? 0) + (swC['pending_completion'] ?? 0) + completedSwitches;
  const coolingOff  = (swC['cooling_off'] ?? 0) + (swC['in_progress'] ?? 0) +
                      (swC['pending_completion'] ?? 0) + completedSwitches;
  const inProgress  = (swC['in_progress'] ?? 0) + (swC['pending_completion'] ?? 0) + completedSwitches;

  return {
    kpis: {
      clients: {
        total:              totalClients,
        activeThisMonth:    activeClientsThisMonth,
        newThisMonth:       newClientsThisMonth,
        newLastMonth:       newClientsLastMonth,
        growthPct:          clientGrowth,
        activeRatePct:      totalClients > 0
          ? parseFloat(((activeClientsThisMonth / totalClients) * 100).toFixed(1))
          : 0,
      },
      revenue: {
        totalPounds:       revTotal,
        thisMonthPounds:   revThisM,
        lastMonthPounds:   revLastM,
        growthPct:         revGrowth,
        trend:             revGrowth === null ? 'neutral'
          : revGrowth > 0 ? 'up' : revGrowth < 0 ? 'down' : 'flat',
      },
      switches: {
        active:                   activeSwitchTotal,
        completedTotal:           completedSwitches,
        completedThisMonth:       completedSwitchesThisMonth,
        completionRatePct,
        avgSavingPerClient:       avgSavingAgg[0] ? Math.round(avgSavingAgg[0].avg) : null,
        totalSavingsDelivered:    Math.round(totalSavingsAgg[0]?.total ?? 0),
        objected:                 swC['objected'] ?? 0,
        coolingOff:               swC['cooling_off'] ?? 0,
      },
      consultations: {
        upcoming:         upcomingConsultationsCount,
        completedTotal:   cC['completed']         ?? 0,
        awaitingPayment:  cC['awaiting_payment']  ?? 0,
        scheduled:        cC['scheduled']         ?? 0,
      },
      meterReadings: {
        pending:   (mC['requested'] ?? 0) + (mC['processing'] ?? 0),
        requested: mC['requested']  ?? 0,
        processing: mC['processing'] ?? 0,
        fulfilled: mC['fulfilled']  ?? 0,
        failed:    mC['failed']     ?? 0,
      },
    },

    pipeline: {
      quotes: {
        pending:   qC['pending']   ?? 0,
        contacted: qC['contacted'] ?? 0,
        completed: qC['completed'] ?? 0,
        cancelled: qC['cancelled'] ?? 0,
        total:     Object.values(qC).reduce((s, c) => s + c, 0),
      },
      switches: {
        active:    activeSwitchTotal,
        completed: completedSwitches,
        cancelled: swC['cancelled'] ?? 0,
        failed:    swC['failed']    ?? 0,
        objected:  swC['objected']  ?? 0,
        coolingOff: swC['cooling_off'] ?? 0,
        total:     totalSwitches,
      },
      documents: {
        pendingSignature: dC['pending_signature'] ?? 0,
        signed:          dC['signed']            ?? 0,
        expired:         dC['expired']           ?? 0,
        total:           Object.values(dC).reduce((s, c) => s + c, 0),
      },
      consultations: {
        awaitingPayment:  cC['awaiting_payment']   ?? 0,
        paymentConfirmed: cC['payment_confirmed']  ?? 0,
        confirmed:        cC['confirmed']          ?? 0,
        scheduled:        cC['scheduled']          ?? 0,
        completed:        cC['completed']          ?? 0,
        cancelled:        cC['cancelled']          ?? 0,
        total:            Object.values(cC).reduce((s, c) => s + c, 0),
      },
      meterReadings: {
        requested:  mC['requested']  ?? 0,
        processing: mC['processing'] ?? 0,
        fulfilled:  mC['fulfilled']  ?? 0,
        failed:     mC['failed']     ?? 0,
        total:      Object.values(mC).reduce((s, c) => s + c, 0),
      },
    },

    pendingActions,

    switchFunnel: {
      labels:         ['Requested', 'Submitted', 'Cooling Off', 'In Progress', 'Completed'],
      values:         [totalSwitches, submitted, coolingOff, inProgress, completedSwitches],
      cancelled:      swC['cancelled'] ?? 0,
      failed:         swC['failed']    ?? 0,
      completionRate: `${completionRatePct}%`,
    },

    topSuppliers: topSuppliersAgg.map((r) => ({
      supplier: r._id,
      switches: r.count,
      sharePct: completedSwitches > 0
        ? parseFloat(((r.count / completedSwitches) * 100).toFixed(1))
        : 0,
    })),

    revenueChart,

    clientHealth: {
      total:                 totalClients,
      withMpan:              profilesWithMpan,
      mpanCoveragePct:       totalClients > 0
        ? Math.round((profilesWithMpan / totalClients) * 100)
        : 0,
      withSmartMeter:        profilesWithSmartMeter,
      smartMeterPct:         totalClients > 0
        ? Math.round((profilesWithSmartMeter / totalClients) * 100)
        : 0,
      onboardingComplete,
      onboardingIncompletePct: totalClients > 0
        ? Math.round(((totalClients - onboardingComplete) / totalClients) * 100)
        : 0,
      withSignedLOA:         lOASignedClients.length,
      loaCoveragePct:        totalClients > 0
        ? Math.round((lOASignedClients.length / totalClients) * 100)
        : 0,
    },

    renewalAlerts,
    recentActivity,

    meta: {
      generatedAt: new Date().toISOString(),
      version:     '1',
    },
  };
};

module.exports = { getClientDashboard, getAdminDashboard };