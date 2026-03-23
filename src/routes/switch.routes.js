const express = require('express');
const router  = express.Router();

const switchController = require('../controllers/switch.controller');
const { protect }      = require('../middleware/auth');
const validate         = require('../middleware/validate');
const validateQuery    = require('../middleware/validateQuery');
const {
  requestSwitchSchema,
  cancelSwitchSchema,
  clientMessageSchema,
  listSwitchesSchema,
} = require('../validators/switch.validators');

// All switch routes require auth
router.use(protect);

// ── Summary ────────────────────────────────────────────────────────
// GET /api/switches/summary
router.get('/summary', switchController.getSwitchSummary);

// ── List ───────────────────────────────────────────────────────────
// GET /api/switches
router.get('/', validateQuery(listSwitchesSchema), switchController.getMySwitches);

// ── Create (client-initiated switch request) ───────────────────────
// POST /api/switches
router.post('/', validate(requestSwitchSchema), switchController.requestSwitch);

// ── Single switch ──────────────────────────────────────────────────
// GET /api/switches/:id
router.get('/:id', switchController.getSwitch);

// ── Cancel ────────────────────────────────────────────────────────
// POST /api/switches/:id/cancel
router.post('/:id/cancel', validate(cancelSwitchSchema), switchController.cancelSwitch);

// ── Client message to broker ──────────────────────────────────────
// POST /api/switches/:id/message
router.post('/:id/message', validate(clientMessageSchema), switchController.addClientMessage);

module.exports = router;