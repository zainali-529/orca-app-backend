/**
 * Stripe Webhook Controller
 *
 * SECURITY — This is the most critical endpoint in the payments system.
 *
 * Rules:
 * 1. Raw body required — express.json() must NOT run on this route
 * 2. Stripe signature verified FIRST — before any DB operations
 * 3. Idempotent — safe to receive same event multiple times
 * 4. Always return 200 quickly — Stripe retries on non-2xx
 * 5. No sensitive data in logs
 * 6. Webhook secret from env — never hardcoded
 *
 * Setup in Express (app.js):
 *   // BEFORE express.json() middleware:
 *   app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
 *   // THEN other routes with express.json():
 *   app.use(express.json());
 */

const stripeService          = require('../services/stripe.service');
const consultationService    = require('../services/consultation.service');

/**
 * POST /api/webhooks/stripe
 *
 * Stripe sends events here when:
 * - payment_intent.succeeded     → Client paid → unlock consultation
 * - payment_intent.payment_failed → Payment failed → notify client
 * - charge.refunded               → Refund processed
 */
const handleStripeWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];

  // ── 1. Signature must be present ──────────────────────────────
  if (!signature) {
    console.warn('[Webhook] Missing stripe-signature header — rejected');
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  let event;

  // ── 2. Verify signature (prevents spoofed events) ─────────────
  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    // Invalid signature = someone is NOT Stripe
    console.warn(`[Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  // ── 3. Log event type (no sensitive data) ─────────────────────
  console.log(`[Webhook] Received: ${event.type} | id: ${event.id}`);

  // ── 4. Process event — async, but ACK Stripe immediately ──────
  // We acknowledge receipt first, then process.
  // This prevents Stripe from timing out and retrying unnecessarily.
  res.status(200).json({ received: true });

  // ── 5. Process the event ──────────────────────────────────────
  try {
    await consultationService.handleStripeWebhookEvent(event);
  } catch (err) {
    // Log processing errors but don't re-throw —
    // we already sent 200 to Stripe. Log for investigation.
    console.error(`[Webhook] Error processing event ${event.type} (${event.id}):`, err.message);
  }
};

module.exports = { handleStripeWebhook };