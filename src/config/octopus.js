/**
 * Octopus Energy Public API Client
 *
 * Base URL : https://api.octopus.energy/v1/
 * Docs     : https://developer.octopus.energy/docs/api/
 *
 * No API key required for public product/tariff data.
 * API key is only needed to read meter readings / account data.
 */

const https = require('https');

const BASE_URL = 'https://api.octopus.energy/v1';
const TIMEOUT  = 10000; // 10s

// ── UK distribution regions → GSP codes ───────────────────────
// Octopus uses GSP (Grid Supply Point) codes per region
const REGION_GSP = {
  eastern:              '_A',
  east_midlands:        '_B',
  london:               '_C',
  merseyside_north_wales: '_D',
  midlands:             '_E',
  north_eastern:        '_F',
  north_western:        '_G',
  scotland_south:       '_H',
  scotland_north:       '_P',
  south_eastern:        '_J',
  southern:             '_K',
  south_western:        '_L',
  yorkshire:            '_M',
  national:             '_C', // London as default when no region specified
};

// ── HTTP helper ────────────────────────────────────────────────
const get = (url) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Octopus API returned ${res.statusCode} for ${url}`));
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Octopus response: ${e.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Octopus API request timed out'));
    });
    req.on('error', reject);
  });

// ── API methods ────────────────────────────────────────────────

/**
 * Fetch all active Octopus products (paginated).
 * Filters: is_variable, is_prepay, is_business, is_green, available_at
 */
const fetchProducts = async ({ pageSize = 100, isVariable, isGreen } = {}) => {
  let url = `${BASE_URL}/products/?page_size=${pageSize}`;
  if (isVariable !== undefined) url += `&is_variable=${isVariable}`;
  if (isGreen     !== undefined) url += `&is_green=${isGreen}`;

  const allProducts = [];
  let nextUrl = url;

  while (nextUrl) {
    const data = await get(nextUrl);
    if (!data?.results) break;
    allProducts.push(...data.results);
    nextUrl = data.next; // pagination
  }

  return allProducts;
};

/**
 * Fetch detailed info for a single product including tariff codes per region.
 */
const fetchProduct = async (productCode) => {
  return get(`${BASE_URL}/products/${productCode}/`);
};

/**
 * Fetch electricity unit rates for a tariff code in a region.
 * Returns array of { value_exc_vat, value_inc_vat, valid_from, valid_to }
 */
const fetchElecUnitRates = async (productCode, tariffCode) => {
  const url = `${BASE_URL}/products/${productCode}/electricity-tariffs/${tariffCode}/standard-unit-rates/?page_size=1`;
  const data = await get(url);
  return data?.results ?? [];
};

/**
 * Fetch electricity standing charges for a tariff.
 */
const fetchElecStandingCharges = async (productCode, tariffCode) => {
  const url = `${BASE_URL}/products/${productCode}/electricity-tariffs/${tariffCode}/standing-charges/?page_size=1`;
  const data = await get(url);
  return data?.results ?? [];
};

/**
 * Fetch gas unit rates for a tariff.
 */
const fetchGasUnitRates = async (productCode, tariffCode) => {
  const url = `${BASE_URL}/products/${productCode}/gas-tariffs/${tariffCode}/standard-unit-rates/?page_size=1`;
  const data = await get(url);
  return data?.results ?? [];
};

/**
 * Fetch gas standing charges for a tariff.
 */
const fetchGasStandingCharges = async (productCode, tariffCode) => {
  const url = `${BASE_URL}/products/${productCode}/gas-tariffs/${tariffCode}/standing-charges/?page_size=1`;
  const data = await get(url);
  return data?.results ?? [];
};

/**
 * Get the tariff code for a product in a given region.
 * Octopus product detail has:
 *   single_register_electricity_tariffs: { _A: { direct_debit_monthly: { code } } }
 *   dual_register_electricity_tariffs:   { ... }
 */
const getTariffCodeForRegion = (productDetail, fuelType, region = 'national') => {
  const gsp = REGION_GSP[region] ?? '_C';

  if (fuelType === 'electricity' || fuelType === 'dual') {
    const elecTariffs = productDetail.single_register_electricity_tariffs;
    const regionTariffs = elecTariffs?.[gsp];
    // Prefer direct_debit_monthly, fallback to prepayment
    return regionTariffs?.direct_debit_monthly?.code
      ?? regionTariffs?.prepayment?.code
      ?? null;
  }

  if (fuelType === 'gas') {
    const gasTariffs = productDetail.gas_tariffs;
    const regionTariffs = gasTariffs?.[gsp];
    return regionTariffs?.direct_debit_monthly?.code
      ?? regionTariffs?.prepayment?.code
      ?? null;
  }

  return null;
};

/**
 * Fetch current live rates for a product in a given region.
 * Returns { electricity: { unitRate, standingCharge }, gas: { unitRate, standingCharge } }
 */
const fetchLiveRates = async (productCode, region = 'national') => {
  const product = await fetchProduct(productCode);
  if (!product) return null;

  const result = { electricity: null, gas: null };

  // ── Electricity ──────────────────────────────────────────────
  const elecCode = getTariffCodeForRegion(product, 'electricity', region);
  if (elecCode) {
    const [unitRates, standingCharges] = await Promise.all([
      fetchElecUnitRates(productCode, elecCode),
      fetchElecStandingCharges(productCode, elecCode),
    ]);
    if (unitRates.length && standingCharges.length) {
      result.electricity = {
        unitRate:       unitRates[0].value_inc_vat,       // p/kWh incl. VAT
        standingCharge: standingCharges[0].value_inc_vat, // p/day incl. VAT
        tariffCode:     elecCode,
      };
    }
  }

  // ── Gas ──────────────────────────────────────────────────────
  const hasDualGas = product.gas_tariffs && Object.keys(product.gas_tariffs).length > 0;
  if (hasDualGas) {
    const gasCode = getTariffCodeForRegion(product, 'gas', region);
    if (gasCode) {
      const [unitRates, standingCharges] = await Promise.all([
        fetchGasUnitRates(productCode, gasCode),
        fetchGasStandingCharges(productCode, gasCode),
      ]);
      if (unitRates.length && standingCharges.length) {
        result.gas = {
          unitRate:       unitRates[0].value_inc_vat,
          standingCharge: standingCharges[0].value_inc_vat,
          tariffCode:     gasCode,
        };
      }
    }
  }

  return result;
};

/**
 * Parse Octopus product into our Tariff model shape.
 * product = response from /v1/products/{code}/
 */
const parseOctopusProduct = (product, liveRates) => {
  if (!liveRates) return null;

  const hasDual = liveRates.electricity && liveRates.gas;
  const fuelType = hasDual ? 'dual'
    : liveRates.electricity ? 'electricity'
    : liveRates.gas         ? 'gas'
    : null;

  if (!fuelType) return null;

  return {
    supplier:       'Octopus Energy',
    supplierRating: 4.8,
    tariffName:     product.display_name || product.full_name,
    tariffCode:     product.code,
    fuelType,
    tariffType:     product.is_variable ? 'variable' : 'fixed',
    region:         'national',
    electricity:    liveRates.electricity
      ? {
          unitRate:       parseFloat(liveRates.electricity.unitRate.toFixed(2)),
          standingCharge: parseFloat(liveRates.electricity.standingCharge.toFixed(2)),
        }
      : { unitRate: null, standingCharge: null },
    gas: liveRates.gas
      ? {
          unitRate:       parseFloat(liveRates.gas.unitRate.toFixed(2)),
          standingCharge: parseFloat(liveRates.gas.standingCharge.toFixed(2)),
        }
      : { unitRate: null, standingCharge: null },
    contractLengthMonths: 12,
    exitFee:        0,
    isGreen:        product.is_green ?? false,
    onlineDiscount: false,
    cashback:       0,
    features:       product.description
      ? [product.description.substring(0, 100)]
      : [],
    smartMeterRequired: product.code?.includes('AGILE') || product.code?.includes('GO'),
    source:         'octopus',
    lastUpdated:    new Date(),
    isActive:       true,
  };
};

module.exports = {
  fetchProducts,
  fetchProduct,
  fetchLiveRates,
  parseOctopusProduct,
  REGION_GSP,
};
