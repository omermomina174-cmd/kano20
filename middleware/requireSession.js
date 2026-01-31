"use strict";

/**
 * Session guard middlewares.
 *
 * - Returns 401 JSON for API requests
 * - Returns 401 text for other requests (can be changed to redirect)
 * - Consistent error codes for frontend handling
 */

const ERROR_CODES = Object.freeze({
  NO_USER_SESSION: "NO_USER_SESSION",
  NO_ADMIN_SESSION: "NO_ADMIN_SESSION",
  NO_SUBADMIN_SESSION: "NO_SUBADMIN_SESSION",
});

/**
 * Detect if request expects JSON response
 */
function wantsJson(req) {
  const accept = String(req.headers.accept || "").toLowerCase();

  // Explicit JSON accept header
  if (accept.includes("application/json")) return true;

  // XMLHttpRequest (AJAX)
  if (req.xhr) return true;

  // API path convention
  if (req.path.includes("/api/")) return true;

  // Content-Type hint (for POST/PUT with JSON body)
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) return true;

  return false;
}

/**
 * Send 401 response
 */
function denyAccess(req, res, code, redirectUrl = null) {
  if (wantsJson(req)) {
    return res.status(401).json({
      ok: false,
      error: code,
      message: "Session required",
    });
  }

  // For non-API requests, optionally redirect
  if (redirectUrl) {
    return res.redirect(redirectUrl);
  }

  return res.status(401).send("Unauthorized");
}

/**
 * Validate session exists and has required field
 */
function hasValidSession(session, field) {
  if (!session) return false;
  if (typeof session !== "object") return false;

  const value = session[field];
  if (!value) return false;

  // Basic validation: must be non-empty string or positive number
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return value > 0;

  return false;
}

/**
 * User session guard
 * Checks: req.session.user.telegramId
 */
function requireUserSession(req, res, next) {
  const session = req.session?.user;

  if (!hasValidSession(session, "telegramId")) {
    return denyAccess(req, res, ERROR_CODES.NO_USER_SESSION);
  }

  next();
}

/**
 * Admin session guard
 * Checks: req.session.admin.telegramId
 */
function requireAdminSession(req, res, next) {
  const session = req.session?.admin;

  if (!hasValidSession(session, "telegramId")) {
    return denyAccess(req, res, ERROR_CODES.NO_ADMIN_SESSION);
  }

  next();
}

/**
 * Subadmin session guard
 * Checks: req.session.subadmin.telegramId
 */
function requireSubadminSession(req, res, next) {
  const session = req.session?.subadmin;

  if (!hasValidSession(session, "telegramId")) {
    return denyAccess(req, res, ERROR_CODES.NO_SUBADMIN_SESSION);
  }

  next();
}

/**
 * Factory for custom session guards
 *
 * @example
 * const requireModerator = createSessionGuard("moderator", "userId", "NO_MOD_SESSION");
 */
function createSessionGuard(sessionKey, requiredField, errorCode) {
  return function (req, res, next) {
    const session = req.session?.[sessionKey];

    if (!hasValidSession(session, requiredField)) {
      return denyAccess(req, res, errorCode);
    }

    next();
  };
}

/**
 * Optional session middleware - doesn't block, just validates
 * Useful for routes that work with or without session
 */
function optionalUserSession(req, res, next) {
  // Just ensure session object exists (even if empty)
  if (!req.session) {
    req.session = {};
  }
  next();
}

module.exports = {
  requireUserSession,
  requireAdminSession,
  requireSubadminSession,

  // Utilities
  createSessionGuard,
  optionalUserSession,
  wantsJson,

  // Error codes for frontend reference
  ERROR_CODES,
};


