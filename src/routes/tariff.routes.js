const express = require('express');
const router  = express.Router();

const tariffController = require('../controllers/tariff.controller');
const { protect }      = require('../middleware/auth');
const validate         = require('../middleware/validate');
const validateQuery    = require('../middleware/validateQuery');
const {
  listTariffsSchema,
  compareSchema,
  calculateSchema,
} = require('../validators/tariff.validators');

// ── Public routes ──────────────────────────────────────────────

// GET  /api/tariffs              — list all tariffs (with filters)
router.get('/',           validateQuery(listTariffsSchema), tariffController.listTariffs);

// GET  /api/tariffs/suppliers    — list of UK suppliers
router.get('/suppliers',  tariffController.getSuppliers);

// GET  /api/tariffs/sync/status  — sync status + ofgem cap info
router.get('/sync/status', tariffController.getSyncStatus);

// POST /api/tariffs/calculate    — calculate cost on a specific tariff
router.post('/calculate', validate(calculateSchema), tariffController.calculateCost);

// ── Protected routes ───────────────────────────────────────────

// POST /api/tariffs/compare      — personalised comparison
router.post('/compare',   protect, validate(compareSchema), tariffController.compareTariffs);

// POST /api/tariffs/sync         — manual sync trigger (admin)
router.post('/sync',      protect, tariffController.syncTariffs);

// GET  /api/tariffs/:id          — single tariff detail
// MUST be last — prevents '/suppliers', '/sync' being caught as :id
router.get('/:id',        protect, tariffController.getTariffById);

module.exports = router;
