const express  = require('express');
const router   = express.Router();

const consultationController = require('../controllers/consultation.controller');
const { protect }    = require('../middleware/auth');
const validate       = require('../middleware/validate');
const validateQuery  = require('../middleware/validateQuery');
const {
  requestConsultationSchema,
  cancelConsultationSchema,
  submitRatingSchema,
  listMyConsultationsSchema,
} = require('../validators/consultation.validators');

// All consultation routes require auth
router.use(protect);

// ── Options (available types + prices) ───────────────────────────
// GET /api/consultations/options
router.get('/options', consultationController.getOptions);

// ── Summary (counts by status) ────────────────────────────────────
// GET /api/consultations/summary
router.get('/summary', consultationController.getMySummary);

// ── List ──────────────────────────────────────────────────────────
// GET /api/consultations
router.get('/', validateQuery(listMyConsultationsSchema), consultationController.getMyConsultations);

// ── Create ────────────────────────────────────────────────────────
// POST /api/consultations
router.post('/', validate(requestConsultationSchema), consultationController.requestConsultation);

// ── Single ────────────────────────────────────────────────────────
// GET /api/consultations/:id
router.get('/:id', consultationController.getConsultation);

// ── Cancel ────────────────────────────────────────────────────────
// POST /api/consultations/:id/cancel
router.post('/:id/cancel', validate(cancelConsultationSchema), consultationController.cancelConsultation);

// ── Retry payment (paid, payment_failed only) ─────────────────────
// POST /api/consultations/:id/retry-payment
router.post('/:id/retry-payment', consultationController.retryPayment);

// ── Submit rating (after completed) ──────────────────────────────
// POST /api/consultations/:id/rating
router.post('/:id/rating', validate(submitRatingSchema), consultationController.submitRating);

module.exports = router;