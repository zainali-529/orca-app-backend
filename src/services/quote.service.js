/**
 * Quote Service — Client Side
 *
 * Client requests a quote → admin contacts them.
 * Profile data auto-fills the request snapshot.
 */

const Quote       = require('../models/Quote');
const Tariff      = require('../models/Tariff');
const UserProfile = require('../models/UserProfile');
const User        = require('../models/User');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS

// ── Build energy snapshot from profile ────────────────────────
const buildEnergySnapshot = (profile) => {
  if (!profile) return {};
  return {
    businessType: profile.businessType ?? null,
    companyName:  profile.companyName  ?? null,
    postcode:     profile.billingAddress?.postcode ?? null,
    city:         profile.billingAddress?.city     ?? null,
    mpan:         profile.energy?.mpan  ?? null,
    mprn:         profile.energy?.mprn  ?? null,
    currentElectricitySupplier: profile.energy?.currentElectricitySupplier ?? null,
    currentGasSupplier:         profile.energy?.currentGasSupplier         ?? null,
    annualElectricityKwh:       profile.energy?.annualElectricityKwh       ?? null,
    annualGasKwh:               profile.energy?.annualGasKwh               ?? null,
    electricityTariffType:      profile.energy?.electricityTariffType      ?? null,
    gasTariffType:              profile.energy?.gasTariffType              ?? null,
    hasSmartMeter:              profile.energy?.hasSmartMeter              ?? false,
  };
};

// ── Build contact details from user + profile ─────────────────
const buildContactDetails = (user, profile) => ({
  name:  `${user.firstName} ${user.lastName}`,
  email: user.email,
  phone: user.phone ?? profile?.businessPhone ?? null,
  preferredContactMethod: profile?.contactPreference ?? 'phone',
  bestTimeToContact: null,
});

// ── Build interested tariff snapshot ──────────────────────────
const buildTariffSnapshot = (tariff, estimatedCost, estimatedSaving) => ({
  tariffId:              tariff._id,
  supplier:              tariff.supplier,
  tariffName:            tariff.tariffName,
  fuelType:              tariff.fuelType,
  tariffType:            tariff.tariffType,
  isGreen:               tariff.isGreen,
  estimatedAnnualCost:   estimatedCost   ?? null,
  estimatedAnnualSaving: estimatedSaving ?? null,
});

// ── Calculate cost estimate ────────────────────────────────────
const calcAnnual = (unitRate, standingCharge, kwh) => {
  if (!unitRate || !kwh) return null;
  return Math.round(((unitRate / 100) * kwh) + (((standingCharge ?? 0) / 100) * 365));
};

const estimateCost = (tariff, elecKwh, gasKwh) => {
  const elec = calcAnnual(tariff.electricity?.unitRate, tariff.electricity?.standingCharge, elecKwh);
  const gas  = calcAnnual(tariff.gas?.unitRate,         tariff.gas?.standingCharge,         gasKwh);
  return (elec ?? 0) + (gas ?? 0) || null;
};

// ─────────────────────────────────────────────────────────────
// SERVICE METHODS
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/quotes
 * Client requests a quote.
 * Auto-fills energy snapshot + contact details from profile.
 */
const createQuoteRequest = async (clientId, data) => {
  const {
    tariffId,
    annualElectricityKwh,
    annualGasKwh,
    currentSupplierAnnualCost,
    preferences,
    contactDetails,
    message,
  } = data;

  // Load client profile + user
  const [user, profile] = await Promise.all([
    User.findById(clientId),
    UserProfile.findOne({ user: clientId }),
  ]);

  // ── Energy snapshot from profile (override with request data if provided) ──
  const snapshot = buildEnergySnapshot(profile);
  if (annualElectricityKwh) snapshot.annualElectricityKwh = annualElectricityKwh;
  if (annualGasKwh)         snapshot.annualGasKwh         = annualGasKwh;

  // ── Contact details from profile (override with request data if provided) ──
  const contact = buildContactDetails(user, profile);
  if (contactDetails) {
    Object.assign(contact, contactDetails);
    // Ensure name is always set
    if (!contact.name || contact.name.trim() === '') {
      contact.name = `${user.firstName} ${user.lastName}`;
    }
  }

  // ── Preferences from profile + request ────────────────────────
  const prefs = {
    fuelType:       preferences?.fuelType      ?? null,
    preferGreen:    preferences?.preferGreen   ?? profile?.preferGreenEnergy ?? false,
    preferFixed:    preferences?.preferFixed   ?? profile?.preferFixedTariff ?? true,
    contractLength: preferences?.contractLength ?? 'no_preference',
  };

  // ── Interested tariff (if client clicked "Request Quote" on a specific tariff) ──
  let interestedTariff = {};
  if (tariffId) {
    const tariff = await Tariff.findById(tariffId);
    if (!tariff) {
      const err = new Error('Tariff not found');
      err.statusCode = 404;
      throw err;
    }

    const elecKwh = snapshot.annualElectricityKwh;
    const gasKwh  = snapshot.annualGasKwh;
    const estimatedCost   = estimateCost(tariff, elecKwh, gasKwh);
    const estimatedSaving = currentSupplierAnnualCost && estimatedCost
      ? currentSupplierAnnualCost - estimatedCost
      : null;

    interestedTariff = buildTariffSnapshot(tariff, estimatedCost, estimatedSaving);
  }

  const quote = await Quote.create({
    client:           clientId,
    interestedTariff,
    energySnapshot:   snapshot,
    preferences:      prefs,
    contactDetails:   contact,
    message:          message ?? null,
  });

  notifyTrigger.onQuoteCreated(quote);  // ← ADD THIS

  return quote;
};

/**
 * GET /api/quotes
 * Client sees their own quote requests.
 * adminNotes field is stripped — clients don't see internal notes.
 */
const getMyQuotes = async (clientId, query) => {
  const { status, page = 1, limit = 20 } = query;

  const filter = { client: clientId };
  if (status) filter.status = status;

  const skip  = (page - 1) * limit;
  const total = await Quote.countDocuments(filter);

  const quotes = await Quote
    .find(filter)
    .select('-adminNotes') // never expose to client
    .sort({ createdAt: -1 })
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
 * Client gets a single quote request (their own only).
 */
const getQuoteById = async (clientId, quoteId) => {
  const quote = await Quote
    .findOne({ _id: quoteId, client: clientId })
    .select('-adminNotes')
    .lean({ virtuals: true });
  return quote;
};

/**
 * PATCH /api/quotes/:id
 * Client can: update message, contact details, or cancel.
 * Cannot change status except to 'cancelled'.
 * Cannot modify after it's been contacted/completed.
 */
const updateQuoteRequest = async (clientId, quoteId, updates) => {
  const quote = await Quote.findOne({ _id: quoteId, client: clientId });
  if (!quote) return null;

  // Can only edit pending requests
  if (!['pending'].includes(quote.status) && updates.status !== 'cancelled') {
    const err = new Error('This quote request can no longer be edited');
    err.statusCode = 400;
    throw err;
  }

  if (updates.message     !== undefined) quote.message = updates.message;
  if (updates.contactDetails) {
    Object.assign(quote.contactDetails, updates.contactDetails);
  }

  // Client can cancel their own request
  if (updates.status === 'cancelled') {
    if (quote.status === 'completed') {
      const err = new Error('Cannot cancel a completed request');
      err.statusCode = 400;
      throw err;
    }
    quote.status      = 'cancelled';
    quote.cancelledAt = new Date();
  }

  await quote.save();
  return quote.toObject({ virtuals: true });
};

/**
 * DELETE /api/quotes/:id
 * Client can only delete their own PENDING requests.
 */
const deleteQuoteRequest = async (clientId, quoteId) => {
  const quote = await Quote.findOne({ _id: quoteId, client: clientId });
  if (!quote) return null;

  if (quote.status !== 'pending') {
    const err = new Error('Only pending requests can be deleted. Use cancel instead.');
    err.statusCode = 400;
    throw err;
  }

  await Quote.deleteOne({ _id: quoteId });
  return true;
};

/**
 * GET /api/quotes/summary
 * Quick count of the client's quote requests by status.
 */
const getQuoteSummary = async (clientId) => {
  const counts = await Quote.aggregate([
    { $match: { client: clientId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = { pending: 0, contacted: 0, completed: 0, cancelled: 0, total: 0 };
  for (const c of counts) {
    summary[c._id] = c.count;
    summary.total += c.count;
  }
  return summary;
};

module.exports = {
  createQuoteRequest,
  getMyQuotes,
  getQuoteById,
  updateQuoteRequest,
  deleteQuoteRequest,
  getQuoteSummary,
};
