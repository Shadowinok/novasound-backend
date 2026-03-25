const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Track = require('../models/Track');
const Playlist = require('../models/Playlist');
const User = require('../models/User');
const ListenLog = require('../models/ListenLog');
const TrackReport = require('../models/TrackReport');
const Announcement = require('../models/Announcement');
const RadioHostSettings = require('../models/RadioHostSettings');
const { getGridFS } = require('../config/gridfs');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const { sendEmail, verifyEmailTransport, getEmailModeInfo } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');
const { syncHybridPlaylists } = require('../services/hybridPlaylists');

const router = express.Router();
router.use(protect, adminOnly);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/admin/email/status — какой режим почты видит сервер (Resend vs SMTP), без секретов
router.get('/email/status', async (req, res) => {
  try {
    res.json(getEmailModeInfo());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/email/test — тест SMTP отправки
router.post('/email/test', [
  body('to').optional().isEmail().withMessage('Некорректный email получателя')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const to = req.body.to || req.user.email;
    await verifyEmailTransport();
    const sent = await sendEmail({
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
    res.json({
      message: 'Тестовое письмо отправлено',
      to,
      resendId: sent?.resendId || null,
      hint: sent?.resendId
        ? 'Проверьте доставку в Resend (Emails) или GET https://api.resend.com/emails/' + sent.resendId
        : undefined
    });
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

// GET /api/admin/playlists — только публичные подборки (личные пользователей не показываем)
router.get('/playlists', async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope || 'editorial').trim().toLowerCase();
    const scope = ['editorial', 'public', 'all'].includes(scopeRaw) ? scopeRaw : 'editorial';

    let filter = { isPublic: { $ne: false } };
    if (scope === 'editorial') {
      const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();
      const adminIds = adminUsers.map((u) => u._id);
      filter = { isPublic: { $ne: false }, createdBy: { $in: adminIds } };
    } else if (scope === 'all') {
      filter = {};
    }

    const playlists = await Playlist.find(filter)
      .populate('createdBy', 'username')
      .populate({ path: 'tracks', match: { status: 'approved' }, select: 'title coverImage author duration', populate: { path: 'author', select: 'username' } })
      .sort({ createdAt: -1 })
      .lean();
    res.json(playlists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/playlists/hybrid/sync — обновить/создать гибридные плейлисты
router.post('/playlists/hybrid/sync', async (req, res) => {
  try {
    const result = await syncHybridPlaylists({ adminUserId: req.user._id });
    res.json({
      message: 'Гибридные плейлисты синхронизированы',
      ...result
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка синхронизации гибридных плейлистов' });
  }
});

// POST /api/admin/playlists/hybrid/sync-monthly — обновить только плейлист «Релизы месяца»
router.post('/playlists/hybrid/sync-monthly', async (req, res) => {
  try {
    const result = await syncHybridPlaylists({
      adminUserId: req.user._id,
      onlyAutoTypes: ['monthlyReleases'],
      includeManual: false,
      includeGenreAuto: false
    });
    res.json({
      message: 'Плейлист «Релизы месяца» синхронизирован',
      ...result
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка синхронизации «Релизы месяца»' });
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

// GET /api/admin/track-reports — очередь жалоб (все открытые серьёзные жалобы, без «только с 4-й попытки»)
router.get('/track-reports', async (req, res) => {
  try {
    const { status = 'open' } = req.query;
    const reports = await TrackReport.find({ status })
      .populate('track', 'title coverImage coverImagePending author status')
      .populate('reporter', 'username email')
      .sort({ createdAt: -1 })
      .lean();
    const trackIds = reports.map((r) => r.track?._id).filter(Boolean);
    const uniqCountsRaw = await TrackReport.aggregate([
      { $match: { status: 'open', track: { $in: trackIds } } },
      { $group: { _id: '$track', reporters: { $addToSet: '$reporter' } } },
      { $project: { uniqueReporters: { $size: '$reporters' } } }
    ]);
    const uniqMap = new Map(uniqCountsRaw.map((x) => [String(x._id), x.uniqueReporters]));
    res.json(reports.map((r) => ({
      ...r,
      uniqueReporters: uniqMap.get(String(r.track?._id || '')) || 1
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/track-reports/:reportId/resolve — решение админа
router.put('/track-reports/:reportId/resolve', [
  param('reportId').isMongoId(),
  body('action').isIn(['leave', 'rejectTrack', 'rejectCover']).withMessage('action: leave, rejectTrack или rejectCover'),
  body('adminComment').optional().trim().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, adminComment } = req.body;

    const report = await TrackReport.findById(reportId).populate('reporter', 'email username');
    if (!report) return res.status(404).json({ message: 'Жалоба не найдена' });
    if (report.status !== 'open') return res.status(400).json({ message: 'Жалоба уже обработана' });
    if (action === 'rejectCover' && report.reportType !== 'cover') {
      return res.status(400).json({ message: 'rejectCover только для жалоб на обложку' });
    }

    let affectedTrackTitle = '';
    let affectedTrackAuthorEmail = '';
    if (action === 'rejectCover') {
      const tr = await Track.findById(report.track).populate('author', 'email username');
      if (tr) {
        affectedTrackTitle = tr.title;
        affectedTrackAuthorEmail = tr.author?.email || '';
        tr.coverImage = '';
        tr.coverImagePending = '';
        tr.coverChangeStatus = 'none';
        tr.coverModerationComment = adminComment || 'Обложка удалена по жалобе';
        await tr.save();
      }
    } else if (action === 'rejectTrack') {
      const track = await Track.findById(report.track).populate('author', 'email username');
      if (track) {
        affectedTrackTitle = track.title;
        affectedTrackAuthorEmail = track.author?.email || '';
        track.status = 'rejected';
        track.moderationComment = adminComment || report.text.slice(0, 200);
        track.rejectedAt = new Date();
        await track.save();
      }

      const autoResolvedReports = await TrackReport.find({
        track: report.track,
        status: 'open',
        _id: { $ne: report._id }
      }).populate('reporter', 'email username');

      // Автоматически закрываем все остальные открытые жалобы по этому треку,
      // чтобы админка не захламлялась после финального решения.
      await TrackReport.updateMany(
        { track: report.track, status: 'open', _id: { $ne: report._id } },
        {
          $set: {
            status: 'resolved',
            adminAction: 'rejectTrack',
            moderationComment: 'Ваша жалоба рассмотрена: трек удалён с публичной выдачи.',
            resolvedBy: req.user._id
          }
        }
      );

      // Уведомляем остальных жалобщиков, чьи жалобы закрылись автоматически.
      for (const rep of autoResolvedReports) {
        try {
          if (rep.reporter?.email) {
            await sendEmail({
              to: rep.reporter.email,
              subject: 'NovaSound — ваша жалоба обработана',
              text: 'Ваша жалоба рассмотрена: трек удалён с публичной выдачи.',
              html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5">
                  <h2>Ваша жалоба обработана</h2>
                  <p>Трек удалён с публичной выдачи.</p>
                  <p>Спасибо за помощь в модерации.</p>
                </div>
              `
            });
          }
        } catch (_) {}
      }
    }

    report.status = 'resolved';
    report.adminAction = action === 'rejectTrack' ? 'rejectTrack' : action === 'rejectCover' ? 'rejectCover' : 'leave';
    report.moderationComment = adminComment || report.moderationComment || '';
    report.resolvedBy = req.user._id;
    await report.save();

    // Уведомляем автора жалобы
    try {
      if (report.reporter?.email) {
        await sendEmail({
          to: report.reporter.email,
          subject: 'NovaSound — ваша жалоба обработана',
          text: `Жалоба обработана. Решение: ${action === 'rejectTrack' ? 'трек отклонён' : 'трек оставлен'}.\nКомментарий модератора: ${adminComment || 'Без комментария.'}`,
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5">
              <h2>Ваша жалоба обработана</h2>
              <p><b>Решение:</b> ${action === 'rejectTrack' ? 'Трек отклонён' : 'Трек оставлен'}</p>
              <p><b>Комментарий модератора:</b> ${adminComment || 'Без комментария.'}</p>
            </div>
          `
        });
      }
    } catch (_) {}

    // Если трек отклонён — уведомляем автора трека
    try {
      if (action === 'rejectTrack' && affectedTrackAuthorEmail) {
        await sendEmail({
          to: affectedTrackAuthorEmail,
          subject: 'NovaSound — ваш трек отклонён по жалобе',
          text: `Трек "${affectedTrackTitle || ''}" отклонён после обработки жалобы.\nКомментарий модератора: ${adminComment || 'Без комментария.'}`,
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5">
              <h2>Трек отклонён</h2>
              <p>Ваш трек <b>${affectedTrackTitle || 'Без названия'}</b> отклонён после обработки жалобы.</p>
              <p><b>Комментарий модератора:</b> ${adminComment || 'Без комментария.'}</p>
            </div>
          `
        });
      }
    } catch (_) {}

    res.json({ message: 'Жалоба обработана' });
  } catch (err) {
    res.status(500).json({ message: err.message });
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

// GET /api/admin/tracks/cover-pending — обложки на проверке после «подозрительного» ИИ
router.get('/tracks/cover-pending', async (req, res) => {
  try {
    const tracks = await Track.find({ status: 'approved', coverChangeStatus: 'pending', coverImagePending: { $ne: '' } })
      .populate('author', 'username email')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/tracks/:id/cover/approve — опубликовать новую обложку
router.put('/tracks/:id/cover/approve', [param('id').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.coverChangeStatus !== 'pending' || !track.coverImagePending) {
      return res.status(400).json({ message: 'Нет обложки на модерации' });
    }
    track.coverImage = track.coverImagePending;
    track.coverImagePending = '';
    track.coverChangeStatus = 'none';
    track.coverModerationComment = '';
    await track.save();
    const populated = await Track.findById(track._id).populate('author', 'username').lean();
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/tracks/:id/cover/reject — отклонить новую обложку (старая остаётся)
router.put('/tracks/:id/cover/reject', [
  param('id').isMongoId(),
  body('comment').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.coverChangeStatus !== 'pending') {
      return res.status(400).json({ message: 'Нет обложки на модерации' });
    }
    track.coverImagePending = '';
    track.coverChangeStatus = 'none';
    track.coverModerationComment = req.body.comment || 'Обложка отклонена модератором';
    await track.save();
    const populated = await Track.findById(track._id).populate('author', 'username').lean();
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/tracks/:id/approve
router.put('/tracks/:id/approve', [param('id').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const tr = await Track.findById(req.params.id);
    if (!tr) return res.status(404).json({ message: 'Трек не найден' });
    tr.status = 'approved';
    tr.moderationComment = req.body.comment || '';
    tr.approvedAt = new Date();
    if (tr.coverChangeStatus === 'pending' && tr.coverImagePending) {
      tr.coverImage = tr.coverImagePending;
      tr.coverImagePending = '';
      tr.coverChangeStatus = 'none';
      tr.coverModerationComment = '';
    }
    await tr.save();
    const track = await Track.findById(tr._id).populate('author', 'username').lean();
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

// GET /api/admin/announcements — все ручные анонсы
router.get('/announcements', async (req, res) => {
  try {
    const list = await Announcement.find({})
      .populate('createdBy', 'username')
      .sort({ pinned: -1, pinnedOrder: 1, createdAt: -1 })
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/announcements — создать ручной анонс
router.post('/announcements', [
  body('title').optional({ nullable: true }).trim().isLength({ min: 1, max: 200 }).withMessage('title: 1-200 символов'),
  body('message').optional({ nullable: true }).trim().isLength({ max: 2000 }).withMessage('message: до 2000 символов'),
  body('trackId').optional({ nullable: true }).trim(),
  body('pinned').optional({ nullable: true }),
  body('pinnedOrder').optional({ nullable: true }).toInt(),
  body('expiresAt').optional({ nullable: true }).trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ message: 'Укажите title' });

    const message = req.body.message ? String(req.body.message).trim() : '';

    const trackIdRaw = req.body.trackId ? String(req.body.trackId).trim() : '';
    const trackId = trackIdRaw && trackIdRaw !== 'null' && trackIdRaw !== 'undefined' ? trackIdRaw : null;

    // pinned может приходить строкой из формы
    const pinned = req.body.pinned === true || String(req.body.pinned) === 'true';
    const pinnedOrder =
      Number.isFinite(Number(req.body.pinnedOrder)) && Number(req.body.pinnedOrder) >= 0 ? Number(req.body.pinnedOrder) : 100;

    const expiresAtRaw = req.body.expiresAt ? String(req.body.expiresAt).trim() : '';
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const expiresAtSafe = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;

    // trackId допускается null/пустой, но если передан невалидный — отклоним
    if (trackId) {
      if (!mongoose.Types.ObjectId.isValid(trackId)) return res.status(400).json({ message: 'Некорректный trackId' });
    }

    const created = await Announcement.create({
      title,
      message,
      trackId,
      pinned,
      pinnedOrder,
      expiresAt: pinned ? expiresAtSafe : expiresAtSafe, // показываем и неп pinned (если expiresAt задан)
      createdBy: req.user._id
    });

    const populated = await Announcement.findById(created._id)
      .populate('createdBy', 'username')
      .lean();

    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/announcements/:id — обновить ручной анонс
router.put('/announcements/:id', [
  param('id').isMongoId(),
  body('title').optional({ nullable: true }).trim().isLength({ min: 1, max: 200 }),
  body('message').optional({ nullable: true }).trim().isLength({ max: 2000 }),
  body('trackId').optional({ nullable: true }).trim(),
  body('pinned').optional({ nullable: true }),
  body('pinnedOrder').optional({ nullable: true }).toInt(),
  body('expiresAt').optional({ nullable: true }).trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = req.params.id;

    const doc = await Announcement.findById(id);
    if (!doc) return res.status(404).json({ message: 'Анонс не найден' });

    const title = req.body.title !== undefined ? String(req.body.title || '').trim() : doc.title;
    if (!title) return res.status(400).json({ message: 'Укажите title' });

    const message = req.body.message !== undefined ? (req.body.message ? String(req.body.message).trim() : '') : doc.message;

    const trackIdRaw = req.body.trackId !== undefined ? (req.body.trackId ? String(req.body.trackId).trim() : '') : doc.trackId;
    const trackId = trackIdRaw && trackIdRaw !== 'null' && trackIdRaw !== 'undefined' ? trackIdRaw : null;
    if (trackId && !mongoose.Types.ObjectId.isValid(trackId)) return res.status(400).json({ message: 'Некорректный trackId' });

    const pinned = req.body.pinned !== undefined ? (req.body.pinned === true || String(req.body.pinned) === 'true') : doc.pinned;
    const pinnedOrder =
      req.body.pinnedOrder !== undefined && Number.isFinite(Number(req.body.pinnedOrder)) && Number(req.body.pinnedOrder) >= 0
        ? Number(req.body.pinnedOrder)
        : doc.pinnedOrder;

    const expiresAtRaw = req.body.expiresAt !== undefined ? (req.body.expiresAt ? String(req.body.expiresAt).trim() : '') : null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const expiresAtSafe = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;

    doc.title = title;
    doc.message = message;
    doc.trackId = trackId;
    doc.pinned = pinned;
    doc.pinnedOrder = pinnedOrder;
    doc.expiresAt = expiresAtSafe;

    await doc.save();

    const populated = await Announcement.findById(doc._id)
      .populate('createdBy', 'username')
      .lean();

    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/announcements/:id — удалить анонс
router.delete('/announcements/:id', [
  param('id').isMongoId()
], async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Announcement.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Анонс не найден' });
    res.json({ message: 'Анонс удалён' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/radio-host-settings — настройки периодичности ведущего
router.get('/radio-host-settings', async (req, res) => {
  try {
    let settings = await RadioHostSettings.findOne({ key: 'main' }).lean();
    if (!settings) {
      const created = await RadioHostSettings.create({ key: 'main' });
      settings = created.toObject();
    }
    res.json({
      mode: settings.mode || 'fixed',
      fixedEverySongs: Number(settings.fixedEverySongs) || 2,
      randomMinSongs: Number(settings.randomMinSongs) || 2,
      randomMaxSongs: Number(settings.randomMaxSongs) || 5,
      radioPlaylistMode: settings.radioPlaylistMode || 'random',
      djTheme: settings.djTheme || 'auto'
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка чтения настроек ведущего' });
  }
});

// PUT /api/admin/radio-host-settings — обновить режим периодичности ведущего
router.put('/radio-host-settings', [
  body('mode').isIn(['fixed', 'random']).withMessage('mode: fixed|random'),
  body('fixedEverySongs').optional({ nullable: true }).toInt(),
  body('randomMinSongs').optional({ nullable: true }).toInt(),
  body('randomMaxSongs').optional({ nullable: true }).toInt(),
  body('radioPlaylistMode').optional({ nullable: true }).isIn(['random', 'dj']).withMessage('radioPlaylistMode: random|dj'),
  body('djTheme').optional({ nullable: true }).isIn(['auto', 'mixed', 'energetic', 'chill', 'night', 'rock', 'pop', 'electro', 'hiphop', 'jazz']).withMessage('djTheme invalid')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const mode = String(req.body.mode || 'fixed');
    const fixedEverySongs = Math.max(1, Math.min(20, Number(req.body.fixedEverySongs) || 2));
    const randomMinSongs = Math.max(1, Math.min(20, Number(req.body.randomMinSongs) || 2));
    const randomMaxSongsRaw = Math.max(1, Math.min(20, Number(req.body.randomMaxSongs) || 5));
    const randomMaxSongs = Math.max(randomMinSongs, randomMaxSongsRaw);
    const radioPlaylistMode = req.body.radioPlaylistMode === 'dj' ? 'dj' : 'random';
    const djTheme = String(req.body.djTheme || 'auto');

    const settings = await RadioHostSettings.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          mode,
          fixedEverySongs,
          randomMinSongs,
          randomMaxSongs,
          radioPlaylistMode,
          djTheme,
          updatedBy: req.user._id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      mode: settings.mode,
      fixedEverySongs: settings.fixedEverySongs,
      randomMinSongs: settings.randomMinSongs,
      randomMaxSongs: settings.randomMaxSongs,
      radioPlaylistMode: settings.radioPlaylistMode || 'random',
      djTheme: settings.djTheme || 'auto'
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка сохранения настроек ведущего' });
  }
});

module.exports = router;
