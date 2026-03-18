const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Track = require('../models/Track');
const Playlist = require('../models/Playlist');
const ListenLog = require('../models/ListenLog');
const { getGridFS } = require('../config/gridfs');

const router = express.Router();

// DELETE /api/users/me — удалить свой аккаунт (требует пароль)
router.delete('/me', protect, [
  body('password').isString().isLength({ min: 1 }).withMessage('Нужен пароль')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userWithPassword = await User.findById(req.user._id).select('+password');
    if (!userWithPassword) return res.status(404).json({ message: 'Пользователь не найден' });

    const ok = await userWithPassword.comparePassword(req.body.password);
    if (!ok) return res.status(401).json({ message: 'Неверный пароль' });

    // Best-effort cleanup: tracks + audio files + listen logs + playlists created by user
    const tracks = await Track.find({ author: req.user._id }).select('_id audioFileId').lean();
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
      // remove deleted tracks from playlists
      try { await Playlist.updateMany({}, { $pull: { tracks: { $in: trackIds } } }); } catch (_) {}
    }

    try { await Playlist.deleteMany({ createdBy: req.user._id }); } catch (_) {}

    await User.deleteOne({ _id: req.user._id });

    res.json({ message: 'Аккаунт удалён' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка удаления аккаунта' });
  }
});

module.exports = router;

