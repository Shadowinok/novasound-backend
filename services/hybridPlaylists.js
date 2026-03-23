const Playlist = require('../models/Playlist');
const Track = require('../models/Track');
const ListenLog = require('../models/ListenLog');
const mongoose = require('mongoose');

const makeSystemKey = () => `pl_${new mongoose.Types.ObjectId().toString()}`;

const AUTO_DEFINITIONS = [
  {
    systemKey: 'auto_weekly_trending',
    title: 'Тренды недели',
    description: 'Самое слушаемое за последние 7 дней.',
    type: 'weeklyTrending'
  },
  {
    systemKey: 'auto_new_and_hot',
    title: 'Новые и горячие',
    description: 'Свежие треки с самым быстрым ростом прослушиваний.',
    type: 'newAndHot'
  },
  {
    systemKey: 'auto_community_finds',
    title: 'Открытия комьюнити',
    description: 'Недооцененные треки с сильной поддержкой слушателей.',
    type: 'communityFinds'
  },
  {
    systemKey: 'auto_monthly_releases',
    title: 'Релизы месяца',
    description: 'Лучшие релизы за текущий месяц.',
    type: 'monthlyReleases'
  },
  {
    systemKey: 'auto_evergreen_hits',
    title: 'Вечный хит',
    description: 'Треки с устойчивой популярностью и долгим интересом слушателей.',
    type: 'evergreenHits'
  }
];

const MANUAL_DEFINITIONS = [];

const GENRE_PLAYLISTS = [
  { systemKey: 'auto_genre_rock_metal', title: 'Рок / Металл', description: 'Энергичный гитарный звук: рок и металл.', genre: 'rock-metal' },
  { systemKey: 'auto_genre_pop', title: 'Поп', description: 'Поп-мелодии и хиты.', genre: 'pop' },
  { systemKey: 'auto_genre_jazz', title: 'Джаз', description: 'Джазовые гармонии и импровизация.', genre: 'jazz' },
  { systemKey: 'auto_genre_hiphop_rap', title: 'Хип-хоп / Рэп', description: 'Биты, речитатив и уличная энергия.', genre: 'hiphop-rap' },
  { systemKey: 'auto_genre_electronic', title: 'Электроника', description: 'EDM, synth и электронные вайбы.', genre: 'electronic' }
];

const SYSTEM_DEFINITIONS = [...AUTO_DEFINITIONS, ...GENRE_PLAYLISTS];
const CANONICAL_SYSTEM_KEY_BY_TITLE = new Map(SYSTEM_DEFINITIONS.map((d) => [d.title, d.systemKey]));
const CANONICAL_SYSTEM_KEYS = new Set(SYSTEM_DEFINITIONS.map((d) => d.systemKey));

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

async function getEvergreenHitTracks(limit = 40) {
  const now = new Date();
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const d90 = daysAgo(90);

  const [lastWeekMap, monthTailMap] = await Promise.all([
    playMapByPeriod(d7, now),
    playMapByPeriod(d30, d7)
  ]);

  const tracks = await Track.find({
    status: 'approved',
    createdAt: { $lte: d30, $gte: d90 }
  })
    .select('_id plays likes dislikes createdAt')
    .lean();

  return tracks
    .map((t) => {
      const id = String(t._id);
      const weekPlays = lastWeekMap.get(id) || 0;
      const monthTailPlays = monthTailMap.get(id) || 0;
      const likes = Array.isArray(t.likes) ? t.likes.length : 0;
      const dislikes = Array.isArray(t.dislikes) ? t.dislikes.length : 0;
      const totalPlays = Number(t.plays) || 0;
      const engagement = likes / Math.max(totalPlays, 1);
      // "Вечный хит": не разовый всплеск, а стабильный интерес + норм вовлеченность.
      const stability = Math.min(weekPlays, monthTailPlays);
      const score = stability * 3 + weekPlays + monthTailPlays + engagement * 120 - dislikes * 2;
      return { id, score, weekPlays, monthTailPlays };
    })
    .filter((x) => x.weekPlays >= 4 && x.monthTailPlays >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

function fallbackGenreKeywords(genreCode, text = '') {
  const t = String(text || '').toLowerCase();
  if (genreCode === 'rock-metal') return /\b(rock|metal|alt rock|hard rock|grunge|гитар|рок|метал)\b/i.test(t);
  if (genreCode === 'pop') return /\b(pop|dance pop|поп)\b/i.test(t);
  if (genreCode === 'jazz') return /\b(jazz|swing|smooth jazz|джаз)\b/i.test(t);
  if (genreCode === 'hiphop-rap') return /\b(hip[- ]?hop|rap|trap|drill|рэп|хип[- ]?хоп)\b/i.test(t);
  if (genreCode === 'electronic') return /\b(edm|electro|electronic|house|techno|trance|synth|dnb|electro|электро)\b/i.test(t);
  return false;
}

async function getGenreTracks(genreCode, limit = 60) {
  const exact = await Track.find({ status: 'approved', genre: genreCode })
    .select('_id plays likes createdAt title description')
    .sort({ plays: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  if (exact.length >= Math.floor(limit * 0.7)) {
    return exact.map((t) => String(t._id));
  }
  // Полуавтомат: если старые треки без genre, добираем по ключевым словам.
  const loose = await Track.find({ status: 'approved' })
    .select('_id plays likes createdAt title description genre')
    .sort({ plays: -1, createdAt: -1 })
    .limit(300)
    .lean();
  const fromKeywords = loose.filter((t) => {
    if (String(t.genre || '') === genreCode) return true;
    const text = `${t.title || ''} ${t.description || ''}`;
    return fallbackGenreKeywords(genreCode, text);
  });
  const uniq = [];
  const seen = new Set();
  for (const t of [...exact, ...fromKeywords]) {
    const id = String(t._id);
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
    if (uniq.length >= limit) break;
  }
  return uniq;
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

async function upsertAutoPlaylist({ systemKey, title, description, createdBy, trackIds }) {
  const playlist = await Playlist.findOne({ systemKey, isPublic: true, createdBy });
  if (!playlist) {
    await Playlist.create({
      systemKey,
      title,
      description,
      isPublic: true,
      tracks: trackIds,
      createdBy
    });
    return { title, systemKey, action: 'created', tracks: trackIds.length };
  }
  if (!String(playlist.systemKey || '').trim()) playlist.systemKey = systemKey || makeSystemKey();
  playlist.description = description;
  playlist.tracks = trackIds;
  await playlist.save();
  return { title, systemKey, action: 'updated', tracks: trackIds.length };
}

async function ensureAdminPublicSystemKeys(adminUserId) {
  // Миграция: у старых системных плейлистов мог быть случайный systemKey -> привязываем к каноничному по title.
  for (const [title, systemKey] of CANONICAL_SYSTEM_KEY_BY_TITLE.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const sameTitle = await Playlist.find({
      createdBy: adminUserId,
      isPublic: true,
      title
    })
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .select('_id systemKey')
      .lean();

    if (!sameTitle.length) continue;

    const keeper = sameTitle.find((p) => String(p.systemKey || '') === systemKey) || sameTitle[0];
    // eslint-disable-next-line no-await-in-loop
    await Playlist.updateOne({ _id: keeper._id }, { $set: { systemKey } });

    const duplicateIds = sameTitle
      .filter((p) => String(p._id) !== String(keeper._id))
      .map((p) => p._id);

    if (duplicateIds.length) {
      // eslint-disable-next-line no-await-in-loop
      await Playlist.deleteMany({ _id: { $in: duplicateIds } });
    }
  }

  // На случай, если дубли уже есть по одному и тому же systemKey.
  for (const systemKey of CANONICAL_SYSTEM_KEYS) {
    // eslint-disable-next-line no-await-in-loop
    const sameKey = await Playlist.find({
      createdBy: adminUserId,
      isPublic: true,
      systemKey
    })
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .select('_id')
      .lean();
    if (sameKey.length <= 1) continue;
    const duplicateIds = sameKey.slice(1).map((p) => p._id);
    // eslint-disable-next-line no-await-in-loop
    await Playlist.deleteMany({ _id: { $in: duplicateIds } });
  }

  const rows = await Playlist.find({
    createdBy: adminUserId,
    isPublic: true,
    $or: [{ systemKey: { $exists: false } }, { systemKey: '' }]
  }).select('_id').lean();
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await Playlist.updateOne({ _id: row._id }, { $set: { systemKey: makeSystemKey() } });
  }
}

async function syncHybridPlaylists({
  adminUserId,
  onlyAutoTypes = null,
  includeManual = true,
  includeGenreAuto = true
}) {
  const [weekly, hot, community, monthly, evergreen] = await Promise.all([
    getWeeklyTrendingTracks(),
    getNewAndHotTracks(),
    getCommunityFindTracks(),
    getMonthlyReleaseTracks(),
    getEvergreenHitTracks()
  ]);
  await ensureAdminPublicSystemKeys(adminUserId);

  const autoByType = {
    weeklyTrending: weekly,
    newAndHot: hot,
    communityFinds: community,
    monthlyReleases: monthly,
    evergreenHits: evergreen
  };

  const targetAutoDefs = Array.isArray(onlyAutoTypes) && onlyAutoTypes.length
    ? AUTO_DEFINITIONS.filter((d) => onlyAutoTypes.includes(d.type))
    : AUTO_DEFINITIONS;

  const autoResults = [];
  for (const def of targetAutoDefs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await upsertAutoPlaylist({
      systemKey: def.systemKey,
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

  const genreResults = [];
  if (includeGenreAuto) {
    for (const g of GENRE_PLAYLISTS) {
      // eslint-disable-next-line no-await-in-loop
      const trackIds = await getGenreTracks(g.genre);
      // eslint-disable-next-line no-await-in-loop
      const r = await upsertAutoPlaylist({
        systemKey: g.systemKey,
        title: g.title,
        description: g.description,
        createdBy: adminUserId,
        trackIds
      });
      genreResults.push(r);
    }
  }

  // Удаляем устаревший плейлист сценариев (если был создан гибридом раньше).
  if (includeGenreAuto) {
    await Playlist.deleteMany({
      title: { $in: ['Для сценариев', 'По жанрам/настроениям'] },
      createdBy: adminUserId
    });
  }

  return {
    auto: autoResults,
    genre: genreResults,
    manual: manualResults
  };
}

module.exports = {
  syncHybridPlaylists
};
