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

// GET  /api/quotes/summary  — count by status (before /:id)
router.get('/summary', quoteController.getQuoteSummary);

// GET  /api/quotes          — list my quote requests
router.get('/',   validateQuery(listQuotesSchema), quoteController.getMyQuotes);

// POST /api/quotes          — submit a quote request
router.post('/',  validate(createQuoteSchema),     quoteController.createQuote);

// GET    /api/quotes/:id    — single quote request
router.get('/:id',    quoteController.getQuote);

// PATCH  /api/quotes/:id    — update message / contact / cancel
router.patch('/:id',  validate(updateQuoteSchema),  quoteController.updateQuote);

// DELETE /api/quotes/:id    — delete pending request
router.delete('/:id', quoteController.deleteQuote);

module.exports = router;
