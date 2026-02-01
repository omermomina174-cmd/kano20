const express = require('express');
const router = express.Router();
const path = require('path');
const SubAdmin = require('../models/SubAdmin'); // Your model

// ═══════════════════════════════════════════════════════════════
// SERVE HTML PAGE
// ═══════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/subadmin.html'));
});

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
router.post('/api/auth', async (req, res) => {
  try {
    // Your existing auth logic here
    const subadmin = req.session.subadmin || await yourAuthFunction(req.body.initData);
    
    if (!subadmin) {
      return res.json({ ok: false, error: 'AUTH_FAILED' });
    }

    req.session.subadmin = subadmin;
    
    res.json({
      ok: true,
      subadmin: {
        id: subadmin.id || subadmin._id,
        username: subadmin.username,
        first_name: subadmin.first_name,
        balance: subadmin.balance || 0,
        status: subadmin.status || 'active'
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.json({ ok: false, error: 'AUTH_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TOGGLE STATUS
// ═══════════════════════════════════════════════════════════════
router.post('/api/toggle-status', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    const newStatus = req.session.subadmin.status === 'active' ? 'sleep' : 'active';
    
    // Update in database
    await SubAdmin.findByIdAndUpdate(req.session.subadmin._id, { status: newStatus });
    
    req.session.subadmin.status = newStatus;
    res.json({ ok: true, status: newStatus });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET STATS
// ═══════════════════════════════════════════════════════════════
router.get('/api/stats', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    const Deposit = require('../models/Deposit'); // Your deposit model
    const Withdraw = require('../models/Withdraw'); // Your withdraw model

    const depositCount = await Deposit.countDocuments({ status: 'pending' });
    const withdrawCount = await Withdraw.countDocuments({ status: 'pending' });

    res.json({
      ok: true,
      balance: req.session.subadmin.balance || 0,
      status: req.session.subadmin.status || 'active',
      deposits: { count: depositCount },
      withdraws: { count: withdrawCount }
    });
  } catch (error) {
    res.json({ ok: false, error: 'DATABASE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET DEPOSITS
// ═══════════════════════════════════════════════════════════════
router.get('/api/deposits', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    const Deposit = require('../models/Deposit');
    const limit = parseInt(req.query.limit) || 50;

    const deposits = await Deposit.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = deposits.length > limit;
    const items = hasMore ? deposits.slice(0, limit) : deposits;

    res.json({
      ok: true,
      items: items.map(d => ({
        id: d._id.toString(),
        senderPhone: d.senderPhone,
        amount: d.amount,
        status: d.status,
        createdAt: d.createdAt
      })),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].createdAt : null
    });
  } catch (error) {
    res.json({ ok: false, error: 'DATABASE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET WITHDRAWS
// ═══════════════════════════════════════════════════════════════
router.get('/api/withdraws', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    const Withdraw = require('../models/Withdraw');
    const limit = parseInt(req.query.limit) || 50;

    const withdraws = await Withdraw.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = withdraws.length > limit;
    const items = hasMore ? withdraws.slice(0, limit) : withdraws;

    res.json({
      ok: true,
      items: items.map(w => ({
        id: w._id.toString(),
        receiverPhone: w.receiverPhone,
        receiverFirstName: w.receiverFirstName,
        amount: w.amount,
        status: w.status,
        createdAt: w.createdAt
      })),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].createdAt : null
    });
  } catch (error) {
    res.json({ ok: false, error: 'DATABASE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// APPROVE DEPOSIT
// ═══════════════════════════════════════════════════════════════
router.post('/api/deposits/:id/approve', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const Deposit = require('../models/Deposit');
    const deposit = await Deposit.findById(req.params.id);

    if (!deposit || deposit.status !== 'pending') {
      return res.json({ ok: false, error: 'NOT_FOUND' });
    }

    deposit.status = 'approved';
    deposit.processedBy = req.session.subadmin._id;
    deposit.processedAt = new Date();
    await deposit.save();

    const newBalance = (req.session.subadmin.balance || 0) + deposit.amount;
    
    await SubAdmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
    req.session.subadmin.balance = newBalance;

    res.json({ ok: true, newBalance });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// BULK APPROVE DEPOSITS
// ═══════════════════════════════════════════════════════════════
router.post('/api/deposits/bulk-approve', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const { ids } = req.body;
    const Deposit = require('../models/Deposit');

    const deposits = await Deposit.find({ _id: { $in: ids }, status: 'pending' });
    
    const totalAmount = deposits.reduce((sum, d) => sum + d.amount, 0);
    
    await Deposit.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { status: 'approved', processedBy: req.session.subadmin._id, processedAt: new Date() }
    );

    const newBalance = (req.session.subadmin.balance || 0) + totalAmount;
    await SubAdmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
    req.session.subadmin.balance = newBalance;

    res.json({ ok: true, approved: deposits.length, failed: ids.length - deposits.length, newBalance });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// REJECT DEPOSIT
// ═══════════════════════════════════════════════════════════════
router.post('/api/deposits/:id/reject', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const Deposit = require('../models/Deposit');
    await Deposit.findByIdAndUpdate(req.params.id, {
      status: 'rejected',
      processedBy: req.session.subadmin._id,
      processedAt: new Date()
    });

    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// APPROVE WITHDRAW
// ═══════════════════════════════════════════════════════════════
router.post('/api/withdraws/:id/approve', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const Withdraw = require('../models/Withdraw');
    const withdraw = await Withdraw.findById(req.params.id);

    if (!withdraw || withdraw.status !== 'pending') {
      return res.json({ ok: false, error: 'NOT_FOUND' });
    }

    withdraw.status = 'approved';
    withdraw.processedBy = req.session.subadmin._id;
    withdraw.processedAt = new Date();
    await withdraw.save();

    const newBalance = (req.session.subadmin.balance || 0) - withdraw.amount;
    
    await SubAdmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
    req.session.subadmin.balance = newBalance;

    res.json({ ok: true, newBalance });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// BULK APPROVE WITHDRAWS
// ═══════════════════════════════════════════════════════════════
router.post('/api/withdraws/bulk-approve', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const { ids } = req.body;
    const Withdraw = require('../models/Withdraw');

    const withdraws = await Withdraw.find({ _id: { $in: ids }, status: 'pending' });
    
    const totalAmount = withdraws.reduce((sum, w) => sum + w.amount, 0);
    
    await Withdraw.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { status: 'approved', processedBy: req.session.subadmin._id, processedAt: new Date() }
    );

    const newBalance = (req.session.subadmin.balance || 0) - totalAmount;
    await SubAdmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
    req.session.subadmin.balance = newBalance;

    res.json({ ok: true, approved: withdraws.length, failed: ids.length - withdraws.length, newBalance });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

// ═══════════════════════════════════════════════════════════════
// REJECT WITHDRAW
// ═══════════════════════════════════════════════════════════════
router.post('/api/withdraws/:id/reject', async (req, res) => {
  if (!req.session.subadmin) {
    return res.json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (req.session.subadmin.status !== 'active') {
    return res.json({ ok: false, error: 'SLEEP_MODE' });
  }

  try {
    const Withdraw = require('../models/Withdraw');
    await Withdraw.findByIdAndUpdate(req.params.id, {
      status: 'rejected',
      processedBy: req.session.subadmin._id,
      processedAt: new Date()
    });

    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: 'UPDATE_FAILED' });
  }
});

module.exports = router;
