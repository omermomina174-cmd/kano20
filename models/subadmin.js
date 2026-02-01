"use strict";

const mongoose = require("mongoose");

/**
 * ════════════════════════════════════════════
 *   👨‍💼 SUBADMIN SCHEMA
 *   Clean, consistent (same style as Admin)
 *   ✅ Balance can be POSITIVE or NEGATIVE
 *   ✅ No min/max restrictions
 * ════════════════════════════════════════════
 */

const SubAdminSchema = new mongoose.Schema(
  {
    /* ─────────────────────────────────────
       🔑 IDENTIFICATION
    ───────────────────────────────────── */
    telegramId: {
      type: String,
      trim: true,
      default: null,
    },

    chatId: {
      type: String,
      trim: true,
      default: "",
    },

    username: {
      type: String,
      trim: true,
      default: "",
    },

    phoneNumber: {
      type: String,
      trim: true,
      default: null,
    },

    /* ─────────────────────────────────────
       💰 BALANCE (2 decimal places, rounded)
       ✅ Can be NEGATIVE or POSITIVE (no restrictions)
    ───────────────────────────────────── */
    balance: {
      type: Number,
      default: 0,
      // ✅ NO min/max validator - allows any value
      set: (v) => Math.round((Number(v) || 0) * 100) / 100, // ✅ Allows negative
      get: (v) => Math.round((Number(v) || 0) * 100) / 100,
    },

    /* ─────────────────────────────────────
       🛡️ ROLE / STATUS
    ───────────────────────────────────── */
    role: {
      type: String,
      trim: true,
      default: "subadmin",
    },

    /**
     * STATUS:
     * - "active"  → Full access (default)
     * - "sleep"   → No effect, treated as active
     * - "blocked" → Access denied by admin
     */
    status: {
      type: String,
      trim: true,
      lowercase: true,
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

/* ═══════════════════════════════════════════
   📌 INDEXES
═══════════════════════════════════════════ */

SubAdminSchema.index(
  { telegramId: 1 },
  { unique: true, sparse: true, name: "idx_unique_subadmin_telegramId" }
);

SubAdminSchema.index(
  { phoneNumber: 1 },
  { unique: true, sparse: true, name: "idx_unique_subadmin_phoneNumber" }
);

SubAdminSchema.index({ status: 1, createdAt: 1 }, { name: "idx_subadmin_status_createdAt" });
SubAdminSchema.index({ role: 1, updatedAt: -1 }, { name: "idx_subadmin_role_updatedAt" });
SubAdminSchema.index({ balance: -1 }, { name: "idx_subadmin_balance" });

/* ═══════════════════════════════════════════
   🔧 STATIC METHODS (Optional)
═══════════════════════════════════════════ */

/**
 * Find subadmin by Telegram ID
 */
SubAdminSchema.statics.findByTelegramId = function (telegramId) {
  return this.findOne({ telegramId: String(telegramId) });
};

/**
 * Count active subadmins
 */
SubAdminSchema.statics.countActiveSubAdmins = function () {
  return this.countDocuments({ status: "active", role: "subadmin" });
};

/**
 * Update subadmin balance (simple add/subtract)
 * ✅ NO validation - just update the amount
 */
SubAdminSchema.statics.updateBalance = async function (telegramId, amount) {
  const roundedAmount = Math.round((Number(amount) || 0) * 100) / 100;
  return this.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { $inc: { balance: roundedAmount } },
    { new: true }
  );
};

module.exports = mongoose.models.SubAdmin || mongoose.model("SubAdmin", SubAdminSchema);
