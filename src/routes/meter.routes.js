const express = require('express');
const router  = express.Router();

const meterController = require('../controllers/meter.controller');
const { protect }     = require('../middleware/auth');
const validate        = require('../middleware/validate');
const validateQuery   = require('../middleware/validateQuery');
const {
  requestReadingSchema,
  listReadingsSchema,
} = require('../validators/meter.validators');

// All meter routes require auth
router.use(protect);

// GET  /api/meter-readings/summary  — counts by status + latest fulfilled
router.get('/summary', meterController.getMySummary);

// GET  /api/meter-readings          — list my requests
router.get('/', validateQuery(listReadingsSchema), meterController.getMyReadings);

// POST /api/meter-readings          — request usage data
router.post('/', validate(requestReadingSchema), meterController.requestReading);

// GET  /api/meter-readings/:id      — single request detail + raw readings
router.get('/:id', meterController.getReading);

// DELETE /api/meter-readings/:id    — delete pending request
router.delete('/:id', meterController.deleteReading);

module.exports = router;