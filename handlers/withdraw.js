"use strict";

const User = require("../models/user");
const Withdraw = require("../models/withdraw");
const SubAdmin = require("../models/subadmin");

/* ═══════════════════════════════════════════
⚙️ CONFIGURATION
═══════════════════════════════════════════ */

const CONFIG = {
  MIN_WITHDRAW: 100,
  MAX_WITHDRAW: 10_000,
  CLEANUP_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 1 week
};

/* ═══════════════════════════════════════════
🎨 KEYBOARDS
═══════════════════════════════════════════ */

const Keyboards = {
  cancel: {
    reply_markup: {
      keyboard: [[{ text: "❌ Cancel" }]],
      resize_keyboard: true,
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
};

/* ═══════════════════════════════════════════
🔧 UTILITY FUNCTIONS
═══════════════════════════════════════════ */

const Utils = {
  /**
   * Clean extra spaces
   */
  cleanSpaces(str) {
    return String(str ?? "")
      .replace(/\s+/g, " ")
      .trim();
  },

  /**
   * Normalize Ethiopian phone to international format
   * Accepts: 0912345678, 912345678, 251912345678
   * Returns: 251912345678 or empty string if invalid
   */
  normalizePhone(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");

    if (digits.length === 10 && digits.startsWith("0")) {
      return "251" + digits.slice(1);
    }
    if (digits.length === 9 && digits.startsWith("9")) {
      return "251" + digits;
    }
    if (digits.length === 12 && digits.startsWith("251")) {
      return digits;
    }
    return "";
  },

  /**
   * Format phone for display (251912345678 → 0912345678)
   */
  formatPhoneDisplay(phone) {
    if (phone?.startsWith("251") && phone.length === 12) {
      return "0" + phone.slice(3);
    }
    return phone || "";
  },

  /**
   * Parse amount from text (handles "1,000 birr", "500", etc.)
   * Returns NaN if invalid
   */
  parseAmount(text) {
    const cleaned = String(text ?? "")
      .replace(/[,\s]/g, "")
      .replace(/birr/gi, "")
      .replace(/br/gi, "")
      .trim();

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  },

  /**
   * Extract first name from full name
   */
  extractFirstName(fullName) {
    const cleaned = Utils.cleanSpaces(fullName);
    if (!cleaned) return "";
    return cleaned.split(" ")[0];
  },

  /**
   * Format number with thousand separators
   */
  formatNumber(num) {
    return Number(num || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  /**
   * Round to 2 decimal places (prevents floating-point errors)
   * ✅ CRITICAL: Use this before any balance operations
   */
  roundAmount(amount) {
    const num = Number(amount) || 0;
    return Math.round(num * 100) / 100;
  },

  /**
   * Check if text is a cancel command
   */
  isCancelCommand(text) {
    const normalized = String(text ?? "").trim().toLowerCase();
    return normalized === "/cancel" || normalized === "❌ cancel";
  },
};

/* ═══════════════════════════════════════════
👨‍💼 SUBADMIN SERVICE
═══════════════════════════════════════════ */

const SubAdminService = {
  /**
   * Check if there's at least one active SubAdmin
   * Status must be "active" (not "sleep" or "blocked")
   */
  async hasActiveSubAdmin() {
    try {
      const count = await SubAdmin.countDocuments({
        status: "active",
        role: "subadmin",
      });

      return count > 0;
    } catch (error) {
      console.error("[WITHDRAW] SubAdmin check error:", error?.message);
      return false;
    }
  },
};

/* ═══════════════════════════════════════════
💬 MESSAGE TEMPLATES (Clean & Simple)
═══════════════════════════════════════════ */

const Messages = {
  pendingExists: () =>
    `⏳ Withdrawal Pending

You have a pending withdrawal request.
Please wait for approval or rejection.

የቀደመ ማውጫ በመጠባበቅ ላይ ነው።
እባክዎ ይጠብቁ።`,

  cancelled: () =>
    `❌ Cancelled

Type /withdraw to start again.

ተሰርዟል።`,

  balanceTooLow: (balance) =>
    `⚠️ Insufficient Balance

Your balance: ${Utils.formatNumber(balance)} ብር
Minimum required: ${Utils.formatNumber(CONFIG.MIN_WITHDRAW)} ብር

ሚዛንዎ በቂ አይደለም።`,

  noActiveSubAdmin: () =>
    `⏸️ Withdraw Unavailable

Withdraw system is not available at this time.
Please wait and try again later.

የማውጫ አገልግሎት በአሁኑ ሰዓት አይገኝም።
እባክዎ ቆይተው ይሞክሩ።`,

  askPhone: () =>
    `💸 Withdraw Funds
ገንዘብ ያውጡ

📊 Limits: ${Utils.formatNumber(CONFIG.MIN_WITHDRAW)} - ${Utils.formatNumber(CONFIG.MAX_WITHDRAW)} ብር

━━━━━━━━━━━━━━━━━━━━

📱 Enter your Telebirr phone number
የቴሌብር ስልክ ቁጥርዎን ያስገቡ

Example: \`0912345678\`

❌ Type /cancel to exit`,

  invalidPhone: () =>
    `⚠️ Invalid Phone Number

Valid formats:
• \`0912345678\`
• \`912345678\`
• \`251912345678\`

የተሳሳተ ቁጥር - እንደገና ይሞክሩ`,

  askName: (phone) =>
    `👤 Account Name
የመለያ ስም

📱 Phone: \`${Utils.formatPhoneDisplay(phone)}\`

━━━━━━━━━━━━━━━━━━━━

📝 Enter your Telebirr account name
የቴሌብር መለያ ስም ያስገቡ

💡 Tip: Enter full name, we'll save first name only

Example: \`Abebe Kebede\`

❌ Type /cancel to exit`,

  invalidName: () =>
    `⚠️ Invalid Name

Please enter a valid name.

Example: \`Abebe\` or \`Abebe Kebede\`

የተሳሳተ ስም`,

  askAmount: (phone, name, balance) =>
    `💰 Enter Amount
መጠን ያስገቡ

📱 Phone: \`${Utils.formatPhoneDisplay(phone)}\`
👤 Name: ${name}

━━━━━━━━━━━━━━━━━━━━

💵 Available Balance: ${Utils.formatNumber(balance)} ብር

📊 Minimum: ${Utils.formatNumber(CONFIG.MIN_WITHDRAW)} ብር
📊 Maximum: ${Utils.formatNumber(CONFIG.MAX_WITHDRAW)} ብር

━━━━━━━━━━━━━━━━━━━━

Example: \`500\` or \`1000\`

❌ Type /cancel to exit`,

  invalidAmount: () =>
    `⚠️ Invalid Amount

Please enter a valid number.

Example: \`500\` or \`1000\`

የተሳሳተ መጠን`,

  amountTooLow: () =>
    `⚠️ Amount Too Low

Minimum: ${Utils.formatNumber(CONFIG.MIN_WITHDRAW)} ብር

መጠኑ በጣም ዝቅተኛ ነው`,

  amountTooHigh: () =>
    `⚠️ Amount Too High

Maximum: ${Utils.formatNumber(CONFIG.MAX_WITHDRAW)} ብር

መጠኑ በጣም ከፍተኛ ነው`,

  accountBlocked: () =>
    `🚫 Account Blocked

Your account is blocked. Contact support.

መለያዎ ታግዷል።`,

  insufficientBalance: (balance) =>
    `❌ Insufficient Balance

Your balance: ${Utils.formatNumber(balance)} ብር

The amount exceeds your balance.

ሚዛንዎ በቂ አይደለም`,

  success: (amount, phone, firstName) =>
    `✅ Withdrawal Submitted!
ጥያቄዎ ተልኳል!

━━━━━━━━━━━━━━━━━━━━
💰 Amount: ${Utils.formatNumber(amount)} ብር
📱 Phone: \`${Utils.formatPhoneDisplay(phone)}\`
👤 Name: ${firstName}
📊 Status: PENDING
━━━━━━━━━━━━━━━━━━━━

⏳ We'll review and process soon.

በቅርብ ጊዜ እንገመግማለን ✨`,

  error: () =>
    `❌ Error

Something went wrong. Try again.

ስህተት ተከስቷል`,
};

/* ═══════════════════════════════════════════
🧹 CLEANUP
═══════════════════════════════════════════ */

async function cleanupOldWithdrawals() {
  try {
    const oneWeekAgo = new Date(Date.now() - CONFIG.CLEANUP_AGE_MS);

    const result = await Withdraw.deleteMany({
      status: { $in: ["approved", "rejected"] },
      updatedAt: { $lt: oneWeekAgo },
    });

    if (result.deletedCount > 0) {
      console.log(`[WITHDRAW] Cleanup: Deleted ${result.deletedCount} old records`);
    }
  } catch (error) {
    console.error("[WITHDRAW] Cleanup error:", error?.message);
  }
}

/* ═══════════════════════════════════════════
🎮 MAIN HANDLERS
═══════════════════════════════════════════ */

/**
 * Start withdraw process
 */
async function startWithdraw(bot, msg, user, safeSend) {
  const chatId = msg?.chat?.id;
  const telegramId = String(msg?.from?.id);

  if (!chatId || !telegramId) return false;

  try {
    // Cleanup old records
    await cleanupOldWithdrawals();

    // ✅ STEP 1: Check pending withdraw
    const pendingWithdraw = await Withdraw.findOne({
      telegramId,
      status: "pending",
    }).lean();

    if (pendingWithdraw) {
      await safeSend(chatId, Messages.pendingExists(), Keyboards.mainMenu);
      return true;
    }

    // ✅ STEP 2: Check user balance >= 100
    const freshUser = await User.findOne({ telegramId }, { Balance: 1 }).lean();
    const balance = Utils.roundAmount(freshUser?.Balance ?? 0);

    if (balance < CONFIG.MIN_WITHDRAW) {
      await safeSend(chatId, Messages.balanceTooLow(balance), Keyboards.mainMenu);
      return true;
    }

    // ✅ STEP 3: Check active SubAdmin exists
    const hasActiveSubAdmin = await SubAdminService.hasActiveSubAdmin();

    if (!hasActiveSubAdmin) {
      await safeSend(chatId, Messages.noActiveSubAdmin(), Keyboards.mainMenu);
      return true;
    }

    // ✅ STEP 4: Start withdraw flow
    // Clean old sessions
    await Withdraw.deleteMany({ telegramId, status: "session" });

    // Create new session
    await Withdraw.create({
      telegramId,
      chatId: String(chatId),
      status: "session",
      step: "await_phone",
    });

    await safeSend(chatId, Messages.askPhone(), Keyboards.cancel);
    return true;
  } catch (error) {
    console.error("[WITHDRAW] Start error:", error?.message);
    await safeSend(chatId, Messages.error(), Keyboards.mainMenu);
    return true;
  }
}

/**
 * Handle withdraw flow (multi-step)
 */
async function handleWithdrawFlow(bot, msg, user, safeSend) {
  const chatId = msg?.chat?.id;
  const telegramId = String(msg?.from?.id);
  const inputText = String(msg?.text || msg?.caption || "").trim();

  if (!chatId || !telegramId) return false;

  // Check if user has active session
  const session = await Withdraw.findOne({ telegramId, status: "session" });

  if (!session) return false;

  try {
    // ═══════ CANCEL COMMAND ═══════
    if (Utils.isCancelCommand(inputText)) {
      await Withdraw.deleteOne({ _id: session._id });
      await safeSend(chatId, Messages.cancelled(), Keyboards.mainMenu);
      return true;
    }

    // ═══════ STEP 1: Phone ═══════
    if (session.step === "await_phone") {
      const phone = Utils.normalizePhone(inputText);

      if (!phone || phone.length !== 12) {
        await safeSend(chatId, Messages.invalidPhone(), Keyboards.cancel);
        return true;
      }

      await Withdraw.updateOne(
        { _id: session._id },
        {
          $set: {
            receiverPhone: phone,
            step: "await_name",
            chatId: String(chatId),
          },
        }
      );

      await safeSend(chatId, Messages.askName(phone), Keyboards.cancel);
      return true;
    }

    // ═══════ STEP 2: Name ═══════
    if (session.step === "await_name") {
      const firstName = Utils.extractFirstName(inputText);

      if (!firstName || firstName.length < 2) {
        await safeSend(chatId, Messages.invalidName(), Keyboards.cancel);
        return true;
      }

      // Fetch fresh balance for display
      const freshUser = await User.findOne({ telegramId }, { Balance: 1 }).lean();
      const balance = Utils.roundAmount(freshUser?.Balance ?? 0);

      await Withdraw.updateOne(
        { _id: session._id },
        {
          $set: {
            receiverFirstName: firstName,
            step: "await_amount",
            chatId: String(chatId),
          },
        }
      );

      await safeSend(
        chatId,
        Messages.askAmount(session.receiverPhone, firstName, balance),
        Keyboards.cancel
      );
      return true;
    }

    // ═══════ STEP 3: Amount ═══════
    if (session.step === "await_amount") {
      const parsedAmount = Utils.parseAmount(inputText);

      // Validate: Is number?
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        await safeSend(chatId, Messages.invalidAmount(), Keyboards.cancel);
        return true;
      }

      // ✅ CRITICAL: Round to 2 decimal places (matches User schema)
      const amount = Utils.roundAmount(parsedAmount);

      // Validate: Minimum
      if (amount < CONFIG.MIN_WITHDRAW) {
        await safeSend(chatId, Messages.amountTooLow(), Keyboards.cancel);
        return true;
      }

      // Validate: Maximum
      if (amount > CONFIG.MAX_WITHDRAW) {
        await safeSend(chatId, Messages.amountTooHigh(), Keyboards.cancel);
        return true;
      }

      // Fetch user status + balance
      const dbUser = await User.findOne(
        { telegramId },
        { Balance: 1, status: 1 }
      ).lean();

      const userStatus = String(dbUser?.status ?? "").toLowerCase();

      // Check: Account blocked?
      if (!dbUser || userStatus === "blocked") {
        await Withdraw.deleteOne({ _id: session._id });
        await safeSend(chatId, Messages.accountBlocked(), Keyboards.mainMenu);
        return true;
      }

      // ✅ Get balance with proper rounding (matches schema getter)
      const balance = Utils.roundAmount(dbUser.Balance ?? 0);

      // Validate: Sufficient balance?
      if (amount > balance) {
        await safeSend(chatId, Messages.insufficientBalance(balance), Keyboards.cancel);
        return true;
      }

      // ═══════════════════════════════════════════════════════
      // ✅ DEDUCT BALANCE (Properly rounded, atomic operation)
      // ═══════════════════════════════════════════════════════
      const deductResult = await User.updateOne(
        {
          telegramId,
          Balance: { $gte: amount }, // Double-check balance is sufficient
        },
        {
          $inc: { Balance: -amount }, // Deduct with rounded amount
        }
      );

      // Check if deduction was successful
      if (!deductResult || deductResult.modifiedCount !== 1) {
        // Balance became insufficient between checks (race condition)
        const freshUser = await User.findOne({ telegramId }, { Balance: 1 }).lean();
        const currentBalance = Utils.roundAmount(freshUser?.Balance ?? 0);

        await safeSend(
          chatId,
          Messages.insufficientBalance(currentBalance),
          Keyboards.cancel
        );
        return true;
      }

      // ═══════════════════════════════════════════════════════
      // ✅ SUBMIT WITHDRAW REQUEST AS PENDING
      // ═══════════════════════════════════════════════════════
      try {
        await Withdraw.updateOne(
          { _id: session._id, status: "session" },
          {
            $set: {
              amount: amount, // Already rounded
              status: "pending",
              step: null,
              approvedBy: null,
              chatId: String(chatId),
            },
          }
        );

        // Send success message to user
        await safeSend(
          chatId,
          Messages.success(
            amount,
            session.receiverPhone,
            session.receiverFirstName
          ),
          Keyboards.mainMenu
        );

        console.log(
          `[WITHDRAW] ✅ Created pending withdrawal | User: ${telegramId} | Amount: ${amount} | Balance deducted`
        );

        return true;
      } catch (error) {
        // ⚠️ ROLLBACK: Restore balance if withdrawal creation failed
        console.error(
          `[WITHDRAW] ❌ Failed to create withdrawal, rolling back balance | User: ${telegramId}`,
          error?.message
        );

        await User.updateOne(
          { telegramId },
          { $inc: { Balance: amount } } // Add back the deducted amount
        );

        throw error; // Re-throw to trigger error message
      }
    }

    return false;
  } catch (error) {
    console.error("[WITHDRAW] Flow error:", error?.message);

    // Clean up session on error
    try {
      await Withdraw.deleteMany({ telegramId, status: "session" });
    } catch (cleanupError) {
      console.error("[WITHDRAW] Cleanup error:", cleanupError?.message);
    }

    await safeSend(chatId, Messages.error(), Keyboards.mainMenu);
    return true;
  }
}

/* ═══════════════════════════════════════════
📤 EXPORTS
═══════════════════════════════════════════ */

module.exports = {
  startWithdraw,
  handleWithdrawFlow,
  cleanupOldWithdrawals,
  CONFIG,
};
