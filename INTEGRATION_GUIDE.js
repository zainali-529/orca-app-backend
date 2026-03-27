/**
 * ═══════════════════════════════════════════════════════════════
 * NOTIFICATION SYSTEM — INTEGRATION GUIDE
 * ═══════════════════════════════════════════════════════════════
 *
 * This file shows the EXACT lines to add to each existing service.
 * Copy only the lines marked with  ← ADD THIS
 *
 * ─────────────────────────────────────────────────────────────
 * 1. src/app.js
 * ─────────────────────────────────────────────────────────────
 *
 * Add near the other route imports:
 *
 *   const notificationRoutes = require('./routes/notification.routes');  // ← ADD THIS
 *
 * Add near the other app.use() lines:
 *
 *   app.use('/api/notifications', notificationRoutes);                   // ← ADD THIS
 *
 * In the admin routes section (admin.routes.js), add:
 *
 *   // In src/routes/admin.routes.js, add at the top:
 *   const notificationController = require('../controllers/notification.controller');
 *
 *   // Add this route:
 *   router.get('/notifications/stats', notificationController.adminGetStats);
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 2. src/server.js
 * ─────────────────────────────────────────────────────────────
 *
 * Add after tariffSync.startScheduler():
 *
 *   const notifCron = require('./jobs/notification.cron');  // ← ADD THIS
 *   notifCron.startScheduler();                             // ← ADD THIS
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 3. src/services/auth.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In registerUser(), after:  return user;
 *   notifyTrigger.onUserRegistered(user);  // ← ADD THIS (fire & forget)
 *   return user;
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 4. src/services/admin.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In updateClient(), after  await user.save() or findOneAndUpdate:
 *   // When admin deactivates a user:
 *   if (safeUpdates.isActive === false) {
 *     notifyTrigger.onAccountDeactivated(user);  // ← ADD THIS
 *   }
 *
 * In updateQuote(), after  await quote.save():
 *   if (status && status !== quote.status) {     // already inside this block
 *     notifyTrigger.onQuoteStatusChanged(quote, status);  // ← ADD THIS
 *   }
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 5. src/services/quote.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In createQuoteRequest(), after  const quote = await Quote.create(...):
 *   notifyTrigger.onQuoteCreated(quote);  // ← ADD THIS
 *   return quote;
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 6. src/services/document.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In signLOA(), after  await document.save():
 *   notifyTrigger.onDocumentSigned(document);  // ← ADD THIS
 *   return document;
 *
 * In adminSendDocument(), after  const doc = await Document.create(...):
 *   notifyTrigger.onDocumentSentToClient(doc);  // ← ADD THIS
 *   return doc;
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 7. src/services/switch.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In adminCreateSwitch(), after  await sw.save():
 *   notifyTrigger.onSwitchInitiated(sw);  // ← ADD THIS
 *   return sw;
 *
 * In adminUpdateStatus(), after  await sw.save():
 *   notifyTrigger.onSwitchStatusChanged(sw, newStatus);  // ← ADD THIS
 *   return sw;
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 8. src/services/consultation.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In requestConsultation(), after  await consultation.save() (final save):
 *   notifyTrigger.onConsultationBooked(consultation);  // ← ADD THIS
 *
 * In handleStripeWebhookEvent(), case 'payment_intent.succeeded':
 *   after  await c.save():
 *   notifyTrigger.onConsultationPaymentConfirmed(c);  // ← ADD THIS
 *
 * In handleStripeWebhookEvent(), case 'payment_intent.payment_failed':
 *   after  await c.save():
 *   notifyTrigger.onConsultationPaymentFailed(c);  // ← ADD THIS
 *
 * In adminConfirm(), after  await c.save():
 *   if (data.scheduledAt) {
 *     notifyTrigger.onConsultationScheduled(c);  // ← ADD THIS
 *   }
 *
 * In adminComplete(), after  await c.save():
 *   notifyTrigger.onConsultationCompleted(c);  // ← ADD THIS
 *
 * In cancelConsultation(), after  await c.save():
 *   notifyTrigger.onConsultationCancelled(c, c.cancelledBy);  // ← ADD THIS
 *
 * In adminRefund(), after  await c.save():
 *   notifyTrigger.onConsultationRefunded(c);  // ← ADD THIS
 *
 * In adminNoShow(), after  await c.save():
 *   notifyTrigger.onConsultationNoShow(c);  // ← ADD THIS
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 9. src/services/meter.service.js
 * ─────────────────────────────────────────────────────────────
 *
 * At top of file:
 *   const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
 *
 * In requestReading(), after  const reading = await MeterReading.create(...):
 *   notifyTrigger.onMeterReadingRequested(reading);  // ← ADD THIS
 *   return reading;
 *
 * In adminMarkProcessing(), after  await reading.save():
 *   notifyTrigger.onMeterReadingProcessing(reading);  // ← ADD THIS
 *   return reading;
 *
 * In adminFulfillReading(), after  await reading.save():
 *   notifyTrigger.onMeterReadingFulfilled(reading);  // ← ADD THIS
 *   return reading;
 *
 * In adminFailReading(), after  await reading.save():
 *   notifyTrigger.onMeterReadingFailed(reading);  // ← ADD THIS
 *   return reading;
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 10. npm install
 * ─────────────────────────────────────────────────────────────
 *
 *   npm install expo-server-sdk
 *
 * Optional (for enhanced push delivery):
 *   Add to .env:
 *   EXPO_ACCESS_TOKEN=your_expo_access_token
 *   (Get from: https://expo.dev/accounts/[username]/settings/access-tokens)
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 11. MongoDB indexes (auto-created on first run)
 * ─────────────────────────────────────────────────────────────
 *
 * Notification model creates these indexes automatically:
 *   - { recipient, isRead, createdAt }  — list queries
 *   - { recipient, category, createdAt } — category filter
 *   - { pushStatus, createdAt }          — push retry queries
 *   - { expiresAt } TTL index            — auto-delete after 90 days
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 12. API Endpoints Summary
 * ─────────────────────────────────────────────────────────────
 *
 * Method  Endpoint                              Auth    Description
 * ─────────────────────────────────────────────────────────────
 * GET     /api/notifications                    Bearer  List notifications (paginated)
 * GET     /api/notifications/unread-count       Bearer  Badge number + by-category counts
 * PATCH   /api/notifications/read-all           Bearer  Mark all (or category) as read
 * DELETE  /api/notifications/clear-read         Bearer  Delete all read notifications
 * POST    /api/notifications/push-token         Bearer  Register Expo push token
 * DELETE  /api/notifications/push-token         Bearer  Deregister token on logout
 * PATCH   /api/notifications/:id/read           Bearer  Mark single as read
 * DELETE  /api/notifications/:id                Bearer  Delete one notification
 * GET     /api/admin/notifications/stats        Admin   Push delivery stats
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 13. Query Parameters for GET /api/notifications
 * ─────────────────────────────────────────────────────────────
 *
 * ?category=switch           — filter by category
 * ?isRead=false              — only unread
 * ?priority=urgent           — filter by priority
 * ?page=1&limit=20           — pagination
 *
 *
 * ─────────────────────────────────────────────────────────────
 * 14. Notification Coverage Summary
 * ─────────────────────────────────────────────────────────────
 *
 * Module           Events                                Recipients
 * ─────────────────────────────────────────────────────────────
 * Account          welcome, deactivated                  client + admins
 * Quotes           created, contacted, completed,        client + admins
 *                  cancelled
 * Documents        sent, signed, expiring (30/14/7/3),  client + admins
 *                  expired
 * Switches         initiated, submitted, cooling-off,    client + admins
 *                  cooling-ending (3/1 days), objected,  (objection → admin)
 *                  objection-resolved, in-progress,
 *                  completed, cancelled, failed
 * Consultations    booked, payment-confirmed,            client + admins
 *                  payment-failed, scheduled,            (payment → admin)
 *                  reminder-24h, reminder-1h, completed,
 *                  cancelled, refunded, no-show
 * Meter readings   requested, processing, fulfilled,     client + admins
 *                  failed
 * Tariff/Energy    contract renewal 60/30/14 days        client
 *
 * Total: 37 unique notification types
 */
