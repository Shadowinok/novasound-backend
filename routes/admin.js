const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Track = require('../models/Track');
const Playlist = require('../models/Playlist');
const User = require('../models/User');
const ListenLog = require('../models/ListenLog');
const TrackReport = require('../models/TrackReport');
const { getGridFS } = require('../config/gridfs');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const { sendEmail, verifyEmailTransport, getEmailModeInfo } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');

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

// GET /api/admin/track-reports — очередь жалоб
router.get('/track-reports', async (req, res) => {
  try {
    const { status = 'open' } = req.query;
    const reports = await TrackReport.find({ status, escalatedToAdmin: true })
      .populate('track', 'title coverImage author status')
      .populate('reporter', 'username email')
      .sort({ createdAt: -1 })
      .lean();
    const trackIds = reports.map((r) => r.track?._id).filter(Boolean);
    const uniqCountsRaw = await TrackReport.aggregate([
      { $match: { status: 'open', escalatedToAdmin: true, track: { $in: trackIds } } },
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
  body('action').isIn(['leave', 'rejectTrack']).withMessage('action должен быть leave или rejectTrack'),
  body('adminComment').optional().trim().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, adminComment } = req.body;

    const report = await TrackReport.findById(reportId).populate('reporter', 'email username');
    if (!report) return res.status(404).json({ message: 'Жалоба не найдена' });
    if (report.status !== 'open') return res.status(400).json({ message: 'Жалоба уже обработана' });

    let affectedTrackTitle = '';
    let affectedTrackAuthorEmail = '';
    if (action === 'rejectTrack') {
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
    report.adminAction = action === 'rejectTrack' ? 'rejectTrack' : 'leave';
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
