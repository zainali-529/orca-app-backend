/**
 * Meter Service
 *
 * Phase 1 — Manual workflow:
 *   Client requests → Admin fulfills manually → Client sees data
 *
 * Phase 2 — n3rgy API (future):
 *   fulfillReading() gets replaced with an API call.
 *   Everything else stays identical.
 */

const MeterReading = require('../models/MeterReading');
const UserProfile  = require('../models/UserProfile');
const User         = require('../models/User');

// ── Populate helper ───────────────────────────────────────────────
const populateMeterReading = (query) =>
  query
    .populate('client',        'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email');

// ── Build meter snapshot from profile ────────────────────────────
const buildMeterSnapshot = (profile, overrides = {}) => ({
  mpan: overrides.mpan ?? profile?.energy?.mpan  ?? null,
  mprn: overrides.mprn ?? profile?.energy?.mprn  ?? null,
});

// ── Estimate annual kWh from a period sample ──────────────────────
const estimateAnnual = (totalKwh, periodDays) => {
  if (!totalKwh || !periodDays || periodDays < 1) return null;
  return Math.round((totalKwh / periodDays) * 365);
};

// ─────────────────────────────────────────────────────────────────
// CLIENT METHODS
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/meter-readings/summary
 */
const getMySummary = async (clientId) => {
  const results = await MeterReading.aggregate([
    { $match: { client: clientId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = {
    requested: 0, processing: 0, fulfilled: 0, failed: 0,
    total: 0, active: 0,
  };

  for (const r of results) {
    summary[r._id] = r.count;
    summary.total  += r.count;
    if (['requested', 'processing'].includes(r._id)) summary.active += r.count;
  }

  // Latest fulfilled reading (most recent data for the client)
  const latestFulfilled = await MeterReading
    .findOne({ client: clientId, status: 'fulfilled' })
    .sort({ fulfilledAt: -1 })
    .select('readingNumber fulfilledAt fuelType electricity gas')
    .lean({ virtuals: true });

  summary.latestFulfilled = latestFulfilled ?? null;

  return summary;
};

/**
 * GET /api/meter-readings
 */
const getMyReadings = async (clientId, query) => {
  const { status, fuelType, page = 1, limit = 20 } = query;

  const filter = { client: clientId };
  if (status)   filter.status   = status;
  if (fuelType) filter.fuelType = fuelType;

  const skip  = (page - 1) * limit;
  const total = await MeterReading.countDocuments(filter);

  const readings = await MeterReading
    .find(filter)
    .select('-adminNotes -readings') // don't return raw data points in list
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean({ virtuals: true });

  return {
    readings,
    pagination: {
      total, page, limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * GET /api/meter-readings/:id
 * Includes raw readings array for chart rendering
 */
const getReadingById = async (clientId, readingId) =>
  MeterReading
    .findOne({ _id: readingId, client: clientId })
    .select('-adminNotes')
    .lean({ virtuals: true });

/**
 * POST /api/meter-readings
 * Client requests usage data for their meter(s).
 * MPAN/MPRN auto-filled from profile, can override per-request.
 */
const requestReading = async (clientId, data) => {
  const {
    fuelType = 'electricity',
    requestType = 'current_usage',
    periodFrom,
    periodTo,
    mpan,
    mprn,
    clientNotes,
  } = data;

  // Pull meter IDs from profile as fallback
  const profile = await UserProfile.findOne({ user: clientId });
  const meters  = buildMeterSnapshot(profile, { mpan, mprn });

  // Validate: need at least one meter number for the requested fuel
  if (fuelType === 'electricity' || fuelType === 'both') {
    if (!meters.mpan) {
      const e = new Error(
        'No MPAN found. Please add your electricity meter number in your profile first, ' +
        'or provide it in this request.'
      );
      e.statusCode = 400;
      throw e;
    }
  }
  if (fuelType === 'gas' || fuelType === 'both') {
    if (!meters.mprn) {
      const e = new Error(
        'No MPRN found. Please add your gas meter number in your profile first, ' +
        'or provide it in this request.'
      );
      e.statusCode = 400;
      throw e;
    }
  }

  // For historical requests, period dates are required
  if (requestType === 'historical') {
    if (!periodFrom || !periodTo) {
      const e = new Error('Historical requests require periodFrom and periodTo dates.');
      e.statusCode = 400;
      throw e;
    }
    if (new Date(periodFrom) >= new Date(periodTo)) {
      const e = new Error('periodFrom must be before periodTo.');
      e.statusCode = 400;
      throw e;
    }
  }

  const reading = await MeterReading.create({
    client:      clientId,
    fuelType,
    requestType,
    mpan:        meters.mpan,
    mprn:        meters.mprn,
    periodFrom:  periodFrom ? new Date(periodFrom) : null,
    periodTo:    periodTo   ? new Date(periodTo)   : null,
    clientNotes: clientNotes ?? null,
  });

  return reading;
};

/**
 * DELETE /api/meter-readings/:id
 * Client can delete only their own PENDING requests.
 */
const deleteReading = async (clientId, readingId) => {
  const reading = await MeterReading.findOne({ _id: readingId, client: clientId });
  if (!reading) return null;

  if (!['requested'].includes(reading.status)) {
    const e = new Error(
      `Cannot delete a '${reading.status}' request. Only 'requested' ones can be deleted.`
    );
    e.statusCode = 400;
    throw e;
  }

  await MeterReading.deleteOne({ _id: readingId });
  return true;
};

// ─────────────────────────────────────────────────────────────────
// ADMIN METHODS
// ─────────────────────────────────────────────────────────────────

/**
 * Admin: List all reading requests.
 */
const adminListReadings = async (query) => {
  const {
    clientId, status, fuelType, requestType, assignedAdmin,
    page = 1, limit = 20, sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = {};
  if (clientId)     filter.client        = clientId;
  if (status)       filter.status        = status;
  if (fuelType)     filter.fuelType      = fuelType;
  if (requestType)  filter.requestType   = requestType;
  if (assignedAdmin) filter.assignedAdmin = assignedAdmin;

  const skip    = (page - 1) * limit;
  const sortDir = order === 'asc' ? 1 : -1;
  const total   = await MeterReading.countDocuments(filter);

  const readings = await populateMeterReading(
    MeterReading
      .find(filter)
      .select('+adminNotes -readings') // admin sees notes, but not raw data in list
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
  ).lean({ virtuals: true });

  return {
    readings,
    pagination: {
      total, page, limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Admin: Get single reading with full detail + raw readings.
 */
const adminGetReading = async (readingId) =>
  populateMeterReading(
    MeterReading.findById(readingId).select('+adminNotes')
  ).lean({ virtuals: true });

/**
 * Admin: Mark a request as 'processing' (I'm working on it).
 */
const adminMarkProcessing = async (adminId, readingId, adminNotes) => {
  const reading = await MeterReading.findById(readingId).select('+adminNotes');

  if (!reading) {
    const e = new Error('Meter reading request not found'); e.statusCode = 404; throw e;
  }
  if (reading.status !== 'requested') {
    const e = new Error(`Request is already '${reading.status}'`); e.statusCode = 400; throw e;
  }

  reading.status        = 'processing';
  reading.assignedAdmin = adminId;
  reading.processingAt  = new Date();
  if (adminNotes !== undefined) reading.adminNotes = adminNotes;

  await reading.save();
  return reading;
};

/**
 * Admin: Fulfill a reading request with actual consumption data.
 *
 * This is the core of Phase 1. Admin pulls data manually from:
 *   - n3rgy portal / DCC (Data Communications Company)
 *   - Smart meter app (Hildebrand, etc.)
 *   - Supplier's online portal
 *   - Physical meter reading
 *
 * In Phase 2, this gets called automatically by the n3rgy API integration.
 *
 * @param {string} adminId
 * @param {string} readingId
 * @param {object} fulfillmentData
 */
const adminFulfillReading = async (adminId, readingId, data) => {
  const {
    dataFrom,
    dataTo,
    dataSource = 'manual',
    adminNotes,

    // Electricity consumption
    electricity,

    // Gas consumption
    gas,

    // Optional raw reading points (for future chart rendering)
    readings = [],
  } = data;

  const reading = await MeterReading.findById(readingId).select('+adminNotes');

  if (!reading) {
    const e = new Error('Meter reading request not found'); e.statusCode = 404; throw e;
  }
  if (!['requested', 'processing'].includes(reading.status)) {
    const e = new Error(`Cannot fulfill a '${reading.status}' request`); e.statusCode = 400; throw e;
  }

  // Validate fuel scope matches request
  if (reading.fuelType === 'electricity' && !electricity) {
    const e = new Error('Electricity data is required for this request'); e.statusCode = 400; throw e;
  }
  if (reading.fuelType === 'gas' && !gas) {
    const e = new Error('Gas data is required for this request'); e.statusCode = 400; throw e;
  }
  if (reading.fuelType === 'both' && !electricity && !gas) {
    const e = new Error('At least electricity or gas data is required'); e.statusCode = 400; throw e;
  }

  reading.assignedAdmin = adminId;
  reading.status        = 'fulfilled';
  reading.fulfilledAt   = new Date();
  reading.dataSource    = dataSource;
  reading.dataFrom      = dataFrom ? new Date(dataFrom) : null;
  reading.dataTo        = dataTo   ? new Date(dataTo)   : null;

  if (adminNotes !== undefined) reading.adminNotes = adminNotes;

  // ── Build electricity summary ──────────────────────────────
  if (electricity) {
    const periodDays = (dataFrom && dataTo)
      ? Math.round((new Date(dataTo) - new Date(dataFrom)) / (1000 * 60 * 60 * 24))
      : null;

    reading.electricity = {
      totalKwh:            electricity.totalKwh             ?? null,
      dailyAvgKwh:         electricity.dailyAvgKwh
        ?? (electricity.totalKwh && periodDays
              ? parseFloat((electricity.totalKwh / periodDays).toFixed(2))
              : null),
      monthlyAvgKwh:       electricity.monthlyAvgKwh
        ?? (electricity.totalKwh && periodDays
              ? parseFloat(((electricity.totalKwh / periodDays) * 30.44).toFixed(2))
              : null),
      peakDemandKw:        electricity.peakDemandKw         ?? null,
      periodDays,
      estimatedAnnualKwh:  electricity.estimatedAnnualKwh
        ?? estimateAnnual(electricity.totalKwh, periodDays),
      estimatedAnnualCost: electricity.estimatedAnnualCost  ?? null,
    };
  }

  // ── Build gas summary ──────────────────────────────────────
  if (gas) {
    const periodDays = (dataFrom && dataTo)
      ? Math.round((new Date(dataTo) - new Date(dataFrom)) / (1000 * 60 * 60 * 24))
      : null;

    reading.gas = {
      totalKwh:            gas.totalKwh             ?? null,
      dailyAvgKwh:         gas.dailyAvgKwh
        ?? (gas.totalKwh && periodDays
              ? parseFloat((gas.totalKwh / periodDays).toFixed(2))
              : null),
      monthlyAvgKwh:       gas.monthlyAvgKwh
        ?? (gas.totalKwh && periodDays
              ? parseFloat(((gas.totalKwh / periodDays) * 30.44).toFixed(2))
              : null),
      peakDemandKw:        null, // not applicable for gas
      periodDays,
      estimatedAnnualKwh:  gas.estimatedAnnualKwh
        ?? estimateAnnual(gas.totalKwh, periodDays),
      estimatedAnnualCost: gas.estimatedAnnualCost ?? null,
    };
  }

  // ── Store raw data points if provided ─────────────────────
  if (readings.length > 0) {
    reading.readings = readings.map((r) => ({
      timestamp:   new Date(r.timestamp),
      value:       r.value,
      unit:        r.unit ?? 'kWh',
      readingType: r.readingType ?? 'actual',
    }));
  }

  // ── Auto-update client's profile with annual estimates ────
  // If we now have better usage data, update their profile
  try {
    const profileUpdate = {};
    if (reading.electricity?.estimatedAnnualKwh) {
      profileUpdate['energy.annualElectricityKwh'] = reading.electricity.estimatedAnnualKwh;
    }
    if (reading.gas?.estimatedAnnualKwh) {
      profileUpdate['energy.annualGasKwh'] = reading.gas.estimatedAnnualKwh;
    }
    if (Object.keys(profileUpdate).length > 0) {
      await UserProfile.findOneAndUpdate(
        { user: reading.client },
        { $set: profileUpdate }
      );
    }
  } catch (profileErr) {
    // Non-fatal — log and continue
    console.warn('[MeterService] Profile update after fulfillment failed:', profileErr.message);
  }

  await reading.save();
  return reading;
};

/**
 * Admin: Mark a request as failed (data unavailable).
 */
const adminFailReading = async (adminId, readingId, reason) => {
  const reading = await MeterReading.findById(readingId).select('+adminNotes');

  if (!reading) {
    const e = new Error('Meter reading request not found'); e.statusCode = 404; throw e;
  }
  if (!['requested', 'processing'].includes(reading.status)) {
    const e = new Error(`Cannot fail a '${reading.status}' request`); e.statusCode = 400; throw e;
  }

  reading.status        = 'failed';
  reading.failedAt      = new Date();
  reading.failureReason = reason ?? 'Unable to retrieve meter data';
  reading.assignedAdmin = adminId;

  await reading.save();
  return reading;
};

/**
 * Admin: Aggregate stats for dashboard.
 */
const adminGetStats = async () => {
  const [statusBreakdown, fuelBreakdown, sourceBreakdown, recentlyFulfilled] =
    await Promise.all([
      MeterReading.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MeterReading.aggregate([
        { $group: { _id: '$fuelType', count: { $sum: 1 } } },
      ]),
      MeterReading.aggregate([
        { $match: { status: 'fulfilled' } },
        { $group: { _id: '$dataSource', count: { $sum: 1 } } },
      ]),
      MeterReading.countDocuments({
        status: 'fulfilled',
        fulfilledAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

  const byStatus = { requested: 0, processing: 0, fulfilled: 0, failed: 0, total: 0 };
  for (const r of statusBreakdown) {
    byStatus[r._id] = r.count;
    byStatus.total  += r.count;
  }

  const byFuel   = {};
  for (const r of fuelBreakdown) byFuel[r._id] = r.count;

  const bySource = {};
  for (const r of sourceBreakdown) bySource[r._id] = r.count;

  return {
    byStatus,
    byFuel,
    bySource,
    fulfilledThisWeek: recentlyFulfilled,
    pendingCount: byStatus.requested + byStatus.processing,
  };
};

module.exports = {
  // Client
  getMySummary, getMyReadings, getReadingById, requestReading, deleteReading,
  // Admin
  adminListReadings, adminGetReading, adminMarkProcessing,
  adminFulfillReading, adminFailReading, adminGetStats,
};