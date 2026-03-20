const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const Track = require('../models/Track');
const ListenLog = require('../models/ListenLog');
const { protect, optionalAuth } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');
const { containsProfanity } = require('../utils/profanityFilter');
const { getGridFS } = require('../config/gridfs');
const cloudinary = require('../config/cloudinary');
const { parseBuffer } = require('music-metadata');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'audio' && ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return cb(null, true);
    if (file.fieldname === 'cover' && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return cb(null, true);
    cb(new Error('Недопустимый тип файла'));
  }
});

const uploadTrackFiles = (req, res, next) => {
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }])(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Файл слишком большой (макс. 50 МБ)' });
      }
      return res.status(400).json({ message: `Ошибка загрузки файла: ${err.code}` });
    }
    return res.status(400).json({ message: err.message || 'Ошибка загрузки файла' });
  });
};

// GET /api/tracks/my — мои треки (авторизованный пользователь), ?status=pending|approved|rejected
router.get('/my', protect, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { author: req.user._id };
    if (status && ['pending', 'approved', 'rejected'].includes(status)) query.status = status;
    const tracks = await Track.find(query).populate('author', 'username').sort({ createdAt: -1 }).lean();
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/tracks/audio/:fileId — стриминг аудио из GridFS (должен быть выше /:id)
router.get('/audio/:fileId', async (req, res) => {
  try {
    const { gridfsBucket } = getGridFS();
    const _id = new mongoose.Types.ObjectId(req.params.fileId);
    const cursor = gridfsBucket.find({ _id });
    const file = await cursor.next();
    if (!file) return res.status(404).json({ message: 'Файл не найден' });
    res.set('Content-Type', file.contentType || 'audio/mpeg');
    const stream = gridfsBucket.openDownloadStream(_id);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/tracks — только одобренные
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, sort = '-createdAt' } = req.query;
    const query = { status: 'approved' };
    if (search) query.$or = [
      { title: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') }
    ];
    const tracks = await Track.find(query)
      .populate('author', 'username')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await Track.countDocuments(query);
    res.json({ tracks, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tracks — загрузка (авторизованный пользователь)
router.post('/', protect, uploadTrackFiles, [
  body('title').trim().isLength({ min: 3, max: 100 }).withMessage('Название 3-100 символов'),
  body('description').optional().trim().isLength({ max: 2000 })
], async (req, res) => {
  let stage = 'start';
  try {
    stage = 'validate';
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!req.files?.audio?.[0]) return res.status(400).json({ message: 'Нужен аудиофайл' });

    stage = 'content-check';
    const { title, description } = req.body;
    if (containsProfanity(title) || containsProfanity(description || '')) {
      return res.status(400).json({ message: 'Недопустимое содержимое в названии или описании' });
    }

    stage = 'duplicate-check';
    // Дубликат: тот же автор, то же название за последний час
    const duplicate = await Track.findOne({
      author: req.user._id,
      title: { $regex: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
    });
    if (duplicate) return res.status(400).json({ message: 'Трек с таким названием уже загружен недавно' });

    stage = 'duration-check';
    // Длительность — не короче 30 сек (против спама)
    let duration = 30;
    try {
      const getMp3Duration = require('get-mp3-duration');
      const buf = req.files.audio[0].buffer;
      const ms = getMp3Duration(buf);
      if (ms) duration = Math.ceil(ms / 1000);
    } catch (_) {
      duration = 30;
    }
    if (duration < 30) return res.status(400).json({ message: 'Длительность трека должна быть не менее 30 секунд' });

    let coverImage = '';
    if (req.files.cover?.[0]) {
      stage = 'cover-upload';
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'novasound/covers', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        ).end(req.files.cover[0].buffer);
      });
      coverImage = result.secure_url;
    } else {
      // Если пользователь не загрузил отдельную обложку — пытаемся взять embedded cover из аудио.
      stage = 'embedded-cover-extract';
      try {
        const metadata = await parseBuffer(req.files.audio[0].buffer, req.files.audio[0].mimetype || undefined, { duration: false });
        const pic = metadata?.common?.picture?.[0];
        if (pic?.data) {
          stage = 'embedded-cover-upload';
          const embeddedCover = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              { folder: 'novasound/covers', resource_type: 'image' },
              (err, result) => (err ? reject(err) : resolve(result))
            ).end(pic.data);
          });
          coverImage = embeddedCover.secure_url;
        }
      } catch (_) {
        // Embedded cover опциональна: если не распарсилось — грузим трек без обложки.
      }
    }

    stage = 'gridfs-init';
    const { gridfsBucket } = getGridFS();
    if (!gridfsBucket) {
      return res.status(500).json({ message: 'Хранилище аудио не инициализировано (GridFS)' });
    }
    const audioFile = req.files.audio[0];
    stage = 'audio-upload';
    const uploadStream = gridfsBucket.openUploadStream(audioFile.originalname, {
      contentType: audioFile.mimetype,
      metadata: { userId: req.user._id.toString() }
    });
    await new Promise((resolve, reject) => {
      uploadStream.on('finish', resolve);
      uploadStream.on('error', reject);
      uploadStream.end(audioFile.buffer);
    });
    const audioFileId = uploadStream.id;

    stage = 'db-save';
    const track = await Track.create({
      title,
      description: description || '',
      author: req.user._id,
      audioFileId,
      coverImage,
      duration,
      status: 'pending'
    });
    stage = 'db-populate';
    const populated = await Track.findById(track._id).populate('author', 'username').lean();
    res.status(201).json(populated);
  } catch (err) {
    const detail =
      err?.message
      || err?.error?.message
      || err?.name
      || 'Неизвестная ошибка';
    // eslint-disable-next-line no-console
    console.error('Track upload failed', { stage, detail, err });
    res.status(500).json({ message: `Ошибка загрузки на этапе "${stage}": ${detail}` });
  }
});

// GET /api/tracks/:id — один трек (для плеера и страницы)
router.get('/:id', async (req, res) => {
  try {
    const track = await Track.findById(req.params.id).populate('author', 'username').lean();
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.status !== 'approved' && (!req.user || (req.user._id.toString() !== track.author._id?.toString() && req.user.role !== 'admin'))) {
      return res.status(404).json({ message: 'Трек не найден' });
    }
    res.json(track);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/tracks/:id — редактировать свой
router.put('/:id', protect, [
  param('id').isMongoId(),
  body('title').optional().trim().isLength({ min: 3, max: 100 }),
  body('description').optional().trim().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Можно редактировать только свои треки' });
    }
    if (track.status !== 'pending') return res.status(400).json({ message: 'Редактировать можно только треки на модерации' });
    const { title, description } = req.body;
    if (title !== undefined) {
      if (containsProfanity(title)) return res.status(400).json({ message: 'Недопустимое название' });
      track.title = title;
    }
    if (description !== undefined) {
      if (containsProfanity(description)) return res.status(400).json({ message: 'Недопустимое описание' });
      track.description = description;
    }
    await track.save();
    const populated = await Track.findById(track._id).populate('author', 'username').lean();
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/tracks/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Доступ запрещён' });
    }
    const { gridfsBucket } = getGridFS();
    try {
      await gridfsBucket.delete(track.audioFileId);
    } catch (_) {}
    await Track.findByIdAndDelete(req.params.id);
    res.json({ message: 'Трек удалён' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tracks/:id/play — учёт прослушивания
router.post('/:id/play', optionalAuth, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track || track.status !== 'approved') return res.status(404).json({ message: 'Трек не найден' });
    const userId = req.user?._id || null;
    const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').split(',')[0].trim();
    const recent = await ListenLog.findOne({
      track: track._id,
      $or: [{ user: userId }, { ip }],
      listenedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
    });
    if (!recent) {
      await ListenLog.create({ track: track._id, user: userId, ip });
      track.plays += 1;
      await track.save();
    }
    res.json({ plays: track.plays });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tracks/:id/like — лайк/анлайк
router.post('/:id/like', protect, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track || track.status !== 'approved') return res.status(404).json({ message: 'Трек не найден' });
    const id = req.user._id.toString();
    const idx = track.likes.findIndex(l => l.toString() === id);
    if (idx >= 0) {
      track.likes.splice(idx, 1);
    } else {
      track.likes.push(req.user._id);
    }
    await track.save();
    res.json({ likes: track.likes.length, liked: track.likes.some(l => l.toString() === id) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
