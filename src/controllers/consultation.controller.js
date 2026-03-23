const consultationService = require('../services/consultation.service');
const { sendSuccess, sendError } = require('../utils/response');

// ─── CLIENT CONTROLLERS ───────────────────────────────────────────

const getOptions = async (req, res) => {
  try {
    const options = consultationService.getOptions();
    return sendSuccess(res, 200, 'Consultation options', { options });
  } catch (e) { return sendError(res, 500, e.message); }
};

const getMySummary = async (req, res) => {
  try {
    const summary = await consultationService.getMySummary(req.user._id);
    return sendSuccess(res, 200, 'Consultation summary', { summary });
  } catch (e) { return sendError(res, 500, e.message); }
};

const getMyConsultations = async (req, res) => {
  try {
    const result = await consultationService.getMyConsultations(req.user._id, req.query);
    return sendSuccess(res, 200, 'Consultations fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const getConsultation = async (req, res) => {
  try {
    const c = await consultationService.getConsultationById(req.user._id, req.params.id);
    if (!c) return sendError(res, 404, 'Consultation not found');
    return sendSuccess(res, 200, 'Consultation fetched', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, 500, e.message);
  }
};

const requestConsultation = async (req, res) => {
  try {
    const result = await consultationService.requestConsultation(req.user._id, req.body);
    return sendSuccess(res, 201, 'Consultation requested', result);
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const cancelConsultation = async (req, res) => {
  try {
    const c = await consultationService.cancelConsultation(
      req.user._id, req.params.id, req.body.reason
    );
    return sendSuccess(res, 200, 'Consultation cancelled', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const retryPayment = async (req, res) => {
  try {
    const result = await consultationService.retryPayment(req.user._id, req.params.id);
    return sendSuccess(res, 200, 'New payment session created', result);
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const submitRating = async (req, res) => {
  try {
    const c = await consultationService.submitRating(
      req.user._id, req.params.id, req.body
    );
    return sendSuccess(res, 200, 'Rating submitted', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ─── ADMIN CONTROLLERS ────────────────────────────────────────────

const adminGetStats = async (req, res) => {
  try {
    const stats = await consultationService.adminGetStats();
    return sendSuccess(res, 200, 'Consultation stats', { stats });
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminListConsultations = async (req, res) => {
  try {
    const result = await consultationService.adminListConsultations(req.query);
    return sendSuccess(res, 200, 'Consultations fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminGetConsultation = async (req, res) => {
  try {
    const c = await consultationService.adminGetConsultation(req.params.id);
    if (!c) return sendError(res, 404, 'Consultation not found');
    return sendSuccess(res, 200, 'Consultation fetched', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, 500, e.message);
  }
};

const adminConfirm = async (req, res) => {
  try {
    const c = await consultationService.adminConfirm(req.user._id, req.params.id, req.body);
    return sendSuccess(res, 200, 'Consultation confirmed', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminComplete = async (req, res) => {
  try {
    const c = await consultationService.adminComplete(req.user._id, req.params.id, req.body);
    return sendSuccess(res, 200, 'Consultation completed', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminNoShow = async (req, res) => {
  try {
    const c = await consultationService.adminNoShow(
      req.user._id, req.params.id, req.body.brokerNotes
    );
    return sendSuccess(res, 200, 'Marked as no-show', { consultation: c });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminRefund = async (req, res) => {
  try {
    const result = await consultationService.adminRefund(req.user._id, req.params.id, req.body);
    return sendSuccess(res, 200, 'Refund issued', {
      consultation: result.consultation,
      refund: { id: result.refund.id, amount: result.refund.amount },
    });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid consultation ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

module.exports = {
  // Client
  getOptions, getMySummary, getMyConsultations,
  getConsultation, requestConsultation, cancelConsultation,
  retryPayment, submitRating,
  // Admin
  adminGetStats, adminListConsultations, adminGetConsultation,
  adminConfirm, adminComplete, adminNoShow, adminRefund,
};