"use strict";

const mongoose = require("mongoose");

/**
 * ════════════════════════════════════════════
 *   👤 USER SCHEMA
 *   Clean, consistent structure
 *   Core user data for the platform
 * ════════════════════════════════════════════
 */

const UserSchema = new mongoose.Schema(
  {
    /* ─────────────────────────────────────
       🔑 IDENTIFICATION
    ───────────────────────────────────── */
    telegramId: {
      type: String,
      trim: true,
      default: null, // IMPORTANT: do NOT use "" with unique+sparse
    },

    chatId: {
      type: String,
      trim: true,
      default: "",
    },

    username: {
      type: String,
      trim: true,
      maxlength: 64,
      default: "",
    },

    phoneNo: {
      type: String,
      trim: true,
      default: null, // IMPORTANT: do NOT use "" with unique+sparse
    },

    /* ─────────────────────────────────────
       💰 BALANCE (2 decimal places, rounded)
       ✅ POSITIVE ONLY (min: 0)
    ───────────────────────────────────── */
    Balance: {
      type: Number,
      default: 0,
      min: [0, "Balance cannot be negative"],
      set: (v) => {
        const num = Number(v) || 0;
        return Math.max(0, Math.round(num * 100) / 100); // Ensure positive & 2 decimals
      },
      get: (v) => Math.round((Number(v) || 0) * 100) / 100, // Ensure 2 decimal on read
    },

    /* ─────────────────────────────────────
       🛡️ ROLE / STATUS
    ───────────────────────────────────── */
    role: {
      type: String,
      trim: true,
      lowercase: true,
      default: "user", // user | vip (flexible, no enum)
    },

    /**
     * STATUS:
     * - "active"  → Full access (default)
     * - "blocked" → Access denied by admin
     */
    status: {
      type: String,
      trim: true,
      lowercase: true,
      default: "active", // active | blocked (flexible, no enum)
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
   (clean + safe + no duplication)
═══════════════════════════════════════════ */

// Prevent duplicate User per Telegram ID
UserSchema.index(
  { telegramId: 1 },
  { unique: true, sparse: true, name: "idx_unique_user_telegramId" }
);

// Prevent duplicate User per phone number (optional but safe)
UserSchema.index(
  { phoneNo: 1 },
  { unique: true, sparse: true, name: "idx_unique_user_phoneNo" }
);

// Fast lookup by username (non-unique)
UserSchema.index({ username: 1 }, { name: "idx_user_username" });

// Helpful for admin queries
UserSchema.index({ status: 1, createdAt: -1 }, { name: "idx_user_status_createdAt" });
UserSchema.index({ role: 1, updatedAt: -1 }, { name: "idx_user_role_updatedAt" });

// Balance queries (useful for sorting/filtering)
UserSchema.index({ Balance: -1 }, { name: "idx_user_balance" });

/* ═══════════════════════════════════════════
   🔧 STATIC METHODS
═══════════════════════════════════════════ */

/**
 * Find user by Telegram ID
 */
UserSchema.statics.findByTelegramId = function (telegramId) {
  return this.findOne({ telegramId: String(telegramId) });
};

/**
 * Count active users
 */
UserSchema.statics.countActiveUsers = function () {
  return this.countDocuments({ status: "active", role: "user" });
};

/**
 * Update user balance with proper rounding
 */
UserSchema.statics.updateBalance = async function (telegramId, amount) {
  const roundedAmount = Math.round((Number(amount) || 0) * 100) / 100;
  return this.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { $inc: { Balance: roundedAmount } },
    { new: true }
  );
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);