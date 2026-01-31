"use strict";

const mongoose = require("mongoose");
const { getEATNowAsDate, getEATNowString } = require("../utils/timeEAT");

/**
 * ════════════════════════════════════════════
 *   💰 DEPOSIT SCHEMA
 * ════════════════════════════════════════════
 */

const DEPOSIT_STATUS = {
  SESSION: "session",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const DEPOSIT_STEPS = {
  PHONE: "await_phone",
  AMOUNT: "await_amount",
  SMS: "await_sms",
  COMPLETE: null,
};

const DepositSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true },
    chatId: { type: String, default: "" },

    status: {
      type: String,
      enum: Object.values(DEPOSIT_STATUS),
      default: DEPOSIT_STATUS.SESSION,
      index: true,
    },

    step: {
      type: String,
      enum: [...Object.values(DEPOSIT_STEPS)],
      default: DEPOSIT_STEPS.PHONE,
    },

    senderPhone: { type: String, trim: true, default: "" },
    amount: { type: Number, default: 0 },
    smsText: { type: String, trim: true, default: "" },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SubAdmin", default: null },
    approvalNote: { type: String, trim: true, default: "" },

    // ✅ Approval time (EAT)
    approvedAt: { type: Date, default: null },
    approvedAtEAT: { type: String, default: "" },

    // ✅ Creation time (EAT) - extra field
    createdAtEAT: { type: String, default: getEATNowString },
  },
  {
    timestamps: true, // keeps createdAt/updatedAt (UTC) for DB sorting
    versionKey: false,
  }
);

/* ═══════════════════════════════════════════
   INDEXES
═══════════════════════════════════════════ */

DepositSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { status: "session" }, name: "idx_unique_session" }
);

DepositSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "idx_unique_pending" }
);

DepositSchema.index({ status: 1, createdAt: 1 }, { name: "idx_status_createdAt_oldestFirst" });

/* ═══════════════════════════════════════════
   HELPERS FOR APPROVAL (optional convenience)
═══════════════════════════════════════════ */

DepositSchema.statics.getEATApprovalStamp = function () {
  return { approvedAt: getEATNowAsDate(), approvedAtEAT: getEATNowString() };
};

module.exports = mongoose.models.Deposit || mongoose.model("Deposit", DepositSchema);

