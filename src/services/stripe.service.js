/**
 * Stripe Service
 *
 * ALL Stripe API calls go through here.
 * No other file should import stripe directly.
 *
 * Security:
 * - Idempotency keys prevent double charges
 * - Amount always comes from server DB — never from client request
 * - Webhook signature verified before processing
 * - No card data stored — PCI compliance handled by Stripe
 */

const { getStripe, getWebhookSecret } = require('../config/stripe');

// ── Payment Intent ─────────────────────────────────────────────────

/**
 * Create a PaymentIntent for a consultation booking.
 *
 * @param {object} opts
 * @param {number}  opts.amountPence     Amount in pence (e.g. 4900 = £49.00)
 * @param {string}  opts.currency        Always 'gbp'
 * @param {string}  opts.idempotencyKey  Unique key per booking attempt (prevents double charge)
 * @param {object}  opts.metadata        Stored on Stripe for reconciliation
 * @returns {stripe.PaymentIntent}
 */
const createPaymentIntent = async ({ amountPence, currency = 'gbp', idempotencyKey, metadata = {} }) => {
  const stripe = getStripe();

  if (!amountPence || amountPence < 50) {
    // Stripe minimum is 50p
    throw new Error('Payment amount must be at least £0.50');
  }

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount:   amountPence,
      currency,
      // Allow card payments only — can expand later (BACS, etc.)
      payment_method_types: ['card'],
      metadata: {
        ...metadata,
        source: 'energy_broker_app',
      },
      // Allow future payment method saving (for repeat clients)
      setup_future_usage: 'off_session',
    },
    {
      idempotencyKey,
    }
  );

  return paymentIntent;
};

/**
 * Retrieve a PaymentIntent by ID.
 * Used to verify payment status after webhook.
 */
const retrievePaymentIntent = async (paymentIntentId) => {
  const stripe = getStripe();
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

/**
 * Cancel a PaymentIntent (before it's confirmed).
 * Used when consultation is cancelled before payment.
 */
const cancelPaymentIntent = async (paymentIntentId) => {
  const stripe = getStripe();
  try {
    return await stripe.paymentIntents.cancel(paymentIntentId);
  } catch (err) {
    // Already cancelled or captured — not a fatal error
    if (err.code === 'payment_intent_unexpected_state') {
      return null;
    }
    throw err;
  }
};

/**
 * Create a Refund for a paid consultation.
 *
 * @param {string}  paymentIntentId
 * @param {number}  [amountPence]    Omit for full refund
 * @param {string}  [reason]         'duplicate' | 'fraudulent' | 'requested_by_customer'
 */
const createRefund = async (paymentIntentId, amountPence = null, reason = 'requested_by_customer') => {
  const stripe = getStripe();

  const refundData = {
    payment_intent: paymentIntentId,
    reason,
  };

  if (amountPence) {
    refundData.amount = amountPence; // Partial refund
  }

  return stripe.refunds.create(refundData);
};

// ── Webhook ────────────────────────────────────────────────────────

/**
 * Verify and construct a Stripe webhook event.
 *
 * IMPORTANT: This requires the RAW request body (Buffer), not parsed JSON.
 * In Express, set up: express.raw({ type: 'application/json' }) for webhook route.
 *
 * @param {Buffer} rawBody    Raw request body
 * @param {string} signature  Value of 'stripe-signature' header
 * @returns {stripe.Event}
 */
const constructWebhookEvent = (rawBody, signature) => {
  const stripe        = getStripe();
  const webhookSecret = getWebhookSecret();

  // This throws if signature is invalid — protects against replay attacks
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
};

// ── Customer ───────────────────────────────────────────────────────

/**
 * Create or retrieve a Stripe Customer for a user.
 * Customers allow saving payment methods for repeat bookings.
 */
const createOrUpdateCustomer = async ({ email, name, phone, metadata = {} }) => {
  const stripe = getStripe();
  return stripe.customers.create({
    email,
    name,
    phone,
    metadata: { ...metadata, source: 'energy_broker_app' },
  });
};

// ── Helper ─────────────────────────────────────────────────────────

/**
 * Convert pounds to pence (Stripe uses smallest currency unit).
 * Example: £49.00 → 4900
 */
const poundsToPence = (pounds) => Math.round(parseFloat(pounds) * 100);

/**
 * Convert pence to pounds (for display).
 * Example: 4900 → 49.00
 */
const penceToPounds = (pence) => (pence / 100).toFixed(2);

/**
 * Format a human-readable price string.
 * Example: 4900 → "£49.00"
 */
const formatPrice = (pence) => `£${penceToPounds(pence)}`;

module.exports = {
  createPaymentIntent,
  retrievePaymentIntent,
  cancelPaymentIntent,
  createRefund,
  constructWebhookEvent,
  createOrUpdateCustomer,
  poundsToPence,
  penceToPounds,
  formatPrice,
};