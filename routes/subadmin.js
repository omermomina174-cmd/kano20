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

/**
 * Format amount to 2 decimal places
 */
const formatAmount = (n) => Number(n || 0).toFixed(2);

/**
 * Round balance to 2 decimal places
 */
const roundBalance = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Validate MongoDB ObjectId
 */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Check if subadmin is in active status
 */
const isActiveStatus = (status) => String(status || "").toLowerCase() === "active";

/**
 * Send Telegram notification
 */
async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN_USER || process.env.BOT_TOKEN;
  if (!token || !chatId) return false;

  try {
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
    return res.ok;
  } catch (e) {
    console.error("[TELEGRAM] Send failed:", e?.message);
    return false;
  }
}

/**
 * Create success response
 */
const successResponse = (data) => ({ ok: true, ...data });

/**
 * Create error response
 */
const errorResponse = (error, statusCode = 400) => ({
  response: { ok: false, error },
  statusCode,
});

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
      const telegramId = String(req.tgUser.id);
      const subadmin = await SubAdmin.findOne({ telegramId }).lean();

      if (!subadmin) {
        return res.status(403).json(errorResponse("NOT_SUBADMIN", 403).response);
      }

      if (subadmin.status?.toLowerCase() === "blocked") {
        return res.status(403).json(errorResponse("BLOCKED", 403).response);
      }

      // Set session
      req.session.subadmin = {
        id: String(subadmin._id),
        telegramId,
        role: subadmin.role || "subadmin",
        username: subadmin.username || req.tgUser.username || "",
      };

      return res.json(
        successResponse({
          subadmin: {
            id: String(subadmin._id),
            username: subadmin.username || req.tgUser.first_name || "",
            status: subadmin.status || "active",
            balance: roundBalance(subadmin.balance || 0),
          },
        })
      );
    } catch (err) {
      console.error("[AUTH] Error:", err);
      return res.status(500).json(errorResponse("AUTH_FAIL", 500).response);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════
   🔄 STATUS TOGGLE
═══════════════════════════════════════════════════════════════ */

router.post("/api/toggle-status", requireSubadminSession, async (req, res) => {
  try {
    const subadminId = req.session.subadmin.id;
    const subadmin = await SubAdmin.findById(subadminId).select("status").lean();

    if (!subadmin) {
      return res.status(404).json(errorResponse("NOT_FOUND", 404).response);
    }

    const currentStatus = String(subadmin.status || "active").toLowerCase();
    const newStatus = currentStatus === "active" ? "sleep" : "active";

    await SubAdmin.findByIdAndUpdate(subadminId, { $set: { status: newStatus } });

    return res.json(successResponse({ status: newStatus }));
  } catch (err) {
    console.error("[TOGGLE_STATUS] Error:", err);
    return res.status(500).json(errorResponse("TOGGLE_FAIL", 500).response);
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

    return res.json(
      successResponse({
        deposits: depositStats[0] || { count: 0, total: 0 },
        withdraws: withdrawStats[0] || { count: 0, total: 0 },
        balance: roundBalance(subadmin?.balance || 0),
        status: subadmin?.status || "active",
      })
    );
  } catch (err) {
    console.error("[STATS] Error:", err);
    return res.status(500).json(errorResponse("STATS_FAIL", 500).response);
  }
});

/* ═══════════════════════════════════════════════════════════════
   💰 BALANCE
═══════════════════════════════════════════════════════════════ */

router.get("/api/balance", requireSubadminSession, async (req, res) => {
  try {
    const subadminId = req.session.subadmin.id;
    const subadmin = await SubAdmin.findById(subadminId).select("balance status").lean();

    return res.json(
      successResponse({
        balance: roundBalance(subadmin?.balance || 0),
        status: subadmin?.status || "active",
      })
    );
  } catch (err) {
    console.error("[BALANCE] Error:", err);
    return res.status(500).json(errorResponse("BALANCE_FAIL", 500).response);
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
    if (cursor && isValidObjectId(cursor)) {
      query._id = { $gt: cursor };
    }

    const deposits = await Deposit.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limitNum)
      .lean();

    const lastItem = deposits[deposits.length - 1];
    const totalCount = await Deposit.countDocuments({ status: "pending" });

    return res.json(
      successResponse({
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
      })
    );
  } catch (err) {
    console.error("[DEPOSITS_FETCH] Error:", err);
    return res.status(500).json(errorResponse("FETCH_FAIL", 500).response);
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
    if (cursor && isValidObjectId(cursor)) {
      query._id = { $gt: cursor };
    }

    const withdraws = await Withdraw.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limitNum)
      .lean();

    const lastItem = withdraws[withdraws.length - 1];
    const totalCount = await Withdraw.countDocuments({ status: "pending" });

    return res.json(
      successResponse({
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
      })
    );
  } catch (err) {
    console.error("[WITHDRAWS_FETCH] Error:", err);
    return res.status(500).json(errorResponse("FETCH_FAIL", 500).response);
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ APPROVE DEPOSIT (Single)
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/:id/approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) {
      return res.status(400).json(errorResponse("INVALID_ID").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
    }

    let result = null;

    await session.withTransaction(async () => {
      const deposit = await Deposit.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status: "approved",
            approvedBy: subadminId,
            approvedAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (!deposit) throw new Error("NOT_FOUND");

      const user = await User.findOneAndUpdate(
        { telegramId: deposit.telegramId },
        { $inc: { Balance: deposit.amount } },
        { new: true, session }
      );

      if (!user) throw new Error("USER_NOT_FOUND");

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: roundBalance(deposit.amount) } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");

      result = { deposit, user, subadmin };
    });

    // Send notification
    if (result?.deposit?.chatId) {
      sendTelegramMessage(
        result.deposit.chatId,
        `✅ <b>Deposit Approved!</b>\n\n💰 Amount: <b>${formatAmount(result.deposit.amount)} Birr</b>\n💵 New Balance: <b>${formatAmount(result.user.Balance)} Birr</b>\n\n🎮 Ready to play!`
      );
    }

    return res.json(
      successResponse({
        id,
        newBalance: roundBalance(result.subadmin.balance),
      })
    );
  } catch (err) {
    console.error("[APPROVE_DEPOSIT] Error:", err);
    return res.status(400).json(errorResponse(err.message || "APPROVE_FAIL").response);
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ✅ BULK APPROVE DEPOSITS
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/bulk-approve", requireSubadminSession, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { ids } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(errorResponse("INVALID_IDS").response);
    }

    const validIds = ids.filter(isValidObjectId);
    if (validIds.length === 0) {
      return res.status(400).json(errorResponse("NO_VALID_IDS").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
    }

    let result = { approved: 0, failed: 0, totalAmount: 0, newBalance: 0 };

    await session.withTransaction(async () => {
      for (const id of validIds) {
        try {
          const deposit = await Deposit.findOneAndUpdate(
            { _id: id, status: "pending" },
            {
              $set: {
                status: "approved",
                approvedBy: subadminId,
                approvedAt: new Date(),
              },
            },
            { new: true, session }
          );

          if (!deposit) {
            result.failed++;
            continue;
          }

          const user = await User.findOneAndUpdate(
            { telegramId: deposit.telegramId },
            { $inc: { Balance: deposit.amount } },
            { new: true, session }
          );

          if (!user) {
            result.failed++;
            continue;
          }

          result.totalAmount += deposit.amount;
          result.approved++;

          // Send notification
          if (deposit.chatId) {
            sendTelegramMessage(
              deposit.chatId,
              `✅ <b>Deposit Approved!</b>\n\n💰 Amount: <b>${formatAmount(deposit.amount)} Birr</b>\n💵 New Balance: <b>${formatAmount(user.Balance)} Birr</b>\n\n🎮 Ready to play!`
            );
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

    return res.json(successResponse(result));
  } catch (err) {
    console.error("[BULK_APPROVE_DEPOSITS] Error:", err);
    return res.status(400).json(errorResponse(err.message || "BULK_APPROVE_FAIL").response);
  } finally {
    session.endSession();
  }
});

/* ═══════════════════════════════════════════════════════════════
   ❌ REJECT DEPOSIT
═══════════════════════════════════════════════════════════════ */

router.post("/api/deposits/:id/reject", requireSubadminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const subadminId = req.session.subadmin.id;

    if (!isValidObjectId(id)) {
      return res.status(400).json(errorResponse("INVALID_ID").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
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

    if (!deposit) {
      return res.status(404).json(errorResponse("NOT_FOUND", 404).response);
    }

    // Send notification
    if (deposit.chatId) {
      sendTelegramMessage(
        deposit.chatId,
        `❌ <b>Deposit Rejected</b>\n\n💰 Amount: <b>${formatAmount(deposit.amount)} Birr</b>${reason ? `\n📝 Reason: ${reason}` : ""}\n\nPlease try again or contact support.`
      );
    }

    return res.json(successResponse({ id }));
  } catch (err) {
    console.error("[REJECT_DEPOSIT] Error:", err);
    return res.status(500).json(errorResponse("REJECT_FAIL", 500).response);
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

    if (!isValidObjectId(id)) {
      return res.status(400).json(errorResponse("INVALID_ID").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
    }

    let result = null;

    await session.withTransaction(async () => {
      const withdraw = await Withdraw.findOne({ _id: id, status: "pending" }).session(session);

      if (!withdraw) throw new Error("NOT_FOUND");

      withdraw.status = "approved";
      withdraw.approvedBy = subadminId;
      withdraw.approvedAt = new Date();
      await withdraw.save({ session });

      const subadmin = await SubAdmin.findByIdAndUpdate(
        subadminId,
        { $inc: { balance: -roundBalance(withdraw.amount) } },
        { new: true, session }
      );

      if (!subadmin) throw new Error("SUBADMIN_NOT_FOUND");

      result = { withdraw, subadmin };
    });

    // Send notification
    if (result?.withdraw?.chatId) {
      sendTelegramMessage(
        result.withdraw.chatId,
        `✅ <b>Withdrawal Approved!</b>\n\n💸 Amount: <b>${formatAmount(result.withdraw.amount)} Birr</b>\n📱 To: <b>${result.withdraw.receiverPhone}</b>\n\nFunds sent successfully!`
      );
    }

    return res.json(
      successResponse({
        id,
        newBalance: roundBalance(result.subadmin.balance),
      })
    );
  } catch (err) {
    console.error("[APPROVE_WITHDRAW] Error:", err);
    return res.status(400).json(errorResponse(err.message || "APPROVE_FAIL").response);
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
      return res.status(400).json(errorResponse("INVALID_IDS").response);
    }

    const validIds = ids.filter(isValidObjectId);
    if (validIds.length === 0) {
      return res.status(400).json(errorResponse("NO_VALID_IDS").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
    }

    let result = { approved: 0, failed: 0, totalAmount: 0, newBalance: 0 };

    await session.withTransaction(async () => {
      for (const id of validIds) {
        try {
          const withdraw = await Withdraw.findOne({ _id: id, status: "pending" }).session(
            session
          );

          if (!withdraw) {
            result.failed++;
            continue;
          }

          withdraw.status = "approved";
          withdraw.approvedBy = subadminId;
          withdraw.approvedAt = new Date();
          await withdraw.save({ session });

          result.totalAmount += withdraw.amount;
          result.approved++;

          // Send notification
          if (withdraw.chatId) {
            sendTelegramMessage(
              withdraw.chatId,
              `✅ <b>Withdrawal Approved!</b>\n\n💸 Amount: <b>${formatAmount(withdraw.amount)} Birr</b>\n📱 To: <b>${withdraw.receiverPhone}</b>\n\nFunds sent successfully!`
            );
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

    return res.json(successResponse(result));
  } catch (err) {
    console.error("[BULK_APPROVE_WITHDRAWS] Error:", err);
    return res.status(400).json(errorResponse(err.message || "BULK_APPROVE_FAIL").response);
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

    if (!isValidObjectId(id)) {
      return res.status(400).json(errorResponse("INVALID_ID").response);
    }

    const subadminCheck = await SubAdmin.findById(subadminId).select("status").lean();
    if (!isActiveStatus(subadminCheck?.status)) {
      return res.status(403).json(errorResponse("SLEEP_MODE", 403).response);
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

      const user = await User.findOneAndUpdate(
        { telegramId: withdraw.telegramId },
        { $inc: { Balance: withdraw.amount } },
        { new: true, session }
      );

      result = { withdraw, user };
    });

    // Send notification
    if (result?.withdraw?.chatId) {
      sendTelegramMessage(
        result.withdraw.chatId,
        `❌ <b>Withdrawal Rejected</b>\n\n💸 Amount: <b>${formatAmount(result.withdraw.amount)} Birr</b>\n💵 Refunded to balance!${reason ? `\n📝 Reason: ${reason}` : ""}\n\nYour new balance: <b>${formatAmount(result.user?.Balance || 0)} Birr</b>`
      );
    }

    return res.json(successResponse({ id }));
  } catch (err) {
    console.error("[REJECT_WITHDRAW] Error:", err);
    return res.status(400).json(errorResponse(err.message || "REJECT_FAIL").response);
  } finally {
    session.endSession();
  }
});

module.exports = router;