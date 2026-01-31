"use strict";

const Deposit = require("../models/deposit");
const AdminModel = require("../models/admin");
const Admin = AdminModel.default || AdminModel;

/* ═══════════════════════════════════════════
   ⚙️ CONFIGURATION
═══════════════════════════════════════════ */

const CONFIG = {
  MIN_DEPOSIT: 100,
  MAX_DEPOSIT: 10_000,
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
  cleanSpaces(str) {
    return String(str ?? "")
      .replace(/\s+/g, " ")
      .trim();
  },

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

  formatPhoneDisplay(phone) {
    if (phone?.startsWith("251") && phone.length === 12) {
      return "0" + phone.slice(3);
    }
    return phone || "";
  },

  getLast4Digits(raw) {
    return String(raw ?? "")
      .replace(/\D/g, "")
      .slice(-4);
  },

  parseAmount(text) {
    const cleaned = String(text ?? "")
      .replace(/[,\s]/g, "")
      .replace(/birr/gi, "")
      .replace(/br/gi, "")
      .trim();

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString();
  },

  isCancelCommand(text) {
    const normalized = String(text ?? "").trim().toLowerCase();
    return normalized === "/cancel" || normalized === "❌ cancel";
  },
};

/* ═══════════════════════════════════════════
   📱 TELEBIRR SERVICE
═══════════════════════════════════════════ */

const TelebirrService = {
  async getActiveAccount() {
    const admin = await Admin.findOne(
      { role: { $in: ["admin", "superadmin"] } },
      { activeTelebirrAccount: 1, telebirrAccountLists: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    const account = admin?.activeTelebirrAccount || admin?.telebirrAccountLists?.[0];

    if (!account) return null;

    const phone = Utils.normalizePhone(account.phoneNumber || "");
    if (!phone) return null;

    const firstName = Utils.cleanSpaces(account.firstName || "").toUpperCase();
    const fatherName = Utils.cleanSpaces(account.fatherName || "").toUpperCase();

    return {
      phone,
      phoneDisplay: Utils.formatPhoneDisplay(phone),
      phoneLast4: Utils.getLast4Digits(phone),
      firstName,
      fatherName,
      fullName: [firstName, fatherName].filter(Boolean).join(" "),
    };
  },

  parseSMS(text) {
    const smsText = String(text || "");

    // Extract amount
    const amountMatch = smsText.match(/ETB\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    const amount = amountMatch
      ? Number(String(amountMatch[1]).replace(/,/g, ""))
      : NaN;

    // Extract receiver info
    const receiverMatch = smsText.match(/to\s+(.+?)\s*\(([^)]+)\)/i);
    const receiverName = receiverMatch
      ? Utils.cleanSpaces(receiverMatch[1]).toUpperCase()
      : "";
    const receiverLast4 = receiverMatch
      ? Utils.getLast4Digits(receiverMatch[2])
      : "";

    return { amount, receiverName, receiverLast4 };
  },
};

/* ═══════════════════════════════════════════
   💬 MESSAGE TEMPLATES (Clean & Simple)
═══════════════════════════════════════════ */

const Messages = {
  pendingExists: () =>
`⏳ *Deposit Pending*

You have a pending deposit request.
Please wait for approval or rejection.

የቀደመ ገንዘብ በመጠባበቅ ላይ ነው።
እባክዎ ይጠብቁ።`,

  cancelled: () =>
`❌ *Cancelled*

Type /deposit to start again.

ተሰርዟል።`,

  askPhone: () =>
`💳 *Deposit Funds*
ገንዘብ ያስገቡ

📊 Limits: ${Utils.formatNumber(CONFIG.MIN_DEPOSIT)} - ${Utils.formatNumber(CONFIG.MAX_DEPOSIT)} ብር

━━━━━━━━━━━━━━━━━━━━

📱 Enter your Telebirr phone number
የቴሌብር ስልክ ቁጥርዎን ያስገቡ

Example: \`0912345678\`

❌ Type /cancel to exit`,

  invalidPhone: () =>
`⚠️ *Invalid Phone Number*

Valid formats:
• \`0912345678\`
• \`912345678\`
• \`251912345678\`

የተሳሳተ ቁጥር`,

  askAmount: (phone) =>
`💰 *Enter Amount*
መጠን ያስገቡ

📱 Your Phone: \`${Utils.formatPhoneDisplay(phone)}\`

━━━━━━━━━━━━━━━━━━━━

📊 *Minimum:* ${Utils.formatNumber(CONFIG.MIN_DEPOSIT)} ብር
📊 *Maximum:* ${Utils.formatNumber(CONFIG.MAX_DEPOSIT)} ብር

━━━━━━━━━━━━━━━━━━━━

Example: \`500\` or \`1000\`

❌ Type /cancel to exit`,

  invalidAmount: () =>
`⚠️ *Invalid Amount*

Allowed: ${Utils.formatNumber(CONFIG.MIN_DEPOSIT)} - ${Utils.formatNumber(CONFIG.MAX_DEPOSIT)} ብር

Example: \`500\` or \`1000\`

የተሳሳተ መጠን`,

  noActiveAccount: () =>
`❌ *Service Unavailable*

Deposit service temporarily unavailable.

አገልግሎቱ ጊዜያዊ አይገኝም`,

  showPaymentDetails: (account, amount, phone) =>
`📲 *Send Payment*
ክፍያ ይላኩ

📱 Your Phone: \`${Utils.formatPhoneDisplay(phone)}\`
💰 Amount: ${Utils.formatNumber(amount)} ብር

━━━━━━━━━━━━━━━━━━━━

🔹 *SEND TO:*
👤 Name: \`${account.fullName}\`
📱 Phone: \`${account.phoneDisplay}\`

━━━━━━━━━━━━━━━━━━━━

📋 *INSTRUCTIONS:*

1️⃣ Open Telebirr app
2️⃣ Send exactly ${Utils.formatNumber(amount)} ብር
3️⃣ Copy & paste the SMS here

━━━━━━━━━━━━━━━━━━━━

⚡ Paste SMS after sending

❌ Type /cancel to exit`,

  invalidSMS: () =>
`⚠️ *Invalid SMS*

Please paste the complete Telebirr SMS.

SMS must contain:
• Amount (ETB)
• Receiver name
• Receiver phone

የተሳሳተ SMS`,

  wrongReceiver: () =>
`❌ *Wrong Receiver*

The SMS shows a different receiver.

Please send to the correct phone and name.

ተቀባዩ ትክክል አይደለም`,

  amountMismatch: (expected, received) =>
`❌ *Amount Mismatch*

Expected: ${Utils.formatNumber(expected)} ብር
SMS shows: ${Utils.formatNumber(received)} ብር

Please send the exact amount.

መጠኑ አይመሳሰልም`,

  success: (amount, phone) =>
`✅ *Deposit Submitted!*
ጥያቄዎ ተልኳል!

━━━━━━━━━━━━━━━━━━━━
📱 Phone: \`${Utils.formatPhoneDisplay(phone)}\`
💰 Amount: ${Utils.formatNumber(amount)} ብር
📊 Status: PENDING
━━━━━━━━━━━━━━━━━━━━

⏳ We'll review and notify you.

በቅርብ ጊዜ እንገመግማለን ✨`,

  error: () =>
`❌ *Error*

Something went wrong. Try again.

ስህተት ተከስቷል`,
};

/* ═══════════════════════════════════════════
   🧹 CLEANUP
═══════════════════════════════════════════ */

async function cleanupOldDeposits() {
  try {
    const oneWeekAgo = new Date(Date.now() - CONFIG.CLEANUP_AGE_MS);

    const result = await Deposit.deleteMany({
      status: { $in: ["approved", "rejected"] },
      updatedAt: { $lt: oneWeekAgo },
    });

    if (result.deletedCount > 0) {
      console.log(`[DEPOSIT] Cleanup: Deleted ${result.deletedCount} old records`);
    }
  } catch (error) {
    console.error("[DEPOSIT] Cleanup error:", error?.message);
  }
}

/* ═══════════════════════════════════════════
   🎮 MAIN HANDLERS
═══════════════════════════════════════════ */

async function startDeposit(bot, msg, user, safeSend) {
  const chatId = msg?.chat?.id;
  const telegramId = String(msg?.from?.id);

  if (!chatId || !telegramId) return false;

  try {
    await cleanupOldDeposits();

    // ✅ CHECK: Pending deposit exists?
    const pendingDeposit = await Deposit.findOne({
      telegramId,
      status: "pending",
    }).lean();

    if (pendingDeposit) {
      await safeSend(chatId, Messages.pendingExists(), Keyboards.mainMenu);
      return true;
    }

    // Clean old sessions
    await Deposit.deleteMany({ telegramId, status: "session" });

    // Create new session
    await Deposit.create({
      telegramId,
      chatId: String(chatId),
      status: "session",
      step: "await_phone",
    });

    await safeSend(chatId, Messages.askPhone(), Keyboards.cancel);
    return true;
  } catch (error) {
    console.error("[DEPOSIT] Start error:", error?.message);
    await safeSend(chatId, Messages.error(), Keyboards.mainMenu);
    return true;
  }
}

async function handleDepositFlow(bot, msg, user, safeSend) {
  const chatId = msg?.chat?.id;
  const telegramId = String(msg?.from?.id);
  const inputText = String(msg?.text || msg?.caption || "").trim();

  if (!chatId || !telegramId) return false;

  const session = await Deposit.findOne({ telegramId, status: "session" });

  if (!session) return false;

  try {
    // ═══════ CANCEL COMMAND ═══════
    if (Utils.isCancelCommand(inputText)) {
      await Deposit.deleteOne({ _id: session._id });
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

      await Deposit.updateOne(
        { _id: session._id },
        {
          $set: {
            senderPhone: phone,
            step: "await_amount",
            chatId: String(chatId),
          },
        }
      );

      await safeSend(chatId, Messages.askAmount(phone), Keyboards.cancel);
      return true;
    }

    // ═══════ STEP 2: Amount ═══════
    if (session.step === "await_amount") {
      const amount = Utils.parseAmount(inputText);

      if (!Number.isFinite(amount) || amount < CONFIG.MIN_DEPOSIT || amount > CONFIG.MAX_DEPOSIT) {
        await safeSend(chatId, Messages.invalidAmount(), Keyboards.cancel);
        return true;
      }

      const adminAccount = await TelebirrService.getActiveAccount();

      if (!adminAccount) {
        await Deposit.deleteOne({ _id: session._id });
        await safeSend(chatId, Messages.noActiveAccount(), Keyboards.mainMenu);
        return true;
      }

      await Deposit.updateOne(
        { _id: session._id },
        {
          $set: {
            amount,
            step: "await_sms",
            chatId: String(chatId),
          },
        }
      );

      await safeSend(
        chatId,
        Messages.showPaymentDetails(adminAccount, amount, session.senderPhone),
        Keyboards.cancel
      );
      return true;
    }

    // ═══════ STEP 3: SMS Verification ═══════
    if (session.step === "await_sms") {
      const adminAccount = await TelebirrService.getActiveAccount();

      if (!adminAccount) {
        await Deposit.deleteOne({ _id: session._id });
        await safeSend(chatId, Messages.noActiveAccount(), Keyboards.mainMenu);
        return true;
      }

      const parsedSMS = TelebirrService.parseSMS(inputText);

      if (!Number.isFinite(parsedSMS.amount) || !parsedSMS.receiverLast4) {
        await safeSend(chatId, Messages.invalidSMS(), Keyboards.cancel);
        return true;
      }

      // Validate receiver phone
      if (parsedSMS.receiverLast4 !== adminAccount.phoneLast4) {
        await safeSend(chatId, Messages.wrongReceiver(), Keyboards.cancel);
        return true;
      }

      // Validate receiver name
      if (parsedSMS.receiverName) {
        const firstNameMatch =
          !adminAccount.firstName || parsedSMS.receiverName.includes(adminAccount.firstName);
        const fatherNameMatch =
          !adminAccount.fatherName || parsedSMS.receiverName.includes(adminAccount.fatherName);

        if (!firstNameMatch || !fatherNameMatch) {
          await safeSend(chatId, Messages.wrongReceiver(), Keyboards.cancel);
          return true;
        }
      } else {
        await safeSend(chatId, Messages.invalidSMS(), Keyboards.cancel);
        return true;
      }

      // Validate amount
      if (parsedSMS.amount !== session.amount) {
        await safeSend(
          chatId,
          Messages.amountMismatch(session.amount, parsedSMS.amount),
          Keyboards.cancel
        );
        return true;
      }

      // ✅ SUBMIT DEPOSIT
      await Deposit.updateOne(
        { _id: session._id, status: "session" },
        {
          $set: {
            status: "pending",
            step: null,
            smsText: inputText,
            chatId: String(chatId),
          },
        }
      );

      await safeSend(
        chatId,
        Messages.success(session.amount, session.senderPhone),
        Keyboards.mainMenu
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("[DEPOSIT] Flow error:", error?.message);

    try {
      await Deposit.deleteMany({ telegramId, status: "session" });
    } catch (e) {}

    await safeSend(chatId, Messages.error(), Keyboards.mainMenu);
    return true;
  }
}

/* ═══════════════════════════════════════════
   📤 EXPORTS
═══════════════════════════════════════════ */

module.exports = {
  startDeposit,
  handleDepositFlow,
  cleanupOldDeposits,
  ...CONFIG,
};