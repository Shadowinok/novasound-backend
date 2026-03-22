require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { initGridFS } = require('./config/gridfs');

const authRoutes = require('./routes/auth');
const tracksRoutes = require('./routes/tracks');
const adminRoutes = require('./routes/admin');
const chartsRoutes = require('./routes/charts');
const playlistsRoutes = require('./routes/playlists');
const usersRoutes = require('./routes/users');

connectDB();
initGridFS();

const app = express();
// Render / Vercel за прокси — чтобы rate limit видел реальный IP клиента
app.set('trust proxy', 1);
const normalizeOrigin = (v) => String(v || '').trim().replace(/\/$/, '');
const primaryFrontend = normalizeOrigin(process.env.FRONTEND_URL);
const legacyFrontend = 'https://novasound.vercel.app';
// Явно: даже если FRONTEND_URL в Render с пробелом/опечаткой — кастомный домен не отвалится по CORS.
const extraFrontends = ['https://novasoundapp.ru', 'https://www.novasoundapp.ru'];
const fromEnv = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((s) => normalizeOrigin(s))
  .filter(Boolean);

const allowedOrigins = new Set(
  [...extraFrontends, primaryFrontend, legacyFrontend, ...fromEnv]
    .filter(Boolean)
    .flatMap((o) => {
      try {
        const u = new URL(o);
        if (u.hostname.startsWith('www.')) {
          const noWww = `${u.protocol}//${u.hostname.replace(/^www\./, '')}`;
          return [o, noWww];
        }
        const withWww = `${u.protocol}//www.${u.hostname}`;
        return [o, withWww];
      } catch (_) {
        return [o];
      }
    })
);

function originAllowed(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    // Любой поддомен основного сайта (REG.RU часто отдаёт app. / m. и т.д.)
    if (h === 'novasoundapp.ru' || h.endsWith('.novasoundapp.ru')) return true;
  } catch (_) {}
  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (originAllowed(origin)) return callback(null, true);
    return callback(new Error('CORS origin denied'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With', 'Origin', 'Cache-Control'],
  exposedHeaders: ['Content-Length', 'Content-Type']
}));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/users', usersRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

/** Диагностика: открой в браузере — должно быть configured: true и cloudName: твой cloud */
app.get('/health/cloudinary', (req, res) => {
  const cloudinary = require('./config/cloudinary');
  const cfg = cloudinary.config();
  const configured = !!(cfg && cfg.cloud_name && cfg.api_key && cfg.api_secret);
  res.json({
    ok: true,
    cloudinaryConfigured: configured,
    cloudName: configured ? cfg.cloud_name : null
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`NovaSound API running on port ${PORT}`));
