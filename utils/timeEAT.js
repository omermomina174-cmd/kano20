// utils/timeEAT.js
"use strict";

/**
 * East Africa Time (EAT) Utilities
 * EAT = UTC+3 (no daylight saving)
 */

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // +3 hours in milliseconds
const EAT_OFFSET_HOURS = 3;

/**
 * Pad number to 2 digits
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Get current time as EAT parts object
 * @returns {{ year, month, day, hour, minute, second }}
 */
function getEATNow() {
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Addis_Ababa",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(new Date());
    const obj = {};
    for (const { type, value } of parts) {
      if (type !== "literal") obj[type] = value;
    }

    return {
      year: Number(obj.year),
      month: Number(obj.month),
      day: Number(obj.day),
      hour: Number(obj.hour),
      minute: Number(obj.minute),
      second: Number(obj.second),
    };
  } catch {
    // Fallback: manual UTC+3
    const now = new Date();
    const eatMs = now.getTime() + EAT_OFFSET_MS;
    const d = new Date(eatMs);

    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
}

/**
 * Get current EAT as JS Date (UTC adjusted)
 * @returns {Date}
 */
function getEATNowAsDate() {
  const now = new Date();
  return new Date(now.getTime() + EAT_OFFSET_MS);
}

/**
 * Get current EAT as formatted string: "DD-MM-YYYY HH:MM:SS"
 * @returns {string}
 */
function getEATNowString() {
  const { year, month, day, hour, minute, second } = getEATNow();
  return `${pad2(day)}-${pad2(month)}-${year} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

/**
 * Parse EAT datetime string to parts object
 * Formats: "DD/MM/YYYY HH:mm:ss" or "DD-MM-YYYY HH:mm:ss"
 * 
 * @param {string} str 
 * @returns {{ year, month, day, hour, minute, second } | null}
 */
function parseEATDateTimeString(str) {
  if (!str) return null;

  const m = String(str)
    .trim()
    .match(/^(\d{2})[/-](\d{2})[/-](\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);

  if (!m) return null;

  const [, dd, mm, yyyy, HH, MM, SS] = m;
  const out = {
    year: Number(yyyy),
    month: Number(mm),
    day: Number(dd),
    hour: Number(HH),
    minute: Number(MM),
    second: Number(SS),
  };

  // Basic range checks
  if (out.month < 1 || out.month > 12) return null;
  if (out.day < 1 || out.day > 31) return null;
  if (out.hour < 0 || out.hour > 23) return null;
  if (out.minute < 0 || out.minute > 59) return null;
  if (out.second < 0 || out.second > 59) return null;

  return out;
}

/**
 * Convert EAT parts to UTC milliseconds
 * EAT is UTC+3, so we subtract 3 hours
 * 
 * @param {{ year, month, day, hour, minute, second }} eat 
 * @returns {number} UTC milliseconds
 */
function eatPartsToMs(eat) {
  if (!eat) return NaN;
  return Date.UTC(
    eat.year,
    eat.month - 1,
    eat.day,
    eat.hour - EAT_OFFSET_HOURS,
    eat.minute,
    eat.second
  );
}

/**
 * Convert EAT parts to JS Date (UTC)
 * 
 * @param {{ year, month, day, hour, minute, second }} eat 
 * @returns {Date | null}
 */
function eatPartsToDate(eat) {
  const ms = eatPartsToMs(eat);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/**
 * Parse EAT datetime string directly to JS Date (UTC)
 * 
 * @param {string} str 
 * @returns {Date | null}
 */
function parseEATToDate(str) {
  const parts = parseEATDateTimeString(str);
  if (!parts) return null;
  return eatPartsToDate(parts);
}

/**
 * Convert any date-like value to JS Date
 * 
 * @param {*} v 
 * @returns {Date | null}
 */
function toJsDate(v) {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toJSDate === "function") return v.toJSDate(); // Luxon
    if (typeof v.toDate === "function") return v.toDate(); // dayjs/moment
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if two dates are the same day in EAT timezone
 * 
 * @param {Date|object} a 
 * @param {Date|object} b 
 * @returns {boolean}
 */
function sameEATDate(a, b) {
  const dateA = toJsDate(a);
  const dateB = toJsDate(b);

  if (!dateA || !dateB) return false;

  // Shift both to EAT, then compare Y/M/D
  const aEAT = new Date(dateA.getTime() + EAT_OFFSET_MS);
  const bEAT = new Date(dateB.getTime() + EAT_OFFSET_MS);

  return (
    aEAT.getUTCFullYear() === bEAT.getUTCFullYear() &&
    aEAT.getUTCMonth() === bEAT.getUTCMonth() &&
    aEAT.getUTCDate() === bEAT.getUTCDate()
  );
}

/**
 * Check if a date is today in EAT timezone
 * 
 * @param {Date|object} date 
 * @returns {boolean}
 */
function isTodayEAT(date) {
  return sameEATDate(date, new Date());
}

/**
 * Get start of today in EAT as UTC Date
 * 
 * @returns {Date}
 */
function getEATTodayStart() {
  const { year, month, day } = getEATNow();
  return new Date(Date.UTC(year, month - 1, day, -EAT_OFFSET_HOURS, 0, 0));
}

/**
 * Get end of today in EAT as UTC Date
 * 
 * @returns {Date}
 */
function getEATTodayEnd() {
  const { year, month, day } = getEATNow();
  return new Date(Date.UTC(year, month - 1, day, 24 - EAT_OFFSET_HOURS, 0, 0) - 1);
}

/**
 * Format a Date for logging (safe for any object type)
 * 
 * @param {*} v 
 * @returns {string}
 */
function formatDateLog(v) {
  try {
    if (!v) return "null";
    if (v instanceof Date) return v.toISOString();
    if (typeof v.toISO === "function") return v.toISO();
    if (typeof v.toISOString === "function") return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  } catch {
    return String(v);
  }
}

module.exports = {
  // Constants
  EAT_OFFSET_MS,
  EAT_OFFSET_HOURS,

  // Current time
  getEATNow,
  getEATNowAsDate,
  getEATNowString,
  getEATTodayStart,
  getEATTodayEnd,

  // Parsing
  parseEATDateTimeString,
  parseEATToDate,

  // Conversion
  eatPartsToMs,
  eatPartsToDate,
  toJsDate,

  // Comparison
  sameEATDate,
  isTodayEAT,

  // Utilities
  formatDateLog,
  pad2,
};

