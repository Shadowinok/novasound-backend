const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { containsProfanity } = require('../utils/profanityFilter');
const { sendEmail } = require('../utils/email');

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const createEmailVerifyToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// POST /api/auth/register
router.post('/register', [
  body('username').trim().isLength({ min: 2, max: 50 }).withMessage('Имя пользователя 2-50 символов'),
  body('email').isEmail().normalizeEmail().withMessage('Некорректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль минимум 6 символов'),
  body('acceptTerms').equals('true').withMessage('Нужно принять правила сервиса')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { username, email, password } = req.body;
    if (containsProfanity(username)) {
      return res.status(400).json({ message: 'Недопустимое имя пользователя' });
    }
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: 'Email или имя уже заняты' });
    const verifyToken = createEmailVerifyToken();
    const verifyTokenHash = hashToken(verifyToken);
    const user = await User.create({
      username,
      email,
      password,
      acceptedTerms: true,
      termsVersion: process.env.TERMS_VERSION || '1.0.0',
      emailVerified: false,
      emailVerifyTokenHash: verifyTokenHash,
      emailVerifyExpires: new Date(Date.now() + 1000 * 60 * 60 * 24)
    });

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      return res.status(500).json({ message: 'FRONTEND_URL is not configured' });
    }
    const verifyUrl = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${verifyToken}`;

    await sendEmail({
      to: user.email,
      subject: 'NovaSound — подтвердите email',
      text: `Подтвердите email: ${verifyUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5">
          <h2>Подтверждение email</h2>
          <p>Нажмите, чтобы подтвердить ваш email в NovaSound:</p>
          <p><a href="${verifyUrl}">Подтвердить email</a></p>
          <p>Ссылка действительна 24 часа.</p>
        </div>
      `
    });

    res.status(201).json({ message: 'Письмо с подтверждением отправлено. Проверьте почту.' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка регистрации' });
  }
});

// GET /api/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).json({ message: 'Нужен token' });
    const tokenHash = hashToken(token);
    const user = await User.findOne({
      emailVerifyTokenHash: tokenHash,
      emailVerifyExpires: { $gt: new Date() }
    });
    if (!user) return res.status(400).json({ message: 'Ссылка недействительна или устарела' });

    user.emailVerified = true;
    user.emailVerifyTokenHash = '';
    user.emailVerifyExpires = null;
    await user.save();

    res.json({ message: 'Email подтверждён. Теперь можно войти.' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка подтверждения' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const user = await User.findOne({ email: req.body.email }).select('+password');
    if (!user || !(await user.comparePassword(req.body.password))) {
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }
    if (user.isBlocked) return res.status(403).json({ message: 'Аккаунт заблокирован' });
    if (!user.emailVerified) return res.status(403).json({ message: 'Подтвердите email перед входом' });
    const token = generateToken(user._id);
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role, emailVerified: user.emailVerified }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка входа' });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
