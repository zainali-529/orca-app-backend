/**
 * Document Service — v5
 *
 * Key change: PDF is now uploaded to Cloudinary on signing.
 * This ensures the signed PDF is immediately available via a public URL.
 *
 * pdf.url and pdf.publicId fields are populated upon successful upload.
 */

const Document    = require('../models/Document');
const UserProfile = require('../models/UserProfile');
const User        = require('../models/User');
const { generateLoaPdf } = require('./loa.pdf.service');
const { appendSignatureToPdf } = require('./document.sign.service');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
const axios = require('axios');

// Cloudinary used for uploading signed PDFs
let cloudinary;
try { cloudinary = require('../config/cloudinary'); } catch { cloudinary = null; }

// ── Helper: build signer snapshot ─────────────────────────────────
const buildSignerSnapshot = (user, profile) => ({
  fullName:    `${user.firstName} ${user.lastName}`,
  email:       user.email,
  phone:       user.phone ?? profile?.businessPhone ?? null,
  companyName: profile?.companyName ?? null,
  address: {
    line1:    profile?.billingAddress?.line1    ?? null,
    city:     profile?.billingAddress?.city     ?? null,
    postcode: profile?.billingAddress?.postcode ?? null,
  },
  mpan:            profile?.energy?.mpan  ?? null,
  mprn:            profile?.energy?.mprn  ?? null,
  currentSupplier: profile?.energy?.currentElectricitySupplier
                ?? profile?.energy?.currentGasSupplier
                ?? null,
});

// ─────────────────────────────────────────────────────────────────
// CLIENT METHODS
// ─────────────────────────────────────────────────────────────────

const createLOA = async (clientId, data) => {
  const { quoteId, type = 'loa', supplier, fuelType, description } = data;

  const [user, profile] = await Promise.all([
    User.findById(clientId),
    UserProfile.findOne({ user: clientId }),
  ]);

  const document = await Document.create({
    client:        clientId,
    quote:         quoteId     ?? null,
    type,
    supplier:      supplier    ?? null,
    fuelType:      fuelType    ?? 'any',
    description:   description ?? null,
    signerDetails: buildSignerSnapshot(user, profile),
  });

  return document;
};

const signLOA = async (clientId, documentId, signatureData, req) => {
  const document = await Document.findOne({ _id: documentId, client: clientId });

  if (!document) {
    const e = new Error('Document not found'); e.statusCode = 404; throw e;
  }
  if (document.status === 'signed') {
    const e = new Error('This document has already been signed'); e.statusCode = 400; throw e;
  }
  if (document.isExpired) {
    const e = new Error('This document has expired and can no longer be signed'); e.statusCode = 400; throw e;
  }

  // Refresh signer snapshot at signing
  const [user, profile] = await Promise.all([
    User.findById(clientId),
    UserProfile.findOne({ user: clientId }),
  ]);

  document.signature = {
    data:      signatureData.signature,
    signedAt:  new Date(),
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
  };
  document.signerDetails = buildSignerSnapshot(user, profile);
  document.status        = 'signed';

  // 1. Generate/Append PDF buffer
  try {
    let pdfBuffer;
    
    if (document.pdf?.url) {
      // Case A: Admin uploaded PDF — Download it and append signature page
      console.log(`[DocumentService] Appending signature to existing PDF for ${documentId}`);
      const response = await axios.get(document.pdf.url, { responseType: 'arraybuffer' });
      const existingBuffer = Buffer.from(response.data);
      pdfBuffer = await appendSignatureToPdf(existingBuffer, document);
    } else {
      // Case B: Generated LOA
      console.log(`[DocumentService] Generating new LOA PDF for ${documentId}`);
      pdfBuffer = await generateLoaPdf(document, profile);
    }
    
    // 2. Upload to Cloudinary
    if (cloudinary && pdfBuffer) {
      const uploadResult = await cloudinary.uploadFile(pdfBuffer, document.docNumber);
      if (uploadResult) {
        document.pdf = {
          url:      uploadResult.url,
          publicId: uploadResult.publicId,
          generatedAt: new Date(),
        };
      }
    }
  } catch (pdfError) {
    console.error(`[DocumentService] PDF processing failed for ${documentId}:`, pdfError.message);
  }

  await document.save();

  notifyTrigger.onDocumentSigned(document);  // ← ADD THIS

  return document;
};

const getMyDocuments = async (clientId, query) => {
  const { type, status, supplier, fuelType, page = 1, limit = 20 } = query;
  const filter = { client: clientId };
  if (type)     filter.type     = type;
  if (status)   filter.status   = status;
  if (supplier) filter.supplier = new RegExp(supplier, 'i');
  if (fuelType) filter.fuelType = fuelType;

  const skip  = (page - 1) * limit;
  const total = await Document.countDocuments(filter);
  const documents = await Document
    .find(filter)
    .select('-signature.data -adminNotes')
    .sort({ createdAt: -1 })
    .skip(skip).limit(limit)
    .lean({ virtuals: true });

  return { documents, pagination: { total, page, limit,
    totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
};

const getDocumentById = async (clientId, documentId) =>
  Document.findOne({ _id: documentId, client: clientId })
    .select('-signature.data -adminNotes')
    .lean({ virtuals: true });

/**
 * downloadDocument — now just validates the document is signed.
 * Actual PDF generation happens in the controller (downloadDocument).
 * This service method kept for backward compat / validation.
 */
const validateDownload = async (clientId, documentId) => {
  const doc = await Document.findOne({ _id: documentId, client: clientId })
    .select('status docNumber');
  if (!doc) {
    const e = new Error('Document not found'); e.statusCode = 404; throw e;
  }
  if (doc.status !== 'signed') {
    const e = new Error('PDF is only available for signed documents.'); e.statusCode = 400; throw e;
  }
  return doc;
};

const deleteDocument = async (clientId, documentId) => {
  const doc = await Document.findOne({ _id: documentId, client: clientId });
  if (!doc) return null;

  if (doc.status === 'signed') {
    const e = new Error('Signed documents cannot be deleted — they are legal records');
    e.statusCode = 400; throw e;
  }

  // Clean up old Cloudinary PDF if it exists (legacy)
  if (doc.pdf?.publicId && cloudinary) {
    await cloudinary.deletePdf(doc.pdf.publicId).catch(() => {});
  }

  await Document.deleteOne({ _id: documentId });
  return true;
};

// ─────────────────────────────────────────────────────────────────
// ADMIN METHODS
// ─────────────────────────────────────────────────────────────────

const adminSendDocument = async (adminId, data) => {
  const { clientId, type = 'loa', supplier, fuelType, description, title, quoteId, adminNotes } = data;

  const [clientUser, clientProfile] = await Promise.all([
    User.findById(clientId),
    UserProfile.findOne({ user: clientId }),
  ]);

  if (!clientUser) {
    const e = new Error('Client not found'); e.statusCode = 404; throw e;
  }

  const doc = await Document.create({
    client:        clientId,
    assignedAdmin: adminId,
    quote:         quoteId    ?? null,
    type,
    supplier:      supplier   ?? null,
    fuelType:      fuelType   ?? 'any',
    description:   description ?? null,
    sentByAdmin:   true,
    adminNotes:    adminNotes ?? null,
    signerDetails: buildSignerSnapshot(clientUser, clientProfile),
    ...(title ? { title } : {}),
  });

  notifyTrigger.onDocumentSentToClient(doc);  // ← ADD THIS

  return doc;
};

/**
 * adminUploadDocument
 * Admin uploads a file (PDF/Image) directly for a client.
 * This document is marked as 'signed' if it's a completed contract/bill,
 * or 'pending_signature' if it's something the client needs to sign (like LOA/VAT).
 */
const adminUploadDocument = async (adminId, clientId, file, data) => {
  const { 
    type = 'other', 
    title, 
    description, 
    supplier, 
    fuelType, 
    adminNotes,
    status = 'signed' // Default to signed for admin uploads (e.g. bills/contracts)
  } = data;

  const [clientUser, clientProfile] = await Promise.all([
    User.findById(clientId),
    UserProfile.findOne({ user: clientId }),
  ]);

  if (!clientUser) {
    const e = new Error('Client not found'); e.statusCode = 404; throw e;
  }

  // 1. Create document record first to get docNumber
  const document = new Document({
    client:        clientId,
    assignedAdmin: adminId,
    type,
    title:         title || 'Uploaded Document',
    description,
    supplier,
    fuelType:      fuelType || 'any',
    adminNotes,
    sentByAdmin:   true,
    status,
    signerDetails: buildSignerSnapshot(clientUser, clientProfile),
  });

  // Trigger pre-save to get docNumber
  await document.validate();
  const year  = new Date().getFullYear();
  const count = await Document.countDocuments();
  const seq   = String(count + 1).padStart(6, '0');
  const prefix = document.type ? document.type.toUpperCase().slice(0, 3) : 'DOC';
  document.docNumber = `${prefix}-${year}-${seq}`;

  // 2. Upload file to Cloudinary
  if (cloudinary) {
    const uploadResult = await cloudinary.uploadFile(file.buffer, document.docNumber);
    if (uploadResult) {
      document.pdf = {
        url:      uploadResult.url,
        publicId: uploadResult.publicId,
        generatedAt: new Date(),
      };
    }
  }

  await document.save();
  return document;
};

const adminListDocuments = async (query) => {
  const {
    clientId, status, type, supplier, fuelType,
    sentByAdmin, assignedAdmin,
    page = 1, limit = 20,
    sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = {};
  if (clientId)      filter.client        = clientId;
  if (status)        filter.status        = status;
  if (type)          filter.type          = type;
  if (supplier)      filter.supplier      = new RegExp(supplier, 'i');
  if (fuelType)      filter.fuelType      = fuelType;
  if (assignedAdmin) filter.assignedAdmin = assignedAdmin;
  if (sentByAdmin !== undefined)
    filter.sentByAdmin = sentByAdmin === 'true' || sentByAdmin === true;

  const skip    = (page - 1) * limit;
  const sortDir = order === 'asc' ? 1 : -1;
  const total   = await Document.countDocuments(filter);

  const documents = await Document
    .find(filter)
    .select('+adminNotes -signature.data')
    .populate('client',        'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email')
    .populate('quote',         'quoteNumber status')
    .sort({ [sortBy]: sortDir })
    .skip(skip).limit(limit)
    .lean({ virtuals: true });

  return { documents, pagination: { total, page, limit,
    totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
};

const adminGetDocument = async (documentId) =>
  Document.findById(documentId)
    .select('+adminNotes -signature.data')
    .populate('client',        'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email')
    .populate('quote',         'quoteNumber status')
    .lean({ virtuals: true });

const adminUpdateDocument = async (documentId, updates) => {
  const doc = await Document.findById(documentId).select('+adminNotes');
  if (!doc) return null;

  if (updates.adminNotes  !== undefined) doc.adminNotes  = updates.adminNotes;
  if (updates.description !== undefined) doc.description = updates.description;
  if (updates.title       !== undefined) doc.title       = updates.title;
  if (updates.status === 'expired' && doc.status !== 'signed') doc.status = 'expired';

  await doc.save();
  return doc;
};

const adminGetDocumentStats = async () => {
  const [stats, sentCount, clientCount] = await Promise.all([
    Document.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Document.countDocuments({ sentByAdmin: true }),
    Document.countDocuments({ sentByAdmin: false }),
  ]);
  const result = { pending_signature: 0, signed: 0, expired: 0, total: 0 };
  for (const s of stats) { result[s._id] = s.count; result.total += s.count; }
  return { ...result, sentByAdmin: sentCount, clientInitiated: clientCount };
};

// Kept for backward compat — no-op since PDFs are on-demand now
const adminRegeneratePdf = async (documentId) => {
  const doc = await Document.findById(documentId);
  if (!doc) { const e = new Error('Document not found'); e.statusCode = 404; throw e; }
  if (doc.status !== 'signed') {
    const e = new Error('Can only regenerate PDF for signed documents'); e.statusCode = 400; throw e;
  }
  // Nothing to do — PDF generated on-demand via /download endpoint
  return doc;
};

module.exports = {
  createLOA, signLOA, getMyDocuments, getDocumentById, validateDownload, deleteDocument,
  adminSendDocument, adminUploadDocument, adminListDocuments, adminGetDocument,
  adminUpdateDocument, adminGetDocumentStats, adminRegeneratePdf,
};