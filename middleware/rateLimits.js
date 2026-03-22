const rateLimit = require('express-rate-limit');

const msg = { message: 'Слишком много запросов с этого адреса. Подождите немного и попробуйте снова.' };

/** Регистрация: не больше N аккаунтов с одного IP в час */
exports.registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_REGISTER_PER_HOUR || 15),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1'
});

/** Вход: защита от перебора пароля */
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_PER_15MIN || 30),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1'
});

/** Повторная отправка письма (дополнительно к кулдауну в БД) */
exports.resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_RESEND_PER_15MIN || 10),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1'
});
