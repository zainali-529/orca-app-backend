/**
 * Ofgem Price Cap Rates
 *
 * Ofgem sets a price cap quarterly (Jan, Apr, Jul, Oct).
 * These rates define the MAXIMUM suppliers can charge on default tariffs.
 * We use these as the baseline rates for non-Octopus suppliers.
 *
 * Source: https://www.ofgem.gov.uk/information-for-household-consumers/energy-price-cap
 *
 * Manual update process:
 *   1. Ofgem announces new cap each quarter
 *   2. Update PRICE_CAP below with new rates
 *   3. Or call POST /api/tariffs/sync/cap with { quarter, year, electricity, gas }
 *
 * Rates are in pence (p/kWh for unit rate, p/day for standing charge)
 * All rates include 5% VAT
 */

const mongoose = require('mongoose');
const Tariff   = require('../models/Tariff');

// ── Current Ofgem Price Cap (Q1 2025 — Jan to Mar 2025) ────────
const CURRENT_CAP = {
  quarter: 'Q1',
  year:    2025,
  effectiveFrom: new Date('2025-01-01'),
  effectiveTo:   new Date('2025-03-31'),

  electricity: {
    unitRate:       24.50, // p/kWh
    standingCharge: 53.37, // p/day
  },
  gas: {
    unitRate:       6.24,  // p/kWh
    standingCharge: 29.60, // p/day
  },
};

// ── Historical caps (for reference / analytics) ────────────────
const CAP_HISTORY = [
  {
    quarter: 'Q4', year: 2024,
    electricity: { unitRate: 24.50, standingCharge: 53.37 },
    gas:         { unitRate: 6.24,  standingCharge: 29.60 },
  },
  {
    quarter: 'Q3', year: 2024,
    electricity: { unitRate: 22.36, standingCharge: 61.64 },
    gas:         { unitRate: 5.48,  standingCharge: 31.65 },
  },
  {
    quarter: 'Q2', year: 2024,
    electricity: { unitRate: 24.50, standingCharge: 61.64 },
    gas:         { unitRate: 6.04,  standingCharge: 31.65 },
  },
];

/**
 * Get current Ofgem price cap rates.
 */
const getCurrentCap = () => CURRENT_CAP;

/**
 * Update the current cap (called from admin endpoint or cron).
 * In production this should persist to DB.
 */
const updateCap = (newCap) => {
  Object.assign(CURRENT_CAP, newCap);
  console.log(`Ofgem cap updated to ${newCap.quarter} ${newCap.year}`);
};

/**
 * Non-Octopus suppliers we maintain manually.
 * Rates = slightly below Ofgem cap (realistic discounting).
 */
const NON_OCTOPUS_SUPPLIERS = [
  {
    supplier:       'British Gas',
    supplierRating: 3.5,
    tariffs: [
      {
        tariffName: 'Dual Tariff Fixed Oct 2025',
        tariffCode: 'BGD-FIX-OCT25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    false,
        discountFactor: { elec: 0.0, gas: 0.0 }, // at cap
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['Fixed rate until Oct 2026', 'No exit fees', 'Smart meter compatible'],
      },
      {
        tariffName: 'Green Future Fixed 2Y',
        tariffCode: 'BGD-GRN2Y-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    true,
        discountFactor: { elec: -0.02, gas: -0.02 }, // 2% below cap
        cashback:   50,
        exitFee:    30,
        contractLengthMonths: 24,
        features:   ['100% renewable electricity', '2-year price guarantee', '£50 cashback'],
      },
    ],
  },
  {
    supplier:       'EDF Energy',
    supplierRating: 3.8,
    tariffs: [
      {
        tariffName: 'Simply Fixed 12M',
        tariffCode: 'EDF-FIX12-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    false,
        discountFactor: { elec: -0.01, gas: -0.01 },
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['Price fixed for 12 months', 'No exit fees', 'Low-carbon generation'],
      },
      {
        tariffName: 'EDF Buyers Club 2Y',
        tariffCode: 'EDF-BC2Y-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    false,
        discountFactor: { elec: -0.06, gas: -0.05 },
        cashback:   75,
        exitFee:    25,
        contractLengthMonths: 24,
        features:   ['2-year price lock', '£75 joining reward', 'Boiler cover available'],
      },
    ],
  },
  {
    supplier:       'E.ON Next',
    supplierRating: 4.0,
    tariffs: [
      {
        tariffName: 'Next Online Exclusive',
        tariffCode: 'EON-ONL-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    true,
        discountFactor: { elec: -0.02, gas: -0.015 },
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['100% renewable electricity', 'Online exclusive rate', 'Free smart meter'],
      },
    ],
  },
  {
    supplier:       'Scottish Power',
    supplierRating: 3.6,
    tariffs: [
      {
        tariffName: 'Fixed Price Energy Oct 2025',
        tariffCode: 'SP-FIX-OCT25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    false,
        discountFactor: { elec: 0.0, gas: 0.0 },
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['Fixed until Oct 2026', 'No exit fees', '24/7 support'],
      },
    ],
  },
  {
    supplier:       'Ovo Energy',
    supplierRating: 3.9,
    tariffs: [
      {
        tariffName: 'Better Energy Fixed',
        tariffCode: 'OVO-BEF-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    true,
        discountFactor: { elec: -0.03, gas: -0.02 },
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['100% renewable electricity', '5 trees planted on sign-up', 'Carbon neutral gas'],
      },
    ],
  },
  {
    supplier:       'Shell Energy',
    supplierRating: 3.7,
    tariffs: [
      {
        tariffName: 'Shell Fixed Oct 2025',
        tariffCode: 'SHE-FIX-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    false,
        discountFactor: { elec: -0.01, gas: -0.01 },
        cashback:   0,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['Fixed rate security', 'Broadband bundle available'],
      },
    ],
  },
  {
    supplier:       'So Energy',
    supplierRating: 4.5,
    tariffs: [
      {
        tariffName: 'So Fixed 12M Green',
        tariffCode: 'SOE-GRN12-25',
        tariffType: 'fixed',
        fuelType:   'dual',
        isGreen:    true,
        discountFactor: { elec: -0.06, gas: -0.05 },
        cashback:   50,
        exitFee:    0,
        contractLengthMonths: 12,
        features:   ['100% renewable', '£50 cashback', 'No exit fees', 'Excellent Trustpilot'],
      },
    ],
  },
];

/**
 * Build Tariff documents for non-Octopus suppliers using current cap rates.
 * discountFactor applies a % adjustment to cap rates.
 *   0.0  = at cap
 *  -0.05 = 5% cheaper than cap
 */
const buildSupplierTariffs = (cap = CURRENT_CAP) => {
  const tariffs = [];

  for (const supplierDef of NON_OCTOPUS_SUPPLIERS) {
    for (const t of supplierDef.tariffs) {
      const elecFactor = 1 + t.discountFactor.elec;
      const gasFactor  = 1 + t.discountFactor.gas;

      tariffs.push({
        supplier:       supplierDef.supplier,
        supplierRating: supplierDef.supplierRating,
        tariffName:     t.tariffName,
        tariffCode:     t.tariffCode,
        fuelType:       t.fuelType,
        tariffType:     t.tariffType,
        region:         'national',
        electricity: {
          unitRate:       parseFloat((cap.electricity.unitRate * elecFactor).toFixed(2)),
          standingCharge: parseFloat((cap.electricity.standingCharge * elecFactor).toFixed(2)),
        },
        gas: {
          unitRate:       parseFloat((cap.gas.unitRate * gasFactor).toFixed(2)),
          standingCharge: parseFloat((cap.gas.standingCharge * gasFactor).toFixed(2)),
        },
        contractLengthMonths: t.contractLengthMonths,
        exitFee:        t.exitFee,
        isGreen:        t.isGreen,
        cashback:       t.cashback,
        features:       t.features,
        smartMeterRequired: false,
        source:         'ofgem_cap',
        lastUpdated:    new Date(),
        isActive:       true,
      });
    }
  }

  return tariffs;
};

/**
 * Sync non-Octopus supplier tariffs in DB using current cap.
 * Upsert by tariffCode — updates existing or creates new.
 */
const syncCapBasedTariffs = async () => {
  const tariffs = buildSupplierTariffs(CURRENT_CAP);
  let updated = 0, created = 0;

  for (const tariff of tariffs) {
    const result = await Tariff.findOneAndUpdate(
      { tariffCode: tariff.tariffCode },
      { ...tariff, lastUpdated: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (result.createdAt?.getTime() === result.updatedAt?.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`Cap-based sync: ${created} created, ${updated} updated`);
  return { created, updated, total: tariffs.length };
};

module.exports = {
  getCurrentCap,
  updateCap,
  buildSupplierTariffs,
  syncCapBasedTariffs,
  NON_OCTOPUS_SUPPLIERS,
  CAP_HISTORY,
};
