const { z } = require('zod');

// ── Client schema (inline — before CRM module in Week 3) ───────
const clientSchema = z.object({
  name:    z.string().trim().min(1, 'Client name is required'),
  company: z.string().trim().optional().nullable(),
  email:   z.string().trim().email('Invalid email').optional().nullable(),
  phone:   z.string().trim().optional().nullable(),
  address: z.object({
    line1:    z.string().trim().optional().nullable(),
    line2:    z.string().trim().optional().nullable(),
    city:     z.string().trim().optional().nullable(),
    postcode: z.string().trim().optional().nullable(),
  }).optional(),
  mpan: z.string().trim().optional().nullable(),
  mprn: z.string().trim().optional().nullable(),
});

// ── POST /api/quotes — create quote ───────────────────────────
const createQuoteSchema = z.object({
  // Client
  client: clientSchema,

  // Tariff
  tariffId: z.string().trim().min(1, 'Tariff ID is required'),

  // Usage
  annualElectricityKwh: z
    .number({ invalid_type_error: 'Must be a number' })
    .positive()
    .optional()
    .nullable(),
  annualGasKwh: z
    .number()
    .positive()
    .optional()
    .nullable(),

  // Current supplier cost (for savings calculation)
  currentSupplierAnnualCost: z
    .number()
    .positive()
    .optional()
    .nullable(),

  // Quote metadata
  notes:     z.string().trim().max(2000).optional().nullable(),
  validDays: z.coerce.number().int().min(1).max(365).default(30),
});

// ── PATCH /api/quotes/:id — update quote ──────────────────────
const updateQuoteSchema = z.object({
  client: z.object({
    name:    z.string().trim().min(1).optional(),
    company: z.string().trim().optional().nullable(),
    email:   z.string().trim().email().optional().nullable(),
    phone:   z.string().trim().optional().nullable(),
    mpan:    z.string().trim().optional().nullable(),
    mprn:    z.string().trim().optional().nullable(),
  }).optional(),

  notes:     z.string().trim().max(2000).optional().nullable(),
  validDays: z.coerce.number().int().min(1).max(365).optional(),

  status: z.enum(['sent', 'accepted', 'rejected', 'expired']).optional(),
}).strict(); // no extra fields

// ── GET /api/quotes — list filters ────────────────────────────
const listQuotesSchema = z.object({
  status:  z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(50).default(20),
  sortBy:  z.enum(['createdAt', 'updatedAt', 'status', 'quoteNumber']).default('createdAt'),
  order:   z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  createQuoteSchema,
  updateQuoteSchema,
  listQuotesSchema,
};
