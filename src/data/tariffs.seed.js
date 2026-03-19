/**
 * UK Energy Tariff Seed Data
 *
 * Rates based on Ofgem price cap Q1 2025 and publicly available supplier data.
 * Electricity: cap ~24.5p/kWh, standing charge ~53p/day
 * Gas:         cap ~6.24p/kWh, standing charge ~29p/day
 *
 * Run: node src/data/tariffs.seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Tariff   = require('../models/Tariff');

const TARIFFS = [

  // ─────────────────────────────────────────────
  // BRITISH GAS
  // ─────────────────────────────────────────────
  {
    supplier:       'British Gas',
    supplierRating: 3.5,
    tariffName:     'Dual Tariff October 2025 v1',
    tariffCode:     'BGD-OCT25-V1',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 24.50, standingCharge: 53.37 },
    gas:            { unitRate: 6.24,  standingCharge: 29.60 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        false,
    onlineDiscount: true,
    cashback:       0,
    features:       ['Fixed rate until Oct 2026', 'No exit fees', 'Smart meter compatible', 'Online account management'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'British Gas',
    supplierRating: 3.5,
    tariffName:     'Green Future Fixed',
    tariffCode:     'BGD-GRN25-V2',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 23.80, standingCharge: 55.00 },
    gas:            { unitRate: 6.10,  standingCharge: 30.20 },
    contractLengthMonths: 24,
    exitFee:        30,
    isGreen:        true,
    onlineDiscount: true,
    cashback:       50,
    features:       ['100% renewable electricity', '2-year price guarantee', '£50 sign-up cashback', 'Carbon offset gas'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // OCTOPUS ENERGY
  // ─────────────────────────────────────────────
  {
    supplier:       'Octopus Energy',
    supplierRating: 4.8,
    tariffName:     'Flexible Octopus',
    tariffCode:     'OE-FLEX-2025',
    fuelType:       'dual',
    tariffType:     'variable',
    region:         'national',
    electricity:    { unitRate: 24.50, standingCharge: 53.37 },
    gas:            { unitRate: 6.24,  standingCharge: 29.60 },
    contractLengthMonths: 0, // no contract
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       0,
    features:       ['No contract — leave any time', '100% renewable electricity', 'Tracks Ofgem price cap', 'Award-winning customer service'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'Octopus Energy',
    supplierRating: 4.8,
    tariffName:     'Agile Octopus',
    tariffCode:     'OE-AGILE-2025',
    fuelType:       'electricity',
    tariffType:     'flexible',
    region:         'national',
    electricity:    { unitRate: 22.00, standingCharge: 45.00 },
    gas:            { unitRate: null,   standingCharge: null },
    contractLengthMonths: 0,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       0,
    features:       ['Half-hourly pricing', 'Cheap rates at off-peak times', 'Plunge pricing possible', 'Smart meter required', 'Great for EV owners'],
    smartMeterRequired: true,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'Octopus Energy',
    supplierRating: 4.8,
    tariffName:     'Octopus 12M Fixed',
    tariffCode:     'OE-FIX12-2025',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 23.50, standingCharge: 50.00 },
    gas:            { unitRate: 5.99,  standingCharge: 28.00 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       50,
    features:       ['100% green electricity', 'No exit fees', '£50 refer-a-friend bonus', 'Fixed for 12 months'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // EDF ENERGY
  // ─────────────────────────────────────────────
  {
    supplier:       'EDF Energy',
    supplierRating: 3.8,
    tariffName:     'Simply Fixed 12 Months',
    tariffCode:     'EDF-FIX12-OCT25',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 24.20, standingCharge: 52.00 },
    gas:            { unitRate: 6.20,  standingCharge: 28.50 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        false,
    onlineDiscount: true,
    cashback:       0,
    features:       ['Price fixed for 12 months', 'No exit fees', 'Online account management', 'British electricity generation'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'EDF Energy',
    supplierRating: 3.8,
    tariffName:     'EDF Buyers Club 2Y',
    tariffCode:     'EDF-BC2Y-2025',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 23.00, standingCharge: 54.00 },
    gas:            { unitRate: 5.90,  standingCharge: 30.00 },
    contractLengthMonths: 24,
    exitFee:        25,
    isGreen:        false,
    onlineDiscount: true,
    cashback:       75,
    features:       ['2-year price lock', '£75 joining reward', 'EDF is a low-carbon generator', 'Boiler cover available'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // E.ON NEXT
  // ─────────────────────────────────────────────
  {
    supplier:       'E.ON Next',
    supplierRating: 4.0,
    tariffName:     'Next Online Exclusive v2',
    tariffCode:     'EON-ONL-V2-25',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 23.90, standingCharge: 51.00 },
    gas:            { unitRate: 6.15,  standingCharge: 27.50 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: true,
    cashback:       0,
    features:       ['Online exclusive rate', '100% renewable electricity', 'Free smart meter install', 'No exit fees'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'E.ON Next',
    supplierRating: 4.0,
    tariffName:     'Next Drive (EV tariff)',
    tariffCode:     'EON-EV-DRV-25',
    fuelType:       'electricity',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 20.00, standingCharge: 53.37 },
    gas:            { unitRate: null,   standingCharge: null },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       0,
    features:       ['Low overnight rate for EV charging', '7-hour off-peak window', 'Smart meter required', 'App charging scheduler'],
    smartMeterRequired: true,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // SCOTTISH POWER
  // ─────────────────────────────────────────────
  {
    supplier:       'Scottish Power',
    supplierRating: 3.6,
    tariffName:     'Fixed Price Energy Oct 2025',
    tariffCode:     'SP-FIX-OCT25',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 24.40, standingCharge: 53.00 },
    gas:            { unitRate: 6.30,  standingCharge: 29.00 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        false,
    onlineDiscount: true,
    cashback:       0,
    features:       ['Fixed until Oct 2026', 'Online account & app', 'No exit fees', '24/7 customer support'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // OVO ENERGY
  // ─────────────────────────────────────────────
  {
    supplier:       'Ovo Energy',
    supplierRating: 3.9,
    tariffName:     'Better Energy Fixed',
    tariffCode:     'OVO-BEF-2025',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 23.70, standingCharge: 52.50 },
    gas:            { unitRate: 6.05,  standingCharge: 28.80 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       0,
    features:       ['100% renewable electricity', '5 trees planted on sign-up', 'Carbon neutral gas', 'No exit fees'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
  {
    supplier:       'Ovo Energy',
    supplierRating: 3.9,
    tariffName:     'Drive Anytime (EV)',
    tariffCode:     'OVO-EV-ANY-25',
    fuelType:       'electricity',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 34.00, standingCharge: 35.00 },
    gas:            { unitRate: null,   standingCharge: null },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       0,
    features:       ['Unlimited cheap EV charging', '£4/month flat EV charge fee', 'Off-peak rate 7p/kWh (midnight-6am)', 'Smart meter required'],
    smartMeterRequired: true,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // SHELL ENERGY
  // ─────────────────────────────────────────────
  {
    supplier:       'Shell Energy',
    supplierRating: 3.7,
    tariffName:     'Shell Fixed Oct 2025',
    tariffCode:     'SHE-FIX-OCT25',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 24.10, standingCharge: 52.00 },
    gas:            { unitRate: 6.18,  standingCharge: 29.40 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        false,
    onlineDiscount: true,
    cashback:       0,
    features:       ['Fixed rate security', 'Shell Energy broadband bundle available', 'Smart meter compatible', 'Online management'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // UTILITY WAREHOUSE
  // ─────────────────────────────────────────────
  {
    supplier:       'Utility Warehouse',
    supplierRating: 4.2,
    tariffName:     'UW Multi-Service Bundle',
    tariffCode:     'UW-MSB-2025',
    fuelType:       'dual',
    tariffType:     'variable',
    region:         'national',
    electricity:    { unitRate: 24.50, standingCharge: 53.37 },
    gas:            { unitRate: 6.24,  standingCharge: 29.60 },
    contractLengthMonths: 0,
    exitFee:        0,
    isGreen:        false,
    onlineDiscount: false,
    cashback:       0,
    features:       ['Discount when bundling broadband & mobile', 'Single monthly bill', 'No exit fees', 'Cashback rewards'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },

  // ─────────────────────────────────────────────
  // SO ENERGY
  // ─────────────────────────────────────────────
  {
    supplier:       'So Energy',
    supplierRating: 4.5,
    tariffName:     'So Fixed 12M Green',
    tariffCode:     'SOE-GRN12-25',
    fuelType:       'dual',
    tariffType:     'fixed',
    region:         'national',
    electricity:    { unitRate: 22.90, standingCharge: 50.50 },
    gas:            { unitRate: 5.95,  standingCharge: 27.00 },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        true,
    onlineDiscount: false,
    cashback:       50,
    features:       ['100% renewable electricity', 'Competitive rates', '£50 cashback', 'No exit fees', 'Excellent Trustpilot rating'],
    smartMeterRequired: false,
    source:         'seed',
    isActive:       true,
  },
];

// ── Seed function ──────────────────────────────────────────────
const seedTariffs = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const Tariff = require('../models/Tariff');

    // Clear existing seed data
    const deleted = await Tariff.deleteMany({ source: 'seed' });
    console.log(`Cleared ${deleted.deletedCount} existing seed tariffs`);

    // Insert fresh seed data
    const inserted = await Tariff.insertMany(TARIFFS);
    console.log(`✅ Seeded ${inserted.length} tariffs`);

    // Summary
    const suppliers = [...new Set(TARIFFS.map(t => t.supplier))];
    console.log(`Suppliers: ${suppliers.join(', ')}`);

  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Only run directly
if (require.main === module) {
  seedTariffs();
}

module.exports = { TARIFFS };
