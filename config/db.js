"use strict";

const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

/* ═══════════════════════════════════════════
   CONFIG (only URI comes from env as requested)
═══════════════════════════════════════════ */

const MONGODB_URI = process.env.MONGODB_URI; // ✅ env only for URL/URI

// Everything else is plain variables (not env-driven)
const DB_CONFIG = {
  maxPoolSize: 20,
  minPoolSize: 0,

  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,

  // Never auto-build indexes in production
  autoIndex: process.env.NODE_ENV !== "production",

  // Retry settings
  retries: 10,
  initialDelayMs: 500,
  maxDelayMs: 8000,
};

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMongooseOptions() {
  return {
    maxPoolSize: DB_CONFIG.maxPoolSize,
    minPoolSize: DB_CONFIG.minPoolSize,

    serverSelectionTimeoutMS: DB_CONFIG.serverSelectionTimeoutMS,
    connectTimeoutMS: DB_CONFIG.connectTimeoutMS,
    socketTimeoutMS: DB_CONFIG.socketTimeoutMS,

    autoIndex: DB_CONFIG.autoIndex,
  };
}

function attachConnectionHandlersOnce() {
  if (mongoose.connection.__handlersAttached) return;

  mongoose.connection.on("connected", () => {
    console.log("[DB] ✅ MongoDB connected");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("[DB] 🔄 MongoDB reconnected");
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[DB] ⚠️ MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[DB] ❌ MongoDB error:", err?.message || err);
  });

  mongoose.connection.__handlersAttached = true;
}

/* ═══════════════════════════════════════════
   MAIN
═══════════════════════════════════════════ */

/**
 * Connect to MongoDB with retries + logging
 * @returns {Promise<mongoose.Connection>}
 */
async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined");
  }

  attachConnectionHandlersOnce();

  const options = buildMongooseOptions();

  let delay = DB_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt <= DB_CONFIG.retries; attempt++) {
    try {
      console.log(`[DB] Connecting... (attempt ${attempt}/${DB_CONFIG.retries})`);
      await mongoose.connect(MONGODB_URI, options);
      return mongoose.connection;
    } catch (err) {
      console.error("[DB] ❌ Connection failed:", err?.message || err);

      if (attempt >= DB_CONFIG.retries) {
        throw new Error("MongoDB connection failed after maximum retries");
      }

      console.log(`[DB] Retrying in ${delay}ms...`);
      await sleep(delay);
      delay = Math.min(delay * 2, DB_CONFIG.maxDelayMs);
    }
  }
}

module.exports = connectDB;