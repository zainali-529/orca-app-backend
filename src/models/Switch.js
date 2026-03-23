const mongoose = require('mongoose');

/**
 * Switch — UK Energy Switching
 *
 * Tracks the full lifecycle of an energy switch from initiation to completion.
 *
 * Status flow:
 *   requested
 *     └→ submitted_to_supplier   (admin submits to new supplier)
 *           └→ cooling_off        (14-day statutory cooling-off period)
 *                 └→ in_progress  (cooling off passed, switch in motion)
 *                       └→ pending_completion  (supplier processing final steps)
 *                             └→ completed     (switch done ✓)
 *
 * Can go to:
 *   objected    (old supplier raised objection — e.g. debt, contract lock-in)
 *   cancelled   (client or admin cancelled)
 *   failed      (supplier rejected or process broke down)
 *
 * Objection resolution:
 *   objected → objection_resolved → in_progress (continue)
 *   objected → cancelled (gave up)
 */

// ── Timeline event ─────────────────────────────────────────────────
// Every status change and admin action is logged here.
const timelineEventSchema = new mongoose.Schema(
  {
    // Who created this event
    actor:     { type: String, enum: ['admin', 'client', 'system'], default: 'admin' },
    actorRef:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Event type
    type: {
      type: String,
      enum: [
        'status_change',      // status moved
        'note_added',         // admin added internal note
        'client_message',     // client left a note/question
        'document_linked',    // LOA linked
        'quote_linked',       // quote linked
        'supplier_update',    // supplier confirmed something
        'objection_raised',   // objection from old supplier
        'objection_resolved', // objection cleared
        'date_updated',       // estimated date changed
        'contract_updated',   // contract details updated
      ],
      default: 'note_added',
    },

    // Human-readable title (e.g. "Switch submitted to British Gas")
    title:   { type: String, trim: true, required: true },

    // Optional longer description
    message: { type: String, trim: true, default: null },

    // Previous + new status (for status_change events)
    fromStatus: { type: String, default: null },
    toStatus:   { type: String, default: null },

    // Is this event visible to client? Admin notes are internal.
    visibleToClient: { type: Boolean, default: true },
  },
  { timestamps: true, _id: true }
);

// ── Meter details ──────────────────────────────────────────────────
const meterDetailsSchema = new mongoose.Schema(
  {
    mpan:         { type: String, default: null }, // electricity meter
    mprn:         { type: String, default: null }, // gas meter
    meterSerial:  { type: String, default: null },
    supplyAddress: {
      line1:    { type: String, default: null },
      city:     { type: String, default: null },
      postcode: { type: String, default: null },
    },
  },
  { _id: false }
);

// ── Contract details ───────────────────────────────────────────────
// New contract terms agreed with new supplier
const contractDetailsSchema = new mongoose.Schema(
  {
    tariffName:        { type: String, default: null },
    contractType:      { type: String, enum: ['fixed', 'variable', 'deemed', null], default: null },
    contractLengthMonths: { type: Number, default: null },
    contractStartDate: { type: Date,   default: null },
    contractEndDate:   { type: Date,   default: null },

    // Electricity rates
    electricityUnitRate:    { type: Number, default: null }, // p/kWh
    electricityStandingCharge: { type: Number, default: null }, // p/day

    // Gas rates
    gasUnitRate:            { type: Number, default: null }, // p/kWh
    gasStandingCharge:      { type: Number, default: null }, // p/day

    // Estimated annual saving vs old supplier
    estimatedAnnualSaving:  { type: Number, default: null }, // £

    // Exit fees on OLD contract (if any)
    exitFees:               { type: Number, default: null }, // £
  },
  { _id: false }
);

// ── Main Switch schema ─────────────────────────────────────────────
const switchSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────
    switchNumber: {
      type: String, unique: true,
      // Auto-generated: SW-2026-000001
    },

    // ── Ownership ─────────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      required: true, index: true,
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      default: null, index: true,
    },

    // ── Linked records ─────────────────────────────────────────
    quote:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quote',    default: null },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null }, // LOA
    tariff:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tariff',   default: null },

    // ── Switch scope ───────────────────────────────────────────
    fuelType: {
      type: String,
      enum: ['electricity', 'gas', 'dual'],
      required: true,
      default: 'electricity',
    },

    // ── Suppliers ──────────────────────────────────────────────
    currentSupplier: { type: String, trim: true, required: true },
    newSupplier:     { type: String, trim: true, required: true },

    // ── Status ─────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'requested',           // switch initiated (by client or admin)
        'submitted_to_supplier',  // admin submitted to new supplier
        'cooling_off',         // 14-day cooling off period running
        'objected',            // old supplier raised objection
        'objection_resolved',  // objection cleared, ready to continue
        'in_progress',         // cooling off done, switch in motion
        'pending_completion',  // supplier processing final steps
        'completed',           // switch done
        'cancelled',           // cancelled
        'failed',              // failed / rejected
      ],
      default: 'requested',
      index: true,
    },

    // ── Who initiated? ─────────────────────────────────────────
    initiatedBy: {
      type: String, enum: ['admin', 'client'], default: 'admin',
    },

    // ── Key dates ──────────────────────────────────────────────
    estimatedSwitchDate:  { type: Date, default: null },
    coolingOffEndsAt:     { type: Date, default: null }, // set when enters cooling_off
    submittedAt:          { type: Date, default: null },
    completedAt:          { type: Date, default: null },
    cancelledAt:          { type: Date, default: null },
    failedAt:             { type: Date, default: null },
    objectionRaisedAt:    { type: Date, default: null },

    // ── Details ────────────────────────────────────────────────
    meterDetails:    { type: meterDetailsSchema,    default: () => ({}) },
    contractDetails: { type: contractDetailsSchema, default: () => ({}) },

    // ── Notes ──────────────────────────────────────────────────
    adminNotes: {
      type: String, trim: true, maxlength: 3000,
      default: null, select: false, // never returned to client
    },
    clientMessage: {
      // Client can leave a message/question for the broker
      type: String, trim: true, maxlength: 1000, default: null,
    },

    // ── Objection details (if objected) ────────────────────────
    objectionReason: {
      type: String, trim: true, maxlength: 1000, default: null,
    },

    // ── Cancellation ───────────────────────────────────────────
    cancellationReason: {
      type: String, trim: true, maxlength: 1000, default: null,
    },

    // ── Timeline ───────────────────────────────────────────────
    // Full audit trail of every action
    timeline: {
      type: [timelineEventSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.adminNotes; // never expose to client
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────────
switchSchema.index({ client: 1, status: 1 });
switchSchema.index({ client: 1, createdAt: -1 });
switchSchema.index({ assignedAdmin: 1, status: 1 });
switchSchema.index({ status: 1, createdAt: -1 });
switchSchema.index({ switchNumber: 1 });
switchSchema.index({ newSupplier: 1 });
switchSchema.index({ currentSupplier: 1 });

// ── Auto-generate switchNumber ─────────────────────────────────────
switchSchema.pre('save', async function (next) {
  if (!this.switchNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    this.switchNumber = `SW-${year}-${seq}`;
  }
  next();
});

// ── Virtuals ───────────────────────────────────────────────────────
switchSchema.virtual('isActive').get(function () {
  return !['completed', 'cancelled', 'failed'].includes(this.status);
});

switchSchema.virtual('isCompleted').get(function () {
  return this.status === 'completed';
});

switchSchema.virtual('isCoolingOff').get(function () {
  return this.status === 'cooling_off';
});

// Days left in cooling off period
switchSchema.virtual('coolingOffDaysLeft').get(function () {
  if (!this.coolingOffEndsAt || this.status !== 'cooling_off') return null;
  const diff = this.coolingOffEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

// Client-visible timeline events only
switchSchema.virtual('clientTimeline').get(function () {
  return this.timeline.filter((e) => e.visibleToClient);
});

module.exports = mongoose.model('Switch', switchSchema);