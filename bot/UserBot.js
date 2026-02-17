"use strict";

const TelegramBot = require("node-telegram-bot-api");
const Admin = require("../models/admin");

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL ERROR HANDLERS
═══════════════════════════════════════════════════════════════════════════ */
if (!global.__ADMIN_BOT_ERROR_HANDLERS_REGISTERED__) {
  global.__ADMIN_BOT_ERROR_HANDLERS_REGISTERED__ = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[ADMIN_BOT] Unhandled Rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[ADMIN_BOT] Uncaught Exception:", error);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const CONFIG = Object.freeze({
  MAX_MESSAGE_LENGTH: 4096,
  DB_MAX_TIME_MS: 5000,
  RATE_LIMIT_WINDOW_MS: 1000,
  MAX_REQUESTS_PER_WINDOW: 4,
  BOT_USERNAME: process.env.ADMIN_BOT_USERNAME || process.env.BOT_USERNAME || "",
});

/* ═══════════════════════════════════════════════════════════════════════════
   KEYBOARDS
═══════════════════════════════════════════════════════════════════════════ */
const KEYBOARDS = Object.freeze({
  contactRequest: {
    keyboard: [[{ text: "📱 Share Phone Number", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Tap to share your contact",
  },

  remove: { remove_keyboard: true },
});

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE TEMPLATES (Simple & Clean)
═══════════════════════════════════════════════════════════════════════════ */
const Messages = {
  welcome: (name) =>
`👑 *Welcome, ${name}!*

You're all set. Tap below to access your Admin Panel.

እንኳን ደህና መጡ!`,

  registered: (name) =>
`✅ *Registration Complete!*

Welcome aboard, *${name}*! You now have full admin access.

በተሳካ ሁኔታ ተመዝግበዋል።`,

  alreadyRegistered: () =>
`✅ *Already Registered*

You're already set up as Admin.

እርስዎ ቀድሞውኑ ተመዝግበዋል።`,

  shareContact: () =>
`📱 *Verification Required*

Share your phone number to continue.

ስልክ ቁጥርዎን ያጋሩ 👇`,

  shareOwnContact: () =>
`⚠️ *Share Your Own Contact*

Please share *your* phone number.

የራስዎን ስልክ ቁጥር ያጋሩ 👇`,

  accessDenied: () =>
`🚫 *Access Denied*

Your phone number is not authorized.

ስልክዎ ፈቃድ የለውም።`,

  registrationDisabled: () =>
`⚠️ *Registration Unavailable*

Admin registration is currently disabled.

Please contact the system administrator.`,

  privateOnly: () =>
`🔒 *Private Chat Only*

Please message me directly.

በግል ውይይት ይላኩኝ።`,

  openPanel: () =>
`🚀 *Admin Panel*

Tap below to access the dashboard.

ፓነሉን ለመክፈት ከታች ይጫኑ 👇`,

  panelNotConfigured: () =>
`⚙️ *Configuration Error*

Admin panel URL not configured.

Please contact the developer.`,

  rateLimited: () =>
`⏳ *Slow Down*

Too many requests. Wait a moment.

እባክዎ ይጠብቁ።`,

  error: () =>
`❌ *Error*

Something went wrong. Try again.

ስህተት ተከስቷል።`,

  invalidContact: () =>
`❌ *Invalid Contact*

Please try again.

እባክዎ እንደገና ይሞክሩ።`,
};

/* ═══════════════════════════════════════════════════════════════════════════
   Phone helpers (Ethiopia-friendly)
═══════════════════════════════════════════════════════════════════════════ */
function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function normalizeETPhone(v) {
  const d = digitsOnly(v);
  if (!d) return "";

  if (d.startsWith("251") && d.length === 12 && d[3] === "9") return "0" + d.slice(3);
  if (d.length === 9 && d.startsWith("9")) return "0" + d;
  if (d.length === 10 && d.startsWith("0")) return d;

  return d;
}

function phoneVariants(v) {
  const p = normalizeETPhone(v);
  const out = new Set();
  if (!p) return [];

  out.add(p);

  if (p.length === 10 && p.startsWith("0") && p[1] === "9") {
    out.add(p.slice(1));
    out.add("251" + p.slice(1));
  }

  const raw = digitsOnly(v);
  if (raw) out.add(raw);

  return [...out];
}

/* ═══════════════════════════════════════════════════════════════════════════
   WebApp link builder
═══════════════════════════════════════════════════════════════════════════ */
function buildAdminPanelLink() {
  let base = String(process.env.WEBAPP_URL || "").trim();
  if (!base) return null;

  if (!/^https?:\/\//i.test(base)) base = "https://" + base;

  try {
    const url = new URL("/admin", base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════════════════════════════════ */
function isPrivateChat(msg) {
  return msg?.chat?.type === "private";
}

function roleIsAdmin(role) {
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "superadmin";
}

function isValidChatId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n !== 0;
}

function isValidTelegramId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Build allowed admin phone set from environment
═══════════════════════════════════════════════════════════════════════════ */
function buildAdminPhoneSet() {
  const phoneSet = new Set();
  const rawPhones = String(process.env.ADMIN_PHONES || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const phone of rawPhones) {
    for (const variant of phoneVariants(phone)) {
      phoneSet.add(variant);
    }
  }

  return phoneSet;
}

const ADMIN_PHONE_SET = buildAdminPhoneSet();

/* ═══════════════════════════════════════════════════════════════════════════
   Rate limiting
═══════════════════════════════════════════════════════════════════════════ */
const rateMap = new Map();

function isRateLimited(telegramId) {
  const now = Date.now();
  const key = String(telegramId);
  const entry = rateMap.get(key);

  if (!entry || now - entry.windowStart > CONFIG.RATE_LIMIT_WINDOW_MS) {
    rateMap.set(key, { windowStart: now, count: 1 });
    return false;
  }

  entry.count++;
  return entry.count > CONFIG.MAX_REQUESTS_PER_WINDOW;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateMap.entries()) {
    if (now - v.windowStart > CONFIG.RATE_LIMIT_WINDOW_MS * 20) rateMap.delete(k);
  }
}, 60_000).unref?.();

/* ═══════════════════════════════════════════════════════════════════════════
   Bot factory
═══════════════════════════════════════════════════════════════════════════ */
module.exports = (token) => {
  if (!token || typeof token !== "string" || token.length < 20) {
    throw new Error("Admin bot token is missing or invalid.");
  }

  const bot = new TelegramBot(token, {
    polling: { autoStart: true, params: { timeout: 30 } },
  });

  console.log("[ADMIN_BOT] ✅ Bot started (polling).");

  async function safeSend(chatId, text, options = {}) {
    if (!isValidChatId(chatId)) return null;
    const msg = String(text ?? "").slice(0, CONFIG.MAX_MESSAGE_LENGTH);
    if (!msg) return null;

    try {
      return await bot.sendMessage(chatId, msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        allow_sending_without_reply: true,
        ...options,
      });
    } catch (e) {
      const errMsg = e?.message || String(e);

      if (errMsg.includes("bot was blocked")) {
        console.warn(`[ADMIN_BOT] Bot blocked by chatId=${chatId}`);
        return null;
      }
      if (errMsg.includes("chat not found")) {
        console.warn(`[ADMIN_BOT] Chat not found chatId=${chatId}`);
        return null;
      }

      // Retry without markdown
      if (errMsg.toLowerCase().includes("can't parse")) {
        return bot.sendMessage(chatId, msg, {
          disable_web_page_preview: true,
          allow_sending_without_reply: true,
          ...options,
          parse_mode: undefined,
        });
      }

      console.error("[ADMIN_BOT] sendMessage failed:", errMsg);
      return null;
    }
  }

  async function getAdminLean(telegramId) {
    return Admin.findOne({ telegramId: String(telegramId) })
      .select("username telegramId chatId role phoneNumber")
      .lean()
      .maxTimeMS(CONFIG.DB_MAX_TIME_MS);
  }

  async function ensureChatIdSaved(telegramId, chatId) {
    Admin.updateOne(
      { telegramId: String(telegramId) },
      { $set: { chatId: String(chatId) } }
    ).catch(() => {});
  }

  async function checkAdminAccess(msg) {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return null;
    if (isRateLimited(telegramId)) {
      await safeSend(chatId, Messages.rateLimited());
      return null;
    }

    const admin = await getAdminLean(telegramId);

    if (!admin || !roleIsAdmin(admin.role)) {
      await safeSend(chatId, Messages.accessDenied());
      return null;
    }

    if (!admin.chatId || String(admin.chatId) !== String(chatId)) {
      ensureChatIdSaved(telegramId, chatId);
    }

    return admin;
  }

  async function sendPanelAccess(chatId, messageText) {
    const panelUrl = buildAdminPanelLink();

    if (!panelUrl) {
      return safeSend(chatId, Messages.panelNotConfigured(), {
        reply_markup: KEYBOARDS.remove,
      });
    }

    return safeSend(chatId, messageText, {
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 Open Admin Panel", web_app: { url: panelUrl } }]],
      },
    });
  }

  async function sendWelcome(msg, admin) {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || msg.from.username || admin?.username || "Admin";

    return sendPanelAccess(chatId, Messages.welcome(name));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Set bot commands
  ═══════════════════════════════════════════════════════════════════════ */
  bot.setMyCommands([
    { command: "start", description: "🏠 Start / ጀምር" },
    { command: "admin_panel", description: "🚀 Open Panel / ፓነል" },
  ]).catch(() => {});

  /* ═══════════════════════════════════════════════════════════════════════
     /start
  ═══════════════════════════════════════════════════════════════════════ */
  bot.onText(/^\/start(?:@\w+)?$/i, async (msg) => {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return;

    if (!isPrivateChat(msg)) {
      await safeSend(chatId, Messages.privateOnly());
      return;
    }

    if (isRateLimited(telegramId)) return;

    try {
      const admin = await getAdminLean(telegramId);

      if (admin && roleIsAdmin(admin.role)) {
        if (!admin.chatId || String(admin.chatId) !== String(chatId)) {
          ensureChatIdSaved(telegramId, chatId);
        }

        await sendWelcome(msg, admin);
        return;
      }

      // Check if registration is enabled
      if (ADMIN_PHONE_SET.size === 0) {
        await safeSend(chatId, Messages.registrationDisabled());
        return;
      }

      await safeSend(chatId, Messages.shareContact(), {
        reply_markup: KEYBOARDS.contactRequest,
      });
    } catch (err) {
      console.error("[ADMIN_BOT][/start] error:", err?.message || err);
      await safeSend(chatId, Messages.error());
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Contact registration
  ═══════════════════════════════════════════════════════════════════════ */
  bot.on("contact", async (msg) => {
    const chatId = msg?.chat?.id;
    const from = msg?.from;
    const contact = msg?.contact;

    if (!isValidChatId(chatId) || !isValidTelegramId(from?.id) || !contact) return;

    if (!isPrivateChat(msg)) {
      await safeSend(chatId, Messages.privateOnly());
      return;
    }

    if (isRateLimited(from.id)) return;

    try {
      if (!contact.phone_number) {
        await safeSend(chatId, Messages.invalidContact());
        return;
      }

      if (!contact.user_id || String(contact.user_id) !== String(from.id)) {
        await safeSend(chatId, Messages.shareOwnContact(), {
          reply_markup: KEYBOARDS.contactRequest,
        });
        return;
      }

      const normalized09 = normalizeETPhone(contact.phone_number);
      const vars = phoneVariants(contact.phone_number);

      // Check if phone is in allowed admin phones
      const isAllowed = vars.some((v) => ADMIN_PHONE_SET.has(v));

      if (!isAllowed) {
        await safeSend(chatId, Messages.accessDenied());
        return;
      }

      const telegramId = String(from.id);
      const chatIdStr = String(chatId);
      const username = from.username || contact.first_name || "Admin";
      const phoneToStore = normalized09 || digitsOnly(contact.phone_number);
      const displayName = from.first_name || username;

      let admin = await Admin.findOne({
        $or: [
          { telegramId },
          { phoneNumber: { $in: vars } },
        ],
      }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);

      if (!admin) {
        try {
          admin = await Admin.create({
            telegramId,
            chatId: chatIdStr,
            username,
            phoneNumber: phoneToStore,
            role: "admin",
          });

          await safeSend(chatId, Messages.registered(displayName), {
            reply_markup: KEYBOARDS.remove,
          });
        } catch (e) {
          if (e?.code === 11000) {
            admin = await Admin.findOne({
              $or: [
                { telegramId },
                { phoneNumber: { $in: vars } },
              ],
            }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);
          } else {
            throw e;
          }
        }
      } else {
        const update = {};
        if (!admin.telegramId || String(admin.telegramId) !== telegramId) update.telegramId = telegramId;
        if (!admin.chatId || String(admin.chatId) !== chatIdStr) update.chatId = chatIdStr;
        if (!admin.phoneNumber) update.phoneNumber = phoneToStore;
        if (!admin.username && from.username) update.username = from.username;

        if (Object.keys(update).length > 0) {
          await Admin.updateOne({ _id: admin._id }, { $set: update }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);
        }

        await safeSend(chatId, Messages.alreadyRegistered(), {
          reply_markup: KEYBOARDS.remove,
        });
      }

      const fresh = await getAdminLean(telegramId);
      if (!fresh || !roleIsAdmin(fresh.role)) {
        await safeSend(chatId, Messages.accessDenied());
        return;
      }

      await sendWelcome(msg, fresh);
    } catch (err) {
      console.error("[ADMIN_BOT][contact] error:", err?.message || err);
      await safeSend(chatId, Messages.error());
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     /admin_panel (WebApp)
  ═══════════════════════════════════════════════════════════════════════ */
  bot.onText(/^\/admin_panel(?:@\w+)?$/i, async (msg) => {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return;

    if (!isPrivateChat(msg)) {
      await safeSend(chatId, Messages.privateOnly());
      return;
    }

    if (isRateLimited(telegramId)) return;

    try {
      const admin = await checkAdminAccess(msg);
      if (!admin) return;

      await sendPanelAccess(chatId, Messages.openPanel());
    } catch (err) {
      console.error("[ADMIN_BOT][/admin_panel] error:", err?.message || err);
      await safeSend(chatId, Messages.error());
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Polling / bot errors
  ═══════════════════════════════════════════════════════════════════════ */
  bot.on("polling_error", (err) => {
    const msg = err?.message || String(err);

    if (msg.includes("ETIMEOUT") || msg.includes("ECONNRESET")) {
      console.warn("[ADMIN_BOT] Polling timeout/reset, will retry...");
      return;
    }

    if (String(err?.code) === "ETELEGRAM" && String(err?.response?.statusCode) === "409") {
      console.error("[ADMIN_BOT] Polling conflict (409). Another bot instance may be running.");
      bot.stopPolling().catch(() => {});
      return;
    }

    console.error("[ADMIN_BOT] polling_error:", msg);
  });

  bot.on("error", (err) => console.error("[ADMIN_BOT] error:", err?.message || err));

  /* ═══════════════════════════════════════════════════════════════════════
     Graceful shutdown
  ═══════════════════════════════════════════════════════════════════════ */
  const shutdown = async () => {
    console.log("[ADMIN_BOT] Shutting down...");
    try {
      await bot.stopPolling();
      console.log("[ADMIN_BOT] Polling stopped");
    } catch (e) {
      console.error("[ADMIN_BOT] Shutdown error:", e?.message || e);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return bot;
};
