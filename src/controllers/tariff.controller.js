const tariffService = require('../services/tariff.service');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET /api/tariffs ────────────────────────────────────────────
const listTariffs = async (req, res) => {
  try {
    const result = await tariffService.listTariffs(req.query);
    return sendSuccess(res, 200, 'Tariffs fetched', result);
  } catch (error) {
    console.error('listTariffs error:', error);
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/tariffs/suppliers ──────────────────────────────────
const getSuppliers = async (req, res) => {
  try {
    const suppliers = await tariffService.getSuppliers();
    return sendSuccess(res, 200, 'Suppliers fetched', { suppliers });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/tariffs/compare ───────────────────────────────────
// Authenticated — uses user's profile data if body is empty
const compareTariffs = async (req, res) => {
  try {
    const result = await tariffService.compareTariffs(req.body);
    return sendSuccess(res, 200, 'Comparison complete', result);
  } catch (error) {
    console.error('compareTariffs error:', error);
    return sendError(res, 500, error.message);
  }
};

// ── POST /api/tariffs/calculate ─────────────────────────────────
// Public — calculate cost on a specific tariff
const calculateCost = async (req, res) => {
  try {
    const result = await tariffService.calculateCost(req.body);
    if (!result) return sendError(res, 404, 'Tariff not found');
    return sendSuccess(res, 200, 'Cost calculated', result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/tariffs/:id ────────────────────────────────────────
const getTariffById = async (req, res) => {
  try {
    const tariff = await tariffService.getTariffById(req.params.id);
    if (!tariff) return sendError(res, 404, 'Tariff not found');
    return sendSuccess(res, 200, 'Tariff fetched', { tariff });
  } catch (error) {
    // Mongoose CastError — invalid ObjectId
    if (error.name === 'CastError') {
      return sendError(res, 400, 'Invalid tariff ID');
    }
    return sendError(res, 500, error.message);
  }
};

module.exports = {
  listTariffs,
  getSuppliers,
  compareTariffs,
  calculateCost,
  getTariffById,
};

// ── POST /api/tariffs/sync ──────────────────────────────────────
// Trigger manual tariff sync (admin only — protect with token in production)
const syncTariffs = async (req, res) => {
  try {
    const { source = 'all' } = req.body;
    const validSources = ['all', 'octopus', 'ofgem'];
    if (!validSources.includes(source)) {
      return sendError(res, 400, `Invalid source. Use: ${validSources.join(', ')}`);
    }

    // Run sync in background — respond immediately
    const tariffSync = require('../jobs/tariff.sync');
    if (tariffSync.isSyncing()) {
      return sendError(res, 409, 'A sync is already in progress');
    }

    res.status(202).json({
      success: true,
      message: `Tariff sync started (source: ${source}). Check server logs for progress.`,
    });

    // Run after response sent
    tariffSync.runSync({ source, adminId: req.user?._id })
      .then(result => console.log('[SyncTrigger] Completed:', JSON.stringify(result.summary)))
      .catch(err  => console.error('[SyncTrigger] Error:', err.message));

  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

// ── GET /api/tariffs/sync/status ────────────────────────────────
const getSyncStatus = async (req, res) => {
  try {
    const tariffSync = require('../jobs/tariff.sync');
    const { getCurrentCap } = require('../config/ofgem');

    const [total, live, capBased, lastUpdated] = await Promise.all([
      require('../models/Tariff').countDocuments({ isActive: true }),
      require('../models/Tariff').countDocuments({ isActive: true, source: 'octopus' }),
      require('../models/Tariff').countDocuments({ isActive: true, source: 'ofgem_cap' }),
      require('../models/Tariff').findOne({}, { lastUpdated: 1 }, { sort: { lastUpdated: -1 } }),
    ]);

    return sendSuccess(res, 200, 'Sync status', {
      isSyncing:     tariffSync.isSyncing(),
      lastSyncedAt:  lastUpdated?.lastUpdated ?? null,
      tariffCounts:  { total, live, capBased },
      currentOfgemCap: getCurrentCap(),
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

module.exports = {
  listTariffs,
  getSuppliers,
  compareTariffs,
  calculateCost,
  getTariffById,
  syncTariffs,
  getSyncStatus,
};
