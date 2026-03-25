const express = require('express');
const Track = require('../models/Track');

const router = express.Router();

/**
 * Публичная лента анонсов (минимальный вариант на ближайший релиз).
 * Источники:
 * - текущий трек радио (единый для всех)
 * - свежие одобренные треки
 *
 * Админ CRUD и “закреп/срок жизни” — завтра (полноценная версия).
 */
router.get('/', async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(3, Math.min(rawLimit, 20)) : 7;

    const cycleLimit = 30;
    const tracksForCycle = await Track.find({ status: 'approved' })
      .select('-coverImagePending -coverChangeStatus -coverModerationComment')
      .populate('author', 'username')
      .sort({ createdAt: 1, _id: 1 })
      .limit(cycleLimit)
      .lean();

    let nowTrack = null;
    let nowOffsetSec = 0;

    if (tracksForCycle.length) {
      const withDurations = tracksForCycle.map((t) => ({
        ...t,
        duration: Number.isFinite(Number(t.duration)) && Number(t.duration) > 0 ? Number(t.duration) : 180
      }));

      const cycleDuration = withDurations.reduce((sum, t) => sum + t.duration, 0);
      const nowSec = Math.floor(Date.now() / 1000);
      let pos = cycleDuration > 0 ? (nowSec % cycleDuration) : 0;

      let currentIndex = 0;
      for (let i = 0; i < withDurations.length; i += 1) {
        const d = withDurations[i].duration;
        if (pos < d) {
          currentIndex = i;
          break;
        }
        pos -= d;
      }

      const orderedQueue = [
        ...withDurations.slice(currentIndex),
        ...withDurations.slice(0, currentIndex)
      ];
      nowTrack = orderedQueue[0] || null;
      nowOffsetSec = nowTrack
        ? Math.max(0, Math.min(nowTrack.duration, Math.floor(pos)))
        : 0;
    }

    const latestNeeded = Math.max(0, limit - (nowTrack ? 1 : 0));
    const latestTracks = latestNeeded
      ? await Track.find({ status: 'approved' })
        .select('-coverImagePending -coverChangeStatus -coverModerationComment')
        .populate('author', 'username')
        .sort({ createdAt: -1 })
        .limit(latestNeeded + 2) // чуть запас, чтобы убрать совпадения
        .lean()
      : [];

    const latestFiltered = nowTrack
      ? latestTracks.filter((t) => String(t._id) !== String(nowTrack._id)).slice(0, latestNeeded)
      : latestTracks.slice(0, latestNeeded);

    const items = [];
    if (nowTrack) {
      items.push({
        kind: 'radio',
        trackId: nowTrack._id,
        title: nowTrack.title,
        author: nowTrack.author?.username || 'Автор',
        offsetSec: nowOffsetSec
      });
    }

    items.push(
      ...latestFiltered.map((t) => ({
        kind: 'new-track',
        trackId: t._id,
        title: t.title,
        author: t.author?.username || 'Автор',
        createdAt: t.createdAt
      }))
    );

    res.json({ items, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

