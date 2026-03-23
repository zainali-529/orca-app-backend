const switchService = require('../services/switch.service');
const { sendSuccess, sendError } = require('../utils/response');

// ─── CLIENT CONTROLLERS ───────────────────────────────────────────

const getSwitchSummary = async (req, res) => {
  try {
    const summary = await switchService.getSwitchSummary(req.user._id);
    return sendSuccess(res, 200, 'Switch summary', { summary });
  } catch (e) { return sendError(res, 500, e.message); }
};

const getMySwitches = async (req, res) => {
  try {
    const result = await switchService.getMySwitches(req.user._id, req.query);
    return sendSuccess(res, 200, 'Switches fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const getSwitch = async (req, res) => {
  try {
    const sw = await switchService.getSwitchById(req.user._id, req.params.id);
    if (!sw) return sendError(res, 404, 'Switch not found');
    return sendSuccess(res, 200, 'Switch fetched', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, 500, e.message);
  }
};

const requestSwitch = async (req, res) => {
  try {
    const sw = await switchService.requestSwitch(req.user._id, req.body);
    return sendSuccess(res, 201, 'Switch request submitted', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const cancelSwitch = async (req, res) => {
  try {
    const sw = await switchService.cancelSwitch(req.user._id, req.params.id, req.body.reason);
    return sendSuccess(res, 200, 'Switch cancelled', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const addClientMessage = async (req, res) => {
  try {
    const sw = await switchService.addClientMessage(req.user._id, req.params.id, req.body.message);
    return sendSuccess(res, 200, 'Message sent to broker', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

// ─── ADMIN CONTROLLERS ────────────────────────────────────────────

const adminGetStats = async (req, res) => {
  try {
    const stats = await switchService.adminGetStats();
    return sendSuccess(res, 200, 'Switch stats', { stats });
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminListSwitches = async (req, res) => {
  try {
    const result = await switchService.adminListSwitches(req.query);
    return sendSuccess(res, 200, 'Switches fetched', result);
  } catch (e) { return sendError(res, 500, e.message); }
};

const adminCreateSwitch = async (req, res) => {
  try {
    const sw = await switchService.adminCreateSwitch(req.user._id, req.body);
    return sendSuccess(res, 201, 'Switch initiated', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminGetSwitch = async (req, res) => {
  try {
    const sw = await switchService.adminGetSwitch(req.params.id);
    if (!sw) return sendError(res, 404, 'Switch not found');
    return sendSuccess(res, 200, 'Switch fetched', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, 500, e.message);
  }
};

const adminUpdateStatus = async (req, res) => {
  try {
    const sw = await switchService.adminUpdateStatus(
      req.user._id, req.params.id, req.body.status, req.body
    );
    return sendSuccess(res, 200, 'Status updated', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminUpdateSwitch = async (req, res) => {
  try {
    const sw = await switchService.adminUpdateSwitch(req.user._id, req.params.id, req.body);
    if (!sw) return sendError(res, 404, 'Switch not found');
    return sendSuccess(res, 200, 'Switch updated', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

const adminAddTimelineEvent = async (req, res) => {
  try {
    const sw = await switchService.adminAddTimelineEvent(req.user._id, req.params.id, req.body);
    return sendSuccess(res, 200, 'Timeline event added', { switch: sw });
  } catch (e) {
    if (e.name === 'CastError') return sendError(res, 400, 'Invalid switch ID');
    return sendError(res, e.statusCode || 500, e.message);
  }
};

module.exports = {
  // Client
  getSwitchSummary, getMySwitches, getSwitch,
  requestSwitch, cancelSwitch, addClientMessage,
  // Admin
  adminGetStats, adminListSwitches, adminCreateSwitch,
  adminGetSwitch, adminUpdateStatus, adminUpdateSwitch, adminAddTimelineEvent,
};