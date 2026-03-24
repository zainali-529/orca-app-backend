const meterService = require('../services/meter.service');
const { sendSuccess, sendError } = require('../utils/response');

// ─── CLIENT CONTROLLERS ───────────────────────────────────────────

const getMySummary = async (req, res) => {
  try {
    const summary = await meterService.getMySummary(req.user._id);
    return sendSuccess(res, 200, 'Meter reading summary', { summary });
  } catch (e) { return sendError(res, 500, e.message); }
};

const getMyReadings = async (req, res) => {
  try {
    const result = await meterService.getMyReadings(req.user._id, req.query);
    return sendSuccess(res, 200, 'Meter readings fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const getReading = async (req, res) => {
  try {
    const reading = await meterService.getReadingById(req.user._id, req.params.id);
    if (!reading) return sendError(res, 404, 'Meter reading not found');
    return sendSuccess(res, 200, 'Meter reading fetched', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, 500, e.message);
  }
};

const requestReading = async (req, res) => {
  try {
    const reading = await meterService.requestReading(req.user._id, req.body);
    return sendSuccess(res, 201, 'Meter reading request submitted. We will process it shortly.', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const deleteReading = async (req, res) => {
  try {
    const result = await meterService.deleteReading(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Meter reading not found');
    return sendSuccess(res, 200, 'Meter reading request deleted');
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ─── ADMIN CONTROLLERS ────────────────────────────────────────────

const adminGetStats = async (req, res) => {
  try {
    const stats = await meterService.adminGetStats();
    return sendSuccess(res, 200, 'Meter reading stats', { stats });
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminListReadings = async (req, res) => {
  try {
    const result = await meterService.adminListReadings(req.query);
    return sendSuccess(res, 200, 'Meter readings fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminGetReading = async (req, res) => {
  try {
    const reading = await meterService.adminGetReading(req.params.id);
    if (!reading) return sendError(res, 404, 'Meter reading not found');
    return sendSuccess(res, 200, 'Meter reading fetched', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, 500, e.message);
  }
};

const adminMarkProcessing = async (req, res) => {
  try {
    const reading = await meterService.adminMarkProcessing(
      req.user._id, req.params.id, req.body.adminNotes
    );
    return sendSuccess(res, 200, 'Request marked as processing', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminFulfillReading = async (req, res) => {
  try {
    const reading = await meterService.adminFulfillReading(
      req.user._id, req.params.id, req.body
    );
    return sendSuccess(res, 200, 'Meter reading fulfilled successfully', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminFailReading = async (req, res) => {
  try {
    const reading = await meterService.adminFailReading(
      req.user._id, req.params.id, req.body.reason
    );
    return sendSuccess(res, 200, 'Request marked as failed', { reading });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid reading ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

module.exports = {
  // Client
  getMySummary, getMyReadings, getReading, requestReading, deleteReading,
  // Admin
  adminGetStats, adminListReadings, adminGetReading,
  adminMarkProcessing, adminFulfillReading, adminFailReading,
};