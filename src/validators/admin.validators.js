const { z } = require('zod');

// ── GET /api/admin/clients ────────────────────────────────────
const listClientsSchema = z.object({
  search:     z.string().trim().optional(),
  isActive:   z.enum(['true', 'false']).optional(),
  isVerified: z.enum(['true', 'false']).optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
  sortBy:     z.enum(['createdAt', 'lastName', 'email', 'lastLoginAt']).default('createdAt'),
  order:      z.enum(['asc', 'desc']).default('desc'),
});

// ── PATCH /api/admin/clients/:id ──────────────────────────────
const updateClientSchema = z.object({
  isActive:   z.boolean().optional(),
  isVerified: z.boolean().optional(),
  phone:      z.string().trim().optional().nullable(),
}).strict();

// ── GET /api/admin/quotes ─────────────────────────────────────
const listQuotesSchema = z.object({
  status:   z.enum(['pending', 'contacted', 'completed', 'cancelled']).optional(),
  clientId: z.string().trim().optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  sortBy:   z.enum(['createdAt', 'status']).default('createdAt'),
  order:    z.enum(['asc', 'desc']).default('desc'),
});

// ── PATCH /api/admin/quotes/:id ───────────────────────────────
const updateQuoteSchema = z.object({
  status:     z.enum(['contacted', 'completed', 'cancelled', 'pending']).optional(),
  adminNotes: z.string().trim().max(2000).optional().nullable(),
}).strict();

module.exports = {
  listClientsSchema,
  updateClientSchema,
  listQuotesSchema,
  updateQuoteSchema,
};