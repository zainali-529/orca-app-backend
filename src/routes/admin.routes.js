const express = require('express');
const router  = express.Router();

const adminController        = require('../controllers/admin.controller');
const documentController     = require('../controllers/document.controller');
const switchController       = require('../controllers/switch.controller');
const dashboardController    = require('../controllers/dashboard.controller');   // ← NEW
const consultationController = require('../controllers/consultation.controller');
const meterController        = require('../controllers/meter.controller');
const { protect }            = require('../middleware/auth');
const { isAdmin }            = require('../middleware/admin');
const validate               = require('../middleware/validate');
const validateQuery          = require('../middleware/validateQuery');
const upload                 = require('../middleware/upload');
const {
  listClientsSchema, updateClientSchema,
  listQuotesSchema,  updateQuoteSchema,
} = require('../validators/admin.validators');
const {
  adminSendDocumentSchema,
  adminUpdateDocumentSchema,
  adminListDocumentsSchema,
} = require('../validators/document.validators');
const {
  adminCreateSwitchSchema,
  adminUpdateStatusSchema,
  adminUpdateSwitchSchema,
  adminAddTimelineSchema,
  adminListSwitchesSchema,
} = require('../validators/switch.validators');
const {
  adminListConsultationsSchema,
  adminConfirmSchema,
  adminCompleteSchema,
  adminNoShowSchema,
  adminRefundSchema,
} = require('../validators/consultation.validators');
const {
  adminProcessSchema,
  adminFulfillSchema,
  adminFailSchema,
  adminListReadingsSchema,
} = require('../validators/meter.validators');

// All admin routes require auth + admin role
router.use(protect, isAdmin);

// ── Dashboard ──────────────────────────────────────────────────────
// Updated to use dedicated dashboardController (replaces adminController.getDashboard)
router.get('/dashboard', dashboardController.getAdminDashboard);

// ── Clients ────────────────────────────────────────────────────────
router.get   ('/clients',     validateQuery(listClientsSchema),  adminController.listClients);
router.get   ('/clients/:id',                                    adminController.getClient);
router.patch ('/clients/:id', validate(updateClientSchema),      adminController.updateClient);

// ── Quotes ─────────────────────────────────────────────────────────
router.get   ('/quotes/stats',                                    adminController.getQuoteStats);
router.get   ('/quotes',       validateQuery(listQuotesSchema),   adminController.listQuotes);
router.get   ('/quotes/:id',                                      adminController.getQuote);
router.patch ('/quotes/:id',   validate(updateQuoteSchema),       adminController.updateQuote);

// ── Documents ──────────────────────────────────────────────────────
router.get  ('/documents/stats',                                          documentController.adminGetDocumentStats);
router.get  ('/documents',       validateQuery(adminListDocumentsSchema),  documentController.adminListDocuments);
router.post ('/documents/send',  validate(adminSendDocumentSchema),        documentController.adminSendDocument);
router.post ('/documents/upload/:clientId', upload.single('file'),        documentController.adminUploadDocument);
router.get  ('/documents/:id',                                            documentController.adminGetDocument);
router.patch('/documents/:id',   validate(adminUpdateDocumentSchema),      documentController.adminUpdateDocument);
router.post ('/documents/:id/regenerate-pdf',                             documentController.adminRegeneratePdf);

// ── Switches ───────────────────────────────────────────────────────
router.get('/switches/stats', switchController.adminGetStats);
router.get('/switches',
  validateQuery(adminListSwitchesSchema),
  switchController.adminListSwitches
);
router.post('/switches',
  validate(adminCreateSwitchSchema),
  switchController.adminCreateSwitch
);
router.get('/switches/:id', switchController.adminGetSwitch);
router.patch('/switches/:id/status',
  validate(adminUpdateStatusSchema),
  switchController.adminUpdateStatus
);
router.patch('/switches/:id',
  validate(adminUpdateSwitchSchema),
  switchController.adminUpdateSwitch
);
router.post('/switches/:id/timeline',
  validate(adminAddTimelineSchema),
  switchController.adminAddTimelineEvent
);

// ── Consultations ──────────────────────────────────────────────────
router.get('/consultations/stats', consultationController.adminGetStats);
router.get('/consultations',
  validateQuery(adminListConsultationsSchema),
  consultationController.adminListConsultations
);
router.get('/consultations/:id', consultationController.adminGetConsultation);
router.post('/consultations/:id/confirm',
  validate(adminConfirmSchema),
  consultationController.adminConfirm
);
router.post('/consultations/:id/complete',
  validate(adminCompleteSchema),
  consultationController.adminComplete
);
router.post('/consultations/:id/no-show',
  validate(adminNoShowSchema),
  consultationController.adminNoShow
);
router.post('/consultations/:id/refund',
  validate(adminRefundSchema),
  consultationController.adminRefund
);

// ── Meter Readings ─────────────────────────────────────────────────

// GET  /api/admin/meter-readings/stats   — aggregate counts + weekly fulfilled
router.get('/meter-readings/stats', meterController.adminGetStats);

// GET  /api/admin/meter-readings         — list all requests (filterable)
router.get('/meter-readings',
  validateQuery(adminListReadingsSchema),
  meterController.adminListReadings
);

// GET  /api/admin/meter-readings/:id     — full detail + raw readings + adminNotes
router.get('/meter-readings/:id', meterController.adminGetReading);

// POST /api/admin/meter-readings/:id/process  — mark as processing (I'm on it)
router.post('/meter-readings/:id/process',
  validate(adminProcessSchema),
  meterController.adminMarkProcessing
);

// POST /api/admin/meter-readings/:id/fulfill  — submit consumption data to client
router.post('/meter-readings/:id/fulfill',
  validate(adminFulfillSchema),
  meterController.adminFulfillReading
);

// POST /api/admin/meter-readings/:id/fail     — mark failed (data unavailable)
router.post('/meter-readings/:id/fail',
  validate(adminFailSchema),
  meterController.adminFailReading
);

module.exports = router;