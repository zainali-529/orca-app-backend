/**
 * Admin Service
 *
 * Handles admin-side management of:
 *  - Clients (users with role='client')
 *  - Quote requests
 *  - Dashboard stats
 */

const User        = require('../models/User');
const UserProfile = require('../models/UserProfile');
const Quote       = require('../models/Quote');
const Document    = require('../models/Document');
const Switch      = require('../models/Switch');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS

// ─────────────────────────────────────────────────────────────
// CLIENT MANAGEMENT
// ─────────────────────────────────────────────────────────────

/**
 * List all clients (role='client').
 */
const listClients = async (query) => {
  const {
    search, isActive, isVerified,
    page = 1, limit = 20,
    sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = { role: 'client' };
  if (isActive   !== undefined) filter.isActive   = isActive   === 'true';
  if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
  if (search) {
    filter.$or = [
      { firstName: new RegExp(search, 'i') },
      { lastName:  new RegExp(search, 'i') },
      { email:     new RegExp(search, 'i') },
    ];
  }

  const skip    = (page - 1) * limit;
  const sortDir = order === 'asc' ? 1 : -1;
  const total   = await User.countDocuments(filter);

  const users = await User
    .find(filter)
    .sort({ [sortBy]: sortDir })
    .skip(skip)
    .limit(limit)
    .lean();

  return { clients: users, pagination: { total, page, limit,
    totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
};

/**
 * Get single client with full profile + stats.
 */
const getClientById = async (clientId) => {
  const [user, profile, quoteCount, docCount] = await Promise.all([
    User.findOne({ _id: clientId, role: 'client' }).lean(),
    UserProfile.findOne({ user: clientId }).lean(),
    Quote.countDocuments({ client: clientId }),
    Document.countDocuments({ client: clientId }),
  ]);

  if (!user) return null;

  return { user, profile, stats: { quotes: quoteCount, documents: docCount } };
};

/**
 * Update client account (deactivate, verify, etc.)
 */
const updateClient = async (clientId, updates) => {
  const allowed = ['isActive', 'isVerified', 'phone'];
  const safeUpdates = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) safeUpdates[key] = updates[key];
  }

  const user = await User.findOneAndUpdate(
    { _id: clientId, role: 'client' },
    safeUpdates,
    { new: true, runValidators: true }
  );

  // When admin deactivates a user:
  if (user && updates.isActive === false) {
    notifyTrigger.onAccountDeactivated(user);  // ← ADD THIS
  }

  return user;
};

// ─────────────────────────────────────────────────────────────
// QUOTE MANAGEMENT
// ─────────────────────────────────────────────────────────────

/**
 * List all quote requests.
 */
const listQuotes = async (query) => {
  const {
    status, clientId,
    page = 1, limit = 20,
    sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = {};
  if (status)   filter.status = status;
  if (clientId) filter.client = clientId;

  const skip    = (page - 1) * limit;
  const sortDir = order === 'asc' ? 1 : -1;
  const total   = await Quote.countDocuments(filter);

  const quotes = await Quote
    .find(filter)
    .populate('client', 'firstName lastName email phone')
    .sort({ [sortBy]: sortDir })
    .skip(skip)
    .limit(limit)
    .lean({ virtuals: true });

  return { quotes, pagination: { total, page, limit,
    totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
};

/**
 * Get single quote with full details.
 */
const getQuoteById = async (quoteId) => {
  return Quote
    .findById(quoteId)
    .populate('client', 'firstName lastName email phone')
    .lean({ virtuals: true });
};

/**
 * Update quote status + admin notes.
 * Status transitions: pending → contacted → completed | cancelled
 */
const updateQuote = async (quoteId, updates) => {
  const quote = await Quote.findById(quoteId);
  if (!quote) return null;

  const { status, adminNotes } = updates;

  if (adminNotes !== undefined) quote.adminNotes = adminNotes;

  if (status && status !== quote.status) {
    notifyTrigger.onQuoteStatusChanged(quote, status);  // ← ADD THIS
    const allowed = {
      pending:   ['contacted', 'cancelled'],
      contacted: ['completed', 'cancelled', 'pending'],
      completed: [],
      cancelled: ['pending'],
    };
    if (!(allowed[quote.status] ?? []).includes(status)) {
      const e = new Error(`Cannot transition from '${quote.status}' to '${status}'`);
      e.statusCode = 400;
      throw e;
    }
    quote.status = status;
    if (status === 'contacted') quote.contactedAt = new Date();
    if (status === 'completed') quote.completedAt = new Date();
    if (status === 'cancelled') quote.cancelledAt = new Date();
  }

  await quote.save();
  return quote;
};

/**
 * Quote summary stats for admin dashboard.
 */
const getQuoteStats = async () => {
  const stats = await Quote.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const result = { pending: 0, contacted: 0, completed: 0, cancelled: 0, total: 0 };
  for (const s of stats) { result[s._id] = s.count; result.total += s.count; }
  return result;
};

// ─────────────────────────────────────────────────────────────
// ADMIN DASHBOARD STATS
// ─────────────────────────────────────────────────────────────

const getDashboardStats = async () => {
  const [
    totalClients, activeClients,
    quoteStats, docStats, switchStats,
    recentQuotes, recentDocs, activeSwitches,
  ] = await Promise.all([
    User.countDocuments({ role: 'client' }),
    User.countDocuments({ role: 'client', isActive: true }),
    getQuoteStats(),
    (async () => {
      const ds = await Document.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      const r = { pending_signature: 0, signed: 0, expired: 0, total: 0 };
      for (const s of ds) { r[s._id] = s.count; r.total += s.count; }
      return r;
    })(),
    // Switch stats for dashboard
    (async () => {
      const ss = await Switch.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      const r = {
        requested: 0, submitted_to_supplier: 0, cooling_off: 0,
        objected: 0, in_progress: 0, pending_completion: 0,
        completed: 0, cancelled: 0, failed: 0,
        total: 0, active: 0,
      };
      for (const s of ss) {
        r[s._id]  = s.count;
        r.total  += s.count;
        if (!['completed', 'cancelled', 'failed'].includes(s._id)) r.active += s.count;
      }
      return r;
    })(),
    Quote.find().sort({ createdAt: -1 }).limit(5)
      .populate('client', 'firstName lastName email')
      .lean({ virtuals: true }),
    Document.find({ status: 'pending_signature' }).sort({ createdAt: -1 }).limit(5)
      .populate('client', 'firstName lastName email')
      .lean({ virtuals: true }),
    // Active switches needing attention
    Switch.find({ status: { $nin: ['completed', 'cancelled', 'failed'] } })
      .sort({ updatedAt: -1 }).limit(5)
      .populate('client', 'firstName lastName email')
      .select('-adminNotes -timeline')
      .lean({ virtuals: true }),
  ]);

  return {
    clients:       { total: totalClients, active: activeClients },
    quotes:        quoteStats,
    documents:     docStats,
    switches:      switchStats,
    recentQuotes,
    pendingDocs:   recentDocs,
    activeSwitches,
  };
};

module.exports = {
  listClients, getClientById, updateClient,
  listQuotes, getQuoteById, updateQuote, getQuoteStats,
  getDashboardStats,
};