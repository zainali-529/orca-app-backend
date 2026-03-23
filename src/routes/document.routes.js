const express = require('express');
const router  = express.Router();

const documentController = require('../controllers/document.controller');
const { protect }        = require('../middleware/auth');
const { isAdmin }        = require('../middleware/admin');
const validate           = require('../middleware/validate');
const validateQuery      = require('../middleware/validateQuery');
const upload            = require('../middleware/upload');
const {
  createLOASchema,
  signDocumentSchema,
  listDocumentsSchema,
  adminSendDocumentSchema,
  adminUpdateDocumentSchema,
  adminListDocumentsSchema,
} = require('../validators/document.validators');

// All document routes require auth
router.use(protect);

// ── CLIENT ROUTES ──────────────────────────────────────────────

router.get ('/', validateQuery(listDocumentsSchema), documentController.getMyDocuments);
router.post('/', validate(createLOASchema),           documentController.createDocument);
router.get ('/:id',          documentController.getDocument);
router.post('/:id/sign',     validate(signDocumentSchema), documentController.signDocument);
router.get ('/:id/download', documentController.downloadDocument);
router.delete('/:id',        documentController.deleteDocument);

// ── ADMIN ROUTES ───────────────────────────────────────────────
// Prefixed under /admin — registered separately in app.js
// These are exported as a sub-router used by admin.routes.js

module.exports = router;

// ── Admin sub-router (used by src/routes/admin.routes.js) ─────
const adminRouter = express.Router();
adminRouter.use(protect, isAdmin);

// GET  /api/admin/documents/stats
adminRouter.get('/stats', documentController.adminGetDocumentStats);

// GET  /api/admin/documents
adminRouter.get('/', validateQuery(adminListDocumentsSchema), documentController.adminListDocuments);

// POST /api/admin/documents/send → send doc to client
adminRouter.post('/send', validate(adminSendDocumentSchema), documentController.adminSendDocument);

// POST /api/admin/documents/upload/:clientId → upload file for client
adminRouter.post('/upload/:clientId', upload.single('file'), documentController.adminUploadDocument);

// GET    /api/admin/documents/:id
adminRouter.get('/:id', documentController.adminGetDocument);

// PATCH  /api/admin/documents/:id
adminRouter.patch('/:id', validate(adminUpdateDocumentSchema), documentController.adminUpdateDocument);

// POST   /api/admin/documents/:id/regenerate-pdf
adminRouter.post('/:id/regenerate-pdf', documentController.adminRegeneratePdf);

module.exports.adminRouter = adminRouter;