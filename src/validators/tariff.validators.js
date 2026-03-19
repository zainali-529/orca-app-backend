const { z } = require('zod');

const UK_REGIONS = [
  'national', 'eastern', 'east_midlands', 'london',
  'merseyside_north_wales', 'midlands', 'north_eastern',
  'north_western', 'scotland_north', 'scotland_south',
  'south_eastern', 'southern', 'south_western', 'yorkshire',
];

// ── GET /api/tariffs — query filters ──────────────────────────
const listTariffsSchema = z.object({
  fuelType:    z.enum(['electricity', 'gas', 'dual']).optional(),
  tariffType:  z.enum(['fixed', 'variable', 'flexible', 'prepayment']).optional(),
  region:      z.enum(UK_REGIONS).optional(),
  supplier:    z.string().trim().optional(),
  isGreen:     z.enum(['true', 'false']).optional(),
  sortBy:      z.enum(['unitRate', 'annualCost', 'rating', 'cashback']).optional().default('annualCost'),
  order:       z.enum(['asc', 'desc']).optional().default('asc'),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(50).default(20),
});

// ── POST /api/tariffs/compare — personalised comparison ───────
const compareSchema = z.object({
  // Consumption
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

  // Current supplier (for savings calculation)
  currentElectricitySupplier: z.string().trim().optional().nullable(),
  currentGasSupplier:         z.string().trim().optional().nullable(),
  currentElectricityUnitRate: z.number().positive().optional().nullable(), // p/kWh
  currentElectricityStanding: z.number().positive().optional().nullable(), // p/day
  currentGasUnitRate:         z.number().positive().optional().nullable(),
  currentGasStanding:         z.number().positive().optional().nullable(),

  // Preferences
  fuelType:   z.enum(['electricity', 'gas', 'dual']).optional().default('dual'),
  tariffType: z.enum(['fixed', 'variable', 'flexible', 'prepayment', 'any']).optional().default('any'),
  region:     z.enum(UK_REGIONS).optional().default('national'),
  isGreen:    z.boolean().optional(),
  limit:      z.coerce.number().int().min(1).max(30).default(10),
});

// ── POST /api/tariffs/calculate — cost calculator (public) ────
const calculateSchema = z.object({
  tariffId:             z.string().trim().min(1, 'Tariff ID is required'),
  annualElectricityKwh: z.number().positive().optional().nullable(),
  annualGasKwh:         z.number().positive().optional().nullable(),
}).refine(
  (d) => d.annualElectricityKwh || d.annualGasKwh,
  { message: 'Provide at least one usage figure (electricity or gas)' }
);

// ── Admin: POST /api/tariffs — create tariff ──────────────────
const createTariffSchema = z.object({
  supplier:             z.string().trim().min(1),
  tariffName:           z.string().trim().min(1),
  tariffCode:           z.string().trim().optional(),
  fuelType:             z.enum(['electricity', 'gas', 'dual']),
  tariffType:           z.enum(['fixed', 'variable', 'flexible', 'prepayment']),
  region:               z.enum(UK_REGIONS).optional().default('national'),
  electricity: z.object({
    unitRate:       z.number().positive(),
    standingCharge: z.number().positive(),
  }).optional(),
  gas: z.object({
    unitRate:       z.number().positive(),
    standingCharge: z.number().positive(),
  }).optional(),
  contractLengthMonths: z.number().int().min(0).optional(),
  exitFee:              z.number().min(0).optional(),
  isGreen:              z.boolean().optional(),
  onlineDiscount:       z.boolean().optional(),
  cashback:             z.number().min(0).optional(),
  features:             z.array(z.string().trim()).optional(),
  smartMeterRequired:   z.boolean().optional(),
  supplierRating:       z.number().min(1).max(5).optional(),
});

module.exports = {
  listTariffsSchema,
  compareSchema,
  calculateSchema,
  createTariffSchema,
};
