"use strict";

const express = require("express");
const router = express.Router();

const User = require("../models/user");
const Deposit = require("../models/deposit");
const Withdraw = require("../models/withdraw");
const KanoTicketHistory = require("../models/KanoTicketHistory");

const { requireTelegramInitData } = require("../utils/telegramWebApp");
const { requireUserSession } = require("../middleware/requireSession");

// ---------------------------------------------------------
// Ethiopian Gamers Array for Fake Leaderboard
// ---------------------------------------------------------
const ethiogamers = [
  "DawitX", "SamsonGG", "KalebPlayz", "YonatanX", "EliasPro",
  "NathanEthi", "AbelFPS", "NoahGG", "MikiClutch", "HenokX",
  "DanielRex", "SamuelOps", "YaredGG", "BereketX", "NahomPlayz",
  "EphremPro", "RobelFPS", "SolomonX", "AmanuelGG", "MatiClutch",
  "AaronX", "EyobPlayz", "KennyGG", "NatiPro", "SamiFPS",
  "ElijahX", "JesseGG", "AbrahamOps", "ChrisEthi", "IsaacX",
  "JonahPlayz", "MarkosGG", "AlexEthi", "TommyX", "BenjiPro",
  "LukeFPS", "MikeOps", "JoshX", "KevinGG", "RyanEthi",
  "LiamX", "NathanClutch", "AaronGGX", "DanielPlayz", "SamXPro",
  "NoahFPS", "EliOps", "MattGG", "JakeX", "PaulPro",
  "LeoFPS", "AndrewX", "NickPlayz", "TonyGG", "VictorOps",
  "SteveX", "EricPro", "JasonFPS", "FrankGG", "AdamX",
  "BrianPlayz", "ChrisFPS", "PeterX", "JohnGG", "TimothyPro",
  "LucasOps", "OscarX", "FelixGG", "IvanFPS", "MaxPro",
  "ZionX", "EzraGG", "JoelPlayz", "TheoPro", "CalebFPS",
  "MicahX", "EthanGG", "AaronOps", "NathanX", "DavidGGX",
  "SamClutch", "JoshFPS", "BenXPro", "MarkGG", "LukePlayz",
  "PaulX", "EvanOps", "AlexFPS", "RyanX", "DanielGGX"
];

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function rangeToMs(range) {
  if (range === "1d") return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function clampRange(range) {
  return range === "1d" ? "1d" : "7d";
}

function computeLevel(games) {
  const g = Number(games || 0);
  if (g <= 0) return "New";
  if (g < 5) return "Beginner";
  if (g < 15) return "Bronze";
  if (g < 30) return "Silver";
  return "Gold";
}

// ---------------------------------------------------------
// EAT (East Africa Time) helpers
// ---------------------------------------------------------
function getEATInfo() {
  const now = new Date();

  // Get current date in EAT (Africa/Addis_Ababa)
  const eatDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
  }).format(now);

  // Get day of week in EAT (0 = Sunday, 1 = Monday, etc.)
  const eatDayOfWeek = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Addis_Ababa",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  ).getDay();

  // Calculate ISO week number
  const [year, month, day] = eatDateStr.split("-").map(Number);
  const eatDate = new Date(year, month - 1, day);
  const dayNum = eatDate.getDay() || 7;
  eatDate.setDate(eatDate.getDate() + 4 - dayNum);
  const yearStart = new Date(eatDate.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((eatDate - yearStart) / 86400000) + 1) / 7);

  return {
    dateKey: eatDateStr,
    weekKey: `${year}-W${String(weekNum).padStart(2, "0")}`,
    isMonday: eatDayOfWeek === 1,
  };
}

// ---------------------------------------------------------
// Seeded Random Generator (deterministic based on seed)
// ---------------------------------------------------------
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = Math.sin(s) * 10000;
    return s - Math.floor(s);
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

// ---------------------------------------------------------
// Generate Fake Winners
// ---------------------------------------------------------
function generateWinners(seedStr, count, gamesRange, payoutRange) {
  const rng = seededRandom(hashString(seedStr));

  // Shuffle array deterministically
  const shuffled = [...ethiogamers]
    .map((name) => ({ name, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .map((item) => item.name);

  // Take first 'count' players
  const winners = shuffled.slice(0, count).map((name) => {
    const games = Math.floor(gamesRange[0] + rng() * (gamesRange[1] - gamesRange[0]));
    const payout = Math.floor(payoutRange[0] + rng() * (payoutRange[1] - payoutRange[0]));
    return { username: name, games, payout };
  });

  // Sort by games descending
  return winners.sort((a, b) => b.games - a.games);
}

// ---------------------------------------------------------
// Leaderboard Cache
// ---------------------------------------------------------
const leaderboardCache = {
  daily: { key: null, data: null },
  weekly: { key: null, data: null },
};

function getGeneratedLeaderboard() {
  const { dateKey, weekKey } = getEATInfo();

  // Check and regenerate daily cache
  // Daily: 9k - 15k payout range
  if (leaderboardCache.daily.key !== dateKey) {
    leaderboardCache.daily.key = dateKey;
    leaderboardCache.daily.data = generateWinners(
      `daily-${dateKey}`,
      3,
      [18, 55],       // games range for daily
      [9000, 15000]   // payout range 9k-15k
    );
    console.log(`[Leaderboard] Generated new daily data for ${dateKey}`);
  }

  // Check and regenerate weekly cache (clears on new week)
  // Weekly: 30k - 50k payout range
  if (leaderboardCache.weekly.key !== weekKey) {
    leaderboardCache.weekly.key = weekKey;
    leaderboardCache.weekly.data = generateWinners(
      `weekly-${weekKey}`,
      3,
      [95, 250],      // games range for weekly
      [30000, 50000]  // payout range 30k-50k
    );
    console.log(`[Leaderboard] Generated new weekly data for ${weekKey}`);
  }

  return {
    daily: leaderboardCache.daily.data,
    weekly: leaderboardCache.weekly.data,
    dateKey,
    weekKey,
  };
}

// ---------------------------------------------------------
// Get User's Own Stats
// ---------------------------------------------------------
async function getMyStats({ telegramId, range }) {
  const since = new Date(Date.now() - rangeToMs(range));

  const myAgg = await KanoTicketHistory.aggregate([
    { $match: { createdAt: { $gte: since }, telegramId: String(telegramId) } },
    { $group: { _id: "$telegramId", games: { $sum: 1 } } },
  ]);

  const games = myAgg[0]?.games || 0;
  return { games, level: computeLevel(games) };
}

// ---------------------------------------------------------
// Serve Home Page
// ---------------------------------------------------------
router.get("/", (req, res) => {
  res.sendFile("home.html", { root: "./public" });
});

// ---------------------------------------------------------
// Auth endpoint
// ---------------------------------------------------------
router.post(
  "/api/user/auth",
  express.json(),
  requireTelegramInitData("TELEGRAM_BOT_TOKEN_USER"),
  asyncHandler(async (req, res) => {
    const telegramUser = req.tgUser;
    const telegramId = String(telegramUser.id);

    const user = await User.findOne(
      { telegramId },
      { username: 1, Balance: 1, status: 1, role: 1 }
    ).lean();

    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (String(user.status || "").toLowerCase() === "blocked") {
      return res.status(403).json({ success: false, error: "User is blocked" });
    }

    req.session.user = {
      telegramId,
      role: user.role || "user",
      username: telegramUser.username || telegramUser.first_name || "Player",
    };

    return res.json({
      success: true,
      user: {
        telegramId,
        username: req.session.user.username,
        first_name: telegramUser.first_name || "",
        balance: Number(user.Balance ?? 0),
      },
    });
  })
);

// ---------------------------------------------------------
// Me
// ---------------------------------------------------------
router.get("/api/user/me", requireUserSession, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

// ---------------------------------------------------------
// Logout
// ---------------------------------------------------------
router.post("/api/user/logout", requireUserSession, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// ---------------------------------------------------------
// Transactions API - FIXED
// ---------------------------------------------------------
router.get(
  "/api/transactions",
  requireUserSession,
  asyncHandler(async (req, res) => {
    const telegramId = String(req.session.user.telegramId);
    const range = clampRange(String(req.query.range || "7d"));
    const status = String(req.query.status || "done").toLowerCase();

    // Validate status parameter
    if (!["pending", "done"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Use 'pending' or 'done'" });
    }

    const since = new Date(Date.now() - rangeToMs(range));

    let depositsQuery;
    let withdrawsQuery;

    if (status === "pending") {
      // Pending: status = "pending" (exclude "session")
      depositsQuery = {
        telegramId,
        status: "pending",
        createdAt: { $gte: since },
      };
      withdrawsQuery = {
        telegramId,
        status: "pending",
        createdAt: { $gte: since },
      };
    } else {
      // Done: status = "approved" OR "rejected" (exclude "session" and "pending")
      depositsQuery = {
        telegramId,
        status: { $in: ["approved", "rejected"] },
        createdAt: { $gte: since },
      };
      withdrawsQuery = {
        telegramId,
        status: { $in: ["approved", "rejected"] },
        createdAt: { $gte: since },
      };
    }

    const [deposits, withdraws] = await Promise.all([
      Deposit.find(depositsQuery, {
        amount: 1,
        status: 1,
        createdAt: 1,
        approvedAt: 1,
        senderPhone: 1,
      }).lean(),
      Withdraw.find(withdrawsQuery, {
        amount: 1,
        status: 1,
        createdAt: 1,
        approvedAt: 1,
        receiverPhone: 1,
        receiverFirstName: 1,
      }).lean(),
    ]);

    const normalized = [];

    for (const d of deposits) {
      normalized.push({
        type: "deposit",
        status: d.status, // "pending", "approved", or "rejected"
        amount: Number(d.amount || 0),
        time: d.approvedAt || d.createdAt,
        phone: d.senderPhone || "",
      });
    }

    for (const w of withdraws) {
      normalized.push({
        type: "withdraw",
        status: w.status, // "pending", "approved", or "rejected"
        amount: Number(w.amount || 0),
        time: w.approvedAt || w.createdAt,
        phone: w.receiverPhone || "",
        name: w.receiverFirstName || "",
      });
    }

    // Sort by time descending (newest first)
    normalized.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json(normalized);
  })
);

// ---------------------------------------------------------
// Leaderboard API
// ---------------------------------------------------------
router.get(
  "/api/kano/leaderboard-data",
  requireUserSession,
  asyncHandler(async (req, res) => {
    const telegramId = String(req.session.user.telegramId);

    // Get generated leaderboard (cached)
    const { daily, weekly, dateKey, weekKey } = getGeneratedLeaderboard();

    // Get user's own stats
    const [myDay, myWeek] = await Promise.all([
      getMyStats({ telegramId, range: "1d" }),
      getMyStats({ telegramId, range: "7d" }),
    ]);

    res.json({
      asOf: new Date().toISOString(),
      dateKey,
      weekKey,
      daily,
      weekly,
      my: { day: myDay, week: myWeek },
    });
  })
);

// ---------------------------------------------------------
// Account overview
// ---------------------------------------------------------
router.get(
  "/api/account/overview",
  requireUserSession,
  asyncHandler(async (req, res) => {
    const telegramId = String(req.session.user.telegramId);
    const myWeek = await getMyStats({ telegramId, range: "7d" });

    res.json({
      weekGames: myWeek.games || 0,
      level: myWeek.level || "New",
    });
  })
);

// ---------------------------------------------------------
// Router error handler
// ---------------------------------------------------------
router.use((err, req, res, next) => {
  console.error("[HOME_USER] Unhandled error:", err);
  if (res.headersSent) return next(err);

  res.status(500).json({
    ok: false,
    error: "Server error",
  });
});

module.exports = router;