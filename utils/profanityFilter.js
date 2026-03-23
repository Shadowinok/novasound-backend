/**
 * Текстовая модерация без внешних API: слова целиком + ограниченный набор стемов (обсценная морфология).
 * Не удаляем пробелы из всей строки — иначе ложные срабатывания («математика», «формат»).
 */

function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().replace(/ё/g, 'е');
}

/** Токены: кириллица и латиница */
function wordsFrom(text) {
  const n = normalize(text);
  return n.match(/[a-zа-я]{2,}/gi) || [];
}

/**
 * Целые слова (рус + англ), без «мат» внутри «математика».
 */
const EXACT_WORDS = new Set(
  [
    // English
    'fuck', 'fucks', 'fucking', 'fucked', 'shit', 'bitch', 'asshole', 'dick', 'cocksucker',
    'cunt', 'whore', 'slut', 'piss', 'nigger', 'nigga', 'retard',
    // Russian — короткие и устойчивые формы (пополнять по мере необходимости)
    'хуй', 'хуя', 'хуе', 'хуи', 'хуё', 'хуйло', 'хуйня', 'хер', 'херня', 'похуй', 'охуеть',
    'мат',
    'пизда', 'пизде', 'пизду', 'пиздец', 'ебать', 'ебёт', 'ебет', 'ебал', 'ебан', 'ебаный',
    'ебанут', 'ебнут', 'еблан', 'бля', 'блядь', 'бляди', 'сука', 'суки', 'сучара',
    'мудак', 'мудаки', 'мудило', 'пидор', 'пидоры', 'педик', 'гондон', 'залупа',
    'жопа', 'говно', 'дерьмо', 'сдохни', 'умри', 'ублюдок'
  ].map((w) => w.toLowerCase().replace(/ё/g, 'е'))
);

/**
 * Стемы ≥ 4 символов: внутри «токена», но не склеиваем всю строку.
 * Не включаем «мат» — ложноположительные в обычных словах.
 */
const STEMS_RU = [
  'пизд', 'ебан', 'ебат', 'ебёт', 'ебет', 'хуй', 'бляд', 'пидор', 'муда', 'залуп', 'гондон', 'уеб'
];

const STEMS_LATIN = ['fuck', 'shitc', 'bitch', 'cock', 'dick'];

function wordHitsProfanity(word) {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length < 2) return false;
  if (EXACT_WORDS.has(w)) return true;
  if (w.length >= 4) {
    if (STEMS_RU.some((s) => w.includes(s))) return true;
    if (STEMS_LATIN.some((s) => w.includes(s))) return true;
  }
  return false;
}

exports.containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;
  const words = wordsFrom(text);
  for (const word of words) {
    if (wordHitsProfanity(word)) return true;
  }
  return false;
};

/** Подозрительные темы (не обязательно мгновенный отказ — часто → pending) */
const SUSPICIOUS_SUBSTRINGS_RU = [
  'порно', '18+', 'наркот', 'суицид', 'взрыв', 'бомб', 'убий', 'убийство',
  'расизм', 'нацизм', 'экстрем', 'террор', 'докс', 'угроз', 'самоуб',
  'порн', 'насили', 'изнасил', 'педоф', 'цп', 'зоофил'
];

/** Латиница — только границы слов, чтобы не цеплять sussex → sex */
const SUSPICIOUS_Latin_WORD = /\b(sex|rape|porn|nazi|terror|bomb|kill|hate|cp|loli)\b/i;

exports.containsSuspiciousContent = (text) => {
  if (!text || typeof text !== 'string') return false;
  const lower = normalize(text);
  if (SUSPICIOUS_SUBSTRINGS_RU.some((k) => lower.includes(k))) return true;
  return SUSPICIOUS_Latin_WORD.test(text);
};
