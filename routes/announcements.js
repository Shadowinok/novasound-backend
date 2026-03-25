const express = require('express');
const Track = require('../models/Track');
const Announcement = require('../models/Announcement');
const { XMLParser } = require('fast-xml-parser');

const router = express.Router();

// Русские ленты (главное требование — русский язык).
// Используем news.google.com RSS поиск с ru-RU параметрами: обычно заголовки на русском,
// плюс ниже фильтруем по кириллице, чтобы не проскакивал английский.
const AI_FEEDS = [
  {
    source: 'ИИ',
    kind: 'ai-news',
    // Минус-слова убирают политику/войну ещё на уровне выдачи.
    url: 'https://news.google.com/rss/search?q=%D0%B8%D1%81%D0%BA%D1%83%D1%81%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%20%D0%B8%D0%BD%D1%82%D0%B5%D0%BB%D0%BB%D0%B5%D0%BA%D1%82%20OR%20%D0%BD%D0%B5%D0%B9%D1%80%D0%BE%D1%81%D0%B5%D1%82%D1%8C%20OR%20ChatGPT%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%B1%D0%BE%D0%B9%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B1%D0%B5%D1%81%D0%BF%D0%B8%D0%BB%D0%BE%D1%82%D0%BD%D0%B8%D0%BA%20-%D0%B4%D1%80%D0%BE%D0%BD%20-%D1%81%D0%B0%D0%BD%D0%BA%D1%86%D0%B8%D0%B8%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B%20-%D0%B4%D0%B5%D0%BF%D1%83%D1%82%D0%B0%D1%82&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'ИИ-музыка',
    kind: 'ai-music-news',
    url: 'https://news.google.com/rss/search?q=%D0%B8%D0%B8%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20OR%20%D0%BD%D0%B5%D0%B9%D1%80%D0%BE%D1%81%D0%B5%D1%82%D1%8C%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20OR%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20%D1%81%20%D0%BF%D0%BE%D0%BC%D0%BE%D1%89%D1%8C%D1%8E%20%D0%B8%D0%B8%20OR%20AI%20music%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B&hl=ru&gl=RU&ceid=RU:ru'
  }
];

const WEATHER_POINTS = [
  { city: 'Москва', lat: 55.7558, lon: 37.6176 },
  { city: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351 },
  { city: 'Новосибирск', lat: 55.0084, lon: 82.9357 },
  { city: 'Екатеринбург', lat: 56.8389, lon: 60.6057 },
  { city: 'Казань', lat: 55.7961, lon: 49.1064 },
  { city: 'Владивосток', lat: 43.1155, lon: 131.8855 },
  { city: 'Хабаровск', lat: 48.4802, lon: 135.0719 }
];

async function fetchWeatherPoint(point) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}&current=temperature_2m,wind_speed_10m&timezone=auto`;
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const temp = Number(data?.current?.temperature_2m);
    if (!Number.isFinite(temp)) return null;
    return {
      kind: 'weather',
      city: point.city,
      temperatureC: Math.round(temp),
      windSpeed: Number.isFinite(Number(data?.current?.wind_speed_10m))
        ? Math.round(Number(data.current.wind_speed_10m))
        : null
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const aiCache = {
  updatedAtMs: 0,
  items: []
};

function safeText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function looksRussian(text) {
  return /[А-Яа-яЁё]/.test(String(text || ''));
}

function stripGoogleNewsSuffix(title) {
  // В Google News часто "Заголовок - Издание"
  const t = safeText(title);
  const idx = t.lastIndexOf(' - ');
  if (idx > 15) return t.slice(0, idx).trim();
  return t;
}

function isPoliticalOrWarJunk(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return true;
  const bad = [
    // война/боевые
    'войн', 'фронт', 'ракета', 'снаряд', 'удар', 'атака', 'обстрел', 'пво',
    'армия', 'минобороны', 'генштаб', 'военн', 'мобилизац', 'наёмник', 'батальон',
    'дрон', 'беспилот', 'fpv',
    // политика/власть/санкции
    'правительств', 'президент', 'губернатор', 'депутат', 'партия', 'выбор', 'митинг',
    'санкц', 'закон', 'суд', 'прокуратур', 'полици', 'фсб', 'мвд',
    // "в регионе внедряют" (то, что ты описал)
    'област', 'крае', 'республик', 'администрац', 'мэр', 'дум',
    // геополитика/конфликты (часто в заголовках)
    'украин', 'киев', 'донбасс', 'нато', 'израил', 'палестин', 'иран', 'сирия'
  ];
  return bad.some((k) => t.includes(k));
}

function acceptAiTitle(title) {
  const clean = stripGoogleNewsSuffix(title);
  if (!looksRussian(clean)) return false;
  if (isPoliticalOrWarJunk(clean)) return false;
  return true;
}

function pickFirstLink(entry) {
  if (!entry) return '';
  const link = entry.link;
  if (!link) return '';
  if (typeof link === 'string') return link;
  // Atom: link can be array of { '@_href': '...' }
  if (Array.isArray(link)) {
    const href = link.map((x) => x?.['@_href']).find(Boolean);
    return href ? String(href) : '';
  }
  if (typeof link === 'object' && link['@_href']) return String(link['@_href']);
  return '';
}

function parseFeedItems(xml, source, kind = 'ai-news') {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (_) {
    return [];
  }

  // RSS 2.0
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    return arr
      .map((it) => {
        const titleRaw = safeText(it?.title);
        const title = stripGoogleNewsSuffix(titleRaw);
        const link = safeText(it?.link);
        const pub = safeText(it?.pubDate) || safeText(it?.published) || safeText(it?.updated);
        if (!title) return null;
        if (!acceptAiTitle(title)) return null;
        return { kind, source, title, link, publishedAt: pub || null };
      })
      .filter(Boolean);
  }

  // Atom
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries) {
    const arr = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    return arr
      .map((e) => {
        const titleRaw = safeText(e?.title);
        const title = stripGoogleNewsSuffix(titleRaw);
        const link = pickFirstLink(e);
        const pub = safeText(e?.published) || safeText(e?.updated);
        if (!title) return null;
        if (!acceptAiTitle(title)) return null;
        return { kind, source, title, link, publishedAt: pub || null };
      })
      .filter(Boolean);
  }

  return [];
}

async function fetchAiFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'NovaSound/1.0 (+announcements ticker)' }
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    return parseFeedItems(xml, feed.source, feed.kind || 'ai-news');
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function getAiNewsCached(maxItems = 8) {
  const ttlMs = 10 * 60 * 1000;
  const now = Date.now();
  if (aiCache.updatedAtMs && (now - aiCache.updatedAtMs) < ttlMs && Array.isArray(aiCache.items)) {
    return aiCache.items.slice(0, maxItems);
  }

  const results = await Promise.all(AI_FEEDS.map(fetchAiFeed));
  const merged = results.flat();

  // Уберём дубликаты по title (и снова проверим русский)
  const seen = new Set();
  const deduped = [];
  for (const it of merged) {
    const title = stripGoogleNewsSuffix(it.title);
    if (!acceptAiTitle(title)) continue;
    const key = safeText(title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...it,
      title: safeText(title).slice(0, 140)
    });
    if (deduped.length >= maxItems) break;
  }

  aiCache.updatedAtMs = now;
  aiCache.items = deduped;
  return deduped;
}

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

    const items = [];
    const hasRadio = !!tracksForCycle.length;
    // Сначала — эфир (чтобы лента всегда начиналась с "В эфире/офлайн").
    if (nowTrack) {
      items.push({
        kind: 'radio',
        trackId: nowTrack._id,
        title: nowTrack.title,
        author: nowTrack.author?.username || 'Автор',
        offsetSec: nowOffsetSec
      });
    } else if (!hasRadio) {
      items.push({
        kind: 'radio-offline',
        trackId: null,
        title: 'Эфир оффлайн',
        author: '',
        offsetSec: 0
      });
    }
    // 1) админские анонсы (закреп + срок жизни)
    const now = new Date();
    const manual = await Announcement.find({
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    })
      .populate('trackId', 'title author')
      .sort({ pinned: -1, pinnedOrder: 1, createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 12)))
      .lean();

    for (const a of manual) {
      items.push({
        kind: 'announcement',
        announcementId: a._id,
        title: a.title,
        message: a.message || '',
        trackId: a.trackId?._id || null
      });
    }

    // 2) новости по ИИ (на русском, кешируются)
    try {
      const aiNews = await getAiNewsCached(10);
      if (aiNews.length) items.push(...aiNews);
    } catch (_) {}

    // 3) новинки для заполнения лимита
    const latestNeeded = Math.max(0, limit - items.length);
    const latestTracks = latestNeeded
      ? await Track.find({ status: 'approved' })
        .select('-coverImagePending -coverChangeStatus -coverModerationComment')
        .populate('author', 'username')
        .sort({ createdAt: -1 })
        .limit(latestNeeded + 2)
        .lean()
      : [];

    const latestFiltered = nowTrack
      ? latestTracks.filter((t) => String(t._id) !== String(nowTrack._id)).slice(0, latestNeeded)
      : latestTracks.slice(0, latestNeeded);

    items.push(
      ...latestFiltered.map((t) => ({
        kind: 'new-track',
        trackId: t._id,
        title: t.title,
        author: t.author?.username || 'Автор',
        createdAt: t.createdAt
      }))
    );

    // 4) погода по ключевым городам + Хабаровск
    const weatherRows = await Promise.all(WEATHER_POINTS.map(fetchWeatherPoint));
    const weatherItems = weatherRows.filter(Boolean);
    if (weatherItems.length) items.push(...weatherItems);

    res.json({ items, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

