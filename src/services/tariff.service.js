const Tariff              = require('../models/Tariff');
const cache               = require('../config/redis');
const { getCurrentCap }   = require('../config/ofgem');

// ── Cache TTL ──────────────────────────────────────────────────
const CACHE_TTL = 30 * 60; // 30 minutes

// ── UK average usage (Ofgem figures 2024) ─────────────────────
const UK_AVG = {
  electricity: 2900,  // kWh/year
  gas:         11500, // kWh/year
};

// ── Ofgem cap — always read from ofgem.js (single source of truth) ──
// DO NOT hardcode rates here. Update ofgem.js → CURRENT_CAP only.
const getOfgemCap = () => getCurrentCap();

/**
 * Calculate annual cost for a given tariff + usage.
 * Returns cost in £ (not pence).
 */
const calcAnnualCost = ({ unitRate, standingCharge, annualKwh }) => {
  if (!unitRate || !annualKwh) return null;
  const sc = standingCharge ?? 0;
  return Math.round(
    ((unitRate / 100) * annualKwh) +
    ((sc / 100) * 365)
  );
};

/**
 * Enrich a tariff document with calculated costs + savings.
 * requestedFuelType: what the user asked for (electricity/gas/dual)
 * For fair comparison: if user wants 'dual' but tariff is electricity-only,
 * calculate only electricity cost so it's still comparable.
 */
const enrichTariff = (tariff, { annualElecKwh, annualGasKwh, currentAnnualCost, requestedFuelType }) => {
  const doc = tariff.toObject ? tariff.toObject({ virtuals: true }) : tariff;

  const elecKwh = annualElecKwh ?? UK_AVG.electricity;
  const gasKwh  = annualGasKwh  ?? UK_AVG.gas;

  // Annual cost on this tariff
  const elecCost = calcAnnualCost({
    unitRate:       doc.electricity?.unitRate,
    standingCharge: doc.electricity?.standingCharge,
    annualKwh:      elecKwh,
  });
  const gasCost = calcAnnualCost({
    unitRate:       doc.gas?.unitRate,
    standingCharge: doc.gas?.standingCharge,
    annualKwh:      gasKwh,
  });

  const totalCost = (elecCost ?? 0) + (gasCost ?? 0) || null;

  // ── Fair savings comparison ─────────────────────────────────
  // Compare like-for-like: only the relevant fuel portion
  let comparableCost = totalCost;
  let comparableCurrentCost = currentAnnualCost;

  if (requestedFuelType === 'electricity') {
    // Only compare electricity cost — ignore gas
    comparableCost = elecCost;
  } else if (requestedFuelType === 'gas') {
    // Only compare gas cost — ignore electricity
    comparableCost = gasCost;
  }
  // dual: compare full totalCost vs full currentAnnualCost

  let annualSaving = null;
  if (comparableCurrentCost && comparableCost) {
    annualSaving = comparableCurrentCost - comparableCost;
  }

  return {
    ...doc,
    isLive:    doc.source === 'octopus',
    dataLabel: doc.source === 'octopus' ? 'Live rate' : 'Ofgem cap rate',
    calculated: {
      electricityAnnualCost: elecCost,
      gasAnnualCost:         gasCost,
      totalAnnualCost:       totalCost,
      annualSaving,
      monthlyCost:   totalCost ? Math.round(totalCost / 12) : null,
      isCheaper:     annualSaving !== null ? annualSaving > 0 : null,
    },
  };
};

// ── Service methods ────────────────────────────────────────────

/**
 * GET /api/tariffs
 * List tariffs with filters + pagination
 */
const listTariffs = async (query) => {
  const {
    fuelType, tariffType, region, supplier,
    isGreen, sortBy, order, page, limit,
  } = query;

  const cacheKey = `tariffs:list:${JSON.stringify(query)}`;
  const cached   = await cache.get(cacheKey);
  if (cached) return cached;

  // Build filter
  const filter = { isActive: true };
  if (fuelType)   filter.fuelType   = fuelType;
  if (tariffType) filter.tariffType = tariffType;
  if (region && region !== 'national') {
    filter.$or = [{ region: 'national' }, { region }];
  }
  if (supplier) {
    filter.supplier = new RegExp(supplier, 'i');
  }
  if (isGreen !== undefined) {
    filter.isGreen = isGreen === 'true';
  }

  // Sort mapping
  const sortMap = {
    unitRate:   fuelType === 'gas' ? 'gas.unitRate' : 'electricity.unitRate',
    annualCost: fuelType === 'gas' ? 'gas.unitRate'  : 'electricity.unitRate',
    rating:     'supplierRating',
    cashback:   'cashback',
  };
  const sortField = sortMap[sortBy] || 'electricity.unitRate';
  const sortDir   = order === 'desc' ? -1 : 1;

  const skip  = (page - 1) * limit;
  const total = await Tariff.countDocuments(filter);
  const tariffs = await Tariff
    .find(filter)
    .sort({ [sortField]: sortDir })
    .skip(skip)
    .limit(limit)
    .lean({ virtuals: true });

  // Add data freshness metadata
  const lastSynced = tariffs.length > 0
    ? tariffs.reduce((latest, t) =>
        t.lastUpdated > latest ? t.lastUpdated : latest,
        tariffs[0].lastUpdated
      )
    : null;

  const result = {
    tariffs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext:    page * limit < total,
      hasPrev:    page > 1,
    },
    meta: {
      lastSynced,
      sources: [...new Set(tariffs.map(t => t.source))],
    },
  };

  await cache.set(cacheKey, result, CACHE_TTL);
  return result;
};

/**
 * GET /api/tariffs/:id
 * Single tariff detail
 */
const getTariffById = async (id) => {
  const cacheKey = `tariffs:single:${id}`;
  const cached   = await cache.get(cacheKey);
  if (cached) return cached;

  const tariff = await Tariff.findById(id).lean({ virtuals: true });
  if (!tariff) return null;

  await cache.set(cacheKey, tariff, CACHE_TTL);
  return tariff;
};

/**
 * GET /api/tariffs/suppliers
 * Unique list of active suppliers with counts
 */
const getSuppliers = async () => {
  const cacheKey = 'tariffs:suppliers';
  const cached   = await cache.get(cacheKey);
  if (cached) return cached;

  const suppliers = await Tariff.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id:           '$supplier',
        rating:        { $first: '$supplierRating' },
        tariffCount:   { $sum: 1 },
        hasGreen:      { $max: '$isGreen' },
        fuelTypes:     { $addToSet: '$fuelType' },
        tariffTypes:   { $addToSet: '$tariffType' },
        minElecRate:   { $min: '$electricity.unitRate' },
        minGasRate:    { $min: '$gas.unitRate' },
      },
    },
    { $sort: { rating: -1, _id: 1 } },
  ]);

  const result = suppliers.map((s) => ({
    name:        s._id,
    rating:      s.rating,
    tariffCount: s.tariffCount,
    hasGreen:    s.hasGreen,
    fuelTypes:   s.fuelTypes,
    tariffTypes: s.tariffTypes,
    minElecRate: s.minElecRate,
    minGasRate:  s.minGasRate,
  }));

  await cache.set(cacheKey, result, CACHE_TTL);
  return result;
};

/**
 * POST /api/tariffs/compare
 * Personalised tariff comparison with savings calculation.
 * Uses user's actual usage from profile if available.
 */
const compareTariffs = async (params) => {
  const {
    annualElectricityKwh,
    annualGasKwh,
    currentElectricitySupplier,
    currentGasSupplier,
    currentElectricityUnitRate,
    currentElectricityStanding,
    currentGasUnitRate,
    currentGasStanding,
    fuelType,
    tariffType,
    region,
    isGreen,
    limit,
  } = params;

  // ── Calculate current annual cost ────────────────────────────
  // If user provided current rates, use them. Otherwise use Ofgem cap.
  const cap     = getOfgemCap();
  const elecRate = currentElectricityUnitRate ?? cap.electricity.unitRate;
  const elecSC   = currentElectricityStanding ?? cap.electricity.standingCharge;
  const gasRate  = currentGasUnitRate         ?? cap.gas.unitRate;
  const gasSC    = currentGasStanding         ?? cap.gas.standingCharge;

  const elecKwh = annualElectricityKwh ?? UK_AVG.electricity;
  const gasKwh  = annualGasKwh         ?? UK_AVG.gas;

  let currentElecCost = null;
  let currentGasCost  = null;

  if (fuelType !== 'gas') {
    currentElecCost = calcAnnualCost({ unitRate: elecRate, standingCharge: elecSC, annualKwh: elecKwh });
  }
  if (fuelType !== 'electricity') {
    currentGasCost = calcAnnualCost({ unitRate: gasRate, standingCharge: gasSC, annualKwh: gasKwh });
  }
  const currentAnnualCost = (currentElecCost ?? 0) + (currentGasCost ?? 0);

  // ── Build DB filter ───────────────────────────────────────────
  const filter = { isActive: true };

  if (fuelType && fuelType !== 'any') {
    if (fuelType === 'electricity') {
      // User wants electricity: show electricity-only AND dual (dual covers electricity)
      filter.$or = [{ fuelType: 'electricity' }, { fuelType: 'dual' }];
    } else if (fuelType === 'gas') {
      // User wants gas: show gas-only AND dual (dual covers gas)
      filter.$or = [{ fuelType: 'gas' }, { fuelType: 'dual' }];
    } else {
      // dual: show ONLY dual fuel tariffs
      // electricity-only Octopus products are NOT dual fuel
      filter.fuelType = 'dual';
    }
  }
  if (tariffType && tariffType !== 'any') filter.tariffType = tariffType;
  if (region && region !== 'national') {
    if (!filter.$and) filter.$and = [];
    filter.$and.push({ $or: [{ region: 'national' }, { region }] });
  }
  if (isGreen !== undefined && isGreen !== null) filter.isGreen = isGreen;

  // Sort: gas requests → sort by gas rate, otherwise by electricity rate
  const sortField = fuelType === 'gas'
    ? { 'gas.unitRate': 1 }
    : { 'electricity.unitRate': 1 };

  const tariffs = await Tariff
    .find(filter)
    .sort(sortField)
    .limit(limit * 3)
    .lean({ virtuals: true });

  // ── Enrich with costs + savings ──────────────────────────────
  const enriched = tariffs
    .map((t) => enrichTariff(t, {
      annualElecKwh: elecKwh,
      annualGasKwh:  gasKwh,
      currentAnnualCost,
      requestedFuelType: fuelType,
    }))
    .filter((t) => t.calculated.totalAnnualCost !== null) // remove tariffs with no calculable cost
    .sort((a, b) => {
      // Sort by total annual cost ascending — cheaper first
      const aCost = a.calculated.totalAnnualCost ?? Infinity;
      const bCost = b.calculated.totalAnnualCost ?? Infinity;
      return aCost - bCost;
    })
    .slice(0, limit);

  // ── Best deal highlight ───────────────────────────────────────
  const bestDeal = enriched[0] ?? null;

  return {
    comparison: {
      currentAnnualCost,
      currentElecCost,
      currentGasCost,
      currentElectricitySupplier: currentElectricitySupplier ?? 'Unknown',
      currentGasSupplier:         currentGasSupplier         ?? 'Unknown',
      usageProfile: {
        annualElectricityKwh: elecKwh,
        annualGasKwh:         gasKwh,
        fuelType,
      },
    },
    bestDeal: bestDeal
      ? {
          tariffId:     bestDeal._id,
          supplier:     bestDeal.supplier,
          tariffName:   bestDeal.tariffName,
          annualCost:   bestDeal.calculated.totalAnnualCost,
          annualSaving: bestDeal.calculated.annualSaving,
          monthlyCost:  bestDeal.calculated.monthlyCost,
        }
      : null,
    tariffs: enriched,
    totalFound: enriched.length,
  };
};

/**
 * POST /api/tariffs/calculate
 * Calculate exact cost on a specific tariff for given usage.
 */
const calculateCost = async ({ tariffId, annualElectricityKwh, annualGasKwh }) => {
  const tariff = await Tariff.findById(tariffId).lean({ virtuals: true });
  if (!tariff) return null;

  const elecCost = annualElectricityKwh && tariff.electricity?.unitRate
    ? calcAnnualCost({
        unitRate:       tariff.electricity.unitRate,
        standingCharge: tariff.electricity.standingCharge,
        annualKwh:      annualElectricityKwh,
      })
    : null;

  const gasCost = annualGasKwh && tariff.gas?.unitRate
    ? calcAnnualCost({
        unitRate:       tariff.gas.unitRate,
        standingCharge: tariff.gas.standingCharge,
        annualKwh:      annualGasKwh,
      })
    : null;

  const totalAnnualCost = (elecCost ?? 0) + (gasCost ?? 0) || null;

  return {
    tariff: {
      _id:        tariff._id,
      supplier:   tariff.supplier,
      tariffName: tariff.tariffName,
      tariffType: tariff.tariffType,
      fuelType:   tariff.fuelType,
      isGreen:    tariff.isGreen,
      exitFee:    tariff.exitFee,
      contractLengthMonths: tariff.contractLengthMonths,
    },
    usage: {
      annualElectricityKwh,
      annualGasKwh,
    },
    costs: {
      electricityAnnualCost: elecCost,
      gasAnnualCost:         gasCost,
      totalAnnualCost,
      monthlyAverage:        totalAnnualCost ? Math.round(totalAnnualCost / 12) : null,
      weeklyAverage:         totalAnnualCost ? Math.round(totalAnnualCost / 52) : null,
      dailyAverage:          totalAnnualCost ? Math.round((totalAnnualCost / 365) * 100) / 100 : null,
    },
    breakdown: {
      electricity: tariff.electricity?.unitRate
        ? {
            unitRate:        tariff.electricity.unitRate,
            standingCharge:  tariff.electricity.standingCharge,
            usageCost:       annualElectricityKwh
              ? Math.round((tariff.electricity.unitRate / 100) * annualElectricityKwh)
              : null,
            standingTotal:   Math.round((tariff.electricity.standingCharge / 100) * 365),
          }
        : null,
      gas: tariff.gas?.unitRate
        ? {
            unitRate:       tariff.gas.unitRate,
            standingCharge: tariff.gas.standingCharge,
            usageCost:      annualGasKwh
              ? Math.round((tariff.gas.unitRate / 100) * annualGasKwh)
              : null,
            standingTotal:  Math.round((tariff.gas.standingCharge / 100) * 365),
          }
        : null,
    },
  };
};

module.exports = {
  listTariffs,
  getTariffById,
  getSuppliers,
  compareTariffs,
  calculateCost,
};
