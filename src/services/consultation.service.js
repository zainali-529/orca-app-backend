/**
 * Consultation Service — PAID ONLY
 */

const Consultation  = require('../models/Consultation');
const User          = require('../models/User');
const stripeService = require('./stripe.service');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
const { lookupPrice, getAvailableOptions } = require('../config/consultation.pricing');

// ── Populate helper ────────────────────────────────────────────────
const populateConsultation = (query) =>
  query
    .populate('client',         'firstName lastName email phone')
    .populate('assignedBroker', 'firstName lastName email')
    .populate('relatedSwitch',  'switchNumber status newSupplier')
    .populate('relatedQuote',   'quoteNumber status');

// ─────────────────────────────────────────────────────────────────
// CLIENT METHODS
// ─────────────────────────────────────────────────────────────────

const getOptions = () => getAvailableOptions();

/**
 * Summary counts for dashboard badges.
 */
const getMySummary = async (clientId) => {
  const results = await Consultation.aggregate([
    { $match: { client: clientId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = {
    requested: 0, awaiting_payment: 0, payment_failed: 0,
    payment_confirmed: 0, confirmed: 0, scheduled: 0,
    in_progress: 0, completed: 0, cancelled: 0, no_show: 0, refunded: 0,
    total: 0, active: 0,
  };

  const activeStatuses = [
    'requested', 'awaiting_payment', 'payment_confirmed',
    'confirmed', 'scheduled', 'in_progress',
  ];

  for (const r of results) {
    summary[r._id] = r.count;
    summary.total  += r.count;
    if (activeStatuses.includes(r._id)) summary.active += r.count;
  }

  summary.upcoming = await Consultation.countDocuments({
    client: clientId,
    status: { $in: ['confirmed', 'scheduled'] },
    scheduledAt: { $gt: new Date() },
  });

  return summary;
};

const getMyConsultations = async (clientId, query) => {
  const { status, page = 1, limit = 20 } = query;

  const filter = { client: clientId };
  if (status) filter.status = status;

  const skip  = (page - 1) * limit;
  const total = await Consultation.countDocuments(filter);

  const consultations = await populateConsultation(
    Consultation.find(filter)
      .select('-brokerNotes -payment.stripeClientSecret -payment.idempotencyKey')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
  ).lean({ virtuals: true });

  return {
    consultations,
    pagination: { total, page, limit,
      totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
  };
};

const getConsultationById = async (clientId, consultationId) =>
  populateConsultation(
    Consultation.findOne({ _id: consultationId, client: clientId })
      .select('-brokerNotes -payment.stripeClientSecret -payment.idempotencyKey')
  ).lean({ virtuals: true });

/**
 * Book a paid consultation.
 *
 * SECURITY: Price is ALWAYS looked up from server config.
 * The client body CANNOT set or influence the price.
 *
 * Returns { consultation, clientSecret, publishableKey }
 * clientSecret is returned ONCE — used by frontend Stripe SDK.
 */
const requestConsultation = async (clientId, data) => {
  const {
    category = 'general',
    duration = 45,
    meetingMethod = 'phone',
    preferredDateFrom,
    preferredDateTo,
    preferredTimeSlots = [],
    clientNotes,
  } = data;

  // ── 1. Server-side price lookup ──────────────────────────────
  const pricing = lookupPrice(category, duration);
  if (!pricing) {
    const e = new Error(
      `No pricing found for: category=${category}, duration=${duration}min. ` +
      `Check /api/consultations/options for valid combinations.`
    );
    e.statusCode = 400; throw e;
  }

  // ── 2. Get user ──────────────────────────────────────────────
  const user = await User.findById(clientId);
  if (!user) { const e = new Error('User not found'); e.statusCode = 404; throw e; }

  // ── 3. Create consultation record (status: requested) ────────
  const consultation = new Consultation({
    client:            clientId,
    category,
    duration,
    price:             pricing.price,
    pricePence:        pricing.pricePence,
    label:             pricing.label,
    meetingMethod,
    preferredDateFrom: preferredDateFrom ?? null,
    preferredDateTo:   preferredDateTo   ?? null,
    preferredTimeSlots,
    clientNotes:       clientNotes ?? null,
    status:            'requested',
  });

  await consultation.save();

  notifyTrigger.onConsultationBooked(consultation);  // ← ADD THIS

  // ── 4. Create Stripe PaymentIntent ───────────────────────────
  const idempotencyKey = `cons_${consultation._id}_v1`;

  const paymentIntent = await stripeService.createPaymentIntent({
    amountPence:    pricing.pricePence,
    currency:       'gbp',
    idempotencyKey,
    metadata: {
      consultationId:     consultation._id.toString(),
      consultationNumber: consultation.consultationNumber,
      clientId:           clientId.toString(),
      clientEmail:        user.email,
      category,
      duration:           String(duration),
      label:              pricing.label,
    },
  });

  // ── 5. Store payment (clientSecret = select:false) ───────────
  consultation.status          = 'awaiting_payment';
  consultation.paymentAttempts = 1;
  consultation.payment = {
    stripePaymentIntentId: paymentIntent.id,
    stripeClientSecret:    paymentIntent.client_secret,  // select:false
    amount:                pricing.pricePence,
    currency:              'gbp',
    amountPounds:          pricing.price,
    status:                'pending',
    idempotencyKey,
  };

  await consultation.save();

  // ── 6. Return clientSecret ONE TIME ─────────────────────────
  return {
    consultation:  consultation.toJSON(),
    clientSecret:  paymentIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  };
};

const cancelConsultation = async (clientId, consultationId, reason) => {
  const c = await Consultation.findOne({ _id: consultationId, client: clientId })
    .select('+payment.stripeClientSecret');

  if (!c) { const e = new Error('Consultation not found'); e.statusCode = 404; throw e; }
  if (!c.canCancel) {
    const e = new Error(`Cannot cancel a '${c.status}' consultation`);
    e.statusCode = 400; throw e;
  }

  const prev           = c.status;
  c.status             = 'cancelled';
  c.cancelledAt        = new Date();
  c.cancelledBy        = 'client';
  c.cancellationReason = reason ?? null;

  // Cancel PaymentIntent if payment not taken yet
  if (c.payment?.stripePaymentIntentId &&
    ['requested', 'awaiting_payment', 'payment_failed'].includes(prev)) {
    await stripeService.cancelPaymentIntent(c.payment.stripePaymentIntentId);
    c.payment.status = 'cancelled';
  }

  await c.save();

  notifyTrigger.onConsultationCancelled(c, c.cancelledBy);  // ← ADD THIS

  return c;
};

const retryPayment = async (clientId, consultationId) => {
  const c = await Consultation.findOne({
    _id:    consultationId,
    client: clientId,
    status: 'payment_failed',
  }).select('+payment.stripeClientSecret +payment.idempotencyKey');

  if (!c) {
    const e = new Error('Consultation not found or not eligible for retry');
    e.statusCode = 404; throw e;
  }
  if (c.paymentAttempts >= 3) {
    const e = new Error('Maximum payment attempts (3) reached. Please contact support.');
    e.statusCode = 400; throw e;
  }

  const user           = await User.findById(clientId);
  const idempotencyKey = `cons_${c._id}_v${c.paymentAttempts + 1}_${Date.now()}`;

  const paymentIntent = await stripeService.createPaymentIntent({
    amountPence:    c.pricePence,
    currency:       'gbp',
    idempotencyKey,
    metadata: {
      consultationId:     c._id.toString(),
      consultationNumber: c.consultationNumber,
      clientId:           clientId.toString(),
      clientEmail:        user.email,
      attempt:            String(c.paymentAttempts + 1),
    },
  });

  c.status                        = 'awaiting_payment';
  c.paymentAttempts               += 1;
  c.payment.stripePaymentIntentId = paymentIntent.id;
  c.payment.stripeClientSecret    = paymentIntent.client_secret;
  c.payment.status                = 'pending';
  c.payment.idempotencyKey        = idempotencyKey;

  await c.save();

  return {
    consultation:  c.toJSON(),
    clientSecret:  paymentIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  };
};

const submitRating = async (clientId, consultationId, { rating, comment }) => {
  const c = await Consultation.findOne({ _id: consultationId, client: clientId, status: 'completed' });
  if (!c) { const e = new Error('Consultation not found or not completed'); e.statusCode = 404; throw e; }
  if (c.rating) { const e = new Error('Rating already submitted'); e.statusCode = 400; throw e; }

  c.rating        = rating;
  c.ratingComment = comment ?? null;
  c.ratedAt       = new Date();

  await c.save();
  return c;
};

// ─────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────

const handleStripeWebhookEvent = async (event) => {
  switch (event.type) {

    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const c  = await Consultation.findOne({ 'payment.stripePaymentIntentId': pi.id });
      if (!c) { console.warn(`[Webhook] No consultation for PI: ${pi.id}`); return; }
      if (c.payment.status === 'succeeded') return; // idempotent

      c.status                   = 'payment_confirmed';
      c.payment.status           = 'succeeded';
      c.payment.paidAt           = new Date(pi.created * 1000);
      c.payment.stripeCustomerId = pi.customer ?? null;

      await c.save();

      notifyTrigger.onConsultationPaymentConfirmed(c);  // ← ADD THIS

      console.log(`[Webhook] Payment confirmed: ${c.consultationNumber} £${c.price}`);
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      const c  = await Consultation.findOne({ 'payment.stripePaymentIntentId': pi.id });
      if (!c) return;

      c.status         = 'payment_failed';
      c.payment.status = 'failed';

      await c.save();

      notifyTrigger.onConsultationPaymentFailed(c);  // ← ADD THIS

      console.log(`[Webhook] Payment failed: ${c.consultationNumber}`);
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      const c = await Consultation.findOne({ 'payment.stripePaymentIntentId': charge.payment_intent });
      if (!c) return;

      const isFullRefund      = charge.amount_refunded >= charge.amount;
      c.payment.status        = isFullRefund ? 'refunded' : 'partially_refunded';
      c.payment.refundAmount  = charge.amount_refunded;
      c.payment.refundedAt    = new Date();
      if (isFullRefund) c.status = 'refunded';

      await c.save();
      break;
    }

    default:
      break;
  }
};

// ─────────────────────────────────────────────────────────────────
// ADMIN METHODS
// ─────────────────────────────────────────────────────────────────

const adminListConsultations = async (query) => {
  const {
    clientId, status, category, assignedBroker,
    scheduledFrom, scheduledTo,
    page = 1, limit = 20, sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = {};
  if (clientId)       filter.client         = clientId;
  if (status)         filter.status         = status;
  if (category)       filter.category       = category;
  if (assignedBroker) filter.assignedBroker = assignedBroker;
  if (scheduledFrom || scheduledTo) {
    filter.scheduledAt = {};
    if (scheduledFrom) filter.scheduledAt.$gte = new Date(scheduledFrom);
    if (scheduledTo)   filter.scheduledAt.$lte = new Date(scheduledTo);
  }

  const skip  = (page - 1) * limit;
  const total = await Consultation.countDocuments(filter);

  const consultations = await populateConsultation(
    Consultation.find(filter)
      .select('+brokerNotes -payment.stripeClientSecret -payment.idempotencyKey')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(limit)
  ).lean({ virtuals: true });

  return {
    consultations,
    pagination: { total, page, limit,
      totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
  };
};

const adminGetConsultation = async (id) =>
  populateConsultation(
    Consultation.findById(id)
      .select('+brokerNotes -payment.stripeClientSecret -payment.idempotencyKey')
  ).lean({ virtuals: true });

const adminConfirm = async (adminId, consultationId, data = {}) => {
  const c = await Consultation.findById(consultationId).select('+brokerNotes');
  if (!c) { const e = new Error('Not found'); e.statusCode = 404; throw e; }

  if (!['requested', 'payment_confirmed'].includes(c.status)) {
    const e = new Error(`Cannot confirm from '${c.status}'`); e.statusCode = 400; throw e;
  }

  c.status         = 'confirmed';
  c.confirmedAt    = new Date();
  c.assignedBroker = adminId;

  if (data.scheduledAt)   { c.scheduledAt   = new Date(data.scheduledAt); c.status = 'scheduled'; }
  if (data.meetingMethod) c.meetingMethod = data.meetingMethod;
  if (data.meetingLink)   c.meetingLink   = data.meetingLink;
  if (data.meetingPhone)  c.meetingPhone  = data.meetingPhone;
  if (data.brokerNotes)   c.brokerNotes   = data.brokerNotes;

  await c.save();

  if (data.scheduledAt) {
    notifyTrigger.onConsultationScheduled(c);  // ← ADD THIS
  }

  return c;
};

const adminComplete = async (adminId, consultationId, data = {}) => {
  const c = await Consultation.findById(consultationId).select('+brokerNotes');
  if (!c) { const e = new Error('Not found'); e.statusCode = 404; throw e; }

  if (!['in_progress', 'scheduled', 'confirmed'].includes(c.status)) {
    const e = new Error(`Cannot complete from '${c.status}'`); e.statusCode = 400; throw e;
  }

  c.status      = 'completed';
  c.completedAt = new Date();
  if (data.outcome)         c.outcome    = data.outcome;
  if (data.nextSteps)       c.nextSteps  = data.nextSteps;
  if (data.brokerNotes)     c.brokerNotes = data.brokerNotes;
  if (data.relatedSwitch)   c.relatedSwitch   = data.relatedSwitch;
  if (data.relatedQuote)    c.relatedQuote    = data.relatedQuote;
  if (data.relatedDocument) c.relatedDocument = data.relatedDocument;

  await c.save();

  notifyTrigger.onConsultationCompleted(c);  // ← ADD THIS

  return c;
};

const adminNoShow = async (adminId, consultationId, brokerNotes) => {
  const c = await Consultation.findById(consultationId).select('+brokerNotes');
  if (!c) { const e = new Error('Not found'); e.statusCode = 404; throw e; }
  if (!['scheduled', 'confirmed', 'in_progress'].includes(c.status)) {
    const e = new Error(`Cannot mark no-show from '${c.status}'`); e.statusCode = 400; throw e;
  }

  c.status   = 'no_show';
  c.noShowAt = new Date();
  if (brokerNotes) c.brokerNotes = brokerNotes;

  await c.save();

  notifyTrigger.onConsultationNoShow(c);  // ← ADD THIS

  return c;
};

const adminRefund = async (adminId, consultationId, opts = {}) => {
  const { reason = 'requested_by_customer', partial, amountPounds } = opts;

  const c = await Consultation.findById(consultationId)
    .select('+brokerNotes +payment.stripePaymentIntentId');

  if (!c) { const e = new Error('Not found'); e.statusCode = 404; throw e; }
  if (!c.payment?.stripePaymentIntentId) {
    const e = new Error('No Stripe payment found'); e.statusCode = 400; throw e;
  }

  const refundPence = partial && amountPounds ? Math.round(parseFloat(amountPounds) * 100) : null;
  const refund = await stripeService.createRefund(c.payment.stripePaymentIntentId, refundPence, reason);

  c.payment.stripeRefundId = refund.id;
  c.payment.refundAmount   = refund.amount;
  c.payment.refundedAt     = new Date();
  c.payment.status         = refund.amount >= c.pricePence ? 'refunded' : 'partially_refunded';
  if (refund.amount >= c.pricePence) c.status = 'refunded';

  await c.save();

  notifyTrigger.onConsultationRefunded(c);  // ← ADD THIS

  return { consultation: c, refund };
};

const adminGetStats = async () => {
  const [statusBreakdown, categoryBreakdown, revenueStats, upcomingCount, ratingStats] =
    await Promise.all([
      Consultation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Consultation.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
      Consultation.aggregate([
        { $match: { 'payment.status': 'succeeded' } },
        { $group: { _id: null,
            totalRevenuePence: { $sum: '$pricePence' },
            count:             { $sum: 1 },
            avgPricePence:     { $avg: '$pricePence' },
        }},
      ]),
      Consultation.countDocuments({
        status: { $in: ['confirmed', 'scheduled'] },
        scheduledAt: { $gt: new Date() },
      }),
      Consultation.aggregate([
        { $match: { rating: { $ne: null } } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);

  const byStatus = {};
  for (const r of statusBreakdown) byStatus[r._id] = r.count;

  const byCategory = {};
  for (const r of categoryBreakdown) byCategory[r._id] = r.count;

  const rev = revenueStats[0] ?? { totalRevenuePence: 0, count: 0, avgPricePence: 0 };

  return {
    byStatus,
    byCategory,
    revenue: {
      totalPounds: (rev.totalRevenuePence / 100).toFixed(2),
      count:       rev.count,
      avgPounds:   (rev.avgPricePence / 100).toFixed(2),
    },
    upcomingCount,
    ratings: ratingStats[0]
      ? { avg: ratingStats[0].avgRating.toFixed(1), count: ratingStats[0].count }
      : { avg: null, count: 0 },
  };
};

module.exports = {
  getOptions, getMySummary, getMyConsultations,
  getConsultationById, requestConsultation,
  cancelConsultation, retryPayment, submitRating,
  handleStripeWebhookEvent,
  adminListConsultations, adminGetConsultation,
  adminConfirm, adminComplete, adminNoShow,
  adminRefund, adminGetStats,
};