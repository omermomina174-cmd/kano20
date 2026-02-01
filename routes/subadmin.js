const express = require('express');
const router = express.Router();
const path = require('path');
const subadmin = require('../models/subadmin');
const deposit = require('../models/deposit');
const withdraw = require('../models/withdraw');

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
    const subadminUser = req.session.subadmin || await yourAuthFunction(req.body.initData);
    
    if (!subadminUser) {
      return res.json({ ok: false, error: 'AUTH_FAILED' });
    }

    req.session.subadmin = subadminUser;
    
    res.json({
      ok: true,
      subadmin: {
        id: subadminUser.id || subadminUser._id,
        username: subadminUser.username,
        first_name: subadminUser.first_name,
        balance: subadminUser.balance || 0,
        status: subadminUser.status || 'active'
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
    await subadmin.findByIdAndUpdate(req.session.subadmin._id, { status: newStatus });
    
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
    const depositCount = await deposit.countDocuments({ status: 'pending' });
    const withdrawCount = await withdraw.countDocuments({ status: 'pending' });

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
    const limit = parseInt(req.query.limit) || 50;

    const deposits = await deposit.find({ status: 'pending' })
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
    const limit = parseInt(req.query.limit) || 50;

    const withdraws = await withdraw.find({ status: 'pending' })
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
    const depositDoc = await deposit.findById(req.params.id);

    if (!depositDoc || depositDoc.status !== 'pending') {
      return res.json({ ok: false, error: 'NOT_FOUND' });
    }

    depositDoc.status = 'approved';
    depositDoc.processedBy = req.session.subadmin._id;
    depositDoc.processedAt = new Date();
    await depositDoc.save();

    const newBalance = (req.session.subadmin.balance || 0) + depositDoc.amount;
    
    await subadmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
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

    const deposits = await deposit.find({ _id: { $in: ids }, status: 'pending' });
    
    const totalAmount = deposits.reduce((sum, d) => sum + d.amount, 0);
    
    await deposit.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { status: 'approved', processedBy: req.session.subadmin._id, processedAt: new Date() }
    );

    const newBalance = (req.session.subadmin.balance || 0) + totalAmount;
    await subadmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
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
    await deposit.findByIdAndUpdate(req.params.id, {
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
    const withdrawDoc = await withdraw.findById(req.params.id);

    if (!withdrawDoc || withdrawDoc.status !== 'pending') {
      return res.json({ ok: false, error: 'NOT_FOUND' });
    }

    withdrawDoc.status = 'approved';
    withdrawDoc.processedBy = req.session.subadmin._id;
    withdrawDoc.processedAt = new Date();
    await withdrawDoc.save();

    const newBalance = (req.session.subadmin.balance || 0) - withdrawDoc.amount;
    
    await subadmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
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

    const withdraws = await withdraw.find({ _id: { $in: ids }, status: 'pending' });
    
    const totalAmount = withdraws.reduce((sum, w) => sum + w.amount, 0);
    
    await withdraw.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { status: 'approved', processedBy: req.session.subadmin._id, processedAt: new Date() }
    );

    const newBalance = (req.session.subadmin.balance || 0) - totalAmount;
    await subadmin.findByIdAndUpdate(req.session.subadmin._id, { balance: newBalance });
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
    await withdraw.findByIdAndUpdate(req.params.id, {
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
