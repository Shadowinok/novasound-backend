const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const ChatChannel = require('../models/ChatChannel');
const ChatMessage = require('../models/ChatMessage');
const ChatMute = require('../models/ChatMute');
const ChatMessageReport = require('../models/ChatMessageReport');
const RadioRequest = require('../models/RadioRequest');
const RadioHostSettings = require('../models/RadioHostSettings');
const User = require('../models/User');
const { protect, optionalAuth, adminOnly, modOrAdmin } = require('../middleware/auth');
const { containsProfanity, containsSuspiciousContent } = require('../utils/profanityFilter');

const router = express.Router();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const rateBuckets = new Map();
const deskClaimIpBuckets = new Map();

function checkDeskClaimIp(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let b = deskClaimIpBuckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + 60_000 };
    deskClaimIpBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= 20;
}

async function userChatMuted(userId) {
  const m = await ChatMute.findOne({ user: userId, until: { $gt: new Date() } }).lean();
  return !!m;
}

function checkRateLimit(userId) {
  const now = Date.now();
  const key = String(userId);
  let b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= RATE_MAX;
}

async function ensureGeneralChannel() {
  let ch = await ChatChannel.findOne({ type: 'general', slug: 'main' });
  if (!ch) ch = await ChatChannel.create({ type: 'general', slug: 'main', title: 'General' });
  return ch;
}

/** Сводка канала для списка (GET /channels, POST /groups). `c` — lean-документ с populate members.user. */
function formatChannelSummary(c, reqUserId) {
  const uid = String(reqUserId);
  const base = {
    _id: c._id,
    type: c.type,
    slug: c.slug || null,
    dmKey: c.dmKey || null,
    updatedAt: c.updatedAt
  };
  if (c.type === 'general') {
    return {
      ...base,
      title: c.title || '',
      displayTitle: 'Общий чат',
      peer: null
    };
  }
  if (c.type === 'dm') {
    const peerMember = (c.members || []).find((m) => {
      const u = m.user;
      const id = u && typeof u === 'object' && u._id != null ? String(u._id) : String(u);
      return id !== uid;
    });
    const peerUser =
      peerMember && peerMember.user && typeof peerMember.user === 'object' ? peerMember.user : null;
    const uname = peerUser?.username || '?';
    return {
      ...base,
      title: c.title || '',
      displayTitle: uname,
      peer: peerUser ? { _id: peerUser._id, username: peerUser.username } : null
    };
  }
  const t = (c.title || '').trim();
  return {
    ...base,
    title: c.title || '',
    displayTitle: t || 'Группа',
    peer: null
  };
}

function dmKeyForUsers(idA, idB) {
  const a = String(idA);
  const b = String(idB);
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

async function userCanAccessChannel(req, channel) {
  if (channel.type === 'general') return true;
  if (!req.user) return false;
  const uid = String(req.user._id);
  return channel.members.some((m) => String(m.user) === uid);
}

async function isRequestDeskEnabled() {
  const s = await RadioHostSettings.findOne({ key: 'main' }).lean();
  return !!(s && s.requestDeskEnabled);
}

router.get('/settings', async (req, res) => {
  try {
    res.json({ requestDeskEnabled: await isRequestDeskEnabled() });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.get('/channels', protect, async (req, res) => {
  try {
    await ensureGeneralChannel();
    const channels = await ChatChannel.find({
      $or: [{ type: 'general' }, { 'members.user': req.user._id }]
    })
      .populate({ path: 'members.user', select: 'username' })
      .lean();
    const mapped = channels.map((c) => formatChannelSummary(c, req.user._id));
    mapped.sort((a, b) => {
      if (a.type === 'general') return -1;
      if (b.type === 'general') return 1;
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.post('/dm/:userId', protect, [param('userId').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) {
      return res.status(400).json({ message: 'Cannot DM yourself' });
    }
    const other = await User.findById(otherId).select('_id username').lean();
    if (!other) return res.status(404).json({ message: 'User not found' });
    const dmKey = dmKeyForUsers(req.user._id, otherId);
    let ch = await ChatChannel.findOne({ type: 'dm', dmKey });
    if (!ch) {
      ch = await ChatChannel.create({
        type: 'dm',
        dmKey,
        title: '',
        members: [
          { user: req.user._id, role: 'member' },
          { user: other._id, role: 'member' }
        ],
        createdBy: req.user._id
      });
    }
    res.json({
      _id: ch._id,
      type: ch.type,
      title: other.username || 'User',
      otherUser: { _id: other._id, username: other.username }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.post(
  '/groups',
  protect,
  [
    body('title').trim().isLength({ min: 2, max: 120 }),
    body('memberIds').isArray({ min: 1 }),
    body('memberIds.*').isMongoId()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const title = String(req.body.title || '').trim();
      if (containsProfanity(title)) return res.status(400).json({ message: 'Moderation' });
      const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
      const uid = String(req.user._id);
      const idSet = new Set([uid, ...memberIds.map((id) => String(id))]);
      const uniqueIds = [...idSet];
      if (uniqueIds.length < 2) {
        return res.status(400).json({ message: 'Нужен хотя бы один участник' });
      }
      const usersFound = await User.find({ _id: { $in: uniqueIds } })
        .select('_id')
        .lean();
      if (usersFound.length !== uniqueIds.length) {
        return res.status(400).json({ message: 'Пользователь не найден' });
      }
      const members = uniqueIds.map((id) => ({
        user: id,
        role: id === uid ? 'owner' : 'member'
      }));
      const ch = await ChatChannel.create({
        type: 'group',
        title,
        members,
        createdBy: req.user._id
      });
      const populated = await ChatChannel.findById(ch._id)
        .populate({ path: 'members.user', select: 'username' })
        .lean();
      const summary = formatChannelSummary(populated, req.user._id);
      res.status(201).json(summary);
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.get(
  '/channels/:channelId/messages',
  optionalAuth,
  [
    param('channelId').isMongoId(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isISO8601()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const channel = await ChatChannel.findById(req.params.channelId);
      if (!channel) return res.status(404).json({ message: 'Channel not found' });
      if (!(await userCanAccessChannel(req, channel))) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const before = req.query.before ? new Date(req.query.before) : null;
      const filter = { channel: channel._id, removed: false };
      if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
      const msgs = await ChatMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('author', 'username')
        .lean();
      const ordered = msgs.reverse().map((m) => ({
        _id: m._id,
        text: m.text,
        createdAt: m.createdAt,
        author: m.author
          ? { _id: m.author._id, username: m.author.username }
          : { _id: m.author, username: '?' }
      }));
      res.json(ordered);
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.post(
  '/channels/:channelId/messages',
  protect,
  [param('channelId').isMongoId(), body('text').trim().isLength({ min: 1, max: 2000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (!checkRateLimit(req.user._id)) {
        return res.status(429).json({ message: 'Rate limit' });
      }
      const channel = await ChatChannel.findById(req.params.channelId);
      if (!channel) return res.status(404).json({ message: 'Channel not found' });
      if (!(await userCanAccessChannel({ user: req.user }, channel))) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      if (await userChatMuted(req.user._id)) {
        return res.status(403).json({ message: 'Чат временно недоступен (мут)' });
      }
      const text = String(req.body.text || '').trim();
      if (containsProfanity(text)) return res.status(400).json({ message: 'Moderation' });
      if (containsSuspiciousContent(text)) return res.status(400).json({ message: 'Moderation' });
      const msg = await ChatMessage.create({ channel: channel._id, author: req.user._id, text });
      await ChatChannel.findByIdAndUpdate(channel._id, { $set: { updatedAt: new Date() } });
      const populated = await ChatMessage.findById(msg._id).populate('author', 'username').lean();
      res.status(201).json({
        _id: populated._id,
        text: populated.text,
        createdAt: populated.createdAt,
        author: populated.author
          ? { _id: populated.author._id, username: populated.author.username }
          : null
      });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.delete('/messages/:messageId', protect, modOrAdmin, [param('messageId').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const msg = await ChatMessage.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: 'Not found' });
    if (req.user.role === 'moderator') {
      const author = await User.findById(msg.author).select('role').lean();
      if (author?.role === 'admin' || author?.role === 'moderator') {
        return res.status(403).json({ message: 'Нельзя удалять сообщения модераторов и админов' });
      }
    }
    msg.removed = true;
    msg.removedBy = req.user._id;
    msg.removedReason = req.user.role === 'admin' ? 'admin' : 'moderator';
    await msg.save();
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.post(
  '/mutes',
  protect,
  modOrAdmin,
  [body('userId').isMongoId(), body('hours').isInt({ min: 1, max: 168 }), body('reason').optional().trim().isLength({ max: 500 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const target = await User.findById(req.body.userId).select('role').lean();
      if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
      if (target.role === 'admin') return res.status(403).json({ message: 'Нельзя мутить администратора' });
      if (req.user.role === 'moderator' && target.role === 'moderator') {
        return res.status(403).json({ message: 'Модератор не может мутить модератора' });
      }
      const hours = Math.min(168, Math.max(1, Number(req.body.hours)));
      const until = new Date(Date.now() + hours * 3600 * 1000);
      await ChatMute.create({
        user: req.body.userId,
        until,
        reason: String(req.body.reason || '').slice(0, 500),
        createdBy: req.user._id
      });
      res.status(201).json({ until: until.toISOString() });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.delete('/mutes/:userId', protect, modOrAdmin, [param('userId').isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ChatMute.deleteMany({ user: req.params.userId, until: { $gt: new Date() } });
    res.json({ message: 'Мут снят' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.post(
  '/messages/:messageId/report',
  protect,
  [param('messageId').isMongoId(), body('text').optional().trim().isLength({ max: 500 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const msg = await ChatMessage.findById(req.params.messageId);
      if (!msg || msg.removed) return res.status(404).json({ message: 'Сообщение не найдено' });
      const channel = await ChatChannel.findById(msg.channel);
      if (!channel) return res.status(404).json({ message: 'Канал не найден' });
      if (!(await userCanAccessChannel({ user: req.user }, channel))) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      try {
        await ChatMessageReport.create({
          reporter: req.user._id,
          message: msg._id,
          channel: msg.channel,
          textSnapshot: String(msg.text || '').slice(0, 2000),
          status: 'open'
        });
      } catch (e) {
        if (e && e.code === 11000) return res.status(409).json({ message: 'Жалоба уже отправлена' });
        throw e;
      }
      res.status(201).json({ message: 'Жалоба принята' });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.get('/reports', protect, modOrAdmin, [query('status').optional().isIn(['open', 'resolved', 'all'])], async (req, res) => {
  try {
    const st = String(req.query.status || 'open');
    const filter = st === 'all' ? {} : { status: st };
    const rows = await ChatMessageReport.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('reporter', 'username')
      .populate('message')
      .populate({ path: 'channel', select: 'type title slug' })
      .lean();
    res.json(
      rows.map((r) => ({
        _id: r._id,
        status: r.status,
        textSnapshot: r.textSnapshot,
        createdAt: r.createdAt,
        adminNote: r.adminNote,
        reporter: r.reporter ? { _id: r.reporter._id, username: r.reporter.username } : null,
        messageId: r.message?._id || r.message,
        channel: r.channel
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.patch(
  '/reports/:id',
  protect,
  modOrAdmin,
  [param('id').isMongoId(), body('status').isIn(['open', 'resolved']), body('adminNote').optional().trim().isLength({ max: 1000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const rep = await ChatMessageReport.findById(req.params.id);
      if (!rep) return res.status(404).json({ message: 'Не найдено' });
      rep.status = req.body.status;
      if (req.body.adminNote !== undefined) rep.adminNote = String(req.body.adminNote || '').slice(0, 1000);
      if (rep.status === 'resolved') rep.resolvedBy = req.user._id;
      await rep.save();
      res.json({ message: 'OK' });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

function tplReplace(s, vars) {
  let out = String(s || '');
  Object.entries(vars).forEach(([k, v]) => {
    out = out.split(`{${k}}`).join(String(v ?? ''));
  });
  return out.trim();
}

router.post('/desk/broadcast-claim', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'x';
    if (!checkDeskClaimIp(ip)) return res.status(429).json({ message: 'Слишком часто' });

    if (!(await isRequestDeskEnabled())) return res.json({ skip: true, reason: 'desk_off' });

    let settings = await RadioHostSettings.findOne({ key: 'main' }).lean();
    if (!settings) {
      await RadioHostSettings.create({ key: 'main' });
      settings = await RadioHostSettings.findOne({ key: 'main' }).lean();
    }

    const minMs = Math.max(60_000, (Number(settings.requestDeskMinIntervalMinutes) || 4) * 60_000);
    const lastAt = settings.deskLastBroadcastAt ? new Date(settings.deskLastBroadcastAt).getTime() : 0;
    if (lastAt && Date.now() - lastAt < minMs) {
      return res.json({ skip: true, reason: 'cooldown' });
    }

    const pending = await RadioRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(80).lean();
    if (!pending.length) return res.json({ skip: true, reason: 'empty' });

    const shuffled = [...pending].sort(() => Math.random() - 0.5);
    let updated = null;
    for (const p of shuffled.slice(0, 15)) {
      const row = await RadioRequest.findOneAndUpdate(
        { _id: p._id, status: 'pending' },
        { $set: { status: 'picked', pickedAt: new Date() } },
        { new: true }
      )
        .populate('user', 'username')
        .lean();
      if (row) {
        updated = row;
        break;
      }
    }
    if (!updated) return res.json({ skip: true, reason: 'race' });

    await RadioHostSettings.updateOne({ key: 'main' }, { $set: { deskLastBroadcastAt: new Date() } });

    const userLabel = updated.user?.username || 'слушатель';
    const intro = tplReplace(settings.deskIntroTemplate || '', {});
    const body = tplReplace(settings.deskBodyTemplate || 'Пишет {user}: {text}.', {
      user: userLabel,
      text: String(updated.text || '').slice(0, 500)
    });
    const outro = tplReplace(settings.deskOutroTemplate || '', {});
    let banter = '';
    const banterChance = Number.isFinite(Number(settings.requestDeskBanterChance))
      ? Math.min(1, Math.max(0, Number(settings.requestDeskBanterChance)))
      : 0.22;
    if (Math.random() < banterChance) {
      banter = ` ${tplReplace(settings.deskBanterTemplate || '', { user: userLabel })}`;
    }
    const tts = `${intro} ${body}${banter} ${outro}`.replace(/\s+/g, ' ').trim().slice(0, 2000);

    res.json({
      skip: false,
      requestId: updated._id,
      tts,
      username: userLabel
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.post('/requests', protect, [body('text').trim().isLength({ min: 1, max: 500 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!(await isRequestDeskEnabled())) return res.status(403).json({ message: 'Desk off' });
    if (!checkRateLimit('req:' + req.user._id)) return res.status(429).json({ message: 'Rate limit' });
    const text = String(req.body.text || '').trim();
    if (containsProfanity(text) || containsSuspiciousContent(text)) {
      return res.status(400).json({ message: 'Moderation' });
    }
    const row = await RadioRequest.create({ user: req.user._id, text, status: 'pending' });
    res.status(201).json({ _id: row._id, text: row.text, status: row.status, createdAt: row.createdAt });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.get('/requests', protect, adminOnly, async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const filter = status === 'all' ? {} : { status };
    const rows = await RadioRequest.find(filter)
      .sort({ createdAt: 1 })
      .limit(200)
      .populate('user', 'username')
      .lean();
    res.json(
      rows.map((r) => ({
        _id: r._id,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt,
        pickedAt: r.pickedAt,
        user: r.user ? { _id: r.user._id, username: r.user.username } : null
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.patch(
  '/requests/:id',
  protect,
  adminOnly,
  [param('id').isMongoId(), body('status').isIn(['picked', 'skipped', 'played', 'pending'])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const status = String(req.body.status);
      const update = { status };
      if (status === 'picked' || status === 'played') update.pickedAt = new Date();
      const row = await RadioRequest.findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
        .populate('user', 'username')
        .lean();
      if (!row) return res.status(404).json({ message: 'Not found' });
      res.json(row);
    } catch (err) {
      res.status(500).json({ message: err.message || 'Error' });
    }
  }
);

router.post('/requests/pick-random', protect, adminOnly, async (req, res) => {
  try {
    const pending = await RadioRequest.find({ status: 'pending' }).lean();
    if (!pending.length) return res.status(404).json({ message: 'Empty' });
    const idx = Math.floor(Math.random() * pending.length);
    const pick = pending[idx];
    const row = await RadioRequest.findByIdAndUpdate(
      pick._id,
      { $set: { status: 'picked', pickedAt: new Date() } },
      { new: true }
    )
      .populate('user', 'username')
      .lean();
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

router.get('/general-channel', async (req, res) => {
  try {
    const ch = await ensureGeneralChannel();
    res.json({ _id: ch._id });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error' });
  }
});

module.exports = router;
