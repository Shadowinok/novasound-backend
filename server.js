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
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/users', usersRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`NovaSound API running on port ${PORT}`));
