"use strict";

const crypto = require("crypto");

function verifyTelegramWebAppData(initData, botToken) {
  if (!initData || !botToken) return null;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  if (!hash) return null;

  urlParams.delete("hash");

  const dataCheckArray = [];
  for (const [key, value] of urlParams.entries()) {
    dataCheckArray.push(`${key}=${value}`);
  }
  dataCheckArray.sort();
  const dataCheckString = dataCheckArray.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) return null;

  const userStr = urlParams.get("user");
  if (!userStr) return null;

  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

/**
 * Middleware factory:
 * - reads initData from req.body.initData
 * - verifies with env bot token
 * - sets req.tgUser
 */
function requireTelegramInitData(botTokenEnvName) {
  return (req, res, next) => {
    const initData = req.body?.initData;
    if (!initData) return res.status(400).json({ ok: false, error: "NO_INITDATA" });

    const botToken = process.env[botTokenEnvName];
    if (!botToken) return res.status(500).json({ ok: false, error: `MISSING_${botTokenEnvName}` });

    const tgUser = verifyTelegramWebAppData(initData, botToken);
    if (!tgUser) return res.status(401).json({ ok: false, error: "INITDATA_INVALID" });

    req.tgUser = tgUser;
    next();
  };
}

module.exports = { verifyTelegramWebAppData, requireTelegramInitData };