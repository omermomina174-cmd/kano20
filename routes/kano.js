"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");

const User = require("../models/user");
const Admin = require("../models/admin");
const KanoTicketHistory = require("../models/KanoTicketHistory");
const KanoDrawHistory = require("../models/KanoDrawHistory");

const { requireUserSession } = require("../middleware/requireSession");

// ========== MIDDLEWARE ==========
async function loadUserFromSession(req, res, next) {
  try {
    const telegramId = String(req.session.user.telegramId);

    const user = await User.findOne(
      { telegramId },
      { telegramId: 1, username: 1, Balance: 1, status: 1 }
    ).lean();

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    if (String(user.status || "").toLowerCase() === "blocked") {
      return res.status(403).json({ success: false, message: "User is blocked" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("[KANO] loadUserFromSession error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// ========== HELPER: Calculate frequency from last N draws ==========
async function calculateFrequencyFromDraws(limit = 100) {
  const draws = await KanoDrawHistory.find({}, { drawnNumbers: 1 })
    .sort({ drawIndex: -1 })
    .limit(limit)
    .lean();

  // Initialize frequency map for 1-80
  const freqMap = new Map();
  for (let i = 1; i <= 80; i++) {
    freqMap.set(i, 0);
  }

  // Count occurrences
  for (const draw of draws) {
    for (const num of draw.drawnNumbers || []) {
      freqMap.set(num, (freqMap.get(num) || 0) + 1);
    }
  }

  // Convert to array
  const frequency = [];
  for (let i = 1; i <= 80; i++) {
    frequency.push({ number: i, count: freqMap.get(i) || 0 });
  }

  return { frequency, totalRounds: draws.length };
}

// ========== ROUTES ==========

// Serve the Kano game page
router.get("/", requireUserSession, loadUserFromSession, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/kano.html"));
});

// Get comprehensive game data
router.get("/game/data", requireUserSession, loadUserFromSession, async (req, res) => {
  try {
    const telegramId = req.user.telegramId;

    const [user, admin, lastDraw, drawHistory, ticketHistory, frequencyData] = await Promise.all([
      // User data
      User.findOne({ telegramId }, { username: 1, Balance: 1 }).lean(),

      // Get RTP from Admin
      Admin.findOne(
        { Role: { $in: ["Admin", "SuperAdmin"] } },
        { rtp: 1 }
      ).lean(),

      // Get last draw for current draw index
      KanoDrawHistory.findOne({})
        .sort({ drawIndex: -1 })
        .select({ drawIndex: 1 })
        .lean(),

      // Recent draw history - CHANGED: limit to 20 (closest 20 draws)
      KanoDrawHistory.find()
        .sort({ drawIndex: -1 })
        .limit(20)
        .lean(),

      // User's ticket history - limit to 50 max (frontend handles pagination display)
      KanoTicketHistory.find({ telegramId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),

      // Calculate frequency from draws
      calculateFrequencyFromDraws(100)
    ]);

    return res.json({
      success: true,
      user: {
        telegramId,
        username: user?.username || "",
        balance: Number(user?.Balance ?? 0)
      },
      kano: {
        rtp: Number(admin?.rtp ?? 70),
        frequency: frequencyData.frequency,
        currentDrawIndex: lastDraw?.drawIndex || 0,
        totalRoundsPlayed: frequencyData.totalRounds
      },
      // Draw history - already sorted by drawIndex descending (most recent first)
      drawHistory: drawHistory.map(d => ({
        drawIndex: d.drawIndex,
        gameId: d.gameId,
        drawnNumbers: d.drawnNumbers,
        totalBets: d.totalBets,
        totalPayout: d.totalPayout,
        totalPlayers: d.totalPlayers,
        totalTickets: d.totalTickets,
        actualRtp: d.actualRtp,
        timestamp: d.createdAt
      })),
      // User ticket history - just the history data, no stats
      userTicketHistory: ticketHistory.map(t => ({
        index: t.drawIndex,
        gameId: t.gameId,
        ticketId: t.ticketId,
        pickedNo: t.pickedCount,
        matchedNo: t.matchedCount,
        pickedNumbers: t.pickedNumbers,
        matchedNumbers: t.matchedNumbers,
        drawnNumbers: t.drawnNumbers,
        betAmount: t.betAmount,
        winAmount: t.winAmount,
        netAmount: t.netAmount,
        multiplier: t.multiplier,
        result: t.result,
        timestamp: t.createdAt
      }))
    });
  } catch (err) {
    console.error("[KANO] Error fetching game data:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get user balance
router.get("/game/balance", requireUserSession, loadUserFromSession, async (req, res) => {
  try {
    const user = await User.findOne(
      { telegramId: req.user.telegramId },
      { Balance: 1 }
    ).lean();

    return res.json({ success: true, balance: Number(user?.Balance ?? 0) });
  } catch (err) {
    console.error("[KANO] Error fetching balance:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get draw history with pagination - CHANGED: default limit to 20
router.get("/game/draws", requireUserSession, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 20)); // Max 20
    const skip = (page - 1) * limit;

    const [draws, total] = await Promise.all([
      KanoDrawHistory.find()
        .sort({ drawIndex: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      KanoDrawHistory.countDocuments()
    ]);

    return res.json({
      success: true,
      draws: draws.map(d => ({
        drawIndex: d.drawIndex,
        gameId: d.gameId,
        drawnNumbers: d.drawnNumbers,
        totalBets: d.totalBets,
        totalPayout: d.totalPayout,
        totalPlayers: d.totalPlayers,
        totalTickets: d.totalTickets,
        targetRtp: d.targetRtp,
        actualRtp: d.actualRtp,
        timestamp: d.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("[KANO] Error fetching draw history:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get user's ticket history - CHANGED: removed stats, pagination 10 at a time, max 50
router.get("/game/my-tickets", requireUserSession, loadUserFromSession, async (req, res) => {
  try {
    const telegramId = req.user.telegramId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit) || 10)); // 10 at a time
    const skip = (page - 1) * limit;
    
    // Max 50 total tickets
    const maxSkip = 40; // 50 - 10 = 40 (max skip for last page of 10)
    const actualSkip = Math.min(skip, maxSkip);

    const [tickets, total] = await Promise.all([
      KanoTicketHistory.find({ telegramId })
        .sort({ createdAt: -1 })
        .skip(actualSkip)
        .limit(limit)
        .lean(),
      KanoTicketHistory.countDocuments({ telegramId })
    ]);

    // Cap total at 50 for pagination purposes
    const cappedTotal = Math.min(total, 50);

    return res.json({
      success: true,
      tickets: tickets.map(t => ({
        drawIndex: t.drawIndex,
        gameId: t.gameId,
        ticketId: t.ticketId,
        pickedNumbers: t.pickedNumbers,
        matchedNumbers: t.matchedNumbers,
        drawnNumbers: t.drawnNumbers,
        pickedCount: t.pickedCount,
        matchedCount: t.matchedCount,
        betAmount: t.betAmount,
        winAmount: t.winAmount,
        netAmount: t.netAmount,
        multiplier: t.multiplier,
        result: t.result,
        timestamp: t.createdAt
      })),
      pagination: {
        page,
        limit,
        total: cappedTotal,
        totalPages: Math.ceil(cappedTotal / limit),
        hasMore: (page * limit) < cappedTotal
      }
    });
  } catch (err) {
    console.error("[KANO] Error fetching ticket history:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get number frequency stats
router.get("/game/frequency", requireUserSession, async (req, res) => {
  try {
    const { frequency, totalRounds } = await calculateFrequencyFromDraws(100);
    const sorted = [...frequency].sort((a, b) => b.count - a.count);

    return res.json({
      success: true,
      frequency,
      hotNumbers: sorted.slice(0, 10).map(f => f.number),
      coldNumbers: sorted.slice(-10).map(f => f.number),
      totalRounds
    });
  } catch (err) {
    console.error("[KANO] Error fetching frequency:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get specific draw by gameId
router.get("/game/draw/:gameId", requireUserSession, async (req, res) => {
  try {
    const { gameId } = req.params;

    const draw = await KanoDrawHistory.findOne({ gameId: gameId.toUpperCase() }).lean();

    if (!draw) {
      return res.status(404).json({ success: false, message: "Draw not found" });
    }

    return res.json({
      success: true,
      draw: {
        drawIndex: draw.drawIndex,
        gameId: draw.gameId,
        drawnNumbers: draw.drawnNumbers,
        totalBets: draw.totalBets,
        totalPayout: draw.totalPayout,
        totalPlayers: draw.totalPlayers,
        totalTickets: draw.totalTickets,
        targetRtp: draw.targetRtp,
        actualRtp: draw.actualRtp,
        timestamp: draw.createdAt
      }
    });
  } catch (err) {
    console.error("[KANO] Error fetching draw:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get game statistics
router.get("/game/stats", requireUserSession, async (req, res) => {
  try {
    const [totalDraws, recentStats] = await Promise.all([
      KanoDrawHistory.countDocuments(),

      KanoDrawHistory.aggregate([
        { $sort: { drawIndex: -1 } },
        { $limit: 100 },
        {
          $group: {
            _id: null,
            avgRtp: { $avg: "$actualRtp" },
            totalBets: { $sum: "$totalBets" },
            totalPayout: { $sum: "$totalPayout" },
            avgPlayers: { $avg: "$totalPlayers" }
          }
        }
      ])
    ]);

    const stats = recentStats[0] || {};

    return res.json({
      success: true,
      stats: {
        totalRoundsPlayed: totalDraws,
        recentAvgRtp: stats.avgRtp?.toFixed(2) || "0.00",
        recentTotalBets: stats.totalBets || 0,
        recentTotalPayout: stats.totalPayout || 0,
        recentAvgPlayers: Math.round(stats.avgPlayers || 0)
      }
    });
  } catch (err) {
    console.error("[KANO] Error fetching stats:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;