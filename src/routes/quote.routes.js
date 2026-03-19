const express = require('express');
const router  = express.Router();

const quoteController = require('../controllers/quote.controller');
const { protect }     = require('../middleware/auth');
const validate        = require('../middleware/validate');
const validateQuery   = require('../middleware/validateQuery');
const {
  createQuoteSchema,
  updateQuoteSchema,
  listQuotesSchema,
} = require('../validators/quote.validators');

// All quote routes require authentication
router.use(protect);

// ── List & Create ───────────────────────────────────────────────

// GET  /api/quotes              — list my quotes (with filters/pagination)
router.get('/',
  validateQuery(listQuotesSchema),
  quoteController.getMyQuotes
);

// GET  /api/quotes/stats        — quote stats for dashboard
router.get('/stats', quoteController.getQuoteStats);

// POST /api/quotes              — create a new quote
router.post('/',
  validate(createQuoteSchema),
  quoteController.createQuote
);

// ── Single quote operations ─────────────────────────────────────
// MUST register /stats before /:id or it'll be caught as an ID

// GET  /api/quotes/:id          — get a single quote
router.get('/:id', quoteController.getQuote);

// PATCH /api/quotes/:id         — update notes, status, client info
router.patch('/:id',
  validate(updateQuoteSchema),
  quoteController.updateQuote
);

// DELETE /api/quotes/:id        — delete quote + Cloudinary PDF
router.delete('/:id', quoteController.deleteQuote);

// ── PDF endpoints ──────────────────────────────────────────────

// POST /api/quotes/:id/pdf      — generate PDF + upload to Cloudinary
router.post('/:id/pdf', quoteController.generatePdf);

// GET  /api/quotes/:id/pdf      — download/view the PDF
router.get('/:id/pdf', quoteController.downloadPdf);

module.exports = router;
