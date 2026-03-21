const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ message: 'Не авторизован' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ message: 'Пользователь не найден' });
    if (user.isBlocked) return res.status(403).json({ message: 'Аккаунт заблокирован' });
    if (user.emailVerified === false) return res.status(403).json({ message: 'Подтвердите email' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Недействительный токен' });
  }
};

/**
 * Стрим аудио: браузерный <audio> не шлёт Authorization, поэтому допускаем JWT в ?token=
 * (только для GET /tracks/audio/..., подключайте этот middleware только там).
 */
exports.protectStream = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token && req.query.token) {
    token = String(req.query.token);
  }
  if (!token) {
    return res.status(401).json({ message: 'Войдите, чтобы слушать музыку' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ message: 'Пользователь не найден' });
    if (user.isBlocked) return res.status(403).json({ message: 'Аккаунт заблокирован' });
    if (user.emailVerified === false) return res.status(403).json({ message: 'Подтвердите email' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Недействительный токен' });
  }
};

exports.optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (user && !user.isBlocked && user.emailVerified !== false) req.user = user;
  } catch (_) {}
  next();
};

exports.adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Доступ только для администратора' });
  }
  next();
};
