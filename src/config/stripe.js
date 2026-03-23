/**
 * Stripe Configuration
 *
 * Security rules:
 * - Secret key ONLY on server — never exposed to client
 * - Webhook secret for signature verification
 * - API version pinned — never auto-upgrade
 * - No card data ever touches our server — all handled by Stripe
 */

let stripeInstance = null;

const getStripe = () => {
  if (stripeInstance) return stripeInstance;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. ' +
      'Add it to your .env file. ' +
      'Get it from: https://dashboard.stripe.com/apikeys'
    );
  }

  if (!secretKey.startsWith('sk_')) {
    throw new Error(
      'STRIPE_SECRET_KEY is invalid. ' +
      'It must start with "sk_test_" (test) or "sk_live_" (production).'
    );
  }

  const Stripe = require('stripe');

  stripeInstance = new Stripe(secretKey, {
    apiVersion: '2024-11-20.acacia',  // Pinned — never auto-upgrade
    appInfo: {
      name:    'Energy Broker App',
      version: '1.0.0',
    },
    // Automatic retries on transient errors (network etc.)
    maxNetworkRetries: 2,
    timeout: 10000,  // 10s timeout
  });

  return stripeInstance;
};

/**
 * Get the webhook signing secret.
 * Used to verify that webhook events truly come from Stripe.
 */
const getWebhookSecret = () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. ' +
      'Create a webhook endpoint in Stripe Dashboard and add the signing secret. ' +
      'For local testing: use `stripe listen --forward-to localhost:PORT/api/webhooks/stripe`'
    );
  }
  return secret;
};

module.exports = { getStripe, getWebhookSecret };