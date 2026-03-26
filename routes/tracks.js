const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const TrackModel = require('../models/Track');
const Track = TrackModel;
const { GENRES } = TrackModel;
const ListenLog = require('../models/ListenLog');
const { protect, optionalAuth, protectStream } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');
const { containsProfanity, containsSuspiciousContent } = require('../utils/profanityFilter');
const { getGridFS } = require('../config/gridfs');
const cloudinary = require('../config/cloudinary');
const { parseBuffer } = require('music-metadata');
const TrackReport = require('../models/TrackReport');
const RadioHostSettings = require('../models/RadioHostSettings');
const {
  trackUploadIpLimiter,
  trackUploadUserLimiter,
  coverReplaceIpLimiter,
  coverReplaceUserLimiter
} = require('../middleware/rateLimits');

const router = express.Router();

const DJ_THEME_GENRE_WEIGHTS = {
  mixed: { 'rock-metal': 1, pop: 1, jazz: 1, 'hiphop-rap': 1, electronic: 1, other: 1 },
  energetic: { electronic: 3, 'hiphop-rap': 2.4, 'rock-metal': 2.1, pop: 1.4, jazz: 0.6, other: 1 },
  chill: { jazz: 3, pop: 1.8, electronic: 1.5, other: 1.5, 'hiphop-rap': 0.9, 'rock-metal': 0.6 },
  night: { electronic: 2.7, jazz: 2.2, pop: 1.2, other: 1.4, 'hiphop-rap': 1, 'rock-metal': 0.7 },
  rock: { 'rock-metal': 3.5, pop: 0.9, electronic: 1, 'hiphop-rap': 0.8, jazz: 0.6, other: 1 },
  pop: { pop: 3.2, electronic: 1.5, 'hiphop-rap': 1.2, 'rock-metal': 0.8, jazz: 0.9, other: 1.1 },
  electro: { electronic: 3.6, pop: 1.3, 'hiphop-rap': 1.2, 'rock-metal': 0.8, jazz: 0.7, other: 1 },
  hiphop: { 'hiphop-rap': 3.5, electronic: 1.4, pop: 1.2, 'rock-metal': 0.7, jazz: 0.6, other: 1 },
  jazz: { jazz: 3.8, electronic: 1.1, pop: 1.1, 'hiphop-rap': 0.8, 'rock-metal': 0.6, other: 1.3 }
};

function mulberry32(seed) {
  // eslint-disable-next-line no-bitwise
  return function rand() { let t = (seed += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function getMskHour() {
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false
    });
    const s = fmt.format(new Date());
    const h = Number(s);
    return Number.isFinite(h) ? h : new Date().getHours();
  } catch (_) {
    return new Date().getHours();
  }
}

function pickDjEpisodeAuto(episodeKey) {
  const mskHour = getMskHour();
  // eslint-disable-next-line no-bitwise
  const rand = mulberry32(episodeKey * 1000003 + 777);

  const morningTags = ['в москве дождит', 'кофе на автопилоте', 'утро в тёплом шуме', 'рассвет и город на минималках'];
  const morningSadTags = ['утренняя грустняшка', 'серое, но стильно', 'чуть-чуть меланхолии', 'дождь, наушники, тишина'];
  const nightTags = ['ночной режим', 'город шепчет на минималке', 'тёмный чилл', 'после полуночи всё вкуснее'];

  let moodType = 'mixed';
  let effectiveTheme = 'mixed';
  let tag = '';

  // Условно: утро/ночь (остальное считаем "смешанным", чтобы не было пусто)
  const isMorning = mskHour >= 6 && mskHour < 12;
  const isNight = mskHour >= 23 || mskHour < 5;

  if (isMorning) {
    if (rand() < 0.55) {
      moodType = 'morning_chill';
      effectiveTheme = 'chill';
      tag = morningTags[Math.floor(rand() * morningTags.length)];
    } else {
      moodType = 'morning_sad';
      effectiveTheme = 'jazz';
      tag = morningSadTags[Math.floor(rand() * morningSadTags.length)];
    }
  } else if (isNight) {
    moodType = 'night_chill';
    effectiveTheme = 'night';
    tag = nightTags[Math.floor(rand() * nightTags.length)];
  } else {
    moodType = 'mixed';
    effectiveTheme = rand() < 0.4 ? 'energetic' : 'mixed';
    tag = nightTags[Math.floor(rand() * nightTags.length)];
  }

  return {
    id: String(episodeKey),
    moodType,
    tag,
    effectiveTheme
  };
}

function weightedShuffleByTheme(list, theme, seed) {
  const weights = DJ_THEME_GENRE_WEIGHTS[theme] || DJ_THEME_GENRE_WEIGHTS.mixed;
  const rand = mulberry32(seed);
  return [...list]
    .map((t, idx) => {
      const g = String(t.genre || 'other');
      const w = Number(weights[g]) || 1;
      const u = Math.max(rand(), 1e-9);
      const score = -Math.log(u) / w + idx * 1e-9;
      return { t, score };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.t);
}

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

/**
 * Подозрительное имя файла → модерация обложки.
 * Не используем простой .includes('sex') — иначе ложные срабатывания (sussex.jpg и т.п.).
 */
function coverFilenameSuspicious(originalname = '') {
  const full = String(originalname).toLowerCase();
  const base = full.replace(/\.[^.]+$/, '');
  const cyrAndLong = [
    'порно', '18+', 'наркот', 'суицид', 'взрыв', 'бомб', 'убий', 'убийство',
    'расизм', 'нацизм', 'экстрем', 'террор', 'докс', 'угроз', 'самоуб', 'порн', 'xxx'
  ];
  if (cyrAndLong.some((k) => full.includes(k))) return true;
  return /\b(sex|hate)\b/i.test(base);
}

function classifyReportText(text = '') {
  const t = String(text).toLowerCase();
  const groups = {
    hate: ['разжиган', 'ненавист', 'расизм', 'нацизм', 'hate', 'ethnic'],
    drugs: ['наркот', 'drug', 'кокаин', 'героин', 'амфетамин'],
    violence: ['убий', 'насили', 'гори', 'войн', 'violence', 'kill'],
    extremism: ['экстрем', 'террор', 'terror', 'бомб'],
    sexual: ['порно', 'sex', 'сексуал', '18+']
  };
  for (const [category, words] of Object.entries(groups)) {
    if (words.some((w) => t.includes(w))) return { isSerious: true, category };
  }
  const seriousGeneric = ['угроз', 'докс', 'пропаганд', 'child abuse', 'суицид'];
  if (seriousGeneric.some((w) => t.includes(w))) return { isSerious: true, category: 'other-serious' };
  return { isSerious: false, category: 'non-serious' };
}

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

// GET /api/tracks/audio/:fileId — стриминг аудио из GridFS (только авторизованные; ?token= для HTML5)
router.get('/audio/:fileId', protectStream, async (req, res) => {
  try {
    const { gridfsBucket } = getGridFS();
    const _id = new mongoose.Types.ObjectId(req.params.fileId);
    const cursor = gridfsBucket.find({ _id });
    const file = await cursor.next();
    if (!file) return res.status(404).json({ message: 'Файл не найден' });
    const fileSize = Number(file.length) || 0;
    const contentType = file.contentType || 'audio/mpeg';
    const range = req.headers.range;

    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Type', contentType);

    if (range && fileSize > 0) {
      const match = String(range).match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.set('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : fileSize - 1;

      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1;
      if (start > end || start >= fileSize) {
        res.set('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.set('Content-Length', String(chunkSize));

      const stream = gridfsBucket.openDownloadStream(_id, {
        start,
        end: end + 1 // в GridFS end — эксклюзивный
      });
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      return stream.pipe(res);
    }

    if (fileSize > 0) res.set('Content-Length', String(fileSize));
    const stream = gridfsBucket.openDownloadStream(_id);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/tracks/audio-public/:fileId — публичный стрим для гостевого радио (только approved)
router.get('/audio-public/:fileId', async (req, res) => {
  try {
    const { gridfsBucket } = getGridFS();
    const _id = new mongoose.Types.ObjectId(req.params.fileId);

    const track = await Track.findOne({ audioFileId: String(req.params.fileId), status: 'approved' })
      .select('_id')
      .lean();
    if (!track) return res.status(404).json({ message: 'Файл не найден' });

    const cursor = gridfsBucket.find({ _id });
    const file = await cursor.next();
    if (!file) return res.status(404).json({ message: 'Файл не найден' });
    const fileSize = Number(file.length) || 0;
    const contentType = file.contentType || 'audio/mpeg';
    const range = req.headers.range;

    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Type', contentType);

    if (range && fileSize > 0) {
      const match = String(range).match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.set('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : fileSize - 1;

      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1;
      if (start > end || start >= fileSize) {
        res.set('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.set('Content-Length', String(chunkSize));

      const stream = gridfsBucket.openDownloadStream(_id, {
        start,
        end: end + 1
      });
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      return stream.pipe(res);
    }

    if (fileSize > 0) res.set('Content-Length', String(fileSize));
    const stream = gridfsBucket.openDownloadStream(_id);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);
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
      .select('-coverImagePending -coverChangeStatus -coverModerationComment')
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

// GET /api/tracks/latest — совместимость со старым фронтендом
router.get('/latest', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 12, 50));
    const tracks = await Track.find({ status: 'approved' })
      .select('-coverImagePending -coverChangeStatus -coverModerationComment')
      .populate('author', 'username')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/tracks/radio/now — упрощённый "единый эфир" из approved-треков
router.get('/radio/now', async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(5, Math.min(rawLimit, 100)) : 30;
    // Берём больше треков, чтобы можно было перемешать и всё равно выдать `limit` очереди.
    const fetchLimit = Math.max(limit, Math.min(limit * 3, 120));
    const tracks = await Track.find({ status: 'approved' })
      .select('-coverImagePending -coverChangeStatus -coverModerationComment')
      .populate('author', 'username')
      .sort({ createdAt: 1, _id: 1 })
      .limit(fetchLimit)
      .lean();

    if (!tracks.length) {
      return res.json({
        now: null,
        next: [],
        queue: [],
        queueIndex: 0,
        generatedAt: new Date().toISOString()
      });
    }

    const withDurations = tracks.map((t) => ({
      ...t,
      duration: Number.isFinite(Number(t.duration)) && Number(t.duration) > 0 ? Number(t.duration) : 180
    }));

    // Делаем порядок очереди "рандомным", но детерминированным для всех:
    // сид зависит от текущего временного окна (чтобы эфир обновлялся не каждую секунду).
    const nowSec = Math.floor(Date.now() / 1000);
    const shuffleWindowSec = Number.isFinite(Number(req.query.shuffleWindowSec))
      ? Math.max(60, Number(req.query.shuffleWindowSec))
      : 60 * 30; // 30 минут
    const windowKey = Math.floor(nowSec / shuffleWindowSec);
    const seedBase = windowKey * 1000003;
    const settings = await RadioHostSettings.findOne({ key: 'main' }).lean();
    const playlistMode = settings?.radioPlaylistMode === 'dj' ? 'dj' : 'random';
    const configuredTheme = String(settings?.djTheme || 'auto');

    const episodeWindowSec = 60 * 60; // 1 час
    const episodeKey = Math.floor(nowSec / episodeWindowSec);

    let effectiveTheme = configuredTheme;
    let djEpisode = null;
    if (playlistMode === 'dj') {
      if (configuredTheme === 'auto') {
        const ep = pickDjEpisodeAuto(episodeKey);
        effectiveTheme = ep.effectiveTheme;
        djEpisode = {
          id: ep.id,
          moodType: ep.moodType,
          tag: ep.tag
        };
      } else {
        effectiveTheme = configuredTheme;
        djEpisode = {
          id: String(episodeKey),
          moodType: 'custom',
          tag: String(configuredTheme)
        };
      }
    }

    let shuffled = [];
    if (playlistMode === 'dj') {
      shuffled = weightedShuffleByTheme(withDurations, effectiveTheme, seedBase + withDurations.length + 913);
    } else {
      const prng = mulberry32(seedBase + withDurations.length);
      shuffled = [...withDurations];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(prng() * (i + 1));
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
    }

    // В очередь берём ровно `limit`
    const orderedQueue = shuffled.slice(0, limit);

    const cycleDuration = orderedQueue.reduce((sum, t) => sum + t.duration, 0);
    let pos = cycleDuration > 0 ? (nowSec % cycleDuration) : 0;

    let currentIndex = 0;
    for (let i = 0; i < orderedQueue.length; i += 1) {
      const d = orderedQueue[i].duration;
      if (pos < d) {
        currentIndex = i;
        break;
      }
      pos -= d;
    }

    const rotateQueue = [
      ...orderedQueue.slice(currentIndex),
      ...orderedQueue.slice(0, currentIndex)
    ];

    const nowTrack = rotateQueue[0];
    const nowOffsetSec = Math.max(0, Math.min(nowTrack.duration, Math.floor(pos)));
    const history = [];
    for (let i = 1; i <= 5; i += 1) {
      const idx = (orderedQueue.length + currentIndex - i) % orderedQueue.length;
      history.push(orderedQueue[idx]);
    }

    res.json({
      now: nowTrack,
      next: rotateQueue.slice(1, 6),
      history,
      queue: rotateQueue,
      queueIndex: 0,
      nowOffsetSec,
      radioPlaylistMode: playlistMode,
      djTheme: effectiveTheme,
      djEpisode,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const coverMimeOk = (mime) =>
  ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(String(mime || '').toLowerCase());

const uploadCoverOnly = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'cover') return cb(new Error('Ожидается поле cover'));
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    // С телефонов часто приходит имя без расширения — смотрим MIME
    if (extOk || coverMimeOk(file.mimetype)) return cb(null, true);
    cb(new Error('Нужен файл изображения: jpg, png или webp'));
  }
});

const uploadCoverMiddleware = (req, res, next) => {
  uploadCoverOnly.single('cover')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Обложка слишком большая (макс. 5 МБ)' });
    }
    return res.status(400).json({ message: err.message || 'Ошибка загрузки обложки' });
  });
};

// PUT/POST /api/tracks/:id/cover — сменить обложку (POST дублирует PUT: часть прокси/Vercel криво прокидывает PUT+multipart)
const coverReplaceStack = [
  protect,
  coverReplaceIpLimiter,
  coverReplaceUserLimiter,
  [param('id').isMongoId()],
  uploadCoverMiddleware
];
async function handleCoverReplace(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!req.file) return res.status(400).json({ message: 'Выберите файл обложки' });
    const cfg = cloudinary.config();
    if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
      return res.status(503).json({
        message:
          'На сервере не заданы ключи Cloudinary. В Render добавь CLOUDINARY_URL (cloudinary://...) или три переменные CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET и перезапусти деплой.'
      });
    }
    if (!req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ message: 'Файл пустой или не прочитался — выберите другой jpg/png/webp' });
    }
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Можно менять обложку только у своих треков' });
    }
    if (track.status !== 'approved' && track.status !== 'pending') {
      return res.status(400).json({ message: 'Обложку можно менять у треков на модерации или уже одобренных' });
    }
    // upload_stream на части хостингов (Render) иногда падает; upload + data URI стабильнее для файлов до 5 МБ
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
          dataUri,
          { folder: 'novasound/covers', resource_type: 'auto' },
          (err, r) => (err ? reject(err) : resolve(r))
        );
      });
    } catch (uploadErr) {
      const cmsg =
        uploadErr?.error?.message ||
        uploadErr?.message ||
        (typeof uploadErr?.error === 'string' ? uploadErr.error : '') ||
        String(uploadErr);
      console.error('[cover cloudinary]', cmsg, uploadErr);
      return res.status(502).json({
        message: `Cloudinary: ${cmsg}`,
        step: 'upload'
      });
    }
    if (!result?.secure_url) {
      return res.status(502).json({ message: 'Cloudinary не вернул ссылку на файл', step: 'upload' });
    }
    const suspicious = coverFilenameSuspicious(req.file.originalname);
    if (suspicious) {
      track.coverImagePending = result.secure_url;
      track.coverChangeStatus = 'pending';
      track.coverModerationComment = 'Подозрительное имя файла обложки — требуется проверка';
    } else {
      track.coverImage = result.secure_url;
      track.coverImagePending = '';
      track.coverChangeStatus = 'none';
      track.coverModerationComment = '';
    }
    try {
      await track.save();
    } catch (saveErr) {
      console.error('[cover save]', saveErr);
      return res.status(500).json({
        message: saveErr?.message || 'Ошибка сохранения трека в базу',
        step: 'database'
      });
    }
    const populated = await Track.findById(track._id).populate('author', 'username').lean();
    res.json(populated);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msgs = Object.values(err.errors || {})
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ message: msgs || err.message });
    }
    console.error('[cover upload]', err);
    const msg =
      err?.error?.message ||
      err?.message ||
      (typeof err?.error === 'string' ? err.error : '') ||
      String(err);
    const httpCode = err?.http_code || err?.error?.http_code;
    res.status(500).json({
      message: msg,
      code: httpCode,
      hint:
        httpCode === 401
          ? 'Неверный API Key/Secret в Render — перепроверь переменные Cloudinary.'
          : undefined
    });
  }
}
router.put('/:id/cover', ...coverReplaceStack, handleCoverReplace);
router.post('/:id/cover', ...coverReplaceStack, handleCoverReplace);

// POST /api/tracks — загрузка (авторизованный пользователь)
router.post('/', protect, trackUploadIpLimiter, trackUploadUserLimiter, uploadTrackFiles, [
  body('title').trim().isLength({ min: 3, max: 100 }).withMessage('Название 3-100 символов'),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('genre').isIn(GENRES).withMessage('Выберите жанр из списка')
], async (req, res) => {
  let stage = 'start';
  try {
    stage = 'validate';
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!req.files?.audio?.[0]) return res.status(400).json({ message: 'Нужен аудиофайл' });

    stage = 'content-check';
    const { title, description, genre } = req.body;
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

    // Базовая (быстрая) AI-модерация по тексту: чистые треки сразу approved,
    // подозрительные — pending (админ посмотрит по жалобе/спорным случаям).
    // Аморальное/запрещенное реальными ИИ мы заменим позже, сейчас — детерминированные правила.
    const textToModerate = `${title} ${description || ''}`;
    const hasSuspicious = containsSuspiciousContent(textToModerate);

    let coverImage = '';
    let coverImagePending = '';
    let coverChangeStatus = 'none';
    let coverModComment = '';

    if (req.files.cover?.[0]) {
      stage = 'cover-upload';
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'novasound/covers', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        ).end(req.files.cover[0].buffer);
      });
      const suspCoverName = coverFilenameSuspicious(req.files.cover[0].originalname);
      if (suspCoverName) {
        coverImagePending = result.secure_url;
        coverChangeStatus = 'pending';
        coverModComment = 'Подозрительное имя файла обложки — требуется проверка';
      } else {
        coverImage = result.secure_url;
      }
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

    let moderationStatus = hasSuspicious ? 'pending' : 'approved';
    let moderationReason = hasSuspicious
      ? 'Подозрительный контент — требуется ручная проверка'
      : '';

    if (coverChangeStatus === 'pending') {
      moderationStatus = 'pending';
      moderationReason = moderationReason
        ? `${moderationReason}; ${coverModComment}`
        : coverModComment;
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
      genre,
      author: req.user._id,
      audioFileId,
      coverImage,
      coverImagePending,
      coverChangeStatus,
      coverModerationComment: coverChangeStatus === 'pending' ? coverModComment : '',
      duration,
      status: moderationStatus,
      moderationComment: moderationReason
    });
    if (moderationStatus === 'approved') track.approvedAt = new Date();
    await track.save();
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

// POST /api/tracks/:id/report — пожаловаться на трек (не скрываем трек сразу)
router.post('/:id/report', protect, [
  param('id').isMongoId(),
  body('text').trim().isLength({ min: 10, max: 2000 }).withMessage('Укажите описание жалобы (10-2000 символов)'),
  body('reportType').optional().isIn(['content', 'cover'])
], async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const reportType = req.body.reportType === 'cover' ? 'cover' : 'content';

    const track = await Track.findById(id).select('author status coverImage');
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    // Жаловаться имеет смысл на уже доступные треки
    if (track.status !== 'approved') return res.status(400).json({ message: 'Жалобы принимаются только для одобренных треков' });
    if (reportType === 'cover' && !track.coverImage) {
      return res.status(400).json({ message: 'У трека нет обложки для этой жалобы' });
    }

    const existingOpen = await TrackReport.findOne({
      track: track._id,
      reporter: req.user._id,
      status: 'open',
      reportType
    }).select('_id');
    if (existingOpen) {
      return res.status(400).json({
        message: reportType === 'cover'
          ? 'У вас уже есть открытая жалоба на обложку этого трека'
          : 'У вас уже есть открытая жалоба на этот трек'
      });
    }

    const { isSerious, category } = classifyReportText(text);
    if (!isSerious) {
      return res.status(400).json({
        message: 'Жалоба не относится к серьёзным нарушениям. Для оценки используйте лайк/дизлайк.'
      });
    }

    const priorSeriousCount = await TrackReport.countDocuments({
      track: track._id,
      reporter: req.user._id,
      reasonCategory: category,
      isSerious: true,
      reportType
    });
    const attemptNumber = priorSeriousCount + 1;

    const report = await TrackReport.create({
      track: track._id,
      reporter: req.user._id,
      reportType,
      text,
      aiSuggestedAction: 'needsManual',
      reasonCategory: category,
      isSerious,
      escalatedToAdmin: true,
      attemptNumber,
      status: 'open',
      adminAction: 'none',
      moderationComment: ''
    });

    res.status(201).json({
      ...report.toObject(),
      message: 'Жалоба передана модераторам'
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(400).json({ message: 'У вас уже есть открытая жалоба на этот трек' });
    }
    res.status(500).json({ message: err.message || 'Ошибка создания жалобы' });
  }
});

// GET /api/tracks/:id — один трек (для плеера и страницы)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id).populate('author', 'username').lean();
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.status !== 'approved' && (!req.user || (req.user._id.toString() !== track.author._id?.toString() && req.user.role !== 'admin'))) {
      return res.status(404).json({ message: 'Трек не найден' });
    }
    const authorId = track.author?._id?.toString?.() || track.author?.toString?.();
    const isAuthorOrAdmin =
      (req.user && authorId === req.user._id.toString()) || req.user?.role === 'admin';
    if (!isAuthorOrAdmin) {
      delete track.coverImagePending;
      delete track.coverModerationComment;
      track.coverChangeStatus = 'none';
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
  body('description').optional().trim().isLength({ max: 2000 }),
  body('genre').optional().isIn(GENRES).withMessage('Выберите жанр из списка')
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
    const { title, description, genre } = req.body;
    if (title !== undefined) {
      if (containsProfanity(title)) return res.status(400).json({ message: 'Недопустимое название' });
      track.title = title;
    }
    if (description !== undefined) {
      if (containsProfanity(description)) return res.status(400).json({ message: 'Недопустимое описание' });
      track.description = description;
    }
    if (genre !== undefined) track.genre = genre;
    const textModerated = `${track.title} ${track.description || ''}`;
    const suspicious = containsSuspiciousContent(textModerated);
    const coverAwaiting =
      track.coverChangeStatus === 'pending' && String(track.coverImagePending || '').trim() !== '';
    if (suspicious) {
      track.status = 'pending';
      track.moderationComment = 'Подозрительный контент — требуется ручная проверка';
      track.approvedAt = undefined;
    } else if (coverAwaiting) {
      track.status = 'pending';
      if (!track.moderationComment) {
        track.moderationComment = 'Ожидается проверка обложки администратором';
      }
      track.approvedAt = undefined;
    } else {
      track.status = 'approved';
      track.moderationComment = '';
      track.approvedAt = new Date();
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
    await ListenLog.deleteMany({ track: track._id });
    await Track.findByIdAndDelete(req.params.id);
    res.json({ message: 'Трек удалён' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tracks/:id/play — учёт прослушивания (только залогиненные; гости не слушают)
router.post('/:id/play', protect, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track || track.status !== 'approved') return res.status(404).json({ message: 'Трек не найден' });
    const userId = req.user._id;
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
    const dislikeIdx = (track.dislikes || []).findIndex(l => l.toString() === id);
    if (idx >= 0) {
      track.likes.splice(idx, 1);
    } else {
      track.likes.push(req.user._id);
      if (dislikeIdx >= 0) track.dislikes.splice(dislikeIdx, 1);
    }
    await track.save();
    res.json({
      likes: track.likes.length,
      dislikes: (track.dislikes || []).length,
      liked: track.likes.some(l => l.toString() === id),
      disliked: (track.dislikes || []).some(l => l.toString() === id)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tracks/:id/dislike — дизлайк/снять дизлайк
router.post('/:id/dislike', protect, async (req, res) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track || track.status !== 'approved') return res.status(404).json({ message: 'Трек не найден' });
    const id = req.user._id.toString();
    const idx = (track.dislikes || []).findIndex(l => l.toString() === id);
    const likeIdx = track.likes.findIndex(l => l.toString() === id);
    if (idx >= 0) {
      track.dislikes.splice(idx, 1);
    } else {
      track.dislikes.push(req.user._id);
      if (likeIdx >= 0) track.likes.splice(likeIdx, 1);
    }
    await track.save();
    res.json({
      likes: track.likes.length,
      dislikes: (track.dislikes || []).length,
      liked: track.likes.some(l => l.toString() === id),
      disliked: (track.dislikes || []).some(l => l.toString() === id)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/tracks/my/reports — мои жалобы на треки
router.get('/my/reports', protect, async (req, res) => {
  try {
    const reports = await TrackReport.find({ reporter: req.user._id })
      .populate('track', 'title status coverImage')
      .sort({ createdAt: -1 })
      .lean();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
