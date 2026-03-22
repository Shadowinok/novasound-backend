const rateLimit = require('express-rate-limit');

const msg = { message: 'Слишком много запросов с этого адреса. Подождите немного и попробуйте снова.' };

const skipAll = () => process.env.RATE_LIMIT_DISABLED === '1';

/** POST /api/tracks — загрузка трека: лимит с одного IP в час */
exports.trackUploadIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_TRACK_UPLOAD_IP_PER_HOUR || 30),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll,
  handler: (req, res) => {
    res.status(429).json({
      message:
        'Слишком много загрузок треков с этого адреса за час. Подождите и попробуйте снова.'
    });
  }
});

/** POST /api/tracks — загрузка трека: лимит на пользователя в сутки */
exports.trackUploadUserLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_TRACK_UPLOAD_USER_PER_DAY || 15),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll,
  keyGenerator: (req) => {
    if (req.user && req.user._id) return `track-upload-user:${req.user._id.toString()}`;
    return `track-upload-user:ip:${req.ip}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      message:
        'Достигнут дневной лимит загрузок треков для аккаунта. Завтра снова или напишите в поддержку.'
    });
  }
});

/** Смена обложки: лимит по IP в час */
exports.coverReplaceIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_COVER_IP_PER_HOUR || 60),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Слишком много смен обложки с этого адреса за час. Подождите немного.'
    });
  }
});

/** Смена обложки: лимит на пользователя в сутки */
exports.coverReplaceUserLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_COVER_USER_PER_DAY || 40),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll,
  keyGenerator: (req) => {
    if (req.user && req.user._id) return `cover-user:${req.user._id.toString()}`;
    return `cover-user:ip:${req.ip}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      message: 'Достигнут дневной лимит смен обложки для аккаунта.'
    });
  }
});

/** Регистрация: не больше N аккаунтов с одного IP в час */
exports.registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_REGISTER_PER_HOUR || 15),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll
});

/** Вход: защита от перебора пароля */
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_PER_15MIN || 30),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll
});

/** Повторная отправка письма (дополнительно к кулдауну в БД) */
exports.resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_RESEND_PER_15MIN || 10),
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAll
});
