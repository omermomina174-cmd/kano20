"use strict";

const { Server } = require("socket.io");
const http = require("http");
const AsyncLock = require("async-lock");

const User = require("../models/user");
const Admin = require("../models/admin");
const KanoTicketHistory = require("../models/KanoTicketHistory");
const KanoDrawHistory = require("../models/KanoDrawHistory");

const { userSession } = require("../middleware/cookieSessions");
const { generateSyntheticTotals, getDayName } = require("../utils/kanoSyntheticTotalsEAT");

// ========== CONSTANTS ==========
const GAME_CONFIG = {
  MIN_BET: 5,
  MAX_BET: 10000,
  MIN_NUMBERS: 1,
  MAX_NUMBERS: 10,
  MAX_KENO_NUMBER: 80,
  MAX_TICKETS_PER_USER: 20,
  BETTING_DURATION_SEC: 60,
  DRAW_SIZE: 20,
  DRAW_INTERVAL_MS: 1500,
  RESULT_DURATION_SEC: 5,
  MAX_WIN_PER_TICKET_MINOR: 100000000,
  MAX_DRAW_HISTORY: 100,
};

const RTP_CONFIG = {
  SIMULATION_BATCH_SIZE: 100,
  MAX_SIMULATION_BATCHES: 50,
  TOLERANCE_PERCENT: 5,
};

const CACHE_CONFIG = {
  ADMIN_CACHE_MS: 30000,
  RATE_LIMIT_MS: 300,
  RATE_LIMIT_MAX_PER_MIN: 30,
};

const PAYOUT_TABLE = {
  "1": { "1": 3 },
  "2": { "1": 1, "2": 10 },
  "3": { "1": 0, "2": 2, "3": 50 },
  "4": { "1": 0, "2": 1, "3": 10, "4": 80 },
  "5": { "1": 0, "2": 1, "3": 3, "4": 30, "5": 150 },
  "6": { "1": 0, "2": 0, "3": 2, "4": 15, "5": 60, "6": 500 },
  "7": { "1": 0, "2": 0, "3": 2, "4": 4, "5": 20, "6": 80, "7": 1000 },
  "8": { "1": 0, "2": 0, "3": 0, "4": 5, "5": 15, "6": 50, "7": 200, "8": 2000 },
  "9": { "1": 0, "2": 0, "3": 0, "4": 2, "5": 10, "6": 25, "7": 125, "8": 1000, "9": 5000 },
  "10": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 5, "6": 30, "7": 100, "8": 300, "9": 2000, "10": 10000 }
};

// ========== STATE ==========
let io = null;
let isInitialized = false;
let isShuttingDown = false;

// Game state
let gamePhase = "betting";
let countdown = GAME_CONFIG.BETTING_DURATION_SEC;
let gameInterval = null;
let isDrawing = false;

// Round state
let winningNumbers = [];
let currentDrawIndex = 0;
let currentGameId = null;
let currentRoundTickets = new Map();
let userRoundBetMinor = new Map();

// Draw state
let activeDrawBatch = null;
let activeDrawFinished = null;
let roundUserResult = new Map();

// Timers
let finishTimer = null;
let newRoundTimer = null;

// Admin cache (RTP only)
let cachedRtp = 70;
let rtpCacheTime = 0;

// Runtime state
let runtimeUsers = new Map();
let socketToTelegram = new Map();

// Rate limiting
let userRateLimit = new Map();

// Locks for race condition prevention
const userLock = new AsyncLock({ timeout: 5000 });

// ========== SIMPLE LOGGING HELPERS ==========
function formatMoney(minor) {
  return (minor / 100).toFixed(2);
}

function formatPct(value) {
  return value.toFixed(2) + "%";
}

// ========== MONEY HELPERS ==========
function toMinor(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function fromMinor(minor) {
  return Number((Number(minor || 0) / 100).toFixed(2));
}

// ========== EAT TIMEZONE HELPERS ==========
function getStartOfDayEAT() {
  const now = new Date();
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  
  const eatTime = new Date(now.getTime() + EAT_OFFSET_MS);
  
  const startOfDayEAT = new Date(Date.UTC(
    eatTime.getUTCFullYear(),
    eatTime.getUTCMonth(),
    eatTime.getUTCDate(),
    0, 0, 0, 0
  ));
  
  return new Date(startOfDayEAT.getTime() - EAT_OFFSET_MS);
}

// ========== RATE LIMITING ==========
function checkRateLimit(telegramId) {
  const now = Date.now();
  let limit = userRateLimit.get(telegramId);
  
  if (!limit) {
    limit = { lastRequest: 0, requestsThisMinute: 0, minuteStart: now };
    userRateLimit.set(telegramId, limit);
  }
  
  if (now - limit.minuteStart > 60000) {
    limit.requestsThisMinute = 0;
    limit.minuteStart = now;
  }
  
  if (now - limit.lastRequest < CACHE_CONFIG.RATE_LIMIT_MS) {
    return { allowed: false, reason: "Too fast. Please wait a moment." };
  }
  
  if (limit.requestsThisMinute >= CACHE_CONFIG.RATE_LIMIT_MAX_PER_MIN) {
    return { allowed: false, reason: "Too many requests. Please slow down." };
  }
  
  limit.lastRequest = now;
  limit.requestsThisMinute++;
  
  return { allowed: true };
}

function clearRateLimitCache() {
  userRateLimit.clear();
}

// ========== GAME ID GENERATOR ==========
function generateGameId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateUniqueGameId() {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const gameId = generateGameId();
    const existing = await KanoDrawHistory.findOne({ gameId }).lean();
    if (!existing) return gameId;
    attempts++;
  }

  return `G${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

// ========== DRAW INDEX HELPERS ==========
function getNextDrawIndex(current) {
  return (current % GAME_CONFIG.MAX_DRAW_HISTORY) + 1;
}

// ========== TIMER MANAGEMENT ==========
function clearRoundTimers() {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
  if (newRoundTimer) {
    clearTimeout(newRoundTimer);
    newRoundTimer = null;
  }
}

// ========== ADMIN CONFIG HELPERS ==========
async function getRtpFromAdmin() {
  const now = Date.now();
  if (now - rtpCacheTime < CACHE_CONFIG.ADMIN_CACHE_MS) {
    return cachedRtp;
  }

  try {
    const admin = await Admin.findOne(
      { Role: { $in: ["Admin", "SuperAdmin"] } },
      { rtp: 1 }
    ).lean();

    const rawRtp = Number(admin?.rtp);
    cachedRtp = (Number.isFinite(rawRtp) && rawRtp >= 1 && rawRtp <= 100) ? rawRtp : 70;
    rtpCacheTime = now;

    console.log(`[RTP] Loaded from Admin: ${cachedRtp}%`);
    return cachedRtp;
  } catch (err) {
    console.error("[RTP] Failed to fetch:", err.message);
    return cachedRtp || 70;
  }
}

// ========== INITIALIZATION ==========
async function initializeDrawIndex() {
  try {
    const lastDraw = await KanoDrawHistory.findOne({})
      .sort({ updatedAt: -1 })
      .select({ drawIndex: 1 })
      .lean();

    currentDrawIndex = lastDraw?.drawIndex || 0;
    console.log(`[INIT] Draw index initialized: ${currentDrawIndex} (max: ${GAME_CONFIG.MAX_DRAW_HISTORY})`);
    return currentDrawIndex;
  } catch (err) {
    console.error("[INIT] Failed to initialize draw index:", err.message);
    return 0;
  }
}

// ========== DRAW GENERATION ==========
function generateSingleDraw() {
  const numbers = [];
  while (numbers.length < GAME_CONFIG.DRAW_SIZE) {
    const num = Math.floor(Math.random() * GAME_CONFIG.MAX_KENO_NUMBER) + 1;
    if (!numbers.includes(num)) numbers.push(num);
  }
  return numbers.sort((a, b) => a - b);
}

function calculatePayoutForDraw(drawnNumbers, tickets) {
  const winSet = new Set(drawnNumbers);
  let totalPayoutMinor = 0;

  for (const [, userTickets] of tickets) {
    for (const ticket of userTickets) {
      const matches = ticket.numbers.filter(n => winSet.has(n)).length;
      const picked = ticket.numbers.length;

      const payoutRow = PAYOUT_TABLE[String(picked)];
      if (!payoutRow) continue;

      const multiplier = Number(payoutRow[String(matches)] || 0);
      if (!multiplier) continue;

      const betMinor = toMinor(ticket.betAmount);
      let winMinor = Math.round(betMinor * multiplier);
      
      winMinor = Math.min(winMinor, GAME_CONFIG.MAX_WIN_PER_TICKET_MINOR);
      totalPayoutMinor += winMinor;
    }
  }

  return totalPayoutMinor;
}

function getTotalRoundBetMinor() {
  let total = 0;
  for (const [, tickets] of currentRoundTickets) {
    for (const t of tickets) total += toMinor(t.betAmount);
  }
  return total;
}

function generateOptimalDrawWithTolerance(tickets, targetRtpPercent) {
  const totalBetMinor = getTotalRoundBetMinor();

  if (totalBetMinor === 0) {
    return {
      numbers: generateSingleDraw(),
      targetRtpPercent,
      tolerancePercent: RTP_CONFIG.TOLERANCE_PERCENT,
      totalBetMinor: 0,
      targetPayoutMinor: 0,
      actualPayoutMinor: 0,
      actualRtp: 0,
      totalSimulationsRun: 0,
      selectedSimulationGlobalIndex: 0,
      mode: "no_bets"
    };
  }

  const minRtp = Math.max(0, targetRtpPercent - RTP_CONFIG.TOLERANCE_PERCENT);
  const maxRtp = Math.min(100, targetRtpPercent + RTP_CONFIG.TOLERANCE_PERCENT);
  const lowerPayoutMinor = Math.floor(totalBetMinor * (minRtp / 100));
  const upperPayoutMinor = Math.ceil(totalBetMinor * (maxRtp / 100));
  const targetPayoutMinor = Math.round(totalBetMinor * (targetRtpPercent / 100));

  console.log(`[SIM] RTP simulation started - totalBets: ${formatMoney(totalBetMinor)}, targetRtp: ${targetRtpPercent}%, rtpBand: ${minRtp}%-${maxRtp}%`);

  let bestOverall = null;
  let bestInBand = null;
  let simsRun = 0;

  for (let batch = 0; batch < RTP_CONFIG.MAX_SIMULATION_BATCHES; batch++) {
    let foundInBandThisBatch = false;

    for (let i = 0; i < RTP_CONFIG.SIMULATION_BATCH_SIZE; i++) {
      const nums = generateSingleDraw();
      const payoutMinor = calculatePayoutForDraw(nums, tickets);
      const actualRtp = (payoutMinor / totalBetMinor) * 100;
      const diff = Math.abs(actualRtp - targetRtpPercent);
      const globalIndex = batch * RTP_CONFIG.SIMULATION_BATCH_SIZE + i;
      simsRun++;

      const candidate = { numbers: nums, payoutMinor, actualRtp, diff, batch, i, globalIndex };

      if (!bestOverall || candidate.diff < bestOverall.diff) {
        bestOverall = candidate;
      }

      const inBand = payoutMinor >= lowerPayoutMinor && payoutMinor <= upperPayoutMinor;
      if (inBand) {
        foundInBandThisBatch = true;
        if (!bestInBand || candidate.diff < bestInBand.diff) {
          bestInBand = candidate;
        }
      }
    }

    if (foundInBandThisBatch) {
      console.log(`[SIM] Found in-band draw at batch ${batch + 1} - rtp: ${formatPct(bestInBand.actualRtp)}, payout: ${formatMoney(bestInBand.payoutMinor)}`);
      break;
    }
  }

  const chosen = bestInBand || bestOverall;

  console.log(`[SIM] Draw selected - mode: ${bestInBand ? "in_band" : "closest"}, rtp: ${formatPct(chosen.actualRtp)}, payout: ${formatMoney(chosen.payoutMinor)}, simulations: ${simsRun}`);

  return {
    numbers: chosen.numbers,
    targetRtpPercent,
    tolerancePercent: RTP_CONFIG.TOLERANCE_PERCENT,
    totalBetMinor,
    targetPayoutMinor,
    actualPayoutMinor: chosen.payoutMinor,
    actualRtp: chosen.actualRtp,
    totalSimulationsRun: simsRun,
    selectedSimulationGlobalIndex: chosen.globalIndex,
    mode: bestInBand ? "in_band" : "closest_overall"
  };
}

// ========== TICKET HELPERS ==========
function getTicketRawWinMinor(ticket, winningNums) {
  const winSet = new Set(winningNums);
  const matchedNumbers = ticket.numbers.filter(n => winSet.has(n));
  const matches = matchedNumbers.length;
  const picked = ticket.numbers.length;

  const payoutRow = PAYOUT_TABLE[String(picked)];
  if (!payoutRow) {
    return { matches, picked, multiplier: 0, rawWinMinor: 0, matchedNumbers };
  }

  const multiplier = Number(payoutRow[String(matches)] || 0);
  if (!multiplier) {
    return { matches, picked, multiplier: 0, rawWinMinor: 0, matchedNumbers };
  }

  const betMinor = toMinor(ticket.betAmount);
  let rawWinMinor = Math.round(betMinor * multiplier);
  
  rawWinMinor = Math.min(rawWinMinor, GAME_CONFIG.MAX_WIN_PER_TICKET_MINOR);

  return { matches, picked, multiplier, rawWinMinor, matchedNumbers };
}

// ========== EMISSION HELPERS ==========
function emitBalanceToUser(telegramId) {
  const ru = runtimeUsers.get(telegramId);
  if (!ru) return;

  const Balance = fromMinor(ru.balanceMinor);
  for (const sid of ru.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("balanceUpdate", Balance);
  }
}

function emitTicketsToUser(telegramId) {
  const ru = runtimeUsers.get(telegramId);
  if (!ru) return;

  const tickets = currentRoundTickets.get(telegramId) || [];
  for (const sid of ru.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("myRoundTickets", tickets);
  }
}

function emitRoundResultToUser(telegramId) {
  const ru = runtimeUsers.get(telegramId);
  if (!ru) return;

  const payload = roundUserResult.get(telegramId);
  if (!payload) return;

  for (const sid of ru.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("myRoundResult", payload);
  }
}

// ========== TICKET HISTORY CLEANUP ==========
async function cleanupOldTicketHistory(telegramIds) {
  if (!telegramIds || telegramIds.length === 0) return;

  const startOfToday = getStartOfDayEAT();
  
  try {
    const result = await KanoTicketHistory.deleteMany({
      telegramId: { $in: telegramIds },
      createdAt: { $lt: startOfToday }
    });

    if (result.deletedCount > 0) {
      console.log(`[CLEANUP] Removed ${result.deletedCount} old tickets for ${telegramIds.length} users`);
    }
  } catch (err) {
    console.error("[CLEANUP] Failed to remove old tickets:", err.message);
  }
}

// ========== DB OPERATIONS (BULK) ==========
async function saveRoundToDb({
  drawIndex,
  gameId,
  drawnNumbers,
  finalWinByTicketKeyMinor,
  matchesByTicketKey,
  matchedNumbersByKey,
  optimalDrawInfo
}) {
  const startTime = Date.now();
  
  const totalBetMinor = getTotalRoundBetMinor();
  let totalPayoutMinor = 0;
  for (const [, win] of finalWinByTicketKeyMinor) {
    totalPayoutMinor += win;
  }
  const realActualRtp = totalBetMinor > 0 ? (totalPayoutMinor / totalBetMinor) * 100 : 0;

  const syn = generateSyntheticTotals({
    min: 10000,
    max: 30000,
    targetRtp: optimalDrawInfo?.targetRtpPercent ?? 70
  });

  // 1) Save Draw History
  try {
    await KanoDrawHistory.findOneAndUpdate(
      { drawIndex },
      {
        $set: {
          gameId,
          drawnNumbers,
          totalBets: syn.totalBets,
          totalPayout: syn.totalPayout,
          totalPlayers: syn.totalPlayers,
          totalTickets: syn.totalTickets,
          targetRtp: optimalDrawInfo?.targetRtpPercent ?? 70,
          actualRtp: syn.actualRtp,
          simulationsRun: optimalDrawInfo?.totalSimulationsRun ?? 0,
          selectedSimulationIndex: optimalDrawInfo?.selectedSimulationGlobalIndex ?? 0,
          realTotalBets: fromMinor(totalBetMinor),
          realTotalPayout: fromMinor(totalPayoutMinor),
          realTotalPlayers: currentRoundTickets.size,
          realActualRtp: Number(realActualRtp.toFixed(2))
        }
      },
      { upsert: true, new: true }
    );

    console.log(`[DB] Draw history saved - drawIndex: ${drawIndex}/${GAME_CONFIG.MAX_DRAW_HISTORY}, gameId: ${gameId}, syntheticBets: ${syn.totalBets}, realBets: ${formatMoney(totalBetMinor)}, eatHour: ${syn.hourEAT}, day: ${getDayName(syn.dayOfWeek)}`);
  } catch (err) {
    console.error("[DB] Draw history save failed:", err.message);
  }

  // 2) Cleanup old ticket history
  const telegramIds = Array.from(currentRoundTickets.keys());
  await cleanupOldTicketHistory(telegramIds);

  // 3) Bulk save Ticket History
  const ticketDocs = [];

  for (const [telegramId, tickets] of currentRoundTickets) {
    const ru = runtimeUsers.get(telegramId);
    const username = ru?.username || "Player";

    for (const t of tickets) {
      const key = `${telegramId}:${t.id}`;
      const finalWinMinor = finalWinByTicketKeyMinor.get(key) || 0;
      const matches = matchesByTicketKey.get(key) || 0;
      const matchedNums = matchedNumbersByKey.get(key) || [];
      const betMinor = toMinor(t.betAmount);

      const payoutRow = PAYOUT_TABLE[String(t.numbers.length)];
      const multiplier = payoutRow ? Number(payoutRow[String(matches)] || 0) : 0;

      ticketDocs.push({
        drawIndex,
        gameId,
        telegramId,
        username,
        ticketId: t.id,
        pickedNumbers: t.numbers,
        matchedNumbers: matchedNums,
        drawnNumbers,
        pickedCount: t.numbers.length,
        matchedCount: matches,
        betAmount: t.betAmount,
        winAmount: fromMinor(finalWinMinor),
        netAmount: fromMinor(finalWinMinor - betMinor),
        multiplier,
        result: finalWinMinor > 0 ? "win" : "lose"
      });
    }
  }

  if (ticketDocs.length > 0) {
    try {
      await KanoTicketHistory.insertMany(ticketDocs, { ordered: false });
      console.log(`[DB] Ticket history saved: ${ticketDocs.length} tickets (today only)`);
    } catch (err) {
      console.error("[DB] Ticket history save failed:", err.message);
    }
  }

  // 4) Bulk update User balances
  const balanceOps = [];

  for (const [telegramId] of currentRoundTickets) {
    const betMinor = userRoundBetMinor.get(telegramId) || 0;
    let winMinor = 0;

    const tickets = currentRoundTickets.get(telegramId) || [];
    for (const t of tickets) {
      const key = `${telegramId}:${t.id}`;
      winMinor += finalWinByTicketKeyMinor.get(key) || 0;
    }

    const deltaMinor = winMinor - betMinor;

    balanceOps.push({
      updateOne: {
        filter: { telegramId: String(telegramId) },
        update: { $inc: { Balance: fromMinor(deltaMinor) } }
      }
    });
  }

  if (balanceOps.length > 0) {
    try {
      await User.bulkWrite(balanceOps, { ordered: false });
      console.log(`[DB] User balances updated: ${balanceOps.length} users`);
    } catch (err) {
      console.error("[DB] User balance update failed:", err.message);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[DB] Round save completed in ${elapsed}ms`);
}

// ========== PAYOUT DISTRIBUTION ==========
async function distributeRawWinnings() {
  const finalWinByTicketKeyMinor = new Map();
  const matchesByTicketKey = new Map();
  const matchedNumbersByKey = new Map();
  const winByUserMinor = new Map();

  let winnersCount = 0;
  let totalPaidMinor = 0;

  for (const [telegramId, tickets] of currentRoundTickets) {
    for (const ticket of tickets) {
      const { matches, rawWinMinor, matchedNumbers } = getTicketRawWinMinor(ticket, winningNumbers);
      const key = `${telegramId}:${ticket.id}`;

      matchesByTicketKey.set(key, matches);
      matchedNumbersByKey.set(key, matchedNumbers);
      finalWinByTicketKeyMinor.set(key, rawWinMinor);

      if (rawWinMinor > 0) {
        winnersCount++;
        totalPaidMinor += rawWinMinor;
        winByUserMinor.set(telegramId, (winByUserMinor.get(telegramId) || 0) + rawWinMinor);
      }
    }
  }

  for (const [telegramId, winMinor] of winByUserMinor) {
    const ru = runtimeUsers.get(telegramId);
    if (ru) {
      ru.balanceMinor += winMinor;
      emitBalanceToUser(telegramId);
    }
  }

  console.log(`[PAYOUT] Winnings distributed - winners: ${winnersCount}, totalPaid: ${formatMoney(totalPaidMinor)}`);

  return { finalWinByTicketKeyMinor, matchesByTicketKey, matchedNumbersByKey, winByUserMinor };
}

function buildUserRoundResultPayload({
  telegramId,
  drawIndex,
  gameId,
  finalWinByTicketKeyMinor,
  matchesByTicketKey,
  matchedNumbersByKey
}) {
  const tickets = currentRoundTickets.get(telegramId) || [];
  const betMinor = userRoundBetMinor.get(telegramId) || 0;

  let winMinor = 0;

  const outTickets = tickets.map(t => {
    const key = `${telegramId}:${t.id}`;
    const win = finalWinByTicketKeyMinor.get(key) || 0;
    const matches = matchesByTicketKey.get(key) || 0;
    const matchedNums = matchedNumbersByKey.get(key) || [];
    winMinor += win;

    return {
      id: t.id,
      numbers: t.numbers,
      betAmount: Number(t.betAmount),
      matchedNo: matches,
      matchedNumbers: matchedNums,
      winAmount: fromMinor(win)
    };
  });

  return {
    drawIndex,
    gameId,
    drawnNumbers: winningNumbers,
    totalBet: fromMinor(betMinor),
    totalWin: fromMinor(winMinor),
    net: fromMinor(winMinor - betMinor),
    tickets: outTickets
  };
}

// ========== ROUND CACHE CLEARING ==========
function clearRoundCaches() {
  currentRoundTickets.clear();
  userRoundBetMinor.clear();
  roundUserResult.clear();
  clearRateLimitCache();
  
  winningNumbers = [];
  currentGameId = null;
  activeDrawBatch = null;
  activeDrawFinished = null;
  
  console.log("[CACHE] Round caches cleared");
}

// ========== DRAW PHASE ==========
async function runDraw() {
  if (isDrawing || isShuttingDown) return;
  isDrawing = true;
  clearRoundTimers();

  gamePhase = "drawing";

  try {
    const rtpPercent = await getRtpFromAdmin();
    
    const drawIndex = getNextDrawIndex(currentDrawIndex);
    currentDrawIndex = drawIndex;
    currentGameId = await generateUniqueGameId();

    const totalBetMinor = getTotalRoundBetMinor();

    console.log(`[DRAW STARTING] drawIndex: ${drawIndex}/${GAME_CONFIG.MAX_DRAW_HISTORY}, gameId: ${currentGameId}, players: ${currentRoundTickets.size}, totalBets: ${formatMoney(totalBetMinor)}, targetRtp: ${rtpPercent}%`);

    const optimalDrawInfo = generateOptimalDrawWithTolerance(currentRoundTickets, rtpPercent);
    winningNumbers = optimalDrawInfo.numbers;

    const startAt = Date.now() + 250;
    activeDrawBatch = {
      drawIndex,
      gameId: currentGameId,
      numbers: winningNumbers,
      startAt,
      intervalMs: GAME_CONFIG.DRAW_INTERVAL_MS
    };

    io.emit("drawStarted", { drawIndex, gameId: currentGameId });
    io.emit("drawBatch", activeDrawBatch);

    const revealDurationMs = GAME_CONFIG.DRAW_SIZE * GAME_CONFIG.DRAW_INTERVAL_MS;
    const delayToFinish = Math.max(0, (startAt + revealDurationMs) - Date.now());

    finishTimer = setTimeout(async () => {
      try {
        const { finalWinByTicketKeyMinor, matchesByTicketKey, matchedNumbersByKey } =
          await distributeRawWinnings();

        for (const [telegramId] of currentRoundTickets) {
          const payload = buildUserRoundResultPayload({
            telegramId,
            drawIndex,
            gameId: currentGameId,
            finalWinByTicketKeyMinor,
            matchesByTicketKey,
            matchedNumbersByKey
          });
          roundUserResult.set(telegramId, payload);
          emitRoundResultToUser(telegramId);
        }

        await saveRoundToDb({
          drawIndex,
          gameId: currentGameId,
          drawnNumbers: winningNumbers,
          finalWinByTicketKeyMinor,
          matchesByTicketKey,
          matchedNumbersByKey,
          optimalDrawInfo
        });

        gamePhase = "result";
        activeDrawFinished = { drawIndex, gameId: currentGameId, winningNumbers };
        io.emit("drawFinished", activeDrawFinished);

        console.log(`[DRAW FINISHED] drawIndex: ${drawIndex}/${GAME_CONFIG.MAX_DRAW_HISTORY}, gameId: ${currentGameId}, phase: result`);

        newRoundTimer = setTimeout(() => startNewRound(), GAME_CONFIG.RESULT_DURATION_SEC * 1000);
      } catch (err) {
        console.error("[DRAW] Error in finish phase:", err.message);
        newRoundTimer = setTimeout(() => startNewRound(), 5000);
      }
    }, delayToFinish);

  } catch (err) {
    console.error("[DRAW] Error starting draw:", err.message);
    isDrawing = false;
    setTimeout(() => startNewRound(), 5000);
  }
}

function startNewRound() {
  if (isShuttingDown) return;
  
  clearRoundTimers();
  clearRoundCaches();
  
  isDrawing = false;
  gamePhase = "betting";
  countdown = GAME_CONFIG.BETTING_DURATION_SEC;

  io.emit("newRound", { countdown });
  
  const nextIndex = getNextDrawIndex(currentDrawIndex);
  console.log(`[ROUND] New round started | Next draw: ${nextIndex}/${GAME_CONFIG.MAX_DRAW_HISTORY} | Online: ${runtimeUsers.size}`);
}

// ========== GAME LOOP ==========
function startGameLoop() {
  if (gameInterval) clearInterval(gameInterval);

  io.emit("countdown", countdown);

  gameInterval = setInterval(() => {
    if (isShuttingDown) return;
    if (gamePhase !== "betting") return;

    io.emit("countdown", countdown);

    if (countdown === 0) {
      gamePhase = "drawing";
      runDraw().catch(err => {
        console.error("[GAME_LOOP] Draw failed:", err.message);
      });
      return;
    }

    countdown = Math.max(0, countdown - 1);
  }, 1000);

  console.log("[GAME] Game loop started");
}

// ========== GRACEFUL SHUTDOWN ==========
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.warn(`[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

  if (gameInterval) {
    clearInterval(gameInterval);
    gameInterval = null;
  }
  clearRoundTimers();

  io.emit("serverShutdown", { message: "Server is restarting. Please reconnect shortly." });

  const balanceOps = [];
  for (const [telegramId, ru] of runtimeUsers) {
    balanceOps.push({
      updateOne: {
        filter: { telegramId },
        update: { $set: { Balance: fromMinor(ru.balanceMinor) } }
      }
    });
  }

  if (balanceOps.length > 0) {
    try {
      await User.bulkWrite(balanceOps, { ordered: false });
      console.log(`[SHUTDOWN] Synced ${balanceOps.length} user balances to DB`);
    } catch (err) {
      console.error("[SHUTDOWN] Failed to sync balances:", err.message);
    }
  }

  io.close();

  console.log("[SHUTDOWN] Graceful shutdown complete");
  process.exit(0);
}

// ========== SOCKET INITIALIZATION ==========
async function initSocket(server) {
  io = new Server(server, {
    cors: { origin: true, credentials: true }
  });

  console.log("[INIT] Initializing Kano game...");
  await initializeDrawIndex();
  await getRtpFromAdmin();

  isInitialized = true;
  console.log(`[INIT] Initialization complete - Draw cycle: 1-${GAME_CONFIG.MAX_DRAW_HISTORY}, Current: ${currentDrawIndex}`);

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    console.error("[UNCAUGHT] Uncaught exception:", err.message, err.stack);
    gracefulShutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[UNHANDLED] Unhandled rejection:", String(reason));
  });

  // Middleware: Session
  io.use((socket, next) => {
    const req = socket.request;
    const res = new http.ServerResponse(req);

    userSession(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  });

  // Middleware: Init check
  io.use((socket, next) => {
    if (!isInitialized) return next(new Error("SERVER_STARTING"));
    if (isShuttingDown) return next(new Error("SERVER_SHUTDOWN"));
    next();
  });

  // Middleware: Authentication
  io.use(async (socket, next) => {
    try {
      const sessUser = socket.request.session?.user;
      const telegramId = String(sessUser?.telegramId || "");
      
      if (!telegramId) {
        return next(new Error("AUTH_REQUIRED"));
      }

      const user = await User.findOne(
        { telegramId },
        { telegramId: 1, username: 1, Balance: 1, status: 1 }
      ).lean();

      if (!user) return next(new Error("USER_NOT_FOUND"));
      if (String(user.status || "").toLowerCase() === "blocked") {
        return next(new Error("USER_BLOCKED"));
      }

      socket.user = { telegramId, username: user.username || "Player" };

      if (!runtimeUsers.has(telegramId)) {
        runtimeUsers.set(telegramId, {
          telegramId,
          username: user.username || "Player",
          balanceMinor: toMinor(user.Balance),
          sockets: new Set()
        });
      }

      const ru = runtimeUsers.get(telegramId);
      ru.sockets.add(socket.id);
      socketToTelegram.set(socket.id, telegramId);

      next();
    } catch (err) {
      console.error("[AUTH] Error:", err.message);
      next(new Error("AUTH_FAIL"));
    }
  });

  // Connection handler
  io.on("connection", (socket) => {
    const { telegramId, username } = socket.user;
    const ru = runtimeUsers.get(telegramId);

    console.log(`[CONNECT] ${username} (${telegramId}) | Online: ${runtimeUsers.size}`);

    socket.emit("userData", {
      telegramId,
      username,
      Balance: fromMinor(ru?.balanceMinor ?? 0)
    });

    socket.emit("myRoundTickets", currentRoundTickets.get(telegramId) || []);

    socket.emit("gameState", {
      phase: gamePhase,
      countdown: gamePhase === "betting" ? countdown : 0,
      drawBatch: (gamePhase === "drawing" || gamePhase === "result") ? activeDrawBatch : null,
      drawFinished: (gamePhase === "result") ? activeDrawFinished : null,
      gameId: currentGameId
    });

    if (gamePhase === "result" && roundUserResult.has(telegramId)) {
      socket.emit("myRoundResult", roundUserResult.get(telegramId));
    }

    // Ticket picking with race condition protection
    socket.on("pickTicket", async (data) => {
      const rateCheck = checkRateLimit(telegramId);
      if (!rateCheck.allowed) {
        return socket.emit("ticketError", rateCheck.reason);
      }

      try {
        await userLock.acquire(telegramId, async () => {
          const numbers = data?.numbers;
          const betAmount = Number(data?.betAmount);

          if (!Array.isArray(numbers)) {
            return socket.emit("ticketError", "Invalid numbers format");
          }

          if (numbers.length < GAME_CONFIG.MIN_NUMBERS || numbers.length > GAME_CONFIG.MAX_NUMBERS) {
            return socket.emit("ticketError", 
              `Select ${GAME_CONFIG.MIN_NUMBERS}-${GAME_CONFIG.MAX_NUMBERS} numbers`);
          }

          const uniqueNumbers = [...new Set(numbers)];
          if (uniqueNumbers.length !== numbers.length) {
            return socket.emit("ticketError", "Duplicate numbers not allowed");
          }

          if (numbers.some(n => n < 1 || n > GAME_CONFIG.MAX_KENO_NUMBER || !Number.isInteger(n))) {
            return socket.emit("ticketError", `Numbers must be 1-${GAME_CONFIG.MAX_KENO_NUMBER}`);
          }

          if (!Number.isFinite(betAmount) || betAmount % 1 !== 0) {
            return socket.emit("ticketError", "Bet must be a whole number");
          }

          if (betAmount < GAME_CONFIG.MIN_BET) {
            return socket.emit("ticketError", `Minimum bet is ${GAME_CONFIG.MIN_BET} Birr`);
          }

          if (betAmount > GAME_CONFIG.MAX_BET) {
            return socket.emit("ticketError", `Maximum bet is ${GAME_CONFIG.MAX_BET} Birr`);
          }

          if (gamePhase !== "betting") {
            return socket.emit("ticketError", "Betting is closed");
          }

          const ru = runtimeUsers.get(telegramId);
          if (!ru) {
            return socket.emit("ticketError", "User session error. Please refresh.");
          }

          const betMinor = toMinor(betAmount);
          if (ru.balanceMinor < betMinor) {
            return socket.emit("ticketError", "Insufficient balance");
          }

          const userTickets = currentRoundTickets.get(telegramId) || [];
          if (userTickets.length >= GAME_CONFIG.MAX_TICKETS_PER_USER) {
            return socket.emit("ticketError", 
              `Maximum ${GAME_CONFIG.MAX_TICKETS_PER_USER} tickets per round`);
          }

          ru.balanceMinor -= betMinor;
          userRoundBetMinor.set(telegramId, (userRoundBetMinor.get(telegramId) || 0) + betMinor);

          const ticket = {
            id: userTickets.length + 1,
            numbers: numbers.slice().sort((a, b) => a - b),
            betAmount,
            timestamp: Date.now()
          };

          userTickets.push(ticket);
          currentRoundTickets.set(telegramId, userTickets);

          socket.emit("ticketConfirmed", {
            ticket,
            Balance: fromMinor(ru.balanceMinor)
          });

          emitBalanceToUser(telegramId);
          emitTicketsToUser(telegramId);

          console.log(`[TICKET] ${username} ticket#${ticket.id} - picks: ${ticket.numbers.length}, bet: ${betAmount}, roundTotal: ${formatMoney(getTotalRoundBetMinor())}`);
        });
      } catch (err) {
        if (err.message === "async-lock timed out") {
          socket.emit("ticketError", "Server busy. Please try again.");
        } else {
          console.error("[TICKET] Error:", err.message);
          socket.emit("ticketError", "Server error. Please try again.");
        }
      }
    });

    // Disconnect handler
    socket.on("disconnect", () => {
      const tid = socketToTelegram.get(socket.id);
      socketToTelegram.delete(socket.id);

      if (tid && runtimeUsers.has(tid)) {
        const u = runtimeUsers.get(tid);
        u.sockets.delete(socket.id);
        
        if (u.sockets.size === 0) {
          runtimeUsers.delete(tid);
        }
      }

      console.log(`[DISCONNECT] ${username} (${telegramId}) | Online: ${runtimeUsers.size}`);
    });
  });

  // Start game loop
  startGameLoop();
  
  // Periodic cleanup (every 5 minutes)
  setInterval(() => {
    for (const [sid, tid] of socketToTelegram) {
      if (!io.sockets.sockets.has(sid)) {
        socketToTelegram.delete(sid);
        const ru = runtimeUsers.get(tid);
        if (ru) {
          ru.sockets.delete(sid);
          if (ru.sockets.size === 0) {
            runtimeUsers.delete(tid);
          }
        }
      }
    }
    console.log(`[CLEANUP] Active users: ${runtimeUsers.size}, Sockets: ${socketToTelegram.size}`);
  }, 300000);

  console.log("[SOCKET] Socket.IO initialized - No player limit");
}

module.exports = { initSocket };
