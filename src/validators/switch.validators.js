const { z } = require('zod');

// ── Shared sub-schemas ────────────────────────────────────────────

const meterDetailsSchema = z.object({
  mpan:         z.string().trim().optional().nullable(),
  mprn:         z.string().trim().optional().nullable(),
  meterSerial:  z.string().trim().optional().nullable(),
  supplyAddress: z.object({
    line1:    z.string().trim().optional().nullable(),
    city:     z.string().trim().optional().nullable(),
    postcode: z.string().trim().optional().nullable(),
  }).optional(),
}).optional();

const contractDetailsSchema = z.object({
  tariffName:               z.string().trim().optional().nullable(),
  contractType:             z.enum(['fixed', 'variable', 'deemed']).optional().nullable(),
  contractLengthMonths:     z.number().int().positive().optional().nullable(),
  contractStartDate:        z.string().optional().nullable(), // ISO date string
  contractEndDate:          z.string().optional().nullable(),
  electricityUnitRate:      z.number().positive().optional().nullable(),
  electricityStandingCharge: z.number().positive().optional().nullable(),
  gasUnitRate:              z.number().positive().optional().nullable(),
  gasStandingCharge:        z.number().positive().optional().nullable(),
  estimatedAnnualSaving:    z.number().optional().nullable(), // can be 0 or negative
  exitFees:                 z.number().min(0).optional().nullable(),
}).optional();

// ── CLIENT: POST /api/switches ────────────────────────────────────
const requestSwitchSchema = z.object({
  fuelType:       z.enum(['electricity', 'gas', 'dual']),
  currentSupplier: z.string().trim().min(1, 'Current supplier is required'),
  newSupplier:    z.string().trim().min(1, 'New supplier is required'),
  quoteId:        z.string().trim().optional().nullable(),
  documentId:     z.string().trim().optional().nullable(),
  estimatedSwitchDate: z.string().optional().nullable(),
  clientMessage:  z.string().trim().max(1000).optional().nullable(),
});

// ── CLIENT: POST /api/switches/:id/cancel ─────────────────────────
const cancelSwitchSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
});

// ── CLIENT: POST /api/switches/:id/message ────────────────────────
const clientMessageSchema = z.object({
  message: z.string().trim().min(1).max(1000, 'Message too long'),
});

// ── CLIENT: GET /api/switches (filters) ───────────────────────────
const listSwitchesSchema = z.object({
  status:   z.enum([
    'requested', 'submitted_to_supplier', 'cooling_off', 'objected',
    'objection_resolved', 'in_progress', 'pending_completion',
    'completed', 'cancelled', 'failed',
  ]).optional(),
  fuelType: z.enum(['electricity', 'gas', 'dual']).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
});

// ── ADMIN: POST /api/admin/switches ───────────────────────────────
const adminCreateSwitchSchema = z.object({
  clientId:        z.string().trim().min(1, 'Client ID is required'),
  fuelType:        z.enum(['electricity', 'gas', 'dual']),
  currentSupplier: z.string().trim().min(1, 'Current supplier is required'),
  newSupplier:     z.string().trim().min(1, 'New supplier is required'),
  quoteId:         z.string().trim().optional().nullable(),
  documentId:      z.string().trim().optional().nullable(),
  tariffId:        z.string().trim().optional().nullable(),
  estimatedSwitchDate: z.string().optional().nullable(),
  adminNotes:      z.string().trim().max(3000).optional().nullable(),
  clientMessage:   z.string().trim().max(1000).optional().nullable(),
  meterDetails:    meterDetailsSchema,
  contractDetails: contractDetailsSchema,
});

// ── ADMIN: PATCH /api/admin/switches/:id/status ───────────────────
const adminUpdateStatusSchema = z.object({
  status: z.enum([
    'requested', 'submitted_to_supplier', 'cooling_off', 'objected',
    'objection_resolved', 'in_progress', 'pending_completion',
    'completed', 'cancelled', 'failed',
  ]),
  message:             z.string().trim().max(1000).optional().nullable(),
  visibleToClient:     z.boolean().optional().default(true),
  adminNotes:          z.string().trim().max(3000).optional().nullable(),
  estimatedSwitchDate: z.string().optional().nullable(),
  objectionReason:     z.string().trim().max(1000).optional().nullable(),
  cancellationReason:  z.string().trim().max(1000).optional().nullable(),
}).strict();

// ── ADMIN: PATCH /api/admin/switches/:id ──────────────────────────
const adminUpdateSwitchSchema = z.object({
  adminNotes:          z.string().trim().max(3000).optional().nullable(),
  estimatedSwitchDate: z.string().optional().nullable(),
  assignedAdmin:       z.string().trim().optional().nullable(),
  clientMessage:       z.string().trim().max(1000).optional().nullable(),
  quoteId:             z.string().trim().optional().nullable(),
  documentId:          z.string().trim().optional().nullable(),
  tariffId:            z.string().trim().optional().nullable(),
  meterDetails:        meterDetailsSchema,
  contractDetails:     contractDetailsSchema,
}).strict();

// ── ADMIN: POST /api/admin/switches/:id/timeline ─────────────────
const adminAddTimelineSchema = z.object({
  type: z.enum([
    'note_added', 'client_message', 'document_linked', 'quote_linked',
    'supplier_update', 'objection_raised', 'objection_resolved',
    'date_updated', 'contract_updated',
  ]),
  title:           z.string().trim().min(1).max(200),
  message:         z.string().trim().max(1000).optional().nullable(),
  visibleToClient: z.boolean().optional().default(true),
}).strict();

// ── ADMIN: GET /api/admin/switches (filters) ──────────────────────
const adminListSwitchesSchema = z.object({
  clientId:       z.string().trim().optional(),
  status:         z.enum([
    'requested', 'submitted_to_supplier', 'cooling_off', 'objected',
    'objection_resolved', 'in_progress', 'pending_completion',
    'completed', 'cancelled', 'failed',
  ]).optional(),
  fuelType:       z.enum(['electricity', 'gas', 'dual']).optional(),
  assignedAdmin:  z.string().trim().optional(),
  newSupplier:    z.string().trim().optional(),
  currentSupplier: z.string().trim().optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(20),
  sortBy:         z.enum(['createdAt', 'updatedAt', 'status', 'switchNumber']).default('createdAt'),
  order:          z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  // Client
  requestSwitchSchema,
  cancelSwitchSchema,
  clientMessageSchema,
  listSwitchesSchema,
  // Admin
  adminCreateSwitchSchema,
  adminUpdateStatusSchema,
  adminUpdateSwitchSchema,
  adminAddTimelineSchema,
  adminListSwitchesSchema,
};