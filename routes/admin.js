const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Track = require('../models/Track');
const Playlist = require('../models/Playlist');
const User = require('../models/User');
const ListenLog = require('../models/ListenLog');
const { getGridFS } = require('../config/gridfs');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const { sendEmail, verifyEmailTransport } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');

const router = express.Router();
router.use(protect, adminOnly);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/admin/email/test — тест SMTP отправки
router.post('/email/test', [
  body('to').optional().isEmail().withMessage('Некорректный email получателя')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const to = req.body.to || req.user.email;
    await verifyEmailTransport();
    await sendEmail({
      to,
      subject: 'NovaSound SMTP test',
      text: 'Тестовое письмо SMTP от NovaSound.',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5">
          <h2>NovaSound SMTP test</h2>
          <p>Если вы получили это письмо, SMTP работает корректно.</p>
        </div>
      `
    });
    res.json({ message: 'Тестовое письмо отправлено', to });
  } catch (err) {
    res.status(500).json({
      message: err.message || 'Ошибка SMTP',
      code: err.code || '',
      response: err.response || '',
      command: err.command || ''
    });
  }
});

// GET /api/admin/users — список пользователей
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username email role emailVerified isBlocked createdAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/users/:id — удалить аккаунт пользователя (жёстко, без подтверждения)
router.delete('/users/:id', [
  param('id').isMongoId(),
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Нельзя удалить текущего админа' });
    }
    const reason = String(req.body.reason || 'Нарушение правил сервиса');

    const tracks = await Track.find({ author: user._id }).select('_id audioFileId').lean();
    const trackIds = tracks.map(t => t._id);

    try {
      const { gridfsBucket } = getGridFS();
      if (gridfsBucket) {
        await Promise.all(tracks.map(async (t) => {
          try {
            if (t.audioFileId) await gridfsBucket.delete(new mongoose.Types.ObjectId(t.audioFileId));
          } catch (_) {}
        }));
      }
    } catch (_) {}

    if (trackIds.length) {
      try { await ListenLog.deleteMany({ track: { $in: trackIds } }); } catch (_) {}
      try { await Track.deleteMany({ _id: { $in: trackIds } }); } catch (_) {}
      try { await Playlist.updateMany({}, { $pull: { tracks: { $in: trackIds } } }); } catch (_) {}
    }

    try { await Playlist.deleteMany({ createdBy: user._id }); } catch (_) {}

    await User.deleteOne({ _id: user._id });

    try {
      await sendEmail({
        to: user.email,
        subject: 'NovaSound — аккаунт удалён',
        text: `Ваш аккаунт был удалён администратором. Причина: ${reason}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5">
            <h2>Аккаунт удалён</h2>
            <p>Ваш аккаунт в NovaSound был удалён администратором.</p>
            <p><b>Причина:</b> ${reason}</p>
          </div>
        `
      });
    } catch (_) {}

    res.json({ message: 'Аккаунт пользователя удалён администратором', reason });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка удаления аккаунта пользователем админом' });
  }
});

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
