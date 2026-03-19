/**
 * Quote Service
 *
 * Handles:
 *   - Creating quotes (with tariff snapshot)
 *   - Listing broker's quotes
 *   - Getting a single quote
 *   - Updating quote status
 *   - Generating PDF + uploading to Cloudinary
 *   - Deleting quotes (and their PDFs)
 */

const Quote       = require('../models/Quote');
const Tariff      = require('../models/Tariff');
const UserProfile = require('../models/UserProfile');
const User        = require('../models/User');
const { generateQuotePdf } = require('./pdf.service');
const cloudinaryConfig     = require('../config/cloudinary');

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build a tariff snapshot from a Tariff DB document.
 * The snapshot is stored on the Quote so rate drift doesn't affect it.
 */
const buildTariffSnapshot = (tariff) => ({
  tariffId:    tariff._id,
  supplier:    tariff.supplier,
  tariffName:  tariff.tariffName,
  tariffCode:  tariff.tariffCode,
  fuelType:    tariff.fuelType,
  tariffType:  tariff.tariffType,
  isGreen:     tariff.isGreen,
  electricity: tariff.electricity,
  gas:         tariff.gas,
  contractLengthMonths: tariff.contractLengthMonths,
  exitFee:     tariff.exitFee,
  cashback:    tariff.cashback,
  features:    tariff.features,
  isLive:      tariff.source === 'octopus',
  dataLabel:   tariff.source === 'octopus' ? 'Live rate' : 'Ofgem cap rate',
});

/**
 * Calculate pricing from tariff rates + usage.
 * Returns the full pricing object for the Quote.
 */
const buildPricing = ({
  tariff,
  annualElectricityKwh,
  annualGasKwh,
  currentSupplierAnnualCost,
}) => {
  const elecKwh = annualElectricityKwh ?? null;
  const gasKwh  = annualGasKwh         ?? null;

  const calcAnnual = (unitRate, standingCharge, kwh) => {
    if (!unitRate || !kwh) return null;
    const sc = standingCharge ?? 0;
    return Math.round(((unitRate / 100) * kwh) + ((sc / 100) * 365));
  };

  const electricityAnnualCost = calcAnnual(
    tariff.electricity?.unitRate,
    tariff.electricity?.standingCharge,
    elecKwh
  );

  const gasAnnualCost = calcAnnual(
    tariff.gas?.unitRate,
    tariff.gas?.standingCharge,
    gasKwh
  );

  const totalAnnualCost = (electricityAnnualCost ?? 0) + (gasAnnualCost ?? 0) || 0;
  const monthlyAverage  = totalAnnualCost ? Math.round(totalAnnualCost / 12) : null;
  const weeklyAverage   = totalAnnualCost ? Math.round(totalAnnualCost / 52) : null;

  // Savings vs current supplier
  const annualSaving  = currentSupplierAnnualCost
    ? currentSupplierAnnualCost - totalAnnualCost
    : null;
  const monthlySaving = annualSaving ? Math.round(annualSaving / 12) : null;

  return {
    annualElectricityKwh: elecKwh,
    annualGasKwh:         gasKwh,
    electricityAnnualCost,
    gasAnnualCost,
    totalAnnualCost,
    monthlyAverage,
    weeklyAverage,
    currentSupplierAnnualCost: currentSupplierAnnualCost ?? null,
    annualSaving,
    monthlySaving,
    vatIncluded: true,
  };
};

// ── Service Methods ────────────────────────────────────────────

/**
 * POST /api/quotes
 * Create a new quote (starts as draft).
 */
const createQuote = async (brokerId, data) => {
  const {
    client,
    tariffId,
    annualElectricityKwh,
    annualGasKwh,
    currentSupplierAnnualCost,
    notes,
    validDays,
  } = data;

  // Fetch tariff from DB
  const tariff = await Tariff.findById(tariffId);
  if (!tariff) {
    const err = new Error('Tariff not found');
    err.statusCode = 404;
    throw err;
  }

  if (!tariff.isActive) {
    const err = new Error('This tariff is no longer active');
    err.statusCode = 400;
    throw err;
  }

  // Build snapshot + pricing
  const tariffSnapshot = buildTariffSnapshot(tariff);
  const pricing = buildPricing({
    tariff,
    annualElectricityKwh,
    annualGasKwh,
    currentSupplierAnnualCost,
  });

  const quote = await Quote.create({
    broker:   brokerId,
    client,
    tariff:   tariffSnapshot,
    pricing,
    notes:    notes ?? null,
    validDays: validDays ?? 30,
  });

  return quote;
};

/**
 * GET /api/quotes
 * List all quotes for the authenticated broker.
 * Supports filters: status, page, limit
 */
const getMyQuotes = async (brokerId, query) => {
  const {
    status,
    page  = 1,
    limit = 20,
    sortBy = 'createdAt',
    order  = 'desc',
  } = query;

  const filter = { broker: brokerId };
  if (status) filter.status = status;

  const sortDir  = order === 'asc' ? 1 : -1;
  const skip     = (page - 1) * limit;
  const total    = await Quote.countDocuments(filter);

  const quotes = await Quote
    .find(filter)
    .sort({ [sortBy]: sortDir })
    .skip(skip)
    .limit(limit)
    .lean({ virtuals: true });

  return {
    quotes,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * GET /api/quotes/:id
 * Get a single quote (must belong to broker).
 */
const getQuoteById = async (brokerId, quoteId) => {
  const quote = await Quote.findOne({ _id: quoteId, broker: brokerId }).lean({ virtuals: true });
  return quote;
};

/**
 * PATCH /api/quotes/:id
 * Update mutable quote fields (notes, client info, status).
 * Cannot update tariff or pricing after creation.
 */
const updateQuote = async (brokerId, quoteId, updates) => {
  const quote = await Quote.findOne({ _id: quoteId, broker: brokerId });
  if (!quote) return null;

  const { notes, status, client, validDays } = updates;

  if (notes     !== undefined) quote.notes    = notes;
  if (validDays !== undefined) {
    quote.validDays  = validDays;
    const d = new Date();
    d.setDate(d.getDate() + validDays);
    quote.validUntil = d;
  }
  if (client    !== undefined) {
    // Allow partial client updates
    Object.assign(quote.client, client);
  }

  // Status transitions
  if (status && status !== quote.status) {
    const allowed = {
      draft:    ['sent'],
      sent:     ['accepted', 'rejected', 'expired'],
      accepted: [],
      rejected: ['sent'], // can re-send
      expired:  ['sent'],
    };
    if (!(allowed[quote.status] ?? []).includes(status)) {
      const err = new Error(`Cannot transition from '${quote.status}' to '${status}'`);
      err.statusCode = 400;
      throw err;
    }

    quote.status = status;
    if (status === 'sent')     quote.sentAt     = new Date();
    if (status === 'accepted') quote.acceptedAt = new Date();
    if (status === 'rejected') quote.rejectedAt = new Date();
  }

  await quote.save();
  return quote;
};

/**
 * POST /api/quotes/:id/pdf
 * Generate a PDF and upload to Cloudinary.
 * Returns the updated quote with pdfUrl.
 */
const generateAndUploadPdf = async (brokerId, quoteId) => {
  const quote = await Quote.findOne({ _id: quoteId, broker: brokerId });
  if (!quote) return null;

  // Fetch broker profile + user for PDF header
  const [brokerProfile, brokerUser] = await Promise.all([
    UserProfile.findOne({ user: brokerId }),
    User.findById(brokerId),
  ]);

  // Generate PDF buffer
  const pdfBuffer = await generateQuotePdf(quote, brokerProfile, brokerUser);

  // Upload to Cloudinary
  const uploaded = await cloudinaryConfig.uploadPdf(pdfBuffer, quote.quoteNumber);

  if (uploaded) {
    // Delete old PDF from Cloudinary if exists
    if (quote.pdf?.publicId && quote.pdf.publicId !== uploaded.publicId) {
      await cloudinaryConfig.deletePdf(quote.pdf.publicId);
    }

    quote.pdf = {
      url:         uploaded.url,
      publicId:    uploaded.publicId,
      generatedAt: new Date(),
    };
    await quote.save();
  } else {
    // Cloudinary not configured — return PDF as buffer in response metadata
    // The controller will handle streaming it directly
    quote._pdfBuffer = pdfBuffer;
    quote.pdf.generatedAt = new Date();
  }

  return { quote, pdfBuffer };
};

/**
 * DELETE /api/quotes/:id
 * Delete a quote + its PDF from Cloudinary.
 */
const deleteQuote = async (brokerId, quoteId) => {
  const quote = await Quote.findOne({ _id: quoteId, broker: brokerId });
  if (!quote) return null;

  // Delete PDF from Cloudinary
  if (quote.pdf?.publicId) {
    await cloudinaryConfig.deletePdf(quote.pdf.publicId);
  }

  await Quote.deleteOne({ _id: quoteId });
  return true;
};

/**
 * GET /api/quotes/stats
 * Quick stats for dashboard.
 */
const getQuoteStats = async (brokerId) => {
  const stats = await Quote.aggregate([
    { $match: { broker: brokerId } },
    {
      $group: {
        _id:   '$status',
        count: { $sum: 1 },
        totalSavings: { $sum: '$pricing.annualSaving' },
      },
    },
  ]);

  const result = { draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0, totalSavingsGenerated: 0 };
  for (const s of stats) {
    result[s._id]  = s.count;
    if (s._id === 'accepted') {
      result.totalSavingsGenerated = Math.round(s.totalSavings ?? 0);
    }
  }

  result.total = Object.values(result)
    .filter((v, i, arr) => i < arr.length - 2) // exclude totalSavings and total
    .reduce((a, b) => (typeof b === 'number' ? a + b : a), 0);

  return result;
};

module.exports = {
  createQuote,
  getMyQuotes,
  getQuoteById,
  updateQuote,
  generateAndUploadPdf,
  deleteQuote,
  getQuoteStats,
};
