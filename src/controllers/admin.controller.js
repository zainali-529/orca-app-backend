const adminService   = require('../services/admin.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── Dashboard ──────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return sendSuccess(res, 200, 'Dashboard stats', { stats });
  } catch (e) { return sendError(res, 500, e.message); }
};

// ── Clients ────────────────────────────────────────────────────
const listClients = async (req, res) => {
  try {
    const result = await adminService.listClients(req.query);
    return sendSuccess(res, 200, 'Clients fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const getClient = async (req, res) => {
  try {
    const result = await adminService.getClientById(req.params.id);
    if (!result) return sendError(res, 404, 'Client not found');
    return sendSuccess(res, 200, 'Client fetched', result);
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid client ID');
    return sendError(res, 500, e.message);
  }
};

const updateClient = async (req, res) => {
  try {
    const user = await adminService.updateClient(req.params.id, req.body);
    if (!user) return sendError(res, 404, 'Client not found');
    return sendSuccess(res, 200, 'Client updated', { user });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid client ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ── Quotes ─────────────────────────────────────────────────────
const listQuotes = async (req, res) => {
  try {
    const result = await adminService.listQuotes(req.query);
    return sendSuccess(res, 200, 'Quotes fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const getQuote = async (req, res) => {
  try {
    const quote = await adminService.getQuoteById(req.params.id);
    if (!quote) return sendError(res, 404, 'Quote not found');
    return sendSuccess(res, 200, 'Quote fetched', { quote });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, 500, e.message);
  }
};

const updateQuote = async (req, res) => {
  try {
    const quote = await adminService.updateQuote(req.params.id, req.body);
    if (!quote) return sendError(res, 404, 'Quote not found');
    return sendSuccess(res, 200, 'Quote updated', { quote });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid quote ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const getQuoteStats = async (req, res) => {
  try {
    const stats = await adminService.getQuoteStats();
    return sendSuccess(res, 200, 'Quote stats', { stats });
  } catch (e) { return sendError(res, 500, e.message); }
};

module.exports = {
  getDashboard,
  listClients, getClient, updateClient,
  listQuotes, getQuote, updateQuote, getQuoteStats,
};