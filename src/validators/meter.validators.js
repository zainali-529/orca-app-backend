const { z } = require('zod');

const STATUSES    = ['requested', 'processing', 'fulfilled', 'failed'];
const FUEL_TYPES  = ['electricity', 'gas', 'both'];
const REQ_TYPES   = ['current_usage', 'historical', 'annual_estimate'];
const DATA_SOURCES = ['manual', 'n3rgy_api', 'supplier_portal', 'smart_meter_app'];

// ── Consumption summary sub-schema ────────────────────────────────
const consumptionSchema = z.object({
  totalKwh:            z.number().positive().optional().nullable(),
  dailyAvgKwh:         z.number().positive().optional().nullable(),
  monthlyAvgKwh:       z.number().positive().optional().nullable(),
  peakDemandKw:        z.number().positive().optional().nullable(),
  estimatedAnnualKwh:  z.number().positive().optional().nullable(),
  estimatedAnnualCost: z.number().positive().optional().nullable(),
}).refine(
  (d) => d.totalKwh || d.estimatedAnnualKwh,
  { message: 'Provide at least totalKwh or estimatedAnnualKwh' }
);

// ── Raw reading point sub-schema ──────────────────────────────────
const readingPointSchema = z.object({
  timestamp:   z.string().datetime({ message: 'Invalid timestamp format' }),
  value:       z.number().nonnegative(),
  unit:        z.string().default('kWh'),
  readingType: z.enum(['actual', 'estimated', 'substituted']).default('actual'),
});

// ── CLIENT: POST /api/meter-readings ─────────────────────────────
const requestReadingSchema = z.object({
  fuelType:    z.enum(FUEL_TYPES).default('electricity'),
  requestType: z.enum(REQ_TYPES).default('current_usage'),

  // Override meter IDs (optional — auto-filled from profile)
  mpan: z.string().trim().regex(/^\d{13}$/, 'MPAN must be 13 digits').optional().nullable(),
  mprn: z.string().trim().regex(/^\d{6,10}$/, 'MPRN must be 6-10 digits').optional().nullable(),

  // Required only for 'historical' requests
  periodFrom: z.string().datetime().optional().nullable(),
  periodTo:   z.string().datetime().optional().nullable(),

  clientNotes: z.string().trim().max(1000).optional().nullable(),
});

// ── CLIENT: GET /api/meter-readings (list filters) ─────────────────
const listReadingsSchema = z.object({
  status:   z.enum(STATUSES).optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
});

// ── ADMIN: POST /api/admin/meter-readings/:id/process ─────────────
const adminProcessSchema = z.object({
  adminNotes: z.string().trim().max(2000).optional().nullable(),
});

// ── ADMIN: POST /api/admin/meter-readings/:id/fulfill ─────────────
const adminFulfillSchema = z.object({
  // Actual period the data covers
  dataFrom:   z.string().datetime().optional().nullable(),
  dataTo:     z.string().datetime().optional().nullable(),
  dataSource: z.enum(DATA_SOURCES).default('manual'),

  electricity: consumptionSchema.optional().nullable(),
  gas:         consumptionSchema.optional().nullable(),

  // Optional raw data points
  readings: z.array(readingPointSchema).max(5000).optional().default([]),

  adminNotes: z.string().trim().max(2000).optional().nullable(),
}).refine(
  (d) => d.electricity || d.gas,
  { message: 'Provide at least electricity or gas consumption data' }
);

// ── ADMIN: POST /api/admin/meter-readings/:id/fail ────────────────
const adminFailSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

// ── ADMIN: GET /api/admin/meter-readings (list filters) ────────────
const adminListReadingsSchema = z.object({
  clientId:      z.string().trim().optional(),
  status:        z.enum(STATUSES).optional(),
  fuelType:      z.enum(FUEL_TYPES).optional(),
  requestType:   z.enum(REQ_TYPES).optional(),
  assignedAdmin: z.string().trim().optional(),
  page:          z.coerce.number().int().min(1).default(1),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
  sortBy:        z.enum(['createdAt', 'updatedAt', 'status', 'readingNumber']).default('createdAt'),
  order:         z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  requestReadingSchema,
  listReadingsSchema,
  adminProcessSchema,
  adminFulfillSchema,
  adminFailSchema,
  adminListReadingsSchema,
};