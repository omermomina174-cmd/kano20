"use strict";

const TelegramBot = require("node-telegram-bot-api");
const User = require("../models/user");
const Admin = require("../models/admin");
const deposit = require("../handlers/deposit");
const withdraw = require("../handlers/withdraw");

/**
 * 🎮 KANO 20 USER BOT
 * Clean, professional & user-friendly
 */

module.exports = function createUserBot(token, WEBAPP_URL) {
  if (!token) throw new Error("[USER_BOT] Missing bot token");

  const bot = new TelegramBot(token, { polling: true });
  console.log("[USER_BOT] ✅ Bot started successfully");

  /* ═══════════════════════════════════════════
     ⚙️ CONFIGURATION
  ═══════════════════════════════════════════ */

  const CONFIG = {
    BOT_USERNAME: process.env.USER_BOT_USERNAME || "",
    MAX_MESSAGE_LENGTH: 4096,
    DEFAULT_USER_LIMIT: 1000,
    SUPPORT_USERNAME: "kanogameultra", // Support contact username
    DB_MAX_TIME_MS: 5000,
  };

  /* ═══════════════════════════════════════════
     🎨 KEYBOARD LAYOUTS
  ═══════════════════════════════════════════ */

  const Keyboards = {
    contact: {
      reply_markup: {
        keyboard: [
          [{ text: "📱 Share Phone Number", request_contact: true }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },

    mainMenu: {
      reply_markup: {
        keyboard: [
          [{ text: "🎮 Play" }, { text: "💰 Balance" }],
          [{ text: "💳 Deposit" }, { text: "💸 Withdraw" }],
          [{ text: "📞 Support" }],
        ],
        resize_keyboard: true,
      },
    },

    cancel: {
      reply_markup: {
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true,
      },
    },

    playButton: (url) => ({
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎮 Launch Game", web_app: { url } }],
        ],
      },
    }),

    supportButton: (username) => ({
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 Contact Support", url: `https://t.me/${username}` }],
          [{ text: "🔙 Back", callback_data: "back_to_menu" }],
        ],
      },
    }),

    remove: {
      reply_markup: { remove_keyboard: true },
    },
  };

  /* ═══════════════════════════════════════════
     🔧 UTILITY FUNCTIONS
  ═══════════════════════════════════════════ */

  const Utils = {
    escapeMarkdown(text) {
      return String(text ?? "").replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
    },

    isPrivateChat(msg) {
      return msg?.chat?.type === "private";
    },

    digitsOnly(value) {
      return String(value ?? "").replace(/\D/g, "");
    },

    normalizePhone(raw) {
      const digits = this.digitsOnly(raw);
      if (digits.startsWith("251") && digits.length === 12) {
        return "0" + digits.slice(3);
      }
      if (digits.length === 9 && digits.startsWith("9")) {
        return "0" + digits;
      }
      if (digits.length === 10 && digits.startsWith("0")) {
        return digits;
      }
      return digits || "";
    },

    formatBalance(balance) {
      return Number(balance ?? 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },

    buildWebAppUrl(base, path) {
      try {
        let url = String(base ?? "").trim();
        if (!url) return null;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        const fullUrl = new URL(path, url);
        return fullUrl.protocol === "https:" ? fullUrl.toString() : null;
      } catch {
        return null;
      }
    },
  };

  /* ═══════════════════════════════════════════
     📤 SAFE MESSAGE SENDER
  ═══════════════════════════════════════════ */

  async function safeSend(chatId, text, options = {}) {
    if (!chatId || !text) return null;

    const message = String(text).slice(0, CONFIG.MAX_MESSAGE_LENGTH);

    try {
      return await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        ...options,
      });
    } catch (error) {
      if (error?.message?.toLowerCase().includes("can't parse")) {
        return bot.sendMessage(chatId, message, {
          disable_web_page_preview: true,
          ...options,
          parse_mode: undefined,
        });
      }
      console.error("[USER_BOT] Send error:", error?.message);
      return null;
    }
  }

  /* ═══════════════════════════════════════════
     👤 USER FUNCTIONS
  ═══════════════════════════════════════════ */

  async function findUser(telegramId) {
    return User.findOne({ telegramId: String(telegramId) })
      .select("username telegramId chatId role status phoneNo Balance")
      .lean()
      .maxTimeMS(CONFIG.DB_MAX_TIME_MS);
  }

  function isBlocked(user) {
    return String(user?.status || "").toLowerCase() === "blocked";
  }

  function isValidChatId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n !== 0;
  }

  function isValidTelegramId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0;
  }

  async function getUserLimit() {
    try {
      const settings = await Admin.getSystemSettings();
      return settings.maxUserLimit || CONFIG.DEFAULT_USER_LIMIT;
    } catch {
      return CONFIG.DEFAULT_USER_LIMIT;
    }
  }

  async function canRegisterNewUser() {
    const [currentCount, maxLimit] = await Promise.all([
      User.countDocuments({ role: "user" }),
      getUserLimit(),
    ]);
    return currentCount < maxLimit;
  }

  /* ═══════════════════════════════════════════
     💬 MESSAGE TEMPLATES (Simple & Beautiful)
  ═══════════════════════════════════════════ */

  const Messages = {
    welcome: () =>
`🎰 *Welcome to KANO 20!*
እንኳን ደህና መጡ!

🏆 Win up to *50,000 ብር* daily
⚡ Instant prizes & fast payouts

To start, share your phone number below 👇
ለመጀመር ስልክ ቁጥርዎን ያጋሩ`,

    registered: () =>
`✅ *You're All Set!*
በተሳካ ሁኔታ ተመዝግበዋል!

🎮 Play games / ጫወት
💰 Check balance / ቀሪ ሂሳብ
💳 Deposit & withdraw / ገንዘብ ያስገቡ/ያውጡ

Use the menu below to begin 👇`,

    welcomeBack: (name) =>
`👋 *Welcome Back!*
እንኳን ደህና ተመለሱ!

Hello, *${Utils.escapeMarkdown(name)}*! 
Ready to play?`,

    menu: (user) => {
      const name = user?.username || "Player";
      const balance = Utils.formatBalance(user?.Balance);

      return `🎰 *KANO 20*

👤 ${Utils.escapeMarkdown(name)}
💰 Balance: \`${balance}\` ብር

Choose an option below:`;
    },

    balance: (user) => {
      const balance = Utils.formatBalance(user?.Balance);

      return `💰 *Your Balance*

💵 \`${balance}\` ብር

💳 Deposit — Add funds
💸 Withdraw — Cash out
🎮 Play — Win more!`;
    },

    play: () =>
`🎮 *Ready to Play!*

🎯 Pick your numbers
🏆 Win instantly
💰 Up to 50,000 ብር

🍀 Good luck!
መልካም ዕድል!

Tap below to start 👇`,

    support: () =>
`📞 *Support*

Need help? Contact us:

• Deposit/Withdrawal
• Game questions
• Technical issues
• General inquiries

⏰ Response: Usually 24 hours

Tap below 👇`,

    blocked: () =>
`🚫 *Account Blocked*

Your account has been blocked by admin.
Please contact support.

መለያዎ ታግዷል። ድጋፍን ያግኙ።`,

    privateOnly: () =>
`🔒 *Private Chat Only*

Please message me directly.
እባክዎ በግል ውይይት ይላኩኝ።`,

    shareOwnContact: () =>
`⚠️ *Share Your Own Contact*

Please share *your* phone number.
የራስዎን ስልክ ቁጥር ያጋሩ።

Tap below 👇`,

    registerFirst: () =>
`📱 *Registration Required*

Please register first.
መጀመሪያ ይመዝገቡ።

Share your contact below 👇`,

    limitReached: () =>
`⏳ *Registration Full*

Maximum users reached.
Try again later!

በቀጣይ ይሞክሩ።`,

    configError: () =>
`⚙️ *Temporarily Unavailable*

Service unavailable. Try later.
እባክዎ ቆይተው ይሞክሩ።`,

    cancelled: () =>
`❌ *Cancelled*

Use the menu below 👇`,

    nothingToCancel: () =>
`ℹ️ *Nothing to Cancel*

Choose from menu below 👇`,

    error: () =>
`❌ *Error*

Something went wrong. Try again.
እባክዎ እንደገና ይሞክሩ።`,

    invalidContact: () =>
`❌ *Invalid Contact*

Please try again.
እባክዎ እንደገና ይሞክሩ።`,
  };

  /* ═══════════════════════════════════════════
     🎯 SCREEN DISPLAYS
  ═══════════════════════════════════════════ */

  async function showMenu(chatId, user) {
    return safeSend(chatId, Messages.menu(user), Keyboards.mainMenu);
  }

  async function showBalance(chatId, user) {
    return safeSend(chatId, Messages.balance(user), Keyboards.mainMenu);
  }

  async function showPlay(chatId) {
    const baseUrl = WEBAPP_URL || process.env.WEBAPP_URL;
    const url = Utils.buildWebAppUrl(baseUrl, "/home_user");

    if (!url) {
      return safeSend(chatId, Messages.configError(), Keyboards.mainMenu);
    }

    return safeSend(chatId, Messages.play(), Keyboards.playButton(url));
  }

  async function showSupport(chatId) {
    return safeSend(
      chatId,
      Messages.support(),
      Keyboards.supportButton(CONFIG.SUPPORT_USERNAME)
    );
  }

  /* ═══════════════════════════════════════════
     ✅ REQUIRE USER MIDDLEWARE
  ═══════════════════════════════════════════ */

  async function requireUser(msg) {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) {
      return { ok: false };
    }

    if (!Utils.isPrivateChat(msg)) {
      await safeSend(chatId, Messages.privateOnly());
      return { ok: false };
    }

    const user = await findUser(telegramId);

    if (!user) {
      await safeSend(chatId, Messages.registerFirst(), Keyboards.contact);
      return { ok: false };
    }

    // ✅ CRITICAL: Check if user is BLOCKED
    if (isBlocked(user)) {
      await safeSend(chatId, Messages.blocked());
      return { ok: false };
    }

    return {
      ok: true,
      user,
      chatId,
      telegramId: String(telegramId),
    };
  }

  /* ═══════════════════════════════════════════
     🎮 COMMAND HANDLERS
  ═══════════════════════════════════════════ */

  async function handleStart(msg) {
    const chatId = msg?.chat?.id;
    const telegramId = msg?.from?.id;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId)) return;

    if (!Utils.isPrivateChat(msg)) {
      return safeSend(chatId, Messages.privateOnly());
    }

    const user = await findUser(telegramId);

    if (!user) {
      return safeSend(chatId, Messages.welcome(), Keyboards.contact);
    }

    // ✅ Check if blocked
    if (isBlocked(user)) {
      return safeSend(chatId, Messages.blocked());
    }

    return showMenu(chatId, user);
  }

  async function handlePlay(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;
    return showPlay(result.chatId);
  }

  async function handleBalance(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;
    
    // Refresh user data for latest balance
    const fresh = await findUser(result.telegramId);
    if (!fresh || isBlocked(fresh)) {
      return safeSend(result.chatId, Messages.blocked());
    }
    
    return showBalance(result.chatId, fresh);
  }

  async function handleDeposit(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;

    if (deposit?.startDeposit) {
      return deposit.startDeposit(bot, msg, result.user, safeSend);
    }
  }

  async function handleWithdraw(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;

    if (withdraw?.startWithdraw) {
      return withdraw.startWithdraw(bot, msg, result.user, safeSend);
    }
  }

  async function handleSupport(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;
    return showSupport(result.chatId);
  }

  async function handleCancel(msg) {
    const result = await requireUser(msg);
    if (!result.ok) return;

    if (deposit?.handleDepositFlow) {
      const cancelMsg = { ...msg, text: "/cancel" };
      const handled = await deposit.handleDepositFlow(bot, cancelMsg, result.user, safeSend);
      if (handled) {
        const fresh = await findUser(result.telegramId);
        return showMenu(result.chatId, fresh);
      }
    }

    if (withdraw?.handleWithdrawFlow) {
      const cancelMsg = { ...msg, text: "/cancel" };
      const handled = await withdraw.handleWithdrawFlow(bot, cancelMsg, result.user, safeSend);
      if (handled) {
        const fresh = await findUser(result.telegramId);
        return showMenu(result.chatId, fresh);
      }
    }

    await safeSend(result.chatId, Messages.nothingToCancel(), Keyboards.mainMenu);
  }

  /* ═══════════════════════════════════════════
     📋 SET BOT COMMANDS
  ═══════════════════════════════════════════ */

  bot.setMyCommands([
    { command: "start", description: "🏠 Start / ጀምር" },
    { command: "play", description: "🎮 Play / ጫወት" },
    { command: "balance", description: "💰 Balance / ቀሪ ሂሳብ" },
    { command: "deposit", description: "💳 Deposit / ገንዘብ አስገባ" },
    { command: "withdraw", description: "💸 Withdraw / ገንዘብ አውጣ" },
    { command: "support", description: "📞 Support / ድጋፍ" },
    { command: "cancel", description: "❌ Cancel / ሰርዝ" },
  ]).catch(() => {});

  /* ═══════════════════════════════════════════
     📡 COMMAND LISTENERS
  ═══════════════════════════════════════════ */

  bot.onText(/^\/start(?:@\w+)?$/i, handleStart);
  bot.onText(/^\/play(?:@\w+)?$/i, handlePlay);
  bot.onText(/^\/balance(?:@\w+)?$/i, handleBalance);
  bot.onText(/^\/deposit(?:@\w+)?$/i, handleDeposit);
  bot.onText(/^\/withdraw(?:@\w+)?$/i, handleWithdraw);
  bot.onText(/^\/support(?:@\w+)?$/i, handleSupport);
  bot.onText(/^\/cancel(?:@\w+)?$/i, handleCancel);

  /* ═══════════════════════════════════════════
     🔘 CALLBACK QUERY HANDLER
  ═══════════════════════════════════════════ */

  bot.on("callback_query", async (query) => {
    const chatId = query?.message?.chat?.id;
    const telegramId = query?.from?.id;
    const data = query?.data;

    if (!isValidChatId(chatId) || !isValidTelegramId(telegramId) || !data) return;

    try {
      await bot.answerCallbackQuery(query.id).catch(() => {});

      if (data === "back_to_menu") {
        const user = await findUser(telegramId);
        if (user && !isBlocked(user)) {
          return showMenu(chatId, user);
        }
      }
    } catch (error) {
      console.error("[USER_BOT] Callback error:", error?.message);
    }
  });

  /* ═══════════════════════════════════════════
     💬 MESSAGE HANDLER
  ═══════════════════════════════════════════ */

  bot.on("message", async (msg) => {
    try {
      if (!msg?.chat?.id || !msg?.from?.id) return;
      if (!Utils.isPrivateChat(msg)) return;

      const text = String(msg.text || "").trim();
      if (!text || text.startsWith("/")) return;

      const chatId = msg.chat.id;
      const telegramId = msg.from.id;

      // ═══════ MENU BUTTON HANDLERS ═══════

      switch (text) {
        case "🎮 Play":
        case "🎮 Play Game":
          return handlePlay(msg);

        case "💰 Balance":
          return handleBalance(msg);

        case "💳 Deposit":
          return handleDeposit(msg);

        case "💸 Withdraw":
          return handleWithdraw(msg);

        case "📞 Support":
        case "📞 Contact Support":
          return handleSupport(msg);

        case "❌ Cancel":
          return handleCancel(msg);
      }

      // ═══════ TEXT TRIGGERS ═══════

      const lowerText = text.toLowerCase();
      if (lowerText === "support" || lowerText === "help" || lowerText === "contact") {
        return handleSupport(msg);
      }

      // ═══════ CHECK USER STATUS ═══════

      const user = await findUser(telegramId);

      if (!user) {
        return safeSend(chatId, Messages.registerFirst(), Keyboards.contact);
      }

      // ✅ Check if blocked
      if (isBlocked(user)) {
        return safeSend(chatId, Messages.blocked());
      }

      // ═══════ HANDLE ACTIVE FLOWS ═══════

      if (deposit?.handleDepositFlow) {
        const handled = await deposit.handleDepositFlow(bot, msg, user, safeSend);
        if (handled) return;
      }

      if (withdraw?.handleWithdrawFlow) {
        const handled = await withdraw.handleWithdrawFlow(bot, msg, user, safeSend);
        if (handled) return;
      }

    } catch (error) {
      console.error("[USER_BOT] Message error:", error?.message);
    }
  });

  /* ═══════════════════════════════════════════
     📱 CONTACT REGISTRATION HANDLER
  ═══════════════════════════════════════════ */

  bot.on("contact", async (msg) => {
    const chatId = msg?.chat?.id;
    const from = msg?.from;
    const contact = msg?.contact;

    if (!isValidChatId(chatId) || !isValidTelegramId(from?.id) || !contact) return;

    try {
      if (!Utils.isPrivateChat(msg)) {
        return safeSend(chatId, Messages.privateOnly());
      }

      // Validate contact has phone number
      if (!contact.phone_number) {
        return safeSend(chatId, Messages.invalidContact(), Keyboards.contact);
      }

      // Ensure user shares their own contact
      if (!contact.user_id || String(contact.user_id) !== String(from.id)) {
        return safeSend(chatId, Messages.shareOwnContact(), Keyboards.contact);
      }

      const telegramId = String(from.id);
      const phoneNo = Utils.normalizePhone(contact.phone_number);
      const username = String(from.username || from.first_name || "").trim().slice(0, 64);

      // Check if user already exists
      const existingUser = await findUser(telegramId);

      if (existingUser) {
        // ✅ CRITICAL: Check if user is BLOCKED before proceeding
        if (isBlocked(existingUser)) {
          await safeSend(chatId, Messages.blocked());
          return;
        }

        // Update user info if needed
        await User.findOneAndUpdate(
          { telegramId },
          {
            $set: {
              chatId: String(chatId),
              ...(phoneNo && !existingUser.phoneNo && { phoneNo }),
              ...(username && { username }),
            },
          }
        );

        const updatedUser = await findUser(telegramId);
        await safeSend(chatId, Messages.welcomeBack(updatedUser?.username || "Player"), Keyboards.remove);
        return showMenu(chatId, updatedUser);
      }

      // New registration - check limit
      const canRegister = await canRegisterNewUser();

      if (!canRegister) {
        return safeSend(chatId, Messages.limitReached());
      }

      // Create new user
      await User.create({
        telegramId,
        chatId: String(chatId),
        phoneNo: phoneNo || "",
        username: username || "",
        role: "user",
        status: "active",
        Balance: 0,
      });

      const newUser = await findUser(telegramId);

      await safeSend(chatId, Messages.registered(), Keyboards.remove);
      return showMenu(chatId, newUser);

    } catch (error) {
      console.error("[USER_BOT] Contact error:", error?.message);

      if (error?.code === 11000) {
        const user = await findUser(from.id);
        if (user) {
          // ✅ Check blocked even on duplicate error
          if (isBlocked(user)) {
            return safeSend(chatId, Messages.blocked());
          }
          return showMenu(chatId, user);
        }
      }

      return safeSend(chatId, Messages.error(), Keyboards.mainMenu);
    }
  });

  /* ═══════════════════════════════════════════
     ❌ ERROR HANDLING
  ═══════════════════════════════════════════ */

  bot.on("polling_error", (error) => {
    const msg = error?.message || String(error);

    if (msg.includes("ETIMEOUT") || msg.includes("ECONNRESET")) {
      console.warn("[USER_BOT] Polling timeout/reset, will retry...");
      return;
    }

    if (String(error?.code) === "ETELEGRAM" && String(error?.response?.statusCode) === "409") {
      console.error("[USER_BOT] Polling conflict (409). Another instance may be running.");
      bot.stopPolling().catch(() => {});
      return;
    }

    console.error("[USER_BOT] Polling error:", msg);
  });

  bot.on("error", (err) => console.error("[USER_BOT] error:", err?.message || err));

  /* ═══════════════════════════════════════════
     🛑 GRACEFUL SHUTDOWN
  ═══════════════════════════════════════════ */

  const shutdown = async () => {
    console.log("[USER_BOT] Shutting down...");
    try {
      await bot.stopPolling();
      console.log("[USER_BOT] Polling stopped");
    } catch (e) {
      console.error("[USER_BOT] Shutdown error:", e?.message || e);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  /* ═══════════════════════════════════════════
     📤 EXPORT BOT INSTANCE
  ═══════════════════════════════════════════ */

  return bot;
};