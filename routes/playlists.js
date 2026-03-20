const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Playlist = require('../models/Playlist');
const Track = require('../models/Track');
const { protect, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/playlists — все плейлисты (только с одобренными треками в выдаче)
router.get('/', async (req, res) => {
  try {
    const playlists = await Playlist.find()
      .populate('createdBy', 'username')
      .populate({ path: 'tracks', match: { status: 'approved' }, select: 'title coverImage author duration plays', populate: { path: 'author', select: 'username' } })
      .sort({ createdAt: -1 })
      .lean();
    res.json(playlists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/playlists/:id
router.get('/:id', async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id)
      .populate('createdBy', 'username')
      .populate({ path: 'tracks', match: { status: 'approved' }, populate: { path: 'author', select: 'username' } })
      .lean();
    if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
    res.json(playlist);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/playlists/my — плейлисты текущего пользователя
router.get('/my/list', protect, async (req, res) => {
  try {
    const playlists = await Playlist.find({ createdBy: req.user._id })
      .populate('createdBy', 'username')
      .populate({ path: 'tracks', match: { status: 'approved' }, populate: { path: 'author', select: 'username' } })
      .sort({ createdAt: -1 })
      .lean();
    res.json(playlists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/playlists/my — создать свой плейлист
router.post('/my', protect, [
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Название 1-100 символов'),
  body('description').optional().trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const playlist = await Playlist.create({
      title: req.body.title,
      description: req.body.description || '',
      coverImage: '',
      tracks: [],
      createdBy: req.user._id
    });
    const populated = await Playlist.findById(playlist._id).populate('createdBy', 'username').populate('tracks', 'title coverImage author duration').lean();
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/playlists/:id/tracks/:trackId — добавить трек в свой плейлист
router.post('/:id/tracks/:trackId', protect, [param('id').isMongoId(), param('trackId').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
    if (playlist.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Доступ запрещён' });
    }
    const track = await Track.findById(req.params.trackId).select('status');
    if (!track || track.status !== 'approved') return res.status(404).json({ message: 'Трек не найден' });
    if (!playlist.tracks.some((t) => t.toString() === req.params.trackId)) {
      playlist.tracks.push(track._id);
      await playlist.save();
    }
    res.json({ message: 'Трек добавлен в плейлист' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/playlists/:id/tracks/:trackId — удалить трек из своего плейлиста
router.delete('/:id/tracks/:trackId', protect, [param('id').isMongoId(), param('trackId').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
    if (playlist.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Доступ запрещён' });
    }
    playlist.tracks = playlist.tracks.filter((t) => t.toString() !== req.params.trackId);
    await playlist.save();
    res.json({ message: 'Трек удалён из плейлиста' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/playlists — только админ
router.post('/', protect, adminOnly, upload.single('cover'), [
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Название 1-100 символов'),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('tracks').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    let coverImage = '';
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'novasound/playlists', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        ).end(req.file.buffer);
      });
      coverImage = result.secure_url;
    }
    let tracks = Array.isArray(req.body.tracks) ? req.body.tracks : [];
    if (typeof req.body.tracks === 'string' && req.body.tracks) {
      try { tracks = JSON.parse(req.body.tracks); } catch (_) { tracks = [req.body.tracks]; }
    }
    if (!Array.isArray(tracks)) tracks = [];
    const playlist = await Playlist.create({
      title: req.body.title,
      description: req.body.description || '',
      coverImage,
      tracks: tracks.filter(Boolean),
      createdBy: req.user._id
    });
    const populated = await Playlist.findById(playlist._id).populate('createdBy', 'username').populate('tracks', 'title coverImage author duration').lean();
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/playlists/:id — только админ
router.put('/:id', protect, adminOnly, upload.single('cover'), [
  param('id').isMongoId(),
  body('title').optional().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('tracks').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
    if (req.body.title !== undefined) playlist.title = req.body.title;
    if (req.body.description !== undefined) playlist.description = req.body.description;
    let tracksUpdate = req.body.tracks;
    if (typeof tracksUpdate === 'string') try { tracksUpdate = JSON.parse(tracksUpdate); } catch (_) {}
    if (Array.isArray(tracksUpdate)) playlist.tracks = tracksUpdate.filter(Boolean);
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'novasound/playlists', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        ).end(req.file.buffer);
      });
      playlist.coverImage = result.secure_url;
    }
    await playlist.save();
    const populated = await Playlist.findById(playlist._id).populate('createdBy', 'username').populate('tracks', 'title coverImage author duration').lean();
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/playlists/:id — только админ
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndDelete(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
    res.json({ message: 'Плейлист удалён' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
