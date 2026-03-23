const documentService = require('../services/document.service');
const { sendSuccess, sendError } = require('../utils/response');

// ─── CLIENT CONTROLLERS ───────────────────────────────────────

const createDocument = async (req, res) => {
  try {
    const document = await documentService.createLOA(req.user._id, req.body);
    return sendSuccess(res, 201, 'LOA created. Please review and sign.', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const getMyDocuments = async (req, res) => {
  try {
    const result = await documentService.getMyDocuments(req.user._id, req.query);
    return sendSuccess(res, 200, 'Documents fetched', result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

const getDocument = async (req, res) => {
  try {
    const document = await documentService.getDocumentById(req.user._id, req.params.id);
    if (!document) return sendError(res, 404, 'Document not found');
    return sendSuccess(res, 200, 'Document fetched', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, 500, error.message);
  }
};

const signDocument = async (req, res) => {
  try {
    const document = await documentService.signLOA(req.user._id, req.params.id, req.body, req);
    return sendSuccess(res, 200, 'Document signed successfully', {
      document,
      pdfAvailable: !!document.pdf?.url,
      pdfUrl:       document.pdf?.url ?? null,
    });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const downloadDocument = async (req, res) => {
  try {
    const pdfUrl = await documentService.downloadDocument(req.user._id, req.params.id);
    return res.redirect(302, pdfUrl);
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const deleteDocument = async (req, res) => {
  try {
    const result = await documentService.deleteDocument(req.user._id, req.params.id);
    if (!result) return sendError(res, 404, 'Document not found');
    return sendSuccess(res, 200, 'Document deleted');
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

// ─── ADMIN CONTROLLERS ────────────────────────────────────────

const adminSendDocument = async (req, res) => {
  try {
    const document = await documentService.adminSendDocument(req.user._id, req.body);
    return sendSuccess(res, 201, 'Document sent to client', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const adminUploadDocument = async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!req.file) return sendError(res, 400, 'Please upload a file');

    const document = await documentService.adminUploadDocument(
      req.user._id,
      clientId,
      req.file,
      req.body
    );

    return sendSuccess(res, 201, 'File uploaded and document created', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid client ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const adminListDocuments = async (req, res) => {
  try {
    const result = await documentService.adminListDocuments(req.query);
    return sendSuccess(res, 200, 'Documents fetched', result);
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

const adminGetDocument = async (req, res) => {
  try {
    const document = await documentService.adminGetDocument(req.params.id);
    if (!document) return sendError(res, 404, 'Document not found');
    return sendSuccess(res, 200, 'Document fetched', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, 500, error.message);
  }
};

const adminUpdateDocument = async (req, res) => {
  try {
    const document = await documentService.adminUpdateDocument(req.params.id, req.body);
    if (!document) return sendError(res, 404, 'Document not found');
    return sendSuccess(res, 200, 'Document updated', { document });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

const adminGetDocumentStats = async (req, res) => {
  try {
    const stats = await documentService.adminGetDocumentStats();
    return sendSuccess(res, 200, 'Document stats', { stats });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
};

const adminRegeneratePdf = async (req, res) => {
  try {
    const document = await documentService.adminRegeneratePdf(req.params.id);
    return sendSuccess(res, 200, 'PDF regenerated', {
      document, pdfUrl: document.pdf?.url,
    });
  } catch (error) {
    if (error.name === 'CastError') return sendError(res, 400, 'Invalid document ID');
    return sendError(res, error.statusCode || 500, error.message);
  }
};

module.exports = {
  // Client
  createDocument, getMyDocuments, getDocument,
  signDocument, downloadDocument, deleteDocument,
  // Admin
  adminSendDocument, adminUploadDocument, adminListDocuments, adminGetDocument,
  adminUpdateDocument, adminGetDocumentStats, adminRegeneratePdf,
};