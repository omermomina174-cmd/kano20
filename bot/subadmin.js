"use strict";

const TelegramBot = require("node-telegram-bot-api");

const SubAdmin = require("../models/subadmin");
const Admin = require("../models/admin");

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL ERROR HANDLERS
═══════════════════════════════════════════════════════════════════════════ */
if (!global.__SUBADMIN_BOT_ERROR_HANDLERS_REGISTERED__) {
  global.__SUBADMIN_BOT_ERROR_HANDLERS_REGISTERED__ = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[SUBADMIN_BOT] Unhandled Rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[SUBADMIN_BOT] Uncaught Exception:", error);
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
  BOT_USERNAME: process.env.SUBADMIN_BOT_USERNAME || process.env.BOT_USERNAME || "",
});

/* ═══════════════════════════════════════════════════════════════════════════
   KEYBOARDS
═══════════════════════════════════════════════════════════════════════════ */
const KEYBOARDS = Object.freeze({
  subadminKeyboard: {
    keyboard: [[{ text: "/subadmin_panel" }]],
    resize_keyboard: true,
    input_field_placeholder: "Tap to open panel",
  },

  contactRequest: {
    keyboard: [[{ text: "📱 Share My Phone Number", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Tap to share your contact",
  },

  remove: { remove_keyboard: true },
});

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE TEMPLATES
═══════════════════════════════════════════════════════════════════════════ */
const Messages = {
  welcome: (name) =>
`👋 *Welcome, ${name}!*

You're all set as a SubAdmin. Use the button below or type /subadmin_panel to access your dashboard.

እንኳን ደህና መጡ! ፓነሉን ለመክፈት ከታች ያለውን ይጫኑ።`,

  registered: () =>
`✅ *Registration Complete!*

You've been successfully registered as a SubAdmin.

በንዑስ አስተዳዳሪነት በተሳካ ሁኔታ ተመዝግበዋል።`,

  alreadyRegistered: () =>
`✅ *Already Registered*

You're already set up as a SubAdmin. Ready to go!

እርስዎ ቀድሞውኑ ተመዝግበዋል።`,

  shareContact: () =>
`📱 *Verification Required*

To continue, please share your phone number using the button below.

ለመቀጠል እባክዎ ስልክ ቁጥርዎን ያጋሩ 👇`,

  shareOwnContact: () =>
`⚠️ *Please Share Your Own Contact*

You need to share your own phone number, not someone else's.

Tap the button below to share correctly.

እባክዎ የራስዎን ስልክ ቁጥር ያጋሩ 👇`,

  accessDenied: () =>
`🚫 *Access Denied*

Your phone number is not registered in the system.

If you believe this is an error, please contact your administrator.

ስልክዎ በስርዓቱ ውስጥ አልተመዘገበም።`,

  blocked: () =>
`🔒 *Account Blocked*

Sorry, you have been blocked by the admin.

Please contact support for assistance.

ይቅርታ፣ መለያዎ በአስተዳዳሪው ታግዷል። እባክዎ ድጋፍን ያግኙ።`,

  privateOnly: () =>
`🔒 *Private Chat Only*

Please message me directly in a private chat to continue.

እባክዎ በግል ውይይት ይላኩኝ።`,

  openPanel: () =>
`🚀 *Open Your SubAdmin Panel*

Tap the button below to access your dashboard.

ፓነሉን ለመክፈት ከታች ይጫኑ 👇`,

  panelNotConfigured: () =>
`⚙️ *Configuration Error*

The SubAdmin panel URL is not configured. Please contact support.`,

  rateLimited: () =>
`⏳ *Please Slow Down*

Too many requests. Wait a moment and try again.

እባክዎ ትንሽ ይጠብቁ።`,

  error: () =>
`❌ *Something Went Wrong*

An error occurred. Please try again later.

ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።`,

  invalidContact: () =>
`❌ *Invalid Contact*

The contact you shared is invalid. Please try again.

የላኩት ስልክ ቁጥር ልክ አይደለም።`,
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
function buildSubadminPanelLink() {
  let base = String(process.env.WEBAPP_URL || "").trim();
  if (!base) return null;

  if (!/^https?:\/\//i.test(base)) base = "https://" + base;

  try {
    const url = new URL("/subadmin", base);
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

function roleIsSubadmin(role) {
  return String(role || "").trim().toLowerCase() === "subadmin";
}

function isBlocked(status) {
  return String(status || "").trim().toLowerCase() === "blocked";
}

function isSleep(status) {
  return String(status || "").trim().toLowerCase() === "sleep";
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
    throw new Error("SubAdmin bot token is missing or invalid.");
  }

  const bot = new TelegramBot(token, {
    polling: { autoStart: true, params: { timeout: 30 } },
  });

  console.log("[SUBADMIN_BOT] ✅ Bot started (polling).");

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
        console.warn(`[SUBADMIN_BOT] Bot blocked by chatId=${chatId}`);
        return null;
      }
      if (errMsg.includes("chat not found")) {
        console.warn(`[SUBADMIN_BOT] Chat not found chatId=${chatId}`);
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

      console.error("[SUBADMIN_BOT] sendMessage failed:", errMsg);
      return null;
    }
  }

  async function getSubAdminLean(telegramId) {
    return SubAdmin.findOne({ telegramId: String(telegramId) })
      .select("username telegramId chatId role status phoneNumber balance")
      .lean()
      .maxTimeMS(CONFIG.DB_MAX_TIME_MS);
  }

  async function ensureChatIdSaved(telegramId, chatId) {
    SubAdmin.updateOne(
      { telegramId: String(telegramId) },
      { $set: { chatId: String(chatId) } }
    ).catch(() => {});
  }

  async function checkSubAdminAccess(msg) {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return null;
    if (isRateLimited(telegramId)) {
      await safeSend(chatId, Messages.rateLimited());
      return null;
    }

    const subadmin = await getSubAdminLean(telegramId);

    if (!subadmin || !roleIsSubadmin(subadmin.role)) {
      await safeSend(chatId, Messages.accessDenied());
      return null;
    }

    // Check if blocked
    if (isBlocked(subadmin.status)) {
      await safeSend(chatId, Messages.blocked());
      return null;
    }

    // Sleep state has no effect - continue as normal
    // (no special handling needed for "sleep" status)

    if (!subadmin.chatId || String(subadmin.chatId) !== String(chatId)) {
      ensureChatIdSaved(telegramId, chatId);
    }

    return subadmin;
  }

  async function sendWelcome(msg, subadmin) {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || msg.from.username || subadmin?.username || "SubAdmin";

    await safeSend(chatId, Messages.welcome(name), {
      reply_markup: KEYBOARDS.subadminKeyboard,
    });
  }

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
      const subadmin = await getSubAdminLean(telegramId);

      if (subadmin && roleIsSubadmin(subadmin.role)) {
        // Check if blocked
        if (isBlocked(subadmin.status)) {
          await safeSend(chatId, Messages.blocked());
          return;
        }

        // Sleep state has no effect - continue as normal

        if (!subadmin.chatId || String(subadmin.chatId) !== String(chatId)) {
          ensureChatIdSaved(telegramId, chatId);
        }

        await sendWelcome(msg, subadmin);
        return;
      }

      // Not registered yet - ask for contact
      await safeSend(chatId, Messages.shareContact(), {
        reply_markup: KEYBOARDS.contactRequest,
      });
    } catch (err) {
      console.error("[SUBADMIN_BOT][/start] error:", err?.message || err);
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

    if (!isValidChatId(chatId) || !from?.id || !contact) return;

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

      // Ensure user shares their own contact
      if (!contact.user_id || String(contact.user_id) !== String(from.id)) {
        await safeSend(chatId, Messages.shareOwnContact(), {
          reply_markup: KEYBOARDS.contactRequest,
        });
        return;
      }

      const normalized09 = normalizeETPhone(contact.phone_number);
      const vars = phoneVariants(contact.phone_number);

      // Check if phone is in admin registry
      const adminMatch = await Admin.findOne({ registry: { $in: vars } })
        .select("_id")
        .lean()
        .maxTimeMS(CONFIG.DB_MAX_TIME_MS);

      if (!adminMatch) {
        await safeSend(chatId, Messages.accessDenied());
        return;
      }

      const telegramId = String(from.id);
      const chatIdStr = String(chatId);
      const username = from.username || contact.first_name || "SubAdmin";
      const phoneToStore = normalized09 || digitsOnly(contact.phone_number);

      // Check if user already exists
      let subadmin = await SubAdmin.findOne({ telegramId }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);

      if (!subadmin) {
        // New registration
        try {
          subadmin = await SubAdmin.create({
            telegramId,
            chatId: chatIdStr,
            username,
            phoneNumber: phoneToStore,
            role: "subadmin",
            status: "active",
            balance: 0,
          });

          await safeSend(chatId, Messages.registered(), {
            reply_markup: KEYBOARDS.remove,
          });
        } catch (e) {
          if (e?.code === 11000) {
            // Duplicate key - fetch existing
            subadmin = await SubAdmin.findOne({ telegramId }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);
          } else {
            throw e;
          }
        }
      } else {
        // User already registered - check status BEFORE continuing
        if (!roleIsSubadmin(subadmin.role)) {
          await safeSend(chatId, Messages.accessDenied());
          return;
        }

        // ✅ CRITICAL: Check if user is BLOCKED
        if (isBlocked(subadmin.status)) {
          await safeSend(chatId, Messages.blocked());
          return;
        }

        // ✅ Sleep state has no effect - continue as normal
        // (no special handling needed for "sleep" status)

        // Update info if needed
        const update = {};
        if (!subadmin.chatId || String(subadmin.chatId) !== chatIdStr) update.chatId = chatIdStr;
        if (!subadmin.phoneNumber) update.phoneNumber = phoneToStore;
        if (!subadmin.username && from.username) update.username = from.username;

        if (Object.keys(update).length > 0) {
          await SubAdmin.updateOne({ _id: subadmin._id }, { $set: update }).maxTimeMS(CONFIG.DB_MAX_TIME_MS);
        }

        await safeSend(chatId, Messages.alreadyRegistered(), {
          reply_markup: KEYBOARDS.remove,
        });
      }

      // Final check before welcome
      const fresh = await getSubAdminLean(telegramId);
      if (!fresh || !roleIsSubadmin(fresh.role)) {
        await safeSend(chatId, Messages.accessDenied());
        return;
      }

      if (isBlocked(fresh.status)) {
        await safeSend(chatId, Messages.blocked());
        return;
      }

      // Sleep state has no effect - continue to welcome
      await sendWelcome(msg, fresh);
    } catch (err) {
      console.error("[SUBADMIN_BOT][contact] error:", err?.message || err);
      await safeSend(chatId, Messages.error());
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     /subadmin_panel (WebApp)
  ═══════════════════════════════════════════════════════════════════════ */
  bot.onText(/^\/subadmin_panel(?:@\w+)?$/i, async (msg) => {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return;

    if (!isPrivateChat(msg)) {
      await safeSend(chatId, Messages.privateOnly());
      return;
    }

    if (isRateLimited(telegramId)) return;

    try {
      const subadmin = await checkSubAdminAccess(msg);
      if (!subadmin) return; // Already handled (blocked/denied)

      const panelLink = buildSubadminPanelLink();
      if (!panelLink) {
        await safeSend(chatId, Messages.panelNotConfigured());
        return;
      }

      await safeSend(chatId, Messages.openPanel(), {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Open SubAdmin Panel", web_app: { url: panelLink } }]],
        },
      });
    } catch (err) {
      console.error("[SUBADMIN_BOT][/subadmin_panel] error:", err?.message || err);
      await safeSend(chatId, Messages.error());
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Polling / bot errors
  ═══════════════════════════════════════════════════════════════════════ */
  bot.on("polling_error", (err) => {
    const msg = err?.message || String(err);

    if (msg.includes("ETIMEOUT") || msg.includes("ECONNRESET")) {
      console.warn("[SUBADMIN_BOT] Polling timeout/reset, will retry...");
      return;
    }

    if (String(err?.code) === "ETELEGRAM" && String(err?.response?.statusCode) === "409") {
      console.error("[SUBADMIN_BOT] Polling conflict (409). Another bot instance may be running.");
      bot.stopPolling().catch(() => {});
      return;
    }

    console.error("[SUBADMIN_BOT] polling_error:", msg);
  });

  bot.on("error", (err) => console.error("[SUBADMIN_BOT] error:", err?.message || err));

  /* ═══════════════════════════════════════════════════════════════════════
     Graceful shutdown
  ═══════════════════════════════════════════════════════════════════════ */
  const shutdown = async () => {
    console.log("[SUBADMIN_BOT] Shutting down...");
    try {
      await bot.stopPolling();
      console.log("[SUBADMIN_BOT] Polling stopped");
    } catch (e) {
      console.error("[SUBADMIN_BOT] Shutdown error:", e?.message || e);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return bot;
};