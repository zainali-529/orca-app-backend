const quoteService = require('../services/quote.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── POST /api/quotes ────────────────────────────────────────────
const createQuote = async (req, res) => {
  try {
    const quote = await quoteService.createQuoteRequest(req.user._id, req.body);
    return sendSuccess(res, 201, 'Quote request submitted. We will contact you shortly.', { quote });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid tariff ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ── GET /api/quotes ─────────────────────────────────────────────
const getMyQuotes = async (req, res) => {
  try {
    const result = await quoteService.getMyQuotes(req.user._id, req.query);
    return sendSuccess(res, 200, 'Quote requests fetched', result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/quotes/summary ─────────────────────────────────────
const getQuoteSummary = async (req, res) => {
  try {
    const summary = await quoteService.getQuoteSummary(req.user._id);
    return sendSuccess(res, 200, 'Quote summary', { summary });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/quotes/:id ─────────────────────────────────────────
const getQuote = async (req, res) => {
  try {
    const quote = await quoteService.getQuoteById(req.user._id, req.params.id);
    if (!quote) return sendError(res, 404, 'Quote request not found');
    return sendSuccess(res, 200, 'Quote request fetched', { quote });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, 500, error.message);
  }
};

// ── PATCH /api/quotes/:id ───────────────────────────────────────
const updateQuote = async (req, res) => {
  try {
    const quote = await quoteService.updateQuoteRequest(req.user._id, req.params.id, req.body);
    if (!quote) return sendError(res, 404, 'Quote request not found');
    return sendSuccess(res, 200, 'Quote request updated', { quote });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ── DELETE /api/quotes/:id ──────────────────────────────────────
const deleteQuote = async (req, res) => {
  try {
    const result = await quoteService.deleteQuoteRequest(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Quote request not found');
    return sendSuccess(res, 200, 'Quote request deleted');
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

module.exports = {
  createQuote,
  getMyQuotes,
  getQuoteSummary,
  getQuote,
  updateQuote,
  deleteQuote,
};
