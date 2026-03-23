const express = require('express');
const router  = express.Router();

const { handleStripeWebhook } = require('../controllers/stripe.webhook.controller');

/**
 * IMPORTANT: This route must receive raw body (Buffer), not parsed JSON.
 *
 * In app.js, register this route BEFORE express.json() middleware:
 *
 *   // ⚠️ Webhook MUST come before express.json()
 *   const webhookRoutes = require('./routes/webhook.routes');
 *   app.use('/api/webhooks', webhookRoutes);
 *
 *   // Then JSON middleware for everything else:
 *   app.use(express.json());
 *
 * The express.raw() middleware here overrides the body parsing
 * specifically for this route.
 */

// POST /api/webhooks/stripe
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),  // Raw body for signature verification
  handleStripeWebhook
);

module.exports = router;