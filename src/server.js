require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Connect to MongoDB first
  await connectDB();

  // Connect to Redis (optional — graceful if not configured)
  const cache = require('./config/redis');
  await cache.connect();

  // Start tariff sync scheduler + run initial sync
  const tariffSync = require('./jobs/tariff.sync');
  tariffSync.startScheduler();

  // Run initial sync on startup (background — don't block server start)
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => {
      console.log('[Startup] Running initial tariff sync...');
      tariffSync.runSync({ source: 'all' })
        .catch(err => console.error('[Startup] Initial sync error:', err.message));
    }, 3000); // 3s delay after server starts
  }

  const server = app.listen(PORT, () => {
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Energy Broker API
  Port     : ${PORT}
  Env      : ${process.env.NODE_ENV || 'development'}
  Health   : http://localhost:${PORT}/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err.message);
    server.close(() => process.exit(1));
  });
};

startServer();
