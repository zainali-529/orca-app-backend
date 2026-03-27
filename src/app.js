const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes         = require('./routes/auth.routes');
const profileRoutes      = require('./routes/profile.routes');
const tariffRoutes       = require('./routes/tariff.routes');
const quoteRoutes        = require('./routes/quote.routes');
const documentRoutes     = require('./routes/document.routes');
const adminRoutes        = require('./routes/admin.routes');
const switchRoutes       = require('./routes/switch.routes');
const webhookRoutes      = require('./routes/webhook.routes');
const consultationRoutes = require('./routes/consultation.routes');
const meterRoutes        = require('./routes/meter.routes');
const dashboardRoutes    = require('./routes/dashboard.routes');   // ← NEW
const notificationRoutes = require('./routes/notification.routes');  // ← ADD THIS

const { sendError } = require('./utils/response');

const app = express();

// ── Security middleware ────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ── Rate limiting ──────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

app.use(globalLimiter);
app.use('/api/webhooks', webhookRoutes);

// ── Body parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── Logger ─────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ── Health check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Energy Broker API is running',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',           authRoutes);
app.use('/api/profile',        profileRoutes);
app.use('/api/tariffs',        tariffRoutes);
app.use('/api/quotes',         quoteRoutes);
app.use('/api/documents',      documentRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/switches',       switchRoutes);
app.use('/api/consultations',  consultationRoutes);
app.use('/api/meter-readings', meterRoutes);
app.use('/api/dashboard',      dashboardRoutes);   // ← NEW
app.use('/api/notifications', notificationRoutes);                   // ← ADD THIS

// ── 404 handler ────────────────────────────────────────────────
app.use((req, res) => {
  sendError(res, 404, `Route ${req.originalUrl} not found`);
});

// ── Global error handler ───────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).reduce((acc, e) => {
      acc[e.path] = e.message;
      return acc;
    }, {});
    return sendError(res, 422, 'Validation failed', errors);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return sendError(res, 409, `${field} already exists`);
  }

  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 401, 'Invalid token');
  }

  return sendError(res, err.statusCode || 500, err.message || 'Internal server error');
});

module.exports = app;