/**
 * Tariff Sync Job
 *
 * Runs on startup + every 24 hours via node-cron.
 * Install: npm install node-cron
 *
 * Strategy:
 *   1. Fetch live Octopus tariffs from their public API
 *   2. Update Ofgem-cap-based tariffs for all other suppliers
 *   3. Mark stale tariffs inactive
 *
 * Manual trigger: POST /api/tariffs/sync (admin only)
 */

const Tariff            = require('../models/Tariff');
const octopusClient     = require('../config/octopus');
const { syncCapBasedTariffs } = require('../config/ofgem');
const cache             = require('../config/redis');

// ── Octopus product codes we actively track ────────────────────
// Add more here as Octopus releases new products.
const OCTOPUS_PRODUCTS_TO_TRACK = [
  { code: 'AGILE-FLEX-22-11-25',  name: 'Agile Octopus'         },
  { code: 'VAR-22-11-01',         name: 'Flexible Octopus'      },
  { code: 'GO-VAR-22-10-14',      name: 'Octopus Go (EV)'       },
  { code: 'OUTGOING-FIX-12M-19-05-13', name: 'Octopus Export'  },
];

// Fallback product list if specific codes change — search by keyword
const OCTOPUS_SEARCH_TERMS = ['Agile', 'Flexible', 'Fixed', 'Go', 'Cosy'];

let isSyncing = false;

// ── Sync Octopus tariffs ───────────────────────────────────────
const syncOctopusTariffs = async () => {
  const results = { created: 0, updated: 0, failed: 0, skipped: 0 };

  let octopusProducts = [];

  try {
    // Try fetching all current Octopus products
    const allProducts = await octopusClient.fetchProducts({ pageSize: 50 });

    // Filter to household (non-business) products with available tariff codes
    octopusProducts = allProducts.filter(p =>
      !p.is_business &&
      !p.is_prepay   &&
      p.available_to === null // currently available (null = no end date)
    );

    if (octopusProducts.length === 0) {
      console.warn('Octopus API returned 0 products — using tracked list fallback');
      // Fallback: use manually tracked product codes
      octopusProducts = OCTOPUS_PRODUCTS_TO_TRACK.map(p => ({
        code:         p.code,
        display_name: p.name,
        is_variable:  false,
        is_green:     true,
      }));
    }
  } catch (err) {
    console.error('Failed to fetch Octopus product list:', err.message);
    console.log('Falling back to tracked product list...');
    octopusProducts = OCTOPUS_PRODUCTS_TO_TRACK.map(p => ({
      code:         p.code,
      display_name: p.name,
      is_variable:  false,
      is_green:     true,
    }));
  }

  // Fetch live rates for each product
  for (const product of octopusProducts.slice(0, 20)) { // cap at 20 to avoid rate limiting
    try {
      const liveRates = await octopusClient.fetchLiveRates(product.code, 'national');

      if (!liveRates?.electricity && !liveRates?.gas) {
        results.skipped++;
        continue;
      }

      const tariffData = octopusClient.parseOctopusProduct(product, liveRates);
      if (!tariffData) { results.skipped++; continue; }

      const res = await Tariff.findOneAndUpdate(
        { tariffCode: product.code, source: 'octopus' },
        { ...tariffData, lastUpdated: new Date() },
        { upsert: true, new: true, runValidators: true }
      );

      if (res.createdAt?.getTime() === res.updatedAt?.getTime()) {
        results.created++;
      } else {
        results.updated++;
      }

      // Small delay to be polite to Octopus API
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      console.error(`Failed to sync Octopus product ${product.code}:`, err.message);
      results.failed++;
    }
  }

  return results;
};

// ── Mark stale tariffs ─────────────────────────────────────────
const markStaleTariffs = async () => {
  const staleDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

  const result = await Tariff.updateMany(
    {
      source:      'octopus',
      lastUpdated: { $lt: staleDate },
      isActive:    true,
    },
    { isActive: false }
  );

  return result.modifiedCount;
};

// ── Clear tariff cache ────────────────────────────────────────
const clearTariffCache = async () => {
  await cache.del('tariffs:*');
  await cache.del('tariffs:suppliers');
};

// ── Main sync function ─────────────────────────────────────────
const runSync = async ({ source = 'all', adminId = null } = {}) => {
  if (isSyncing) {
    return { success: false, message: 'Sync already in progress' };
  }

  isSyncing = true;
  const startedAt = new Date();

  console.log(`\n[TariffSync] Starting sync — source: ${source} at ${startedAt.toISOString()}`);

  const summary = {
    startedAt,
    source,
    triggeredBy: adminId ? 'manual' : 'scheduled',
    octopus:     null,
    ofgem:       null,
    staleMarked: 0,
    errors:      [],
    duration:    null,
  };

  try {
    // 1. Sync Octopus live tariffs
    if (source === 'all' || source === 'octopus') {
      console.log('[TariffSync] Syncing Octopus live tariffs...');
      try {
        summary.octopus = await syncOctopusTariffs();
        console.log(`[TariffSync] Octopus: created=${summary.octopus.created} updated=${summary.octopus.updated} failed=${summary.octopus.failed}`);
      } catch (err) {
        const msg = `Octopus sync failed: ${err.message}`;
        console.error('[TariffSync]', msg);
        summary.errors.push(msg);
      }
    }

    // 2. Sync Ofgem cap-based tariffs for other suppliers
    if (source === 'all' || source === 'ofgem') {
      console.log('[TariffSync] Updating Ofgem cap-based tariffs...');
      try {
        summary.ofgem = await syncCapBasedTariffs();
        console.log(`[TariffSync] Ofgem: created=${summary.ofgem.created} updated=${summary.ofgem.updated}`);
      } catch (err) {
        const msg = `Ofgem sync failed: ${err.message}`;
        console.error('[TariffSync]', msg);
        summary.errors.push(msg);
      }
    }

    // 3. Mark old Octopus tariffs inactive
    summary.staleMarked = await markStaleTariffs();
    if (summary.staleMarked > 0) {
      console.log(`[TariffSync] Marked ${summary.staleMarked} stale tariffs inactive`);
    }

    // 4. Clear Redis cache so fresh data is served
    await clearTariffCache();
    console.log('[TariffSync] Cache cleared');

  } catch (err) {
    console.error('[TariffSync] Fatal error:', err.message);
    summary.errors.push(`Fatal: ${err.message}`);
  } finally {
    isSyncing = false;
    const duration = Date.now() - startedAt.getTime();
    summary.duration = `${(duration / 1000).toFixed(1)}s`;
    summary.completedAt = new Date();
    console.log(`[TariffSync] Completed in ${summary.duration}\n`);
  }

  return { success: summary.errors.length === 0, summary };
};

// ── Schedule using node-cron ────────────────────────────────────
const startScheduler = () => {
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('[TariffSync] node-cron not installed — auto-sync disabled');
    console.warn('Run: npm install node-cron');
    return;
  }

  // Every day at 4 AM
  cron.schedule('0 4 * * *', async () => {
    console.log('[TariffSync] Scheduled daily sync starting...');
    await runSync({ source: 'all' });
  });

  // Every 6 hours — sync Octopus only (rates can change frequently)
  cron.schedule('0 */6 * * *', async () => {
    console.log('[TariffSync] Scheduled 6-hourly Octopus sync...');
    await runSync({ source: 'octopus' });
  });

  console.log('[TariffSync] Scheduler started — daily at 4AM, Octopus every 6h');
};

module.exports = { runSync, startScheduler, isSyncing: () => isSyncing };
