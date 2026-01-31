"use strict";

const cookieSession = require("cookie-session");

/**
 * Production-grade cookie-session factory.
 *
 * Notes:
 * - In production behind a proxy (Render/NGINX/Cloudflare), you MUST set:
 *   app.set("trust proxy", 1)
 *   otherwise secure cookies may not be set correctly.
 *
 * - sameSite:
 *   - If your WebApp is inside Telegram WebView + cross-site context, you often need:
 *     sameSite: "none" + secure: true (HTTPS)
 *   - In local dev, use "lax" and secure: false.
 *
 * Environment variables:
 *   SESSION_SECRET       - Required. Supports rotation: "key1,key2,key3"
 *   SESSION_SAMESITE     - Optional. "none" | "lax" | "strict"
 *   SESSION_COOKIE_DOMAIN- Optional. ".yourdomain.com" for cross-subdomain
 *   SESSION_MAX_AGE_DAYS - Optional. Default 7 days
 */

function getSessionSecretKeys() {
  const secret = String(process.env.SESSION_SECRET || "").trim();

  if (!secret) {
    throw new Error("[SESSION] SESSION_SECRET is not set");
  }

  // Support key rotation: SESSION_SECRET="currentKey,oldKey1,oldKey2"
  const keys = secret
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error("[SESSION] SESSION_SECRET is empty or invalid");
  }

  // Warn if key is too short
  if (keys[0].length < 32) {
    console.warn("[SESSION] ⚠️ SESSION_SECRET is shorter than 32 chars. Consider using a stronger key.");
  }

  return keys;
}

function normalizePath(p) {
  const s = String(p || "/").trim() || "/";
  return s.startsWith("/") ? s : "/" + s;
}

function parseSameSite(envValue, isProd) {
  const val = String(envValue || "").toLowerCase().trim();

  if (val === "none" || val === "lax" || val === "strict") {
    return val;
  }

  // Default: "none" in prod (for Telegram WebView cross-origin), "lax" in dev
  return isProd ? "none" : "lax";
}

function parseMaxAge() {
  const days = Number(process.env.SESSION_MAX_AGE_DAYS);
  if (Number.isFinite(days) && days > 0) {
    return days * 24 * 60 * 60 * 1000;
  }
  // Default: 7 days
  return 7 * 24 * 60 * 60 * 1000;
}

function makeCookieSession({ name, cookiePath }) {
  if (!name || typeof name !== "string") {
    throw new Error("[SESSION] Cookie name is required");
  }

  const isProd = process.env.NODE_ENV === "production";
  const keys = getSessionSecretKeys();

  const sameSite = parseSameSite(process.env.SESSION_SAMESITE, isProd);

  // Browser requirement: if sameSite is "none", secure MUST be true
  const secure = sameSite === "none" ? true : isProd;

  // Optional cookie domain (e.g., ".example.com" for cross-subdomain)
  const rawDomain = String(process.env.SESSION_COOKIE_DOMAIN || "").trim();
  const domain = rawDomain || undefined;

  const maxAge = parseMaxAge();

  const sessionMiddleware = cookieSession({
    name,
    keys,
  
    httpOnly: true,
    secure,
    secureProxy: true,   // <-- ADD THIS
    sameSite,
  
    path: normalizePath(cookiePath),
    maxAge,
  
    ...(domain && { domain }),
  });

  // Wrap to handle errors gracefully
  return function wrappedSession(req, res, next) {
    try {
      sessionMiddleware(req, res, (err) => {
        if (err) {
          console.error(`[SESSION] Error in ${name}:`, err?.message || err);
          // Clear potentially corrupted session
          req.session = null;
        }
        next();
      });
    } catch (err) {
      console.error(`[SESSION] Unexpected error in ${name}:`, err?.message || err);
      req.session = null;
      next();
    }
  };
}

// Validate on load (fail fast)
let sessionsExported = false;

try {
  getSessionSecretKeys();
  sessionsExported = true;
} catch (err) {
  console.error(err.message);
  // Don't crash immediately; let server.js handle it
}

module.exports = {
  // ✅ User cookie must be available for /home_user, /kano, and /socket.io session parsing
  userSession: makeCookieSession({ name: "user_sid", cookiePath: "/" }),

  // Admin/subadmin cookies scoped to their routes only
  adminSession: makeCookieSession({ name: "admin_sid", cookiePath: "/admin" }),
  subadminSession: makeCookieSession({ name: "subadmin_sid", cookiePath: "/subadmin" }),

  // Export factory for custom sessions if needed
  makeCookieSession,
};