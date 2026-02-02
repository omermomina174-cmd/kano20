"use strict";

const express = require("express");
const path = require("path");
const router = express.Router();

const Admin = require("../models/admin");
const SubAdmin = require("../models/subadmin");
const User = require("../models/user");
const Deposit = require("../models/deposit");
const Withdraw = require("../models/withdraw");

const { requireTelegramInitData } = require("../utils/telegramWebApp");
const { requireAdminSession } = require("../middleware/requireSession");

/* ═══════════════════════════════════════════
   Helpers
═══════════════════════════════════════════ */

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function roundBalance(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeMsisdn(v) {
  const d = onlyDigits(v);
  if (!d) return "";
  if (d.startsWith("251") && d.length === 12) return "0" + d.slice(3);
  if (d.startsWith("2510") && d.length === 13) return "0" + d.slice(4);
  if (d.length === 9 && d.startsWith("9")) return "0" + d;
  if (d.length === 10 && d.startsWith("0")) return d;
  return d;
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phoneVariantsForSearch(input) {
  const out = new Set();
  const rawDigits = onlyDigits(input);
  if (rawDigits) out.add(rawDigits);

  const local09 = normalizeMsisdn(input);
  if (local09) {
    out.add(local09);
    if (local09.startsWith("09") && local09.length === 10) {
      out.add("251" + local09.slice(1));
      out.add("+251" + local09.slice(1));
    }
  }

  if (rawDigits.startsWith("2519") && rawDigits.length === 12) {
    out.add("0" + rawDigits.slice(3));
  }

  return [...out].filter(Boolean);
}

function buildName(firstName, fatherName) {
  return `${String(firstName || "").trim()} ${String(fatherName || "").trim()}`.trim();
}

function normalizeTelebirrAccountObj(obj) {
  const rawPhone = typeof obj === "string" ? obj : (obj && (obj.phoneNumber || obj.phone)) || "";
  const phone = normalizeMsisdn(rawPhone);

  const firstName = String(obj?.firstName || "").trim();
  const fatherName = String(obj?.fatherName || "").trim();
  const name = buildName(firstName, fatherName);

  return { 
    phoneNumber: phone,
    firstName: firstName,
    fatherName: fatherName,
    phone, 
    name 
  };
}

function normalizeActiveTelebirrField(active) {
  if (!active) return null;

  if (typeof active === "string") {
    const p = normalizeMsisdn(active);
    if (!p) return null;
    return { phoneNumber: p, firstName: "", fatherName: "" };
  }

  if (typeof active === "object") {
    const x = normalizeTelebirrAccountObj(active);
    if (!x.phone) return null;
    return { phoneNumber: x.phone, firstName: x.firstName, fatherName: x.fatherName };
  }

  return null;
}

function upsertTelebirrAccount(list, phone, firstName, fatherName) {
  const p = normalizeMsisdn(phone);
  const fn = String(firstName || "").trim();
  const fatn = String(fatherName || "").trim();
  if (!p || !fn || !fatn) return Array.isArray(list) ? list : [];

  const next = [];
  let found = false;

  for (const item of list || []) {
    const x = normalizeTelebirrAccountObj(item);
    if (!x.phone) continue;

    if (x.phone === p) {
      next.push({ phoneNumber: p, firstName: fn, fatherName: fatn });
      found = true;
    } else {
      next.push({ phoneNumber: x.phone, firstName: x.firstName, fatherName: x.fatherName });
    }
  }

  if (!found) next.push({ phoneNumber: p, firstName: fn, fatherName: fatn });
  return next;
}

function removeTelebirrAccount(list, phone) {
  const p = normalizeMsisdn(phone);
  return (list || [])
    .map(normalizeTelebirrAccountObj)
    .filter((x) => x.phone && x.phone !== p)
    .map((x) => ({ phoneNumber: x.phone, firstName: x.firstName, fatherName: x.fatherName }));
}

function normalizeRegistryList(list) {
  const out = [];
  const seen = new Set();

  for (const item of list || []) {
    const p = normalizeMsisdn(String(item || "").split("|")[0]);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function registryUpsertPhone(list, phone) {
  const p = normalizeMsisdn(phone);
  const base = normalizeRegistryList(list);
  if (!p) return base;
  if (!base.includes(p)) base.push(p);
  return base;
}

function registryRemovePhone(list, phone) {
  const p = normalizeMsisdn(phone);
  return normalizeRegistryList(list).filter((x) => x !== p);
}

async function getAdminLeanBySession(req) {
  const telegramId = req.session?.admin?.telegramId;
  if (!telegramId) return null;
  return Admin.findOne({ telegramId: String(telegramId) }).lean();
}

/* ═══════════════════════════════════════════
   Page
═══════════════════════════════════════════ */

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

/* ═══════════════════════════════════════════
   Auth
═══════════════════════════════════════════ */

router.post("/api/auth", requireTelegramInitData("TELEGRAM_BOT_TOKEN_ADMIN"), async (req, res) => {
  try {
    const tgUser = req.tgUser;
    const telegramId = String(tgUser.id);

    const admin = await Admin.findOne({ telegramId: telegramId }).lean();
    if (!admin) return res.status(403).json({ ok: false, error: "NOT_ADMIN" });

    req.session.admin = {
      telegramId,
      role: String(admin.role || "admin"),
      username: admin.username || tgUser.username || "",
    };

    return res.json({ ok: true, admin: { Username: req.session.admin.username } });
  } catch (err) {
    console.error("[ADMIN_AUTH] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/logout", requireAdminSession, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════
   Settings
═══════════════════════════════════════════ */

router.get("/api/settings", requireAdminSession, async (req, res) => {
  try {
    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const teleList = (admin.telebirrAccountLists || [])
      .map(normalizeTelebirrAccountObj)
      .filter((x) => x.phone);

    const activeFixed = normalizeActiveTelebirrField(admin.activeTelebirrAccount);
    const activeObj = activeFixed ? normalizeTelebirrAccountObj(activeFixed) : null;

    const registryPhones = normalizeRegistryList(admin.registry || []);

    return res.json({
      ok: true,
      admin: { Username: admin.username || "" },
      maxUserLimit: Number(admin.maxUserLimit ?? 1000),
      kanoRtp: Number(admin.rtp ?? 50),
      activeTelebirr:
        activeObj && activeObj.phone
          ? {
              phone: activeObj.phone,
              name: activeObj.name || activeObj.phone,
              firstName: activeObj.firstName,
              fatherName: activeObj.fatherName,
            }
          : null,
      registry: registryPhones.map((phone) => ({ phone })),
      telebirrAccounts: teleList.map((x) => ({
        phone: x.phone,
        name: x.name,
        firstName: x.firstName,
        fatherName: x.fatherName,
      })),
    });
  } catch (err) {
    console.error("[SETTINGS] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/maxuserlimit", requireAdminSession, async (req, res) => {
  try {
    const n = Number(req.body?.maxUserLimit);
    if (!Number.isFinite(n) || n < 1) return res.status(400).json({ ok: false, error: "MAXUSERLIMIT_MIN_1" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    await Admin.updateOne({ telegramId: admin.telegramId }, { $set: { maxUserLimit: n } });
    return res.json({ ok: true, maxUserLimit: n });
  } catch (err) {
    console.error("[MAXUSERLIMIT_SET] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/kano/rtp", requireAdminSession, async (req, res) => {
  try {
    const rtpNum = Number(req.body?.rtp);
    if (!Number.isFinite(rtpNum) || rtpNum < 1 || rtpNum > 100) {
      return res.status(400).json({ ok: false, error: "RTP_RANGE_1_100" });
    }

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    await Admin.updateOne({ telegramId: admin.telegramId }, { $set: { rtp: rtpNum } });
    return res.json({ ok: true, kanoRtp: rtpNum });
  } catch (err) {
    console.error("[ADMIN_SET_RTP] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/registry/add", requireAdminSession, async (req, res) => {
  try {
    const p = normalizeMsisdn(req.body?.phone);
    if (!p) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const nextRegistry = registryUpsertPhone(admin.registry || [], p);
    const activeFixed = normalizeActiveTelebirrField(admin.activeTelebirrAccount);

    await Admin.updateOne(
      { telegramId: admin.telegramId },
      { $set: { registry: nextRegistry, activeTelebirrAccount: activeFixed } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[REGISTRY_ADD] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/registry/remove", requireAdminSession, async (req, res) => {
  try {
    const p = normalizeMsisdn(req.body?.phone);
    if (!p) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const nextRegistry = registryRemovePhone(admin.registry || [], p);
    const activeFixed = normalizeActiveTelebirrField(admin.activeTelebirrAccount);

    await Admin.updateOne(
      { telegramId: admin.telegramId },
      { $set: { registry: nextRegistry, activeTelebirrAccount: activeFixed } }
    );

    await SubAdmin.deleteMany({ phoneNumber: p });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[REGISTRY_REMOVE] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/telebirr/add", requireAdminSession, async (req, res) => {
  try {
    const p = normalizeMsisdn(req.body?.phone);
    const fn = String(req.body?.firstName || "").trim();
    const fatn = String(req.body?.fatherName || "").trim();
    if (!p || !fn || !fatn) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const nextList = upsertTelebirrAccount(admin.telebirrAccountLists || [], p, fn, fatn);
    const activeFixed = normalizeActiveTelebirrField(admin.activeTelebirrAccount);

    await Admin.updateOne(
      { telegramId: admin.telegramId },
      { $set: { telebirrAccountLists: nextList, activeTelebirrAccount: activeFixed } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[TELEBIRR_ADD] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/telebirr/remove", requireAdminSession, async (req, res) => {
  try {
    const p = normalizeMsisdn(req.body?.phone);
    if (!p) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const nextList = removeTelebirrAccount(admin.telebirrAccountLists || [], p);

    const activeFixed = normalizeActiveTelebirrField(admin.activeTelebirrAccount);
    const activePhone = activeFixed ? normalizeMsisdn(activeFixed.phoneNumber) : "";
    const nextActive = activePhone === p ? null : activeFixed;

    await Admin.updateOne(
      { telegramId: admin.telegramId },
      { $set: { telebirrAccountLists: nextList, activeTelebirrAccount: nextActive } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[TELEBIRR_REMOVE] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/telebirr/setActive", requireAdminSession, async (req, res) => {
  try {
    const p = normalizeMsisdn(req.body?.phone);
    if (!p) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const admin = await getAdminLeanBySession(req);
    if (!admin) return res.status(404).json({ ok: false, error: "ADMIN_NOT_FOUND" });

    const list = (admin.telebirrAccountLists || []).map(normalizeTelebirrAccountObj);
    const found = list.find((x) => x.phone === p);
    if (!found) return res.status(400).json({ ok: false, error: "NOT_IN_LIST" });

    const nextActive = { phoneNumber: found.phone, firstName: found.firstName, fatherName: found.fatherName };

    await Admin.updateOne({ telegramId: admin.telegramId }, { $set: { activeTelebirrAccount: nextActive } });

    return res.json({
      ok: true,
      activeTelebirr: {
        phone: found.phone,
        name: found.name,
        firstName: found.firstName,
        fatherName: found.fatherName,
      },
    });
  } catch (err) {
    console.error("[TELEBIRR_SET_ACTIVE] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════
   SubAdmins
═══════════════════════════════════════════ */

router.get("/api/subadmins", requireAdminSession, async (req, res) => {
  try {
    const subadmins = await SubAdmin.find({}).sort({ createdAt: -1 }).lean();
    return res.json({
      ok: true,
      subadmins: subadmins.map((s) => ({
        _id: s._id,
        username: s.username || "",
        phoneNumber: s.phoneNumber || "",
        telegramId: s.telegramId || "",
        status: s.status || "active",
        balance: roundBalance(s.balance || 0),
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error("[SUBADMINS_LIST] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/subadmins/update", requireAdminSession, async (req, res) => {
  try {
    const { subadminId, status } = req.body || {};
    if (!subadminId) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const s = await SubAdmin.findById(subadminId);
    if (!s) return res.status(404).json({ ok: false, error: "SUBADMIN_NOT_FOUND" });

    if (status && ["active", "sleep", "blocked"].includes(String(status).toLowerCase())) {
      s.status = String(status).toLowerCase();
    }

    await s.save();
    return res.json({
      ok: true,
      subadmin: {
        _id: s._id,
        status: s.status,
        balance: roundBalance(s.balance || 0),
      },
    });
  } catch (err) {
    console.error("[SUBADMIN_UPDATE] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/subadmins/adjust-balance", requireAdminSession, async (req, res) => {
  try {
    const { subadminId, amount } = req.body || {};
    if (!subadminId) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    // accept "1000", "-500", "1,000" etc.
    const cleaned = String(amount ?? "").replace(/[,\s]/g, "").trim();
    const adjustAmount = roundBalance(Number(cleaned));

    if (!Number.isFinite(adjustAmount) || adjustAmount === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_AMOUNT" });
    }

    // get previous balance for response
    const before = await SubAdmin.findById(subadminId).select("balance status").lean();
    if (!before) return res.status(404).json({ ok: false, error: "SUBADMIN_NOT_FOUND" });

    const previousBalance = roundBalance(before.balance || 0);

    // ✅ atomic add/subtract (allows negative result)
    const updated = await SubAdmin.findByIdAndUpdate(
      subadminId,
      { $inc: { balance: adjustAmount } },
      { new: true }
    ).select("balance status");

    if (!updated) return res.status(404).json({ ok: false, error: "SUBADMIN_NOT_FOUND" });

    return res.json({
      ok: true,
      subadmin: {
        _id: updated._id,
        status: updated.status,
        previousBalance,
        adjustment: adjustAmount,
        balance: roundBalance(updated.balance || 0),
      },
    });
  } catch (err) {
    console.error("[SUBADMIN_BALANCE_ADJUST] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/api/subadmins/:id/transactions", requireAdminSession, async (req, res) => {
  try {
    const subadminId = String(req.params.id || "");
    if (!subadminId) return res.status(400).json({ ok: false, error: "BAD_INPUT" });

    const skip = Math.max(0, Number(req.query.skip) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const subadmin = await SubAdmin.findById(subadminId).lean();
    if (!subadmin) return res.status(404).json({ ok: false, error: "SUBADMIN_NOT_FOUND" });

    const matchProcessed = {
      approvedBy: subadmin._id,
      status: { $in: ["approved", "rejected"] },
    };

    const [depCount, wdrCount] = await Promise.all([
      Deposit.countDocuments(matchProcessed),
      Withdraw.countDocuments(matchProcessed),
    ]);

    const totalTransactions = depCount + wdrCount;

    const [depAgg, wdrAgg] = await Promise.all([
      Deposit.aggregate([
        { $match: matchProcessed },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            sumAmount: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$amount", 0] } },
          },
        },
      ]),
      Withdraw.aggregate([
        { $match: matchProcessed },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            sumAmount: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$amount", 0] } },
          },
        },
      ]),
    ]);

    function pickCount(arr, status) {
      const x = (arr || []).find((i) => String(i._id) === status);
      return Number(x?.count || 0);
    }
    function pickSum(arr) {
      return (arr || []).reduce((a, b) => a + Number(b?.sumAmount || 0), 0);
    }

    const summary = {
      totalDepositsApproved: pickCount(depAgg, "approved"),
      totalDepositsRejected: pickCount(depAgg, "rejected"),
      totalWithdrawalsApproved: pickCount(wdrAgg, "approved"),
      totalWithdrawalsRejected: pickCount(wdrAgg, "rejected"),
      totalDepositAmount: pickSum(depAgg),
      totalWithdrawAmount: pickSum(wdrAgg),
    };

    const depositColl = Deposit.collection.name;

    const pipeline = [
      { $match: matchProcessed },
      {
        $project: {
          _id: 1,
          type: { $literal: "withdraw" },
          telegramId: { $ifNull: ["$telegramId", ""] },
          amount: { $ifNull: ["$amount", 0] },
          status: 1,
          senderPhone: { $literal: "" },
          receiverPhone: { $ifNull: ["$receiverPhone", ""] },
          receiverFirstName: { $ifNull: ["$receiverFirstName", ""] },
          approvedAt: { $ifNull: ["$approvedAt", "$updatedAt"] },
          createdAt: 1,
        },
      },
      {
        $unionWith: {
          coll: depositColl,
          pipeline: [
            { $match: matchProcessed },
            {
              $project: {
                _id: 1,
                type: { $literal: "deposit" },
                telegramId: { $ifNull: ["$telegramId", ""] },
                amount: { $ifNull: ["$amount", 0] },
                status: 1,
                senderPhone: { $ifNull: ["$senderPhone", ""] },
                receiverPhone: { $literal: "" },
                receiverFirstName: { $literal: "" },
                approvedAt: { $ifNull: ["$approvedAt", "$updatedAt"] },
                createdAt: 1,
              },
            },
          ],
        },
      },
      { $sort: { approvedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const transactions = await Withdraw.aggregate(pipeline);

    const hasMore = skip + transactions.length < totalTransactions;

    return res.json({
      ok: true,
      subadmin: { _id: subadmin._id, username: subadmin.username || "" },
      summary,
      transactions: (transactions || []).map((t) => ({
        _id: t._id,
        type: t.type,
        telegramId: t.telegramId || "",
        amount: Number(t.amount || 0),
        status: t.status,
        senderPhone: t.senderPhone || "",
        receiverPhone: t.receiverPhone || "",
        receiverFirstName: t.receiverFirstName || "",
        approvedAt: t.approvedAt || null,
        createdAt: t.createdAt || null,
      })),
      totalTransactions,
      hasMore,
    });
  } catch (err) {
    console.error("[SUBADMIN_TRANSACTIONS] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ═══════════════════════════════════════════
   Users
═══════════════════════════════════════════ */

router.get("/api/users", requireAdminSession, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const totalRegistered = await User.countDocuments({ role: "user" });

    let query = {};
    if (search) {
      const safeText = escapeRegex(search);

      const phones = phoneVariantsForSearch(search)
        .map((p) => onlyDigits(p))
        .filter(Boolean);

      const phoneOr = phones.map((p) => ({
        phoneNo: { $regex: p, $options: "i" },
      }));

      query = {
        $or: [{ username: { $regex: safeText, $options: "i" } }, ...phoneOr],
      };
    }

    const [users, totalMatched] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    return res.json({
      ok: true,
      users: users.map((u) => ({
        _id: u._id,
        username: u.username || "",
        phoneNo: u.phoneNo || "",
        telegramId: u.telegramId || "",
        Balance: Number(u.Balance || 0),
        status: u.status || "active",
        createdAt: u.createdAt,
      })),
      totalRegistered,
      totalMatched,
      hasMore: skip + users.length < totalMatched,
    });
  } catch (err) {
    console.error("[USERS_LIST] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/api/users/update", requireAdminSession, async (req, res) => {
  try {
    const { userId, adjustBalance, status } = req.body;
    if (!userId) {
      return res.status(400).json({ ok: false, error: "BAD_INPUT" });
    }

    const adjust = Number(adjustBalance);
    if (!Number.isFinite(adjust) || adjust === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_ADJUST" });
    }

    const user = await User.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            Balance: {
              $max: [0, { $add: ["$Balance", adjust] }],
            },
          },
        },
      ],
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    if (["active", "blocked"].includes(String(status).toLowerCase())) {
      user.status = status.toLowerCase();
      await user.save();
    }

    res.json({
      ok: true,
      user: {
        _id: user._id,
        Balance: user.Balance,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("[USER_UPDATE] error:", err);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
