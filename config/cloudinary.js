/**
 * ВАЖНО: любой require('cloudinary') читает CLOUDINARY_URL из process.env.
 * Если там https://... или мусор — SDK падает при старте. Чиним env ДО require.
 */
(function sanitizeCloudinaryEnv() {
  // Убираем кавычки и угловые скобки (часто копируют <8354...> из примеров)
  const trim = (s) =>
    s == null
      ? ''
      : String(s)
          .trim()
          .replace(/^['"]+|['"]+$/g, '')
          .replace(/[<>]/g, '');
  ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].forEach((k) => {
    if (process.env[k]) process.env[k] = trim(process.env[k]);
  });
  const v = process.env.CLOUDINARY_URL;
  if (!v) return;
  const t = trim(v);
  process.env.CLOUDINARY_URL = t;
  if (!t.toLowerCase().startsWith('cloudinary://')) {
    console.warn(
      '[Cloudinary] CLOUDINARY_URL должен начинаться с cloudinary:// (в Cloudinary: Dashboard → API Keys → скопируй строку «environment variable», не URL из браузера). Неверное значение отключено — задай исправленную строку или три переменные CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET.'
    );
    delete process.env.CLOUDINARY_URL;
  }
})();

const cloudinary = require('cloudinary').v2;

/**
 * Сначала три явные переменные — иначе старая/ошибочная CLOUDINARY_URL перебивает правильные ключи.
 * CLOUDINARY_URL — только если трёх переменных нет.
 */
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  console.log('[Cloudinary] Режим: CLOUDINARY_CLOUD_NAME + API_KEY + API_SECRET');
} else if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
  console.log('[Cloudinary] Режим: CLOUDINARY_URL');
} else {
  console.error(
    '[Cloudinary] Задай в Render CLOUDINARY_URL (= cloudinary://...) или три переменные CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET'
  );
}

module.exports = cloudinary;
