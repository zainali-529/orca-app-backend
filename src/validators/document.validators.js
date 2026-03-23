const { z } = require('zod');

const UK_SUPPLIERS = [
  'British Gas', 'Octopus Energy', 'EDF Energy', 'E.ON Next',
  'Scottish Power', 'Ovo Energy', 'Shell Energy', 'So Energy',
  'Utility Warehouse',
];

// ── POST /api/documents — client create LOA ───────────────────
const createLOASchema = z.object({
  type:        z.enum(['loa']).default('loa'),
  quoteId:     z.string().trim().optional().nullable(),
  supplier:    z.string().trim().optional().nullable(),  // specific supplier
  fuelType:    z.enum(['electricity', 'gas', 'dual', 'any']).optional().default('any'),
  description: z.string().trim().max(500).optional().nullable(),
});

// ── POST /api/documents/:id/sign ─────────────────────────────
const signDocumentSchema = z.object({
  signature: z
    .string({ required_error: 'Signature is required' })
    .min(100, 'Signature data is too short — must be a valid base64 image')
    .refine(
      (val) => val.startsWith('data:image/'),
      { message: 'Signature must be a base64 data URI starting with data:image/' }
    ),
});

// ── GET /api/documents — list filters ────────────────────────
const listDocumentsSchema = z.object({
  type:     z.enum(['loa', 'contract', 'other']).optional(),
  status:   z.enum(['pending_signature', 'signed', 'expired']).optional(),
  supplier: z.string().trim().optional(),
  fuelType: z.enum(['electricity', 'gas', 'dual', 'any']).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
});

// ── Admin: POST /api/admin/documents/send ─────────────────────
const adminSendDocumentSchema = z.object({
  clientId:    z.string().trim().min(1, 'Client ID is required'),
  type:        z.enum(['loa', 'contract', 'other']).default('loa'),
  title:       z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  supplier:    z.string().trim().optional().nullable(),
  fuelType:    z.enum(['electricity', 'gas', 'dual', 'any']).optional().default('any'),
  quoteId:     z.string().trim().optional().nullable(),
  adminNotes:  z.string().trim().max(2000).optional().nullable(),
});

// ── Admin: PATCH /api/admin/documents/:id ────────────────────
const adminUpdateDocumentSchema = z.object({
  adminNotes:  z.string().trim().max(2000).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  title:       z.string().trim().max(200).optional(),
  status:      z.enum(['expired']).optional(), // admin can only force-expire
}).strict();

// ── Admin: GET /api/admin/documents (list) ───────────────────
const adminListDocumentsSchema = z.object({
  clientId:      z.string().trim().optional(),
  status:        z.enum(['pending_signature', 'signed', 'expired']).optional(),
  type:          z.enum(['loa', 'contract', 'other']).optional(),
  supplier:      z.string().trim().optional(),
  fuelType:      z.enum(['electricity', 'gas', 'dual', 'any']).optional(),
  sentByAdmin:   z.enum(['true', 'false']).optional(),
  assignedAdmin: z.string().trim().optional(),
  page:          z.coerce.number().int().min(1).default(1),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
  sortBy:        z.enum(['createdAt', 'updatedAt', 'status', 'docNumber']).default('createdAt'),
  order:         z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  createLOASchema,
  signDocumentSchema,
  listDocumentsSchema,
  adminSendDocumentSchema,
  adminUpdateDocumentSchema,
  adminListDocumentsSchema,
};