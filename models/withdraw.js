"use strict";

const mongoose = require("mongoose");
const { getEATNowAsDate, getEATNowString } = require("../utils/timeEAT");

/**
 * ════════════════════════════════════════════
 *   💸 WITHDRAW SCHEMA
 * ════════════════════════════════════════════
 */

const WithdrawSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true },
    chatId: { type: String, default: "" },

    status: {
      type: String,
      enum: ["session", "pending", "approved", "rejected"],
      default: "session",
      index: true,
    },

    step: {
      type: String,
      enum: ["await_phone", "await_name", "await_amount", null],
      default: "await_phone",
    },

    amount: { type: Number, default: 0 },
    receiverPhone: { type: String, trim: true, default: "" },
    receiverFirstName: { type: String, trim: true, default: "" },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SubAdmin", default: null },
    approvalNote: { type: String, trim: true, default: "" },

    // ✅ Approval time (EAT)
    approvedAt: { type: Date, default: null },
    approvedAtEAT: { type: String, default: "" },

    // ✅ Creation time (EAT)
    createdAtEAT: { type: String, default: getEATNowString },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

WithdrawSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { status: "session" }, name: "idx_unique_withdraw_session" }
);

WithdrawSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "idx_unique_withdraw_pending" }
);

WithdrawSchema.index({ status: 1, createdAt: 1 }, { name: "idx_withdraw_status_createdAt_oldestFirst" });

WithdrawSchema.statics.getEATApprovalStamp = function () {
  return { approvedAt: getEATNowAsDate(), approvedAtEAT: getEATNowString() };
};

module.exports = mongoose.models.Withdraw || mongoose.model("Withdraw", WithdrawSchema);



