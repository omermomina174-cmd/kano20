"use strict";

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../models/user");
const SubAdmin = require("../models/subadmin");
const Deposit = require("../models/deposit");
const Withdraw = require("../models/withdraw");

const { requireTelegramInitData } = require("../utils/telegramWebApp");
const { requireSubadminSession } = require("../middleware/requireSession");

router.use(express.json({ limit: "256kb" }));

/* ═══════════════════════════════════════════════════════════════
   🔧 UTILITY FUNCTIONS
═══════════════════════════════════════════════════════════════ */

const formatAmount = (n) => Number(n || 0).toFixed(2);
const roundBalance = (value) => Math.round((Number(value) || 0) * 100) / 100;
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const isActiveStatus = (status) => String(status || "").toLowerCase() === "active";

/**
 * Pick a target chat id for notifying the user.
 * Deposit/Withdraw chatId is best, fallback to user's chatId, else telegramId.
 */
function pickTargetChatId({ deposit, withdraw, user }) {
  const raw =
    (deposit?.chatId ?? withdraw?.chatId ?? "") ||
    (user?.chatId ?? "") ||
    (deposit?.telegramId ?? withdraw?.telegramId ?? user?.telegramId ?? "");

  const chatId = String(raw || "").trim();
  return chatId ? chatId : null;
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN_USER || process.env.BOT_TOKEN;
  if (!token || !chatId) return false;

  try {
    // Node 18+ has global fetch
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[TELEGRAM] Send failed:", res.status, body);
    }

    return res.ok;
  } catch (e) {
    console.error("[TELEGRAM] Send failed:", e?.message);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   📄 SERVE HTML PAGE
═══════════════════════════════════════════════════════════════ */

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "subadmin.html"));
});

/* ═══════════════════════════════════════════════════════════════
   🔐 AUTHENTICATION
═══════════════════════════════════════════════════════════════ */

router.post(
  "/api/auth",
  requireTelegramInitData("TELEGRAM_BOT_TOKEN_SUBADMIN"),
  async (req, res) => {
    try {
      const tgUser = req.tgUser;
      const telegramId = String(tgUser.id);

      const subadmin = await SubAdmin.findOne({ telegramId }).lean();
      if (!subadmin) return res.status(403).json({ ok: false, error: "NOT_SUBADMIN" });
      if (subadmin.status?.toLowerCase() === "blocked") {
        return res.status(403).json({ ok: false, error: "BLOCKED" });
      }

      req.session.subadmin = {
        id: String(subadmin._id),
        telegramId,
        role: subadmin.role || "subadmin",
        username: subadmin.username || tgUser.username || "",
      };

      return res.json({
        ok: true,
        subadmin: {
          username: subadmin.username || tgUser.first_name || "",
          status: subadmin.status || "active",
          balance: roundBalance(subadmin.balance || 0),
        },
      });
    } catch (err) {
      console.error("[SUBADMIN_AUTH] error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
  }
);

router.post("/api/logout", requireSubadminSession, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   🔄 STATUS TOGGLE
═══════════════════════════════════════════════════════════════ */

router.post("/api/toggle-status", requireSubadminSession, async (req, res) => {
  try {
    const subadminId = req.session.subadmin.id;
    const subadmin = await SubAdmin.findById(subadminId).select("status").lean();

    if (!subadmin) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const currentStatus = String(subadmin.status || "active").toLowerCase();
    const newStatus = currentStatus === "active" ? "sleep" : "active";

    await SubAdmin.findByIdAndUpdate(subadminId, { $set: { status: newStatus } });

    return res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("[TOGGLE_STATUS] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   📊 STATISTICS
═══════════════════════════════════════════════════════════════ */

router.get("/api/stats", requireSubadminSession, async (req, res) => {
  try {
    const subadminId = req.session.subadmin.id;

    const [depositStats, withdrawStats, subadmin] = await Promise.all([
      Deposit.aggregate([
        { $match: { status: "pending" } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$amount" } } },
      ]),
      Withdraw.aggregate([
        { $match: { status: "pending" } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$amount" } } },
      ]),
      SubAdmin.findById(subadminId).select("balance status").lean(),
    ]);

    return res.json({
      ok: true,
      deposits: depositStats[0] || { count: 0, total: 0 },
      withdraws: withdrawStats[0] || { count: 0, total: 0 },
      balance: roundBalance(subadmin?.balance || 0),
      status: subadmin?.status || "active",
    });
  } catch (err) {
    console.error("[STATS] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   💰 BALANCE
═══════════════════════════════════════════════════════════════ */

router.get("/api/balance", requireSubadminSession, async (req, res) => {
  try {
    const subadminId = req.session.subadmin.id;
    const subadmin = await SubAdmin.findById(subadminId).select("balance status").lean();

    return res.json({
      ok: true,
      balance: roundBalance(subadmin?.balance || 0),
      status: subadmin?.status || "active",
    });
  } catch (err) {
    console.error("[BALANCE] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   💳 DEPOSITS - LIST
═══════════════════════════════════════════════════════════════ */

router.get("/api/deposits", requireSubadminSession, async (req, res) => {
  try {
    const { cursor, limit = 50 } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 50));

    const query = { status: "pending" };
    if (cursor && isValidObjectId(cursor)) query._id = { $gt: cursor };

    const deposits = await Deposit.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limitNum)
      .lean();

    const lastItem = deposits[deposits.length - 1];
    const totalCount = await Deposit.countDocuments({ status: "pending" });

    return res.json({
      ok: true,
      items: deposits.map((d) => ({
        id: String(d._id),
        telegramId: d.telegramId,
        chatId: d.chatId,
        senderPhone: d.senderPhone || "",
        amount: d.amount || 0,
        createdAt: d.createdAt,
      })),
      hasMore: deposits.length === limitNum,
      nextCursor: lastItem ? String(lastItem._id) : null,
      totalCount,
    });
  } catch (err) {
    console.error("[DEPOSITS_FETCH] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   💸 WITHDRAWALS - LIST
═══════════════════════════════════════════════════════════════ */

router.get("/api/withdraws", requireSubadminSession, async (req, res) => {
  try {
    const { cursor, limit = 50 } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 50));

    const query = { status: "pending" };
    if (cursor && isValidObjectId(cursor)) query._id = { $gt: cursor };

    const withdraws = await Withdraw.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limitNum)
      .lean();

    const lastItem = withdraws[withdraws.length - 1];
    const totalCount = await Withdraw.countDocuments({ status: "pending" });

    return res.json({
      ok: true,
      items: withdraws.map((w) => ({
        id: String(w._id),
        telegramId: w.telegramId,
        chatId: w.chatId,
        receiverPhone: w.receiverPhone || "",
        receiverFirstName: w.receiverFirstName || "",
        amount: w.amount || 0,
        createdAt: w.createdAt,
      })),
      hasMore: withdraws.length === limitNum,
      nextCursor: lastItem ? String(lastItem._id) : null,
      totalCount,
    });
  } catch (err) {
    console.error("[WITHDRAWS_FETCH] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ APPROVE DEPOSIT (Single)  ✅ FIXED NOTIFICATION
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/:id/approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, error: "INVALID_ID" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    let result = null;

    await session.withTransaction(async () => {
      const deposit = await Deposit.findOneAndUpdate(
        { _id: id, status: "pending" },
        { $set: { status: "approved", approvedBy: subadminId, approvedAt: new Date() } },
        { new: true, session }
      );

      if (!deposit) throw new Error("NOT_FOUND");

      const amount = roundBalance(deposit.amount);

      const user = await User.findOneAndUpdate(
        { telegramId: deposit.telegramId },
        { $inc: { Balance: amount } },
        { new: true, session }
      );

      if (!user) throw new Error("USER_NOT_FOUND");

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: amount } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");

      result = { deposit, user, subadmin };
    });

    // ✅ Send after transaction, with fallback chat id logic
    const chatId = pickTargetChatId({ deposit: result?.deposit, user: result?.user });

    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `✅ <b>Deposit Approved!</b>\n\n💰 Amount: <b>${formatAmount(result.deposit.amount)} Birr</b>\n💵 New Balance: <b>${formatAmount(result.user.Balance)} Birr</b>\n\n🎮 Ready to play!`
      );
    } else {
      console.warn("[DEPOSIT_NOTICE] Missing chatId/telegramId for deposit:", String(result?.deposit?._id));
    }

    return res.json({
      ok: true,
      id,
      newBalance: roundBalance(result.subadmin.balance),
    });
  } catch (err) {
    console.error("[APPROVE_DEPOSIT] error:", err);
    return res.status(400).json({ ok: false, error: err.message || "APPROVE_FAIL" });
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ BULK APPROVE DEPOSITS  ✅ FIXED NOTIFICATION
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/bulk-approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { ids } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_IDS" });
    }

    const validIds = ids.filter(isValidObjectId);
    if (validIds.length === 0) return res.status(400).json({ ok: false, error: "NO_VALID_IDS" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    let result = { approved: 0, failed: 0, totalAmount: 0, newBalance: 0 };

    // Collect telegram messages to send after commit
    const toNotify = [];

    await session.withTransaction(async () => {
      for (const id of validIds) {
        try {
          const deposit = await Deposit.findOneAndUpdate(
            { _id: id, status: "pending" },
            { $set: { status: "approved", approvedBy: subadminId, approvedAt: new Date() } },
            { new: true, session }
          );

          if (!deposit) {
            result.failed++;
            continue;
          }

          const amount = roundBalance(deposit.amount);

          const user = await User.findOneAndUpdate(
            { telegramId: deposit.telegramId },
            { $inc: { Balance: amount } },
            { new: true, session }
          );

          if (!user) {
            result.failed++;
            continue;
          }

          result.totalAmount += amount;
          result.approved++;

          const chatId = pickTargetChatId({ deposit, user });
          if (chatId) {
            toNotify.push({
              chatId,
              text: `✅ <b>Deposit Approved!</b>\n\n💰 Amount: <b>${formatAmount(deposit.amount)} Birr</b>\n💵 New Balance: <b>${formatAmount(user.Balance)} Birr</b>\n\n🎮 Ready to play!`,
            });
          }
        } catch (err) {
          console.error(`[BULK_APPROVE_DEPOSIT] Failed for ${id}:`, err);
          result.failed++;
        }
      }

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: roundBalance(result.totalAmount) } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");
      result.newBalance = roundBalance(subadmin.balance);
    });

    // ✅ Send notifications after transaction
    for (const n of toNotify) {
      await sendTelegramMessage(n.chatId, n.text);
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[BULK_APPROVE_DEPOSITS] error:", err);
    return res.status(400).json({ ok: false, error: err.message || "BULK_APPROVE_FAIL" });
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ❌ REJECT DEPOSIT  ✅ FIXED NOTIFICATION
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/:id/reject", requireSubadminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, error: "INVALID_ID" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    const deposit = await Deposit.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status: "rejected",
          approvedBy: subadminId,
          approvalNote: reason || "",
          approvedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!deposit) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // ✅ Send with fallback chat id logic
    const chatId = pickTargetChatId({ deposit });

    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `❌ <b>Deposit Rejected</b>\n\n💰 Amount: <b>${formatAmount(deposit.amount)} Birr</b>${
          reason ? `\n📝 Reason: ${reason}` : ""
        }\n\nPlease try again or contact support.`
      );
    } else {
      console.warn("[DEPOSIT_REJECT_NOTICE] Missing chatId/telegramId for deposit:", String(deposit._id));
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[REJECT_DEPOSIT] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ APPROVE WITHDRAWAL (Single)
═══════════════════════════════════════════════════════════════ */

router.post("/api/withdraws/:id/approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, error: "INVALID_ID" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    let result = null;

    await session.withTransaction(async () => {
      const withdraw = await Withdraw.findOne({ _id: id, status: "pending" }).session(session);
      if (!withdraw) throw new Error("NOT_FOUND");

      withdraw.status = "approved";
      withdraw.approvedBy = subadminId;
      withdraw.approvedAt = new Date();
      await withdraw.save({ session });

      const amount = roundBalance(withdraw.amount);

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: -amount } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");

      result = { withdraw, subadmin };
    });

    const chatId = pickTargetChatId({ withdraw: result?.withdraw });
    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `✅ <b>Withdrawal Approved!</b>\n\n💸 Amount: <b>${formatAmount(result.withdraw.amount)} Birr</b>\n📱 To: <b>${result.withdraw.receiverPhone}</b>\n\nFunds sent successfully!`
      );
    }

    return res.json({
      ok: true,
      id,
      newBalance: roundBalance(result.subadmin.balance),
    });
  } catch (err) {
    console.error("[APPROVE_WITHDRAW] error:", err);
    return res.status(400).json({ ok: false, error: err.message || "APPROVE_FAIL" });
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ BULK APPROVE WITHDRAWALS
═══════════════════════════════════════════════════════════════ */

router.post("/api/withdraws/bulk-approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { ids } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_IDS" });
    }

    const validIds = ids.filter(isValidObjectId);
    if (validIds.length === 0) return res.status(400).json({ ok: false, error: "NO_VALID_IDS" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    let result = { approved: 0, failed: 0, totalAmount: 0, newBalance: 0 };
    const toNotify = [];

    await session.withTransaction(async () => {
      for (const id of validIds) {
        try {
          const withdraw = await Withdraw.findOne({ _id: id, status: "pending" }).session(session);

          if (!withdraw) {
            result.failed++;
            continue;
          }

          withdraw.status = "approved";
          withdraw.approvedBy = subadminId;
          withdraw.approvedAt = new Date();
          await withdraw.save({ session });

          const amount = roundBalance(withdraw.amount);
          result.totalAmount += amount;
          result.approved++;

          const chatId = pickTargetChatId({ withdraw });
          if (chatId) {
            toNotify.push({
              chatId,
              text: `✅ <b>Withdrawal Approved!</b>\n\n💸 Amount: <b>${formatAmount(withdraw.amount)} Birr</b>\n📱 To: <b>${withdraw.receiverPhone}</b>\n\nFunds sent successfully!`,
            });
          }
        } catch (err) {
          console.error(`[BULK_APPROVE_WITHDRAW] Failed for ${id}:`, err);
          result.failed++;
        }
      }

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: -roundBalance(result.totalAmount) } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");
      result.newBalance = roundBalance(subadmin.balance);
    });

    for (const n of toNotify) {
      await sendTelegramMessage(n.chatId, n.text);
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[BULK_APPROVE_WITHDRAWS] error:", err);
    return res.status(400).json({ ok: false, error: err.message || "BULK_APPROVE_FAIL" });
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ❌ REJECT WITHDRAWAL
═══════════════════════════════════════════════════════════════ */

router.post("/api/withdraws/:id/reject", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { reason } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) return res.status(400).json({ ok: false, error: "INVALID_ID" });

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json({ ok: false, error: "SLEEP_MODE" });
    }

    let result = null;

    await session.withTransaction(async () => {
      const withdraw = await Withdraw.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status: "rejected",
            approvedBy: subadminId,
            approvalNote: reason || "",
            approvedAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (!withdraw) throw new Error("NOT_FOUND");

      const amount = roundBalance(withdraw.amount);

      const user = await User.findOneAndUpdate(
        { telegramId: withdraw.telegramId },
        { $inc: { Balance: amount } },
        { new: true, session }
      );

      result = { withdraw, user };
    });

    const chatId = pickTargetChatId({ withdraw: result?.withdraw, user: result?.user });

    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `❌ <b>Withdrawal Rejected</b>\n\n💸 Amount: <b>${formatAmount(result.withdraw.amount)} Birr</b>\n💵 Refunded to balance!${
          reason ? `\n📝 Reason: ${reason}` : ""
        }\n\nYour new balance: <b>${formatAmount(result.user?.Balance || 0)} Birr</b>`
      );
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[REJECT_WITHDRAW] error:", err);
    return res.status(400).json({ ok: false, error: err.message || "REJECT_FAIL" });
  } finally {
    session.endSession();
  }
});

module.exports = router;
