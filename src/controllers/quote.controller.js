const quoteService = require('../services/quote.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── POST /api/quotes ────────────────────────────────────────────
const createQuote = async (req, res) => {
  try {
    const quote = await quoteService.createQuote(req.user._id, req.body);
    return sendSuccess(res, 201, 'Quote created', { quote });
  } catch (error) {
    if (error.name === 'CastError') {
      return sendError(res, 400, 'Invalid tariff ID');
    }
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ── GET /api/quotes ─────────────────────────────────────────────
const getMyQuotes = async (req, res) => {
  try {
    const result = await quoteService.getMyQuotes(req.user._id, req.query);
    return sendSuccess(res, 200, 'Quotes fetched', result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/quotes/stats ───────────────────────────────────────
const getQuoteStats = async (req, res) => {
  try {
    const stats = await quoteService.getQuoteStats(req.user._id);
    return sendSuccess(res, 200, 'Quote stats', { stats });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/quotes/:id ─────────────────────────────────────────
const getQuote = async (req, res) => {
  try {
    const quote = await quoteService.getQuoteById(req.user._id, req.params.id);
    if (!quote) return sendError(res, 404, 'Quote not found');
    return sendSuccess(res, 200, 'Quote fetched', { quote });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, 500, error.message);
  }
};

// ── PATCH /api/quotes/:id ───────────────────────────────────────
const updateQuote = async (req, res) => {
  try {
    const quote = await quoteService.updateQuote(req.user._id, req.params.id, req.body);
    if (!quote) return sendError(res, 404, 'Quote not found');
    return sendSuccess(res, 200, 'Quote updated', { quote });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ── POST /api/quotes/:id/pdf ────────────────────────────────────
// Generate PDF and upload to Cloudinary (or stream directly if Cloudinary not configured)
const generatePdf = async (req, res) => {
  try {
    const result = await quoteService.generateAndUploadPdf(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Quote not found');

    const { quote, pdfBuffer } = result;

    // If Cloudinary is configured → PDF is already uploaded, return URL
    if (quote.pdf?.url) {
      return sendSuccess(res, 200, 'PDF generated and uploaded', {
        quote,
        pdfUrl:      quote.pdf.url,
        generatedAt: quote.pdf.generatedAt,
      });
    }

    // Cloudinary not configured → stream PDF directly as download
    // This is a fallback for development without Cloudinary
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);

  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    console.error('PDF generation error:', error);
    return sendError(res, 500, `PDF generation failed: ${error.message}`);
  }
};

// ── GET /api/quotes/:id/pdf ─────────────────────────────────────
// Download the quote PDF (regenerates if not yet created)
const downloadPdf = async (req, res) => {
  try {
    const result = await quoteService.generateAndUploadPdf(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Quote not found');

    const { quote, pdfBuffer } = result;

    if (quote.pdf?.url) {
      // Redirect to Cloudinary URL — browser downloads it
      return res.redirect(302, quote.pdf.url);
    }

    // Stream directly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNumber}.pdf"`);
    return res.end(pdfBuffer);

  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, 500, `PDF download failed: ${error.message}`);
  }
};

// ── DELETE /api/quotes/:id ──────────────────────────────────────
const deleteQuote = async (req, res) => {
  try {
    const result = await quoteService.deleteQuote(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Quote not found');
    return sendSuccess(res, 200, 'Quote deleted');
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, 500, error.message);
  }
};

module.exports = {
  createQuote,
  getMyQuotes,
  getQuoteStats,
  getQuote,
  updateQuote,
  generatePdf,
  downloadPdf,
  deleteQuote,
};
