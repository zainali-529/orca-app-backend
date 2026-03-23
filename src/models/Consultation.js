/**
 * Consultation Model — PAID ONLY
 *
 * Status flow:
 *   requested → awaiting_payment → payment_confirmed → confirmed → scheduled → in_progress → completed
 *                               ↓                              ↓            ↓              ↓
 *                         payment_failed                   cancelled    cancelled       no_show
 *
 *   payment_failed → awaiting_payment  (retry, max 3)
 *   completed      → refunded          (admin only)
 *   cancelled      → requested         (admin re-open)
 */

const mongoose = require('mongoose');

// ── Payment sub-schema ─────────────────────────────────────────────
const paymentSchema = new mongoose.Schema(
  {
    stripePaymentIntentId: { type: String, default: null },
    stripeCustomerId:      { type: String, default: null },

    // SECURITY: client_secret select:false — returned ONE TIME only at creation
    stripeClientSecret: { type: String, default: null, select: false },

    amount:       { type: Number, default: 0 },    // pence e.g. 4900 = £49.00
    currency:     { type: String, default: 'gbp' },
    amountPounds: { type: Number, default: 0 },    // display £

    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
      default: 'pending',
    },

    paidAt:       { type: Date,   default: null },
    refundedAt:   { type: Date,   default: null },
    refundAmount: { type: Number, default: null },  // pence
    stripeRefundId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
  },
  { _id: false }
);

// ── Main schema ────────────────────────────────────────────────────
const consultationSchema = new mongoose.Schema(
  {
    consultationNumber: { type: String, unique: true },

    // ── Ownership ─────────────────────────────────────────────
    client: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      required: true, index: true,
    },
    assignedBroker: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User',
      default: null, index: true,
    },

    // ── Category ──────────────────────────────────────────────
    category: {
      type: String,
      enum: [
        'general',
        'tariff_review',
        'switch_advice',
        'contract_review',
        'energy_audit',
        'renewal_advice',
        'new_connection',
      ],
      default: 'general',
    },

    // ── Status ─────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'requested',
        'awaiting_payment',
        'payment_failed',
        'payment_confirmed',
        'confirmed',
        'scheduled',
        'in_progress',
        'completed',
        'cancelled',
        'no_show',
        'refunded',
      ],
      default: 'requested',
      index: true,
    },

    // ── Pricing (ALWAYS from server config — never from client) ─
    price:      { type: Number, required: true },   // £
    pricePence: { type: Number, required: true },   // pence
    currency:   { type: String, default: 'gbp' },
    label:      { type: String, default: null },    // e.g. "Energy Audit (60 min)"

    // ── Scheduling ─────────────────────────────────────────────
    duration: {
      type: Number, enum: [30, 45, 60], default: 45,
    },
    scheduledAt:  { type: Date, default: null },
    confirmedAt:  { type: Date, default: null },
    completedAt:  { type: Date, default: null },
    cancelledAt:  { type: Date, default: null },
    noShowAt:     { type: Date, default: null },

    // ── Client preferences ─────────────────────────────────────
    preferredDateFrom:  { type: Date,     default: null },
    preferredDateTo:    { type: Date,     default: null },
    preferredTimeSlots: { type: [String], default: [] },

    // ── Meeting ────────────────────────────────────────────────
    meetingMethod: {
      type: String, enum: ['phone', 'video', 'in_person'], default: 'phone',
    },
    meetingLink:  { type: String, default: null },
    meetingPhone: { type: String, default: null },

    // ── Notes ──────────────────────────────────────────────────
    clientNotes: { type: String, trim: true, maxlength: 2000, default: null },

    // SECURITY: brokerNotes select:false — never in client responses
    brokerNotes: { type: String, trim: true, maxlength: 3000, default: null, select: false },

    // Post-consultation — visible to client
    outcome:   { type: String, trim: true, maxlength: 3000, default: null },
    nextSteps: { type: String, trim: true, maxlength: 1000, default: null },

    // ── Cancellation ───────────────────────────────────────────
    cancellationReason: { type: String, trim: true, maxlength: 500, default: null },
    cancelledBy: {
      type: String, enum: ['client', 'admin', 'system'], default: null,
    },

    // ── Linked records ─────────────────────────────────────────
    relatedSwitch:   { type: mongoose.Schema.Types.ObjectId, ref: 'Switch',   default: null },
    relatedQuote:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quote',     default: null },
    relatedDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },

    // ── Stripe payment (required for all consultations) ────────
    payment: { type: paymentSchema, default: null },

    paymentAttempts: { type: Number, default: 0 },

    // ── Rating ─────────────────────────────────────────────────
    rating:        { type: Number, min: 1, max: 5, default: null },
    ratingComment: { type: String, trim: true, maxlength: 500, default: null },
    ratedAt:       { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.brokerNotes;
        delete ret.__v;
        if (ret.payment) {
          delete ret.payment.stripeClientSecret;
          delete ret.payment.idempotencyKey;
        }
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────────
consultationSchema.index({ client: 1, status: 1 });
consultationSchema.index({ client: 1, createdAt: -1 });
consultationSchema.index({ assignedBroker: 1, status: 1 });
consultationSchema.index({ status: 1, scheduledAt: 1 });
consultationSchema.index({ category: 1, status: 1 });
consultationSchema.index({ 'payment.stripePaymentIntentId': 1 }, { sparse: true });
consultationSchema.index({ consultationNumber: 1 });

// ── Auto-generate consultationNumber ──────────────────────────────
consultationSchema.pre('save', async function (next) {
  if (!this.consultationNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    const seq   = String(count + 1).padStart(6, '0');
    this.consultationNumber = `CONS-${year}-${seq}`;
  }
  if (this.isModified('price')) {
    this.pricePence = Math.round(this.price * 100);
  }
  next();
});

// ── Virtuals ───────────────────────────────────────────────────────
consultationSchema.virtual('isUpcoming').get(function () {
  return ['confirmed', 'scheduled'].includes(this.status) &&
    this.scheduledAt && this.scheduledAt > new Date();
});

consultationSchema.virtual('isPaymentPending').get(function () {
  return this.status === 'awaiting_payment';
});

consultationSchema.virtual('canCancel').get(function () {
  return ['requested', 'awaiting_payment', 'payment_failed',
    'payment_confirmed', 'confirmed', 'scheduled'].includes(this.status);
});

consultationSchema.virtual('isActive').get(function () {
  return !['completed', 'cancelled', 'no_show', 'refunded'].includes(this.status);
});

module.exports = mongoose.model('Consultation', consultationSchema);