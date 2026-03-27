/**
 * Switch Service
 *
 * Client methods:  getMySwitches, getSwitchById, getSwitchSummary,
 *                  requestSwitch, cancelSwitch, addClientMessage
 *
 * Admin methods:   adminCreateSwitch, adminListSwitches, adminGetSwitch,
 *                  adminUpdateSwitch, adminUpdateStatus, adminAddTimelineEvent,
 *                  adminGetStats
 */

const Switch      = require('../models/Switch');
const Quote       = require('../models/Quote');
const Document    = require('../models/Document');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS

// ── Status transition rules ────────────────────────────────────────
// Defines which transitions are valid from each status
const VALID_TRANSITIONS = {
  requested:             ['submitted_to_supplier', 'cancelled'],
  submitted_to_supplier: ['cooling_off', 'objected', 'failed', 'cancelled'],
  cooling_off:           ['in_progress', 'objected', 'cancelled'],
  objected:              ['objection_resolved', 'cancelled', 'failed'],
  objection_resolved:    ['in_progress', 'cancelled'],
  in_progress:           ['pending_completion', 'objected', 'cancelled', 'failed'],
  pending_completion:    ['completed', 'failed', 'cancelled'],
  completed:             [], // terminal
  cancelled:             ['requested'], // can re-open
  failed:                ['requested'], // can re-try
};

// Status labels for timeline events
const STATUS_LABELS = {
  requested:             'Switch Requested',
  submitted_to_supplier: 'Submitted to Supplier',
  cooling_off:           'Cooling Off Period Started',
  objected:              'Objection Raised',
  objection_resolved:    'Objection Resolved',
  in_progress:           'Switch In Progress',
  pending_completion:    'Pending Final Completion',
  completed:             'Switch Completed',
  cancelled:             'Switch Cancelled',
  failed:                'Switch Failed',
};

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

const populateSwitch = (query) =>
  query
    .populate('client',        'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email')
    .populate('quote',         'quoteNumber status')
    .populate('document',      'docNumber status title')
    .populate('tariff',        'supplierName planName unitRate');

const addTimelineEntry = (sw, { actor = 'admin', actorRef = null, type, title, message = null,
  fromStatus = null, toStatus = null, visibleToClient = true }) => {
  sw.timeline.push({ actor, actorRef, type, title, message, fromStatus, toStatus, visibleToClient });
};

// ─────────────────────────────────────────────────────────────────
// CLIENT SERVICE METHODS
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/switches/summary
 * Count by status for the dashboard badges.
 */
const getSwitchSummary = async (clientId) => {
  const results = await Switch.aggregate([
    { $match: { client: clientId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = {
    requested: 0, submitted_to_supplier: 0, cooling_off: 0,
    objected: 0, objection_resolved: 0, in_progress: 0,
    pending_completion: 0, completed: 0, cancelled: 0, failed: 0,
    total: 0, active: 0,
  };

  for (const r of results) {
    summary[r._id] = r.count;
    summary.total += r.count;
    if (!['completed', 'cancelled', 'failed'].includes(r._id)) {
      summary.active += r.count;
    }
  }

  return summary;
};

/**
 * GET /api/switches
 * Client sees their own switches with client-only timeline.
 */
const getMySwitches = async (clientId, query) => {
  const { status, fuelType, page = 1, limit = 20 } = query;

  const filter = { client: clientId };
  if (status)   filter.status   = status;
  if (fuelType) filter.fuelType = fuelType;

  const skip  = (page - 1) * limit;
  const total = await Switch.countDocuments(filter);

  const switches = await populateSwitch(
    Switch.find(filter)
      .select('-adminNotes -timeline') // timeline returned separately (client-filtered)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
  ).lean({ virtuals: true });

  return {
    switches,
    pagination: { total, page, limit,
      totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
  };
};

/**
 * GET /api/switches/:id
 * Full switch detail — returns only client-visible timeline events.
 */
const getSwitchById = async (clientId, switchId) => {
  const sw = await populateSwitch(
    Switch.findOne({ _id: switchId, client: clientId })
      .select('-adminNotes')
  ).lean({ virtuals: true });

  if (!sw) return null;

  // Filter timeline to client-visible events only
  sw.timeline = (sw.timeline ?? []).filter((e) => e.visibleToClient);
  return sw;
};

/**
 * POST /api/switches
 * Client can request a switch (optional — admin usually initiates).
 * Links to an existing quote.
 */
const requestSwitch = async (clientId, data) => {
  const { quoteId, documentId, fuelType, currentSupplier, newSupplier,
    estimatedSwitchDate, clientMessage } = data;

  const sw = new Switch({
    client:          clientId,
    quote:           quoteId      ?? null,
    document:        documentId   ?? null,
    fuelType:        fuelType     ?? 'electricity',
    currentSupplier,
    newSupplier,
    initiatedBy:     'client',
    estimatedSwitchDate: estimatedSwitchDate ?? null,
    clientMessage:   clientMessage ?? null,
  });

  addTimelineEntry(sw, {
    actor:          'client',
    actorRef:       clientId,
    type:           'status_change',
    title:          'Switch Requested',
    message:        `Request to switch from ${currentSupplier} to ${newSupplier}.`,
    fromStatus:     null,
    toStatus:       'requested',
    visibleToClient: true,
  });

  await sw.save();

  notifyTrigger.onSwitchInitiated(sw);  // ← ADD THIS

  return sw;
};

/**
 * POST /api/switches/:id/cancel
 * Client can cancel during cooling-off or from requested status.
 */
const cancelSwitch = async (clientId, switchId, reason) => {
  const sw = await Switch.findOne({ _id: switchId, client: clientId });

  if (!sw) { const e = new Error('Switch not found'); e.statusCode = 404; throw e; }

  const cancellableStatuses = ['requested', 'submitted_to_supplier', 'cooling_off'];
  if (!cancellableStatuses.includes(sw.status)) {
    const e = new Error(`Cannot cancel a switch that is '${sw.status}'. Contact your broker.`);
    e.statusCode = 400; throw e;
  }

  const prev = sw.status;
  sw.status             = 'cancelled';
  sw.cancelledAt        = new Date();
  sw.cancellationReason = reason ?? null;

  addTimelineEntry(sw, {
    actor: 'client', actorRef: clientId, type: 'status_change',
    title: 'Switch Cancelled by Client',
    message: reason ?? null,
    fromStatus: prev, toStatus: 'cancelled',
    visibleToClient: true,
  });

  await sw.save();
  return sw;
};

/**
 * POST /api/switches/:id/message
 * Client leaves a message/question for the broker.
 */
const addClientMessage = async (clientId, switchId, message) => {
  const sw = await Switch.findOne({ _id: switchId, client: clientId });
  if (!sw) { const e = new Error('Switch not found'); e.statusCode = 404; throw e; }
  if (!sw.isActive && sw.status !== 'completed') {
    const e = new Error('Cannot message on a cancelled or failed switch'); e.statusCode = 400; throw e;
  }

  sw.clientMessage = message;
  addTimelineEntry(sw, {
    actor: 'client', actorRef: clientId, type: 'client_message',
    title: 'Message from Client',
    message,
    visibleToClient: true,
  });

  await sw.save();
  return sw;
};

// ─────────────────────────────────────────────────────────────────
// ADMIN SERVICE METHODS
// ─────────────────────────────────────────────────────────────────

/**
 * Admin: Create / initiate a switch for a client.
 * This is the primary way switches are created.
 */
const adminCreateSwitch = async (adminId, data) => {
  const {
    clientId, quoteId, documentId, tariffId,
    fuelType, currentSupplier, newSupplier,
    estimatedSwitchDate, adminNotes, clientMessage,
    meterDetails, contractDetails,
  } = data;

  const sw = new Switch({
    client:          clientId,
    assignedAdmin:   adminId,
    quote:           quoteId       ?? null,
    document:        documentId    ?? null,
    tariff:          tariffId      ?? null,
    fuelType,
    currentSupplier,
    newSupplier,
    initiatedBy:     'admin',
    estimatedSwitchDate: estimatedSwitchDate ?? null,
    adminNotes:      adminNotes    ?? null,
    clientMessage:   clientMessage ?? null,
    meterDetails:    meterDetails  ?? {},
    contractDetails: contractDetails ?? {},
  });

  addTimelineEntry(sw, {
    actor: 'admin', actorRef: adminId, type: 'status_change',
    title: 'Switch Initiated by Broker',
    message: `Switch from ${currentSupplier} to ${newSupplier} (${fuelType}) initiated.`,
    fromStatus: null, toStatus: 'requested',
    visibleToClient: true,
  });

  // If contractDetails provided, log it
  if (contractDetails?.tariffName) {
    addTimelineEntry(sw, {
      actor: 'admin', actorRef: adminId, type: 'contract_updated',
      title: 'Contract Details Added',
      message: `New tariff: ${contractDetails.tariffName}${contractDetails.estimatedAnnualSaving
        ? ` — estimated saving £${contractDetails.estimatedAnnualSaving}/year` : ''}`,
      visibleToClient: true,
    });
  }

  await sw.save();
  return sw;
};

/**
 * Admin: List all switches across all clients.
 */
const adminListSwitches = async (query) => {
  const {
    clientId, status, fuelType, assignedAdmin,
    newSupplier, currentSupplier,
    page = 1, limit = 20,
    sortBy = 'createdAt', order = 'desc',
  } = query;

  const filter = {};
  if (clientId)       filter.client        = clientId;
  if (status)         filter.status        = status;
  if (fuelType)       filter.fuelType      = fuelType;
  if (assignedAdmin)  filter.assignedAdmin = assignedAdmin;
  if (newSupplier)    filter.newSupplier    = new RegExp(newSupplier, 'i');
  if (currentSupplier) filter.currentSupplier = new RegExp(currentSupplier, 'i');

  const skip    = (page - 1) * limit;
  const sortDir = order === 'asc' ? 1 : -1;
  const total   = await Switch.countDocuments(filter);

  const switches = await populateSwitch(
    Switch.find(filter)
      .select('+adminNotes -timeline') // admin sees adminNotes, but not huge timeline in list
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
  ).lean({ virtuals: true });

  return {
    switches,
    pagination: { total, page, limit,
      totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
  };
};

/**
 * Admin: Full switch with complete timeline.
 */
const adminGetSwitch = async (switchId) => {
  const sw = await populateSwitch(
    Switch.findById(switchId).select('+adminNotes')
  ).lean({ virtuals: true });

  return sw;
};

/**
 * Admin: Update status with full transition validation.
 */
const adminUpdateStatus = async (adminId, switchId, newStatus, opts = {}) => {
  const { message, visibleToClient = true, adminNotes,
    estimatedSwitchDate, objectionReason, cancellationReason } = opts;

  const sw = await Switch.findById(switchId).select('+adminNotes');
  if (!sw) { const e = new Error('Switch not found'); e.statusCode = 404; throw e; }

  const allowed = VALID_TRANSITIONS[sw.status] ?? [];
  if (!allowed.includes(newStatus)) {
    const e = new Error(
      `Cannot transition from '${sw.status}' to '${newStatus}'. ` +
      `Allowed: ${allowed.join(', ') || 'none'}`
    );
    e.statusCode = 400; throw e;
  }

  const prevStatus = sw.status;
  sw.status = newStatus;

  // Set date fields based on new status
  if (newStatus === 'submitted_to_supplier') sw.submittedAt     = new Date();
  if (newStatus === 'cooling_off')           sw.coolingOffEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  if (newStatus === 'completed')             sw.completedAt      = new Date();
  if (newStatus === 'cancelled')             sw.cancelledAt      = new Date();
  if (newStatus === 'failed')               sw.failedAt         = new Date();
  if (newStatus === 'objected')             sw.objectionRaisedAt = new Date();

  if (estimatedSwitchDate !== undefined)    sw.estimatedSwitchDate = estimatedSwitchDate;
  if (objectionReason !== undefined)        sw.objectionReason     = objectionReason;
  if (cancellationReason !== undefined)     sw.cancellationReason  = cancellationReason;
  if (adminNotes !== undefined)             sw.adminNotes          = adminNotes;

  // Add timeline event
  addTimelineEntry(sw, {
    actor: 'admin', actorRef: adminId, type: 'status_change',
    title: STATUS_LABELS[newStatus] ?? newStatus,
    message: message ?? null,
    fromStatus: prevStatus, toStatus: newStatus,
    visibleToClient,
  });

  await sw.save();

  notifyTrigger.onSwitchStatusChanged(sw, newStatus);  // ← ADD THIS

  return sw;
};

/**
 * Admin: Update switch details (notes, contract, meter, dates).
 * Does NOT change status — use adminUpdateStatus for that.
 */
const adminUpdateSwitch = async (adminId, switchId, updates) => {
  const sw = await Switch.findById(switchId).select('+adminNotes');
  if (!sw) return null;

  const {
    adminNotes, estimatedSwitchDate, assignedAdmin,
    meterDetails, contractDetails, clientMessage,
    quoteId, documentId, tariffId,
  } = updates;

  if (adminNotes          !== undefined) sw.adminNotes          = adminNotes;
  if (estimatedSwitchDate !== undefined) sw.estimatedSwitchDate = estimatedSwitchDate;
  if (assignedAdmin       !== undefined) sw.assignedAdmin       = assignedAdmin;
  if (clientMessage       !== undefined) sw.clientMessage       = clientMessage;
  if (quoteId             !== undefined) sw.quote               = quoteId;
  if (documentId          !== undefined) sw.document            = documentId;
  if (tariffId            !== undefined) sw.tariff              = tariffId;

  if (meterDetails) {
    sw.meterDetails = { ...sw.meterDetails.toObject(), ...meterDetails };
    addTimelineEntry(sw, {
      actor: 'admin', actorRef: adminId, type: 'note_added',
      title: 'Meter Details Updated', message: null,
      visibleToClient: false, // internal only
    });
  }

  if (contractDetails) {
    sw.contractDetails = { ...sw.contractDetails.toObject(), ...contractDetails };
    const saving = contractDetails.estimatedAnnualSaving;
    addTimelineEntry(sw, {
      actor: 'admin', actorRef: adminId, type: 'contract_updated',
      title: 'Contract Details Updated',
      message: saving ? `Estimated annual saving: £${saving}` : null,
      visibleToClient: true,
    });
  }

  await sw.save();
  return sw;
};

/**
 * Admin: Manually add a timeline event (e.g. supplier called, letter received).
 */
const adminAddTimelineEvent = async (adminId, switchId, data) => {
  const { type, title, message, visibleToClient = true } = data;

  const sw = await Switch.findById(switchId).select('+adminNotes');
  if (!sw) { const e = new Error('Switch not found'); e.statusCode = 404; throw e; }

  addTimelineEntry(sw, {
    actor: 'admin', actorRef: adminId, type,
    title, message: message ?? null,
    visibleToClient,
  });

  await sw.save();
  return sw;
};

/**
 * Admin: Aggregate stats.
 */
const adminGetStats = async () => {
  const [statusBreakdown, fuelBreakdown, supplierBreakdown, recentActivity] = await Promise.all([
    // Counts by status
    Switch.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // Counts by fuelType
    Switch.aggregate([
      { $group: { _id: '$fuelType', count: { $sum: 1 } } },
    ]),

    // Top new suppliers
    Switch.aggregate([
      { $group: { _id: '$newSupplier', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),

    // Switches updated in last 7 days
    Switch.countDocuments({
      updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  const byStatus = {
    requested: 0, submitted_to_supplier: 0, cooling_off: 0,
    objected: 0, objection_resolved: 0, in_progress: 0,
    pending_completion: 0, completed: 0, cancelled: 0, failed: 0,
    total: 0, active: 0,
  };

  for (const r of statusBreakdown) {
    byStatus[r._id] = r.count;
    byStatus.total += r.count;
    if (!['completed', 'cancelled', 'failed'].includes(r._id)) byStatus.active += r.count;
  }

  const byFuel = {};
  for (const r of fuelBreakdown) byFuel[r._id] = r.count;

  const topSuppliers = supplierBreakdown.map((r) => ({ supplier: r._id, count: r.count }));

  return { byStatus, byFuel, topSuppliers, recentActivity };
};

module.exports = {
  // Client
  getSwitchSummary, getMySwitches, getSwitchById,
  requestSwitch, cancelSwitch, addClientMessage,
  // Admin
  adminCreateSwitch, adminListSwitches, adminGetSwitch,
  adminUpdateStatus, adminUpdateSwitch, adminAddTimelineEvent, adminGetStats,
};