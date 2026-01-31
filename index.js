"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
const { initSocket } = require("./socket/IO");

// Bots
const startUserBot = require("./bot/UserBot");
const startAdminBot = require("./bot/adminBot");
const startSubAdminBot = require("./bot/subadmin");

// Routes
const userHomeRoute = require("./routes/home");
const kanoRoute = require("./routes/kano");
const adminRoute = require("./routes/admin");
const subadminRoute = require("./routes/subadmin");

// Sessions
const { userSession, adminSession, subadminSession } = require("./middleware/cookieSessions");

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

/* ═══════════════════════════════════════════════════════════════════════════
   EXPRESS APP
═══════════════════════════════════════════════════════════════════════════ */
const app = express();

// Trust proxy (required for secure cookies behind Render/NGINX/Cloudflare)
app.set("trust proxy", 1);

// Remove fingerprint header
app.disable("x-powered-by");

/* ═══════════════════════════════════════════════════════════════════════════
   CORS
═══════════════════════════════════════════════════════════════════════════ */
function buildCorsOptions() {
  const raw = (process.env.CORS_ORIGIN || "").trim();

  // If not set, reflect origin (okay for Telegram WebApp)
  if (!raw) {
    return {
      origin: true,
      credentials: true,
      optionsSuccessStatus: 204,
    };
  }

  // Support comma-separated list
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);

  return {
    origin(origin, cb) {
      // Allow server-to-server / curl (no origin)
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error("CORS_NOT_ALLOWED"), false);
    },
    credentials: true,
    optionsSuccessStatus: 204,
  };
}

app.use(cors(buildCorsOptions()));

/* ═══════════════════════════════════════════════════════════════════════════
   SECURITY & PERFORMANCE
═══════════════════════════════════════════════════════════════════════════ */
// Helmet with Telegram WebView-friendly settings
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Compression
app.use(compression());

// Global rate limit (HTTP only; Socket.io is separate)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.HTTP_RATE_LIMIT_PER_MIN || 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Too many requests. Please slow down." },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === "/health";
    },
  })
);

// Body parsers with limits
app.use(express.json({ limit: process.env.JSON_LIMIT || "200kb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENC_LIMIT || "200kb" }));

/* ═══════════════════════════════════════════════════════════════════════════
   REQUEST LOGGING
═══════════════════════════════════════════════════════════════════════════ */
const morganFormat = isProd ? "combined" : "dev";

// Skip logging for health checks in production
const morganOptions = isProd
  ? { skip: (req) => req.path === "/health" }
  : {};

app.use(morgan(morganFormat, morganOptions));

/* ═══════════════════════════════════════════════════════════════════════════
   STATIC FILES
═══════════════════════════════════════════════════════════════════════════ */
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: isProd ? "1d" : 0,
    index: false, // Don't serve index.html automatically (we handle routes)
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTES (sessions per section)
═══════════════════════════════════════════════════════════════════════════ */

app.get('/ping', (req, res) => res.send('ok'));

// User routes
app.use("/home_user", userSession, userHomeRoute);
app.use("/kano", userSession, kanoRoute);

// Admin routes
app.use("/admin", adminSession, adminRoute);
app.use("/subadmin", subadminSession, subadminRoute);

// Root redirect
app.get("/", (req, res) => res.redirect("/home_user"));


/* ═══════════════════════════════════════════════════════════════════════════
   404 HANDLER
═══════════════════════════════════════════════════════════════════════════ */
app.use((req, res) => {
  const wantsJson =
    req.accepts(["json", "html"]) === "json" ||
    req.path.includes("/api/") ||
    req.xhr;

  if (wantsJson) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  return res.status(404).send("Not found");
});

/* ═══════════════════════════════════════════════════════════════════════════
   CENTRAL ERROR HANDLER
═══════════════════════════════════════════════════════════════════════════ */
app.use((err, req, res, next) => {
  // CORS not allowed
  if (err?.message === "CORS_NOT_ALLOWED") {
    return res.status(403).json({ ok: false, error: "CORS not allowed" });
  }

  // JSON parse errors
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  // Rate limit exceeded (if custom handler needed)
  if (err?.status === 429) {
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }

  // Log error (don't log stack in production for non-500 errors)
  if (isProd) {
    console.error("[HTTP_ERROR]", err?.message || err);
  } else {
    console.error("[HTTP_ERROR]", err);
  }

  if (res.headersSent) return next(err);

  return res.status(500).json({ ok: false, error: "Server error" });
});

/* ═══════════════════════════════════════════════════════════════════════════
   BOT STARTUP
═══════════════════════════════════════════════════════════════════════════ */
async function startBotsSafely() {
  const started = [];

  const bots = [
    {
      name: "User",
      token: process.env.TELEGRAM_BOT_TOKEN_USER,
      start: startUserBot,
    },
    {
      name: "Admin",
      token: process.env.TELEGRAM_BOT_TOKEN_ADMIN,
      start: startAdminBot,
    },
    {
      name: "SubAdmin",
      token: process.env.TELEGRAM_BOT_TOKEN_SUBADMIN,
      start: startSubAdminBot,
    },
  ];

  for (const bot of bots) {
    if (!bot.token) {
      console.warn(`[BOT] ⚠️ ${bot.name} bot token missing. Skipped.`);
      continue;
    }

    try {
      bot.start(bot.token);
      console.log(`[BOT] ✅ ${bot.name} bot started`);
      started.push(bot.name.toLowerCase());
    } catch (e) {
      console.error(`[BOT] ❌ ${bot.name} bot failed:`, e?.message || e);
    }
  }

  return started;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRACEFUL SHUTDOWN
═══════════════════════════════════════════════════════════════════════════ */
let server = null;
let shuttingDown = false;

async function closeWithTimeout(closeFn, timeoutMs = 10_000) {
  return Promise.race([
    new Promise((resolve) => closeFn(resolve)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("CLOSE_TIMEOUT")), timeoutMs)
    ),
  ]);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.warn(`\n[SHUTDOWN] ${signal} received. Shutting down gracefully...`);

  // 1) Stop accepting new HTTP connections
  if (server) {
    try {
      await closeWithTimeout((done) => server.close(done), 15_000);
      console.log("[SHUTDOWN] ✅ HTTP server closed");
    } catch (e) {
      console.error("[SHUTDOWN] ⚠️ HTTP server close error:", e?.message || e);
    }
  }

  // 2) Close MongoDB
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection?.readyState === 1) {
      await mongoose.connection.close(false);
      console.log("[SHUTDOWN] ✅ MongoDB connection closed");
    }
  } catch (e) {
    console.error("[SHUTDOWN] ⚠️ MongoDB close error:", e?.message || e);
  }

  console.log("[SHUTDOWN] Bye!");
  process.exit(0);
}

// Signal handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Fatal error handlers
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
  shutdown("unhandledRejection");
});

/* ═══════════════════════════════════════════════════════════════��═══════════
   STARTUP
═══════════════════════════════════════════════════════════════════════════ */
async function start() {
  try {
    console.log(`[STARTUP] Environment: ${NODE_ENV}`);
    console.log(`[STARTUP] Port: ${PORT}`);

    // 1) Connect to MongoDB
    await connectDB();

    // 2) Start Telegram bots
    const startedBots = await startBotsSafely();
    console.log(`[STARTUP] Bots started: ${startedBots.length > 0 ? startedBots.join(", ") : "none"}`);

    // 3) Create HTTP server
    server = http.createServer(app);

    // Production tuning
    server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65_000);
    server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 70_000);

    // Server error handler
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[FATAL] Port ${PORT} is already in use`);
        process.exit(1);
      }
      console.error("[HTTP_SERVER_ERROR]", err);
    });

    // 4) Initialize Socket.io
    initSocket(server);
    console.log("[STARTUP] ✅ Socket.io initialized");

    // 5) Start listening
    server.listen(PORT, () => {
      console.log(`[STARTUP] 🚀 Server running on port ${PORT}`);
      console.log("[STARTUP] ────────────────────────────────────");
    });

  } catch (err) {
    console.error("[STARTUP] ❌ Startup failed:", err);
    process.exit(1);
  }
}

// Go!
start();