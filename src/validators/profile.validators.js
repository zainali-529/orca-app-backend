const { z } = require('zod');

// ── UK Postcode regex ──────────────────────────────────────────
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

// ── UK MPAN: exactly 13 digits ─────────────────────────────────
const UK_MPAN_RE = /^\d{13}$/;

// ── UK MPRN: 6–10 digits ──────────────────────────────────────
const UK_MPRN_RE = /^\d{6,10}$/;

// ── Reusable address schema ────────────────────────────────────
const addressSchema = z.object({
  line1:    z.string().trim().min(1, 'Address line 1 is required'),
  line2:    z.string().trim().optional().nullable(),
  city:     z.string().trim().min(1, 'City is required'),
  county:   z.string().trim().optional().nullable(),
  postcode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(UK_POSTCODE_RE, 'Please enter a valid UK postcode'),
  country: z.string().trim().default('United Kingdom'),
});

const addressSchemaPartial = addressSchema.partial();

// ── Step 1: Business type ─────────────────────────────────────
const step1Schema = z.object({
  businessType: z.enum(['residential', 'sme', 'commercial', 'industrial'], {
    required_error: 'Business type is required',
  }),
});

// ── Step 2: Business details ──────────────────────────────────
const step2Schema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, 'Company name is required')
    .max(200)
    .optional()
    .nullable(),
  companyNumber: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{8}$/, 'Companies House number must be 8 characters')
    .optional()
    .nullable(),
  vatNumber: z
    .string()
    .trim()
    .regex(/^GB\d{9}$/, 'VAT number must be in format GB123456789')
    .optional()
    .nullable(),
  sicCode: z.string().trim().optional().nullable(),
  numberOfEmployees: z
    .enum(['1-10', '11-50', '51-200', '201-500', '500+'])
    .optional()
    .nullable(),
  businessPhone: z.string().trim().optional().nullable(),
  businessEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please enter a valid email')
    .optional()
    .nullable(),
});

// ── Step 3: Address ───────────────────────────────────────────
const step3Schema = z.object({
  billingAddress: addressSchema,
  sameAddress:    z.boolean().default(true),
  // If sameAddress=false, supplyAddress is required
  supplyAddress: addressSchema.optional().nullable(),
}).refine(
  (data) => data.sameAddress || (data.supplyAddress !== null && data.supplyAddress !== undefined),
  {
    message: 'Supply address is required when different from billing address',
    path: ['supplyAddress'],
  }
);

// ── Step 4: Energy details ────────────────────────────────────
const step4Schema = z
  .object({
    // Electricity
    mpan: z
      .string()
      .trim()
      .regex(UK_MPAN_RE, 'MPAN must be exactly 13 digits')
      .optional()
      .nullable(),
    currentElectricitySupplier: z.string().trim().optional().nullable(),
    annualElectricityKwh: z
      .number({ invalid_type_error: 'Annual kWh must be a number' })
      .positive('Annual kWh must be positive')
      .optional()
      .nullable(),
    electricityContractEndDate: z
      .string()
      .datetime({ message: 'Invalid date format' })
      .optional()
      .nullable(),
    electricityTariffType: z
      .enum(['fixed', 'variable', 'flexible', 'unknown'])
      .optional()
      .nullable(),

    // Gas
    mprn: z
      .string()
      .trim()
      .regex(UK_MPRN_RE, 'MPRN must be 6 to 10 digits')
      .optional()
      .nullable(),
    currentGasSupplier: z.string().trim().optional().nullable(),
    annualGasKwh: z
      .number()
      .positive('Annual kWh must be positive')
      .optional()
      .nullable(),
    gasContractEndDate: z
      .string()
      .datetime({ message: 'Invalid date format' })
      .optional()
      .nullable(),
    gasTariffType: z
      .enum(['fixed', 'variable', 'flexible', 'unknown'])
      .optional()
      .nullable(),

    hasSmartMeter: z.boolean().optional(),
  })
  .refine(
    (data) => data.mpan || data.mprn,
    { message: 'At least one of MPAN (electricity) or MPRN (gas) is required', path: ['mpan'] }
  );

// ── Step 5: Preferences (review + confirm) ────────────────────
const step5Schema = z.object({
  preferGreenEnergy: z.boolean().optional(),
  preferFixedTariff: z.boolean().optional(),
  contactPreference: z.enum(['email', 'phone', 'whatsapp']).optional(),
});

// ── Update profile (partial — any field) ──────────────────────
const updateProfileSchema = z.object({
  firstName:       z.string().trim().min(2).max(50).optional(),
  lastName:        z.string().trim().min(2).max(50).optional(),
  phone:           z.string().trim().optional().nullable(),
  businessType:    z.enum(['residential', 'sme', 'commercial', 'industrial']).optional().nullable(),
  companyName:     z.string().trim().max(200).optional().nullable(),
  companyNumber:   z.string().trim().optional().nullable(),
  vatNumber:       z.string().trim().optional().nullable(),
  businessPhone:   z.string().trim().optional().nullable(),
  businessEmail:   z.string().trim().toLowerCase().email().optional().nullable(),
  billingAddress:  addressSchemaPartial.optional(),
  supplyAddress:   addressSchemaPartial.optional().nullable(),
  sameAddress:     z.boolean().optional(),
  energy:          z.object({
    mpan:                       z.string().trim().optional().nullable(),
    currentElectricitySupplier: z.string().trim().optional().nullable(),
    annualElectricityKwh:       z.number().positive().optional().nullable(),
    electricityContractEndDate: z.string().datetime().optional().nullable(),
    electricityTariffType:      z.enum(['fixed','variable','flexible','unknown']).optional().nullable(),
    mprn:                       z.string().trim().optional().nullable(),
    currentGasSupplier:         z.string().trim().optional().nullable(),
    annualGasKwh:               z.number().positive().optional().nullable(),
    gasContractEndDate:         z.string().datetime().optional().nullable(),
    gasTariffType:              z.enum(['fixed','variable','flexible','unknown']).optional().nullable(),
    hasSmartMeter:              z.boolean().optional(),
  }).optional(),
  preferGreenEnergy:  z.boolean().optional(),
  preferFixedTariff:  z.boolean().optional(),
  contactPreference:  z.enum(['email', 'phone', 'whatsapp']).optional(),
  notes:              z.string().trim().max(1000).optional().nullable(),
});

module.exports = {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  updateProfileSchema,
};