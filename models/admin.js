"use strict";

const mongoose = require("mongoose");

/**
 * ════════════════════════════════════════════
 *   👑 ADMIN SCHEMA
 *   System administrators & configuration
 *   Clean, consistent structure
 * ════════════════════════════════════════════
 */

/* ─────────────────────────────────────
   📱 TELEBIRR ACCOUNT SUB-SCHEMA
───────────────────────────────────── */
const TelebirrAccountSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: [true, "Telebirr phone number is required"],
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    fatherName: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false, minimize: false }
);

/* ─────────────────────────────────────
   👑 MAIN ADMIN SCHEMA
───────────────────────────────────── */
const AdminSchema = new mongoose.Schema(
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

    phoneNumber: {
      type: String,
      trim: true,
      default: null, // IMPORTANT: do NOT use "" with unique+sparse
    },

    /* ─────────────────────────────────────
       👤 ROLE & PERMISSIONS
    ───────────────────────────────────── */
    role: {
      type: String,
      trim: true,
      lowercase: true,
      default: "admin", // admin | superadmin (flexible, no enum)
    },

    /* ─────────────────────────────────────
       💳 TELEBIRR CONFIGURATION
    ───────────────────────────────────── */
    activeTelebirrAccount: {
      type: TelebirrAccountSchema,
      default: null,
    },

    telebirrAccountLists: {
      type: [TelebirrAccountSchema],
      default: [],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length <= 50; // Reasonable limit
        },
        message: "Maximum 50 Telebirr accounts allowed",
      },
    },

    /* ─────────────────────────────────────
       📋 REGISTRY (authorized phone numbers)
    ───────────────────────────────────── */
    registry: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length <= 1000; // Reasonable limit
        },
        message: "Maximum 1000 registry entries allowed",
      },
    },

    /* ─────────────────────────────────────
       ⚙️ SYSTEM SETTINGS
    ───────────────────────────────────── */
    maxUserLimit: {
      type: Number,
      default: 1000,
      min: [1, "Minimum user limit is 1"],
      max: [1000000, "Maximum user limit is 1,000,000"],
    },

    maxPlayersNumber: {
      type: Number,
      default: 100,
      min: [1, "Minimum players is 1"],
      max: [10000, "Maximum players is 10,000"],
    },

    rtp: {
      type: Number,
      default: 50,
      min: [1, "Minimum RTP is 1"],
      max: [100, "Maximum RTP is 100"],
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

// Prevent duplicate Admin per Telegram ID
AdminSchema.index(
  { telegramId: 1 },
  { unique: true, sparse: true, name: "idx_unique_admin_telegramId" }
);

// Prevent duplicate Admin per phone number
AdminSchema.index(
  { phoneNumber: 1 },
  { unique: true, sparse: true, name: "idx_unique_admin_phoneNumber" }
);

// Fast lookup by role
AdminSchema.index({ role: 1, updatedAt: -1 }, { name: "idx_admin_role_updatedAt" });

// Registry queries
AdminSchema.index({ registry: 1 }, { name: "idx_admin_registry" });

/* ═══════════════════════════════════════════
   🔧 STATIC METHODS
   (Optimized for better performance)
═══════════════════════════════════════════ */

/**
 * Get system settings from active admin
 * @returns {Promise<Object>} System settings
 */
AdminSchema.statics.getSystemSettings = async function () {
  try {
    const admin = await this.findOne(
      { role: { $in: ["admin", "superadmin"] } },
      { maxUserLimit: 1, maxPlayersNumber: 1, rtp: 1, _id: 0 }
    )
      .sort({ updatedAt: -1 })
      .lean()
      .maxTimeMS(5000);

    return {
      maxUserLimit: admin?.maxUserLimit ?? 1000,
      maxPlayersNumber: admin?.maxPlayersNumber ?? 100,
      rtp: admin?.rtp ?? 50,
    };
  } catch (error) {
    console.error("[ADMIN_SCHEMA] getSystemSettings error:", error?.message);
    // Return defaults on error
    return {
      maxUserLimit: 1000,
      maxPlayersNumber: 100,
      rtp: 50,
    };
  }
};

/**
 * Get active Telebirr account
 * @returns {Promise<Object|null>} Active Telebirr account or null
 */
AdminSchema.statics.getActiveTelebirrAccount = async function () {
  try {
    const admin = await this.findOne(
      { role: { $in: ["admin", "superadmin"] } },
      { activeTelebirrAccount: 1, telebirrAccountLists: 1, _id: 0 }
    )
      .sort({ updatedAt: -1 })
      .lean()
      .maxTimeMS(5000);

    return admin?.activeTelebirrAccount || admin?.telebirrAccountLists?.[0] || null;
  } catch (error) {
    console.error("[ADMIN_SCHEMA] getActiveTelebirrAccount error:", error?.message);
    return null;
  }
};

/**
 * Check if phone number is in registry
 * @param {string|string[]} phoneVariants - Phone number variant(s) to check
 * @returns {Promise<boolean>} True if authorized
 */
AdminSchema.statics.isPhoneInRegistry = async function (phoneVariants) {
  try {
    const variants = Array.isArray(phoneVariants) ? phoneVariants : [phoneVariants];
    
    const count = await this.countDocuments({
      role: { $in: ["admin", "superadmin"] },
      registry: { $in: variants },
    })
      .limit(1)
      .maxTimeMS(5000);

    return count > 0;
  } catch (error) {
    console.error("[ADMIN_SCHEMA] isPhoneInRegistry error:", error?.message);
    return false;
  }
};

/**
 * Update system settings
 * @param {string} telegramId - Admin's Telegram ID
 * @param {Object} settings - Settings to update
 * @returns {Promise<Object|null>} Updated admin or null
 */
AdminSchema.statics.updateSystemSettings = async function (telegramId, settings) {
  try {
    const validSettings = {};
    
    if (typeof settings.maxUserLimit === "number") {
      validSettings.maxUserLimit = Math.max(1, Math.min(1000000, settings.maxUserLimit));
    }
    if (typeof settings.maxPlayersNumber === "number") {
      validSettings.maxPlayersNumber = Math.max(1, Math.min(10000, settings.maxPlayersNumber));
    }
    if (typeof settings.rtp === "number") {
      validSettings.rtp = Math.max(1, Math.min(100, settings.rtp));
    }

    if (Object.keys(validSettings).length === 0) return null;

    return this.findOneAndUpdate(
      { telegramId: String(telegramId), role: { $in: ["admin", "superadmin"] } },
      { $set: validSettings },
      { new: true, runValidators: true }
    ).maxTimeMS(5000);
  } catch (error) {
    console.error("[ADMIN_SCHEMA] updateSystemSettings error:", error?.message);
    return null;
  }
};

module.exports = mongoose.models.Admin || mongoose.model("Admin", AdminSchema);