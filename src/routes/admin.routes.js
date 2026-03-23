const express = require('express');
const router  = express.Router();

const adminController    = require('../controllers/admin.controller');
const documentController = require('../controllers/document.controller');
const switchController   = require('../controllers/switch.controller');
const consultationController = require('../controllers/consultation.controller');
const { protect }        = require('../middleware/auth');
const { isAdmin }        = require('../middleware/admin');
const validate           = require('../middleware/validate');
const validateQuery      = require('../middleware/validateQuery');
const upload            = require('../middleware/upload');
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
const { adminListConsultationsSchema, adminConfirmSchema, adminCompleteSchema, adminNoShowSchema, adminRefundSchema } = require('../validators/consultation.validators');

// All admin routes require auth + admin role
router.use(protect, isAdmin);

// ── Dashboard ──────────────────────────────────────────────────────
// GET /api/admin/dashboard
router.get('/dashboard', adminController.getDashboard);

// ── Clients ────────────────────────────────────────────────────────
// GET    /api/admin/clients
router.get   ('/clients',     validateQuery(listClientsSchema),  adminController.listClients);
// GET    /api/admin/clients/:id
router.get   ('/clients/:id',                                    adminController.getClient);
// PATCH  /api/admin/clients/:id
router.patch ('/clients/:id', validate(updateClientSchema),      adminController.updateClient);

// ── Quotes ─────────────────────────────────────────────────────────
// GET  /api/admin/quotes/stats
router.get   ('/quotes/stats',                                    adminController.getQuoteStats);
// GET  /api/admin/quotes
router.get   ('/quotes',       validateQuery(listQuotesSchema),   adminController.listQuotes);
// GET  /api/admin/quotes/:id
router.get   ('/quotes/:id',                                      adminController.getQuote);
// PATCH /api/admin/quotes/:id
router.patch ('/quotes/:id',   validate(updateQuoteSchema),       adminController.updateQuote);

// ── Documents ──────────────────────────────────────────────────────
// GET  /api/admin/documents/stats
router.get  ('/documents/stats',                                          documentController.adminGetDocumentStats);
// GET  /api/admin/documents
router.get  ('/documents',       validateQuery(adminListDocumentsSchema),  documentController.adminListDocuments);
// POST /api/admin/documents/send
router.post ('/documents/send',  validate(adminSendDocumentSchema),        documentController.adminSendDocument);
// POST /api/admin/documents/upload/:clientId
router.post ('/documents/upload/:clientId', upload.single('file'),        documentController.adminUploadDocument);
// GET  /api/admin/documents/:id
router.get  ('/documents/:id',                                            documentController.adminGetDocument);
// PATCH /api/admin/documents/:id
router.patch('/documents/:id',   validate(adminUpdateDocumentSchema),      documentController.adminUpdateDocument);
// POST /api/admin/documents/:id/regenerate-pdf
router.post ('/documents/:id/regenerate-pdf',                             documentController.adminRegeneratePdf);

// ── Switches ───────────────────────────────────────────────────────

// GET  /api/admin/switches/stats          — aggregate counts
router.get('/switches/stats', switchController.adminGetStats);

// GET  /api/admin/switches                — list all (filterable)
router.get('/switches',
  validateQuery(adminListSwitchesSchema),
  switchController.adminListSwitches
);

// POST /api/admin/switches                — initiate a switch for a client
router.post('/switches',
  validate(adminCreateSwitchSchema),
  switchController.adminCreateSwitch
);

// GET  /api/admin/switches/:id            — full switch + complete timeline + adminNotes
router.get('/switches/:id', switchController.adminGetSwitch);

// PATCH /api/admin/switches/:id/status   — update status (with transition validation)
router.patch('/switches/:id/status',
  validate(adminUpdateStatusSchema),
  switchController.adminUpdateStatus
);

// PATCH /api/admin/switches/:id          — update details (notes, contract, meter, etc.)
router.patch('/switches/:id',
  validate(adminUpdateSwitchSchema),
  switchController.adminUpdateSwitch
);

// POST /api/admin/switches/:id/timeline  — add a manual timeline event
router.post('/switches/:id/timeline',
  validate(adminAddTimelineSchema),
  switchController.adminAddTimelineEvent
);

// ── Consultations ──────────────────────────────────────────────────
 
// GET  /api/admin/consultations/stats
router.get('/consultations/stats', consultationController.adminGetStats);
 
// GET  /api/admin/consultations
router.get('/consultations',
  validateQuery(adminListConsultationsSchema),
  consultationController.adminListConsultations
);
 
// GET  /api/admin/consultations/:id
router.get('/consultations/:id', consultationController.adminGetConsultation);
 
// POST /api/admin/consultations/:id/confirm  — confirm + optionally schedule
router.post('/consultations/:id/confirm',
  validate(adminConfirmSchema),
  consultationController.adminConfirm
);
 
// POST /api/admin/consultations/:id/complete — mark complete + add outcome
router.post('/consultations/:id/complete',
  validate(adminCompleteSchema),
  consultationController.adminComplete
);
 
// POST /api/admin/consultations/:id/no-show — mark client no-show
router.post('/consultations/:id/no-show',
  validate(adminNoShowSchema),
  consultationController.adminNoShow
);
 
// POST /api/admin/consultations/:id/refund — issue full or partial refund
router.post('/consultations/:id/refund',
  validate(adminRefundSchema),
  consultationController.adminRefund
);
 
module.exports = router;