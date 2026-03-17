const express = require('express');
const Track = require('../models/Track');
const ListenLog = require('../models/ListenLog');
const mongoose = require('mongoose');

const router = express.Router();

const getChart = async (startDate) => {
  const logs = await ListenLog.aggregate([
    { $match: { listenedAt: { $gte: startDate } } },
    { $group: { _id: '$track', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 }
  ]);
  const trackIds = logs.map(l => l._id);
  const tracks = await Track.find({ _id: { $in: trackIds }, status: 'approved' })
    .populate('author', 'username')
    .lean();
  const byId = {};
  tracks.forEach(t => { byId[t._id.toString()] = t; });
  return logs.map((l, i) => ({
    ...byId[l._id.toString()],
    rank: i + 1,
    playsInPeriod: l.count
  })).filter(Boolean);
};

// GET /api/charts/weekly
router.get('/weekly', async (req, res) => {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const chart = await getChart(start);
    res.json(chart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/charts/monthly
router.get('/monthly', async (req, res) => {
  try {
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const chart = await getChart(start);
    res.json(chart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/charts/alltime
router.get('/alltime', async (req, res) => {
  try {
    const tracks = await Track.find({ status: 'approved' })
      .populate('author', 'username')
      .sort({ plays: -1 })
      .limit(50)
      .lean();
    res.json(tracks.map((t, i) => ({ ...t, rank: i + 1 })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
