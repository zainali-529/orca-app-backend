const { z } = require('zod');

/**
 * Quote Request Validators
 * Client submits a quote request — most data auto-filled from profile
 */

// ── POST /api/quotes ── Create quote request ──────────────────
const createQuoteSchema = z.object({

  // Tariff they saw (optional — can be general enquiry)
  tariffId: z.string().trim().optional().nullable(),

  // Usage — pre-filled from profile, client can override
  annualElectricityKwh: z.number().positive().optional().nullable(),
  annualGasKwh:         z.number().positive().optional().nullable(),

  // Current costs (for savings estimate)
  currentSupplierAnnualCost: z.number().positive().optional().nullable(),

  // Preferences
  preferences: z.object({
    fuelType:       z.enum(['electricity', 'gas', 'dual']).optional().nullable(),
    preferGreen:    z.boolean().optional(),
    preferFixed:    z.boolean().optional(),
    contractLength: z.enum(['no_preference', 'short', 'long']).optional(),
  }).optional(),

  // Contact — pre-filled from profile, can override for this request
  contactDetails: z.object({
    name:                    z.string().trim().min(1, 'Name is required').optional(),
    email:                   z.string().trim().email().optional().nullable(),
    phone:                   z.string().trim().optional().nullable(),
    preferredContactMethod:  z.enum(['email', 'phone', 'whatsapp']).optional(),
    bestTimeToContact:       z.string().trim().max(100).optional().nullable(),
  }).optional(),

  // Any message from client
  message: z.string().trim().max(1000).optional().nullable(),
});

// ── PATCH /api/quotes/:id ── Client can only cancel or update message ──
const updateQuoteSchema = z.object({
  message: z.string().trim().max(1000).optional().nullable(),

  contactDetails: z.object({
    phone:                  z.string().trim().optional().nullable(),
    preferredContactMethod: z.enum(['email', 'phone', 'whatsapp']).optional(),
    bestTimeToContact:      z.string().trim().max(100).optional().nullable(),
  }).optional(),

  // Client can only cancel their own request
  status: z.enum(['cancelled']).optional(),
}).strict();

// ── GET /api/quotes — list filters ────────────────────────────
const listQuotesSchema = z.object({
  status: z.enum(['pending', 'contacted', 'completed', 'cancelled']).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});

module.exports = {
  createQuoteSchema,
  updateQuoteSchema,
  listQuotesSchema,
};
