const { z } = require('zod');

const CATEGORIES = [
  'general', 'tariff_review', 'switch_advice',
  'contract_review', 'energy_audit', 'renewal_advice', 'new_connection',
];

const STATUSES = [
  'requested', 'awaiting_payment', 'payment_failed', 'payment_confirmed',
  'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show', 'refunded',
];

// ── CLIENT ─────────────────────────────────────────────────────────

const requestConsultationSchema = z.object({
  category:    z.enum(CATEGORIES).default('general'),
  duration:    z.coerce.number().int().refine((v) => [30, 45, 60].includes(v), {
    message: 'Duration must be 30, 45, or 60 minutes',
  }).default(45),
  meetingMethod:      z.enum(['phone', 'video', 'in_person']).default('phone'),
  preferredDateFrom:  z.string().optional().nullable(),
  preferredDateTo:    z.string().optional().nullable(),
  preferredTimeSlots: z.array(z.enum(['morning', 'afternoon', 'evening'])).optional().default([]),
  clientNotes:        z.string().trim().max(2000).optional().nullable(),
  // SECURITY: price fields rejected — server config only
}).strict().strip(); // strip unknown fields including any price attempts

const cancelConsultationSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

const submitRatingSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
}).strict();

const listMyConsultationsSchema = z.object({
  status: z.enum(STATUSES).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});

// ── ADMIN ──────────────────────────────────────────────────────────

const adminConfirmSchema = z.object({
  scheduledAt:   z.string().optional().nullable(),
  meetingMethod: z.enum(['phone', 'video', 'in_person']).optional(),
  meetingLink:   z.string().url().optional().nullable(),
  meetingPhone:  z.string().trim().optional().nullable(),
  brokerNotes:   z.string().trim().max(3000).optional().nullable(),
}).strict();

const adminCompleteSchema = z.object({
  outcome:         z.string().trim().max(3000).optional().nullable(),
  nextSteps:       z.string().trim().max(1000).optional().nullable(),
  brokerNotes:     z.string().trim().max(3000).optional().nullable(),
  relatedSwitch:   z.string().trim().optional().nullable(),
  relatedQuote:    z.string().trim().optional().nullable(),
  relatedDocument: z.string().trim().optional().nullable(),
}).strict();

const adminNoShowSchema = z.object({
  brokerNotes: z.string().trim().max(3000).optional().nullable(),
});

const adminRefundSchema = z.object({
  reason:       z.enum(['requested_by_customer', 'duplicate', 'fraudulent']).default('requested_by_customer'),
  partial:      z.boolean().optional().default(false),
  amountPounds: z.coerce.number().positive().optional().nullable(),
}).strict();

const adminListConsultationsSchema = z.object({
  clientId:       z.string().trim().optional(),
  status:         z.enum(STATUSES).optional(),
  category:       z.enum(CATEGORIES).optional(),
  assignedBroker: z.string().trim().optional(),
  scheduledFrom:  z.string().optional(),
  scheduledTo:    z.string().optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(20),
  sortBy:         z.enum(['createdAt', 'updatedAt', 'scheduledAt', 'status', 'price']).default('createdAt'),
  order:          z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  requestConsultationSchema,
  cancelConsultationSchema,
  submitRatingSchema,
  listMyConsultationsSchema,
  adminConfirmSchema,
  adminCompleteSchema,
  adminNoShowSchema,
  adminRefundSchema,
  adminListConsultationsSchema,
};