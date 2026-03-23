const Playlist = require('../models/Playlist');
const Track = require('../models/Track');
const ListenLog = require('../models/ListenLog');

const AUTO_DEFINITIONS = [
  {
    title: 'Тренды недели',
    description: 'Самое слушаемое за последние 7 дней.',
    type: 'weeklyTrending'
  },
  {
    title: 'Новые и горячие',
    description: 'Свежие треки с самым быстрым ростом прослушиваний.',
    type: 'newAndHot'
  },
  {
    title: 'Открытия комьюнити',
    description: 'Недооцененные треки с сильной поддержкой слушателей.',
    type: 'communityFinds'
  },
  {
    title: 'Релизы месяца',
    description: 'Лучшие релизы за текущий месяц.',
    type: 'monthlyReleases'
  }
];

const MANUAL_DEFINITIONS = [
  {
    title: 'По жанрам/настроениям',
    description: 'Synthwave, Phonk, Chill, Dark и другие тематические подборки.'
  },
  {
    title: 'Для сценариев',
    description: 'Для работы, для дороги, ночной вайб и другие сценарии прослушивания.'
  }
];

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

async function playMapByPeriod(start, end = null) {
  const match = end
    ? { listenedAt: { $gte: start, $lt: end } }
    : { listenedAt: { $gte: start } };
  const rows = await ListenLog.aggregate([
    { $match: match },
    { $group: { _id: '$track', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((r) => [String(r._id), Number(r.count) || 0]));
}

async function getWeeklyTrendingTracks(limit = 40) {
  const weeklyMap = await playMapByPeriod(daysAgo(7));
  const ids = Array.from(weeklyMap.keys());
  if (!ids.length) return [];
  const tracks = await Track.find({ _id: { $in: ids }, status: 'approved' })
    .select('_id createdAt likes plays')
    .lean();
  return tracks
    .map((t) => ({ id: String(t._id), score: weeklyMap.get(String(t._id)) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

async function getNewAndHotTracks(limit = 40) {
  const now = new Date();
  const weekAgo = daysAgo(7);
  const twoWeeksAgo = daysAgo(14);
  const recentMap = await playMapByPeriod(weekAgo, now);
  const prevMap = await playMapByPeriod(twoWeeksAgo, weekAgo);
  const tracks = await Track.find({
    status: 'approved',
    createdAt: { $gte: daysAgo(45) }
  })
    .select('_id createdAt likes plays')
    .lean();
  return tracks
    .map((t) => {
      const id = String(t._id);
      const recent = recentMap.get(id) || 0;
      const prev = prevMap.get(id) || 0;
      const growth = recent - prev;
      const freshnessBoost = Math.max(0, 45 - Math.floor((now - new Date(t.createdAt)) / (24 * 3600 * 1000)));
      const score = growth * 3 + recent + freshnessBoost;
      return { id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

async function getCommunityFindTracks(limit = 40) {
  const tracks = await Track.find({ status: 'approved' })
    .select('_id likes plays createdAt')
    .lean();
  return tracks
    .map((t) => {
      const likes = Array.isArray(t.likes) ? t.likes.length : 0;
      const plays = Number(t.plays) || 0;
      const ratio = likes / Math.max(plays, 1);
      // Поддержка комьюнити + немного веса за абсолютные лайки.
      const score = ratio * 100 + likes * 0.8 - plays * 0.03;
      return { id: String(t._id), likes, plays, score };
    })
    .filter((x) => x.likes >= 2 && x.plays >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

async function getMonthlyReleaseTracks(limit = 40) {
  const start = startOfCurrentMonth();
  const monthlyMap = await playMapByPeriod(start);
  const tracks = await Track.find({
    status: 'approved',
    createdAt: { $gte: start }
  })
    .select('_id createdAt likes plays')
    .lean();
  return tracks
    .map((t) => {
      const id = String(t._id);
      const likes = Array.isArray(t.likes) ? t.likes.length : 0;
      const monthPlays = monthlyMap.get(id) || 0;
      const score = monthPlays * 2 + likes * 3;
      return { id, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

async function ensureManualPlaylist({ title, description, createdBy }) {
  const existing = await Playlist.findOne({ title, isPublic: true, createdBy }).select('_id').lean();
  if (existing) return { title, action: 'exists' };
  await Playlist.create({
    title,
    description,
    isPublic: true,
    tracks: [],
    createdBy
  });
  return { title, action: 'created' };
}

async function upsertAutoPlaylist({ title, description, createdBy, trackIds }) {
  const playlist = await Playlist.findOne({ title, isPublic: true, createdBy });
  if (!playlist) {
    await Playlist.create({
      title,
      description,
      isPublic: true,
      tracks: trackIds,
      createdBy
    });
    return { title, action: 'created', tracks: trackIds.length };
  }
  playlist.description = description;
  playlist.tracks = trackIds;
  await playlist.save();
  return { title, action: 'updated', tracks: trackIds.length };
}

async function syncHybridPlaylists({ adminUserId, onlyAutoTypes = null, includeManual = true }) {
  const [weekly, hot, community, monthly] = await Promise.all([
    getWeeklyTrendingTracks(),
    getNewAndHotTracks(),
    getCommunityFindTracks(),
    getMonthlyReleaseTracks()
  ]);

  const autoByType = {
    weeklyTrending: weekly,
    newAndHot: hot,
    communityFinds: community,
    monthlyReleases: monthly
  };

  const targetAutoDefs = Array.isArray(onlyAutoTypes) && onlyAutoTypes.length
    ? AUTO_DEFINITIONS.filter((d) => onlyAutoTypes.includes(d.type))
    : AUTO_DEFINITIONS;

  const autoResults = [];
  for (const def of targetAutoDefs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await upsertAutoPlaylist({
      title: def.title,
      description: def.description,
      createdBy: adminUserId,
      trackIds: autoByType[def.type] || []
    });
    autoResults.push(r);
  }

  const manualResults = [];
  if (includeManual) {
    for (const def of MANUAL_DEFINITIONS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ensureManualPlaylist({
        title: def.title,
        description: def.description,
        createdBy: adminUserId
      });
      manualResults.push(r);
    }
  }

  return {
    auto: autoResults,
    manual: manualResults
  };
}

module.exports = {
  syncHybridPlaylists
};
