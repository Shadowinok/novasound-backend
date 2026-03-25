const express = require('express');
const Track = require('../models/Track');
const Announcement = require('../models/Announcement');
const RadioHostSettings = require('../models/RadioHostSettings');
const { XMLParser } = require('fast-xml-parser');

const router = express.Router();

// Русские ленты (главное требование — русский язык).
// Используем news.google.com RSS поиск с ru-RU параметрами: обычно заголовки на русском,
// плюс ниже фильтруем по кириллице, чтобы не проскакивал английский.
const AI_FEEDS = [
  {
    source: 'ИИ-креатив',
    kind: 'ai-creative-news',
    // Минус-слова убирают политику/войну ещё на уровне выдачи.
    url: 'https://news.google.com/rss/search?q=%D0%B8%D1%81%D0%BA%D1%83%D1%81%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%20%D0%B8%D0%BD%D1%82%D0%B5%D0%BB%D0%BB%D0%B5%D0%BA%D1%82%20OR%20%D0%BD%D0%B5%D0%B9%D1%80%D0%BE%D1%81%D0%B5%D1%82%D1%8C%20OR%20ChatGPT%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%B1%D0%BE%D0%B9%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B1%D0%B5%D1%81%D0%BF%D0%B8%D0%BB%D0%BE%D1%82%D0%BD%D0%B8%D0%BA%20-%D0%B4%D1%80%D0%BE%D0%BD%20-%D1%81%D0%B0%D0%BD%D0%BA%D1%86%D0%B8%D0%B8%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B%20-%D0%B4%D0%B5%D0%BF%D1%83%D1%82%D0%B0%D1%82&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'ИИ-музыка',
    kind: 'ai-music-news',
    url: 'https://news.google.com/rss/search?q=%D0%B8%D0%B8%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20OR%20%D0%BD%D0%B5%D0%B9%D1%80%D0%BE%D1%81%D0%B5%D1%82%D1%8C%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20OR%20%D0%BC%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%20%D1%81%20%D0%BF%D0%BE%D0%BC%D0%BE%D1%89%D1%8C%D1%8E%20%D0%B8%D0%B8%20OR%20AI%20music%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B&hl=ru&gl=RU&ceid=RU:ru'
  }
  ,
  {
    source: 'Игры',
    kind: 'gaming-news',
    url: 'https://news.google.com/rss/search?q=%D0%B8%D0%B3%D1%80%D1%8B%20OR%20%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE%D0%B8%D0%B3%D1%80%D1%8B%20OR%20%D0%B3%D0%B5%D0%B9%D0%BC%D0%BF%D0%BB%D0%B5%D0%B9%20%D0%BE%D0%B1%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20OR%20%D0%B2%20%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B5%20OR%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20OR%20%D1%82%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80%20OR%20%D1%80%D0%B5%D0%BB%D0%B8%D0%B7%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B4%D0%BE%D0%BD%D0%B1%D0%B0%D1%81%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'Кино',
    kind: 'film-news',
    url: 'https://news.google.com/rss/search?q=%D0%BA%D0%B8%D0%BD%D0%BE%20OR%20%D1%84%D0%B8%D0%BB%D1%8C%D0%BC%20OR%20%D1%81%D0%B5%D1%80%D0%B8%D0%B0%D0%BB%20OR%20%D0%BF%D1%80%D0%B5%D0%BC%D1%8C%D0%B5%D1%80%D0%B0%20OR%20%D1%82%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80%20OR%20%D1%81%D1%8A%D0%B5%D0%BC%D0%BA%D0%B8%20OR%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20OR%20%D0%BE%D0%B7%D0%B2%D1%83%D1%87%D0%BA%D0%B0%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B4%D0%BE%D0%BD%D0%B1%D0%B0%D1%81%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'Цифровая индустрия',
    kind: 'industry-news',
    url: 'https://news.google.com/rss/search?q=%D1%86%D0%B8%D1%84%D1%80%D0%BE%D0%B2%D0%B0%D1%8F%20%D0%B8%D0%BD%D0%B4%D1%83%D1%81%D1%82%D1%80%D0%B8%D1%8F%20OR%20%D0%B2%20%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B5%20OR%20%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D0%B8%D1%82%D1%81%D1%8F%20%D0%BA%20%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D1%83%20OR%20%D1%80%D0%B5%D0%BB%D0%B8%D0%B7%20OR%20%D0%BE%D0%B1%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20OR%20%D0%B0%D0%BF%D0%B4%D0%B5%D0%B9%D1%82%20OR%20%D1%82%D0%B5%D1%85%D0%BD%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D0%B8%20OR%20%D0%B2%D1%8B%D0%BF%D1%83%D1%81%D0%BA%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B4%D0%BE%D0%BD%D0%B1%D0%B0%D1%81%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'Софтовые сервисы',
    kind: 'software-news',
    url: 'https://news.google.com/rss/search?q=%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5%20OR%20%D1%81%D0%B5%D1%80%D0%B2%D0%B8%D1%81%20OR%20%D0%BF%D0%BB%D0%B0%D1%82%D1%84%D0%BE%D1%80%D0%BC%D0%B0%20OR%20%D0%BE%D0%B1%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20OR%20%D0%B0%D0%BF%D0%B4%D0%B5%D0%B9%D1%82%20OR%20%D1%80%D0%B5%D0%BB%D0%B8%D0%B7%20OR%20%D1%84%D0%B8%D1%87%D0%B0%20OR%20SDK%20OR%20API%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D1%81%D0%B0%D0%BD%D0%BA%D1%86%D0%B8%D0%B8%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'Роботы',
    kind: 'robots-news',
    url: 'https://news.google.com/rss/search?q=%D1%80%D0%BE%D0%B1%D0%BE%D1%82%20OR%20%D1%80%D0%BE%D0%B1%D0%BE%D1%82%D0%BE%D1%82%D0%B5%D1%85%D0%BD%D0%B8%D0%BA%D0%B0%20OR%20%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%B0%D1%82%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%8F%20OR%20%D0%BC%D0%B5%D1%85%D0%B0%D1%82%D1%80%D0%BE%D0%BD%D0%B8%D0%BA%D0%B0%20OR%20%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%B0%D1%82%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B0%D1%8F%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D0%B4%D0%BE%D0%BD%D0%B1%D0%B0%D1%81%20-%D1%81%D0%B0%D0%BD%D0%BA%D1%86%D0%B8%D0%B8%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B%20-%D0%B1%D0%B5%D1%81%D0%BF%D0%B8%D0%BB%D0%BE%D1%82%D0%BD%D1%8B%D0%B9%20-%D0%B4%D1%80%D0%BE%D0%BD%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE&hl=ru&gl=RU&ceid=RU:ru'
  },
  {
    source: 'Релизы и индустрия',
    kind: 'releases-news',
    url: 'https://news.google.com/rss/search?q=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7%20OR%20%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D0%B8%D1%82%20OR%20%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D0%B8%D1%82%D1%81%D1%8F%20OR%20%D0%B2%D1%8B%D0%B9%D0%B4%D1%83%D1%82%20OR%20%D0%B0%D0%BD%D0%BE%D0%BD%D1%81%20OR%20%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D0%B8%D1%82%D1%81%D1%8F%20%D0%BA%20%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D1%83%20OR%20%D0%BE%D0%B1%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20OR%20%D0%B0%D0%BF%D0%B4%D0%B5%D0%B9%D1%82%20OR%20%D0%B2%D1%8B%D0%BF%D1%83%D1%81%D0%BA%20-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0%20-%D0%B0%D1%80%D0%BC%D0%B8%D1%8F%20-%D0%BC%D0%B8%D0%BD%D0%BE%D0%B1%D0%BE%D1%80%D0%BE%D0%BD%D1%8B%20-%D1%81%D0%B0%D0%BD%D0%BA%D1%86%D0%B8%D0%B8%20-%D0%B2%D1%8B%D0%B1%D0%BE%D1%80%D1%8B%20-%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE%20-%D0%B4%D0%BE%D0%BD%D0%B1%D0%B0%D1%81&hl=ru&gl=RU&ceid=RU:ru'
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

function normalizeNewsTitle(title) {
  const base = stripGoogleNewsSuffix(title)
    .toLowerCase()
    .replace(/[«»"“”'`]/g, ' ')
    .replace(/[.,!?;:()[\]{}|\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Служебные/частые слова, не влияющие на смысл заголовка.
  const stop = new Set([
    'в', 'во', 'на', 'и', 'или', 'к', 'по', 'про', 'для', 'с', 'со', 'из', 'о', 'об',
    'от', 'до', 'за', 'над', 'под', 'не', 'это', 'как', 'что', 'кто', 'где', 'у', 'а',
    'но', 'же', 'ли', 'the'
  ]);
  const tokens = base.split(' ').filter((w) => w && !stop.has(w));
  return tokens.join(' ');
}

function titleTokenSet(title) {
  return new Set(normalizeNewsTitle(title).split(' ').filter(Boolean));
}

function areTitlesNearDuplicate(a, b) {
  const na = normalizeNewsTitle(a);
  const nb = normalizeNewsTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Вложенность (один заголовок — расширенная версия другого)
  if (na.length > 28 && nb.length > 28 && (na.includes(nb) || nb.includes(na))) return true;

  const sa = titleTokenSet(na);
  const sb = titleTokenSet(nb);
  if (!sa.size || !sb.size) return false;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  const jaccard = union > 0 ? inter / union : 0;

  // Достаточно строгий порог, чтобы не склеивать разные новости.
  return jaccard >= 0.78;
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

function containsMusicKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    'музык', 'музыка', 'песн', 'трек', 'аудио', 'звук', 'голос', 'подкаст', 'композ',
    'аранжир', 'саунд', 'концерт', 'исполнител', 'студ', 'сведение', 'master'
  ];
  return good.some((k) => t.includes(k));
}

function containsCreativeKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    // Для креатива: важно, чтобы это выглядело как медиа/визуал/озвучка.
    // Если это не “визуальный”/“медийный” креатив — всё равно отфильтруем на unwanted-темах.
    'нейросет', 'генерац', 'изображ', 'картин', 'обложк', 'дизайн', 'постер', 'арт',
    'видео', 'ролик', 'монтаж', 'озвучк', 'диктор', '3d', 'рендер', 'анимац'
  ];
  return good.some((k) => t.includes(k));
}

function isUnwantedAiTopic(title, kind) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;

  // Это то, что ты прямо просил выкинуть.
  // Применяем только к "ИИ-креатив", чтобы не резать игровое/киношное/музыкальное.
  if (kind === 'ai-creative-news') {
    const bad = [
      // образование
      'школ', 'учеб', 'образован', 'за парт',
      // наркотики/пропаганда
      'наркот', 'пропаганд',
      // граффити/нелегальная реклама
      'графит', 'граффит', 'реклам', 'нелегальн',
      // фонды/стартапы/агенты
      'фонд', 'стартап', 'агент'
    ];
    if (bad.some((k) => t.includes(k))) return true;

    // "обложка книги ... искусственный интеллект" — выкидываем по примеру.
    if (t.includes('обложк') && (t.includes('книга') || t.includes('книг'))) {
      const hasAiAngle = t.includes('искусствен') || t.includes('интеллект') || t.includes('ии') || t.includes('нейросет');
      if (hasAiAngle) return true;
    }
  }

  return false;
}

function containsGameKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    // максимально “игровые” маркеры
    'игр', 'игра', 'геймплей', 'трейлер', 'консоль', 'steam', 'vr', 'ar',
    'патч', 'апдей', 'обновлен', 'релиз', 'выйдет', 'выпуск', 'студ', 'разработ'
  ];
  return good.some((k) => t.includes(k));
}

function containsFilmKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    // максимально “киношные” маркеры
    'кино', 'фильм', 'сериал', 'промьера', 'премьер', 'премьера', 'трейлер',
    'съёмк', 'съемк', 'съём', 'съем', 'снима', 'запис', 'озвучк', 'директор', 'режисс',
    'анимац', 'студия'
  ];
  return good.some((k) => t.includes(k));
}

function containsIndustryKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    // Индустрия: только про технологии/платформы, без “выйдет/релиз” (они слишком широкие).
    'цифров', 'индустр', 'технолог', 'платформ', 'облако', 'вычисл', 'алгоритм',
    'прилож', 'система', 'движок', 'архитект', 'проект', 'платёж'
  ];
  return good.some((k) => t.includes(k));
}

function containsSoftwareKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    // софт/сервисы: больше про “что именно” и меньше про “релиз вообще”
    'приложен', 'прилож', 'сервис', 'платформ', 'апдейт', 'фича',
    'sdk', 'api', 'функц', 'интеграц', 'библиотек', 'документац', 'верси'
  ];
  return good.some((k) => t.includes(k));
}

function containsRobotsKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;
  const good = [
    'робот', 'робото', 'робототехн', 'автоматизац', 'мехатрон', 'автономн',
    'модуль', 'манипулятор'
  ];
  return good.some((k) => t.includes(k));
}

function containsReleasesKeywords(title) {
  const t = safeText(title).toLowerCase();
  if (!t) return false;

  // Релизы: требуем и “про релиз”, и “про продукт/технологии”, чтобы не цеплять лишний мусор.
  const releaseWords = [
    'релиз', 'выйдет', 'выйдут', 'выходит', 'выпуск', 'анонс', 'готовитс', 'готовится',
    'апдейт', 'обновлен', 'представ', 'поступит', 'верси', 'патч', 'демо'
  ];

  const domainWords = [
    'технолог', 'платформ', 'софт', 'сервис', 'прилож', 'игр', 'кино', 'музык', 'аудио',
    'индустр', 'платёж', 'облако', 'sdk', 'api', 'движок', 'алгоритм', 'модель'
  ];

  const hasRelease = releaseWords.some((k) => t.includes(k));
  const hasDomain = domainWords.some((k) => t.includes(k));
  return hasRelease && hasDomain;
}

function acceptAiTitle(title, kind) {
  const clean = stripGoogleNewsSuffix(title);
  if (!looksRussian(clean)) return false;
  if (isPoliticalOrWarJunk(clean)) return false;
  if (isUnwantedAiTopic(clean, kind)) return false;
  // Разнообразим: 
  // - ai-music-news: только музыка/аудио
  // - ai-creative-news: только творчество (обложки, изображения, видео, озвучка и т.п.)
  if (kind === 'ai-music-news') return containsMusicKeywords(clean);
  if (kind === 'ai-creative-news') return containsCreativeKeywords(clean);
  if (kind === 'gaming-news') return containsGameKeywords(clean);
  if (kind === 'film-news') return containsFilmKeywords(clean);
  if (kind === 'industry-news') return containsIndustryKeywords(clean);
  if (kind === 'software-news') return containsSoftwareKeywords(clean);
  if (kind === 'robots-news') return containsRobotsKeywords(clean);
  if (kind === 'releases-news') return containsReleasesKeywords(clean);
  return containsMusicKeywords(clean);
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
        if (!acceptAiTitle(title, kind)) return null;
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
        if (!acceptAiTitle(title, kind)) return null;
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

  // Уберём дубли (точные и почти одинаковые по смыслу)
  const seen = new Set();
  const seenTitles = [];
  const deduped = [];
  for (const it of merged) {
    const title = stripGoogleNewsSuffix(it.title);
    if (!acceptAiTitle(title, it.kind)) continue;
    const key = normalizeNewsTitle(title);
    if (!key || seen.has(key)) continue;
    // Защита от “похожих дублей” между разными источниками.
    const isNearDup = seenTitles.some((prev) => areTitlesNearDuplicate(prev, title));
    if (isNearDup) continue;
    seen.add(key);
    seenTitles.push(title);
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

// Публичные настройки периодичности ведущего
router.get('/host-settings', async (req, res) => {
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
      randomMaxSongs: Number(settings.randomMaxSongs) || 5
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка чтения настроек ведущего' });
  }
});

// GET /api/announcements/tts?text=...
// Серверный нейро-TTS (Edge voices), чтобы не использовать механическую browser speech.
router.get('/tts', async (req, res) => {
  try {
    const { tts } = require('edge-tts');
    const raw = String(req.query.text || '').trim();
    const text = raw.slice(0, 420);
    if (!text) return res.status(400).json({ message: 'text required' });

    const requestedVoice = String(req.query.voice || '').trim();
    const voiceCandidates = [
      requestedVoice,
      'ru-RU-DmitryNeural',
      'ru-RU-MaximNeural',
      'ru-RU-PavelNeural'
    ].filter(Boolean);
    const rate = String(req.query.rate || '-2%').trim() || '-2%';
    let lastErr = null;

    for (const voice of voiceCandidates) {
      try {
        const mp3 = await tts(text, {
          voice,
          rate,
          volume: '+0%',
          pitch: '-2Hz'
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-TTS-Voice', voice);
        return res.send(Buffer.from(mp3));
      } catch (e) {
        lastErr = e;
      }
    }

    return res.status(502).json({ message: lastErr?.message || 'TTS provider unavailable' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'TTS error' });
  }
});

module.exports = router;

