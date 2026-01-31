"use strict";

const mongoose = require("mongoose");

/**
 * ════════════════════════════════════════════
 *   👨‍💼 SUBADMIN SCHEMA
 *   Clean, consistent (same style as Admin)
 *   Difference from Admin: data/role only
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
      default: "",
    },

    phoneNumber: {
      type: String,
      trim: true,
      default: null, // IMPORTANT: do NOT use "" with unique+sparse
    },

    /* ─────────────────────────────────────
       💰 BALANCE (2 decimal places, rounded)
       ✅ Can be NEGATIVE or POSITIVE
    ───────────────────────────────────── */
    balance: {
      type: Number,
      default: 0,
      set: (v) => Math.round((Number(v) || 0) * 100) / 100, // Round to 2 decimal places
      get: (v) => Math.round((Number(v) || 0) * 100) / 100, // Ensure 2 decimal on read
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
      default: "active", // active | sleep | blocked (no enum, flexible)
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

// Prevent duplicate SubAdmin per Telegram ID
SubAdminSchema.index(
  { telegramId: 1 },
  { unique: true, sparse: true, name: "idx_unique_subadmin_telegramId" }
);

// Prevent duplicate SubAdmin per phone number
SubAdminSchema.index(
  { phoneNumber: 1 },
  { unique: true, sparse: true, name: "idx_unique_subadmin_phoneNumber" }
);

// Helpful for panel queries
SubAdminSchema.index({ status: 1, createdAt: 1 }, { name: "idx_subadmin_status_createdAt" });
SubAdminSchema.index({ role: 1, updatedAt: -1 }, { name: "idx_subadmin_role_updatedAt" });

// Balance queries (optional, useful for sorting/filtering by balance)
SubAdminSchema.index({ balance: -1 }, { name: "idx_subadmin_balance" });

module.exports = mongoose.models.SubAdmin || mongoose.model("SubAdmin", SubAdminSchema);