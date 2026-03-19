/**
 * Redis client — graceful no-op if REDIS_URL not set or connection fails.
 * Uses ioredis with require() — no dynamic import.
 * Install: npm install ioredis
 */

let client        = null;
let isConnected   = false;
let connectCalled = false;

const connect = async () => {
  if (connectCalled) return client;
  connectCalled = true;

  if (!process.env.REDIS_URL) {
    console.warn('⚠  REDIS_URL not set — caching disabled');
    return null;
  }

  try {
    const Redis = require('ioredis');

    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout:       5000,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying after 3 attempts
        return Math.min(times * 500, 2000);
      },
      lazyConnect:      false,
      enableReadyCheck: true,
      reconnectOnError: () => false,
    });

    // Remove all listeners first to prevent duplicates on hot-reload
    client.removeAllListeners();

    client.on('ready',  () => { isConnected = true;  console.log('Redis connected'); });
    client.on('error',  (e) => { isConnected = false; console.warn('Redis error:', e.message); });
    client.on('close',  () => { isConnected = false; });
    client.on('end',    () => { isConnected = false; });

    // Wait for ready or timeout
    await Promise.race([
      new Promise((resolve) => client.once('ready', resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout')), 5000)
      ),
    ]);

    return client;

  } catch (err) {
    console.warn('Redis init failed — running without cache:', err.message);
    client      = null;
    isConnected = false;
    return null;
  }
};

// ── Cache helpers ──────────────────────────────────────────────

/**
 * Get a cached value. Returns null on any error.
 */
const get = async (key) => {
  if (!client || !isConnected) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
};

/**
 * Set a cached value with TTL (seconds).
 */
const set = async (key, value, ttlSeconds = 1800) => {
  if (!client || !isConnected) return;
  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // silent — caching is optional
  }
};

/**
 * Delete a cached key or pattern.
 */
const del = async (keyOrPattern) => {
  if (!client || !isConnected) return;
  try {
    if (keyOrPattern.includes('*')) {
      const keys = await client.keys(keyOrPattern);
      if (keys.length) await client.del(...keys);
    } else {
      await client.del(keyOrPattern);
    }
  } catch {
    // silent
  }
};

module.exports = { connect, get, set, del };