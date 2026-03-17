const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Track = require('../models/Track');
const Playlist = require('../models/Playlist');
const { protect, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');

const router = express.Router();
router.use(protect, adminOnly);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/admin/tracks/pending
router.get('/tracks/pending', async (req, res) => {
  try {
    const tracks = await Track.find({ status: 'pending' })
      .populate('author', 'username email')
      .sort({ createdAt: -1 })
      .lean();
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/tracks/:id/approve
router.put('/tracks/:id/approve', [param('id').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const track = await Track.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', moderationComment: req.body.comment || '', approvedAt: new Date() },
      { new: true }
    ).populate('author', 'username').lean();
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    res.json(track);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/tracks/:id/reject
router.put('/tracks/:id/reject', [
  param('id').isMongoId(),
  body('comment').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const track = await Track.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', moderationComment: req.body.comment || '', rejectedAt: new Date() },
      { new: true }
    ).populate('author', 'username').lean();
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    res.json(track);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
