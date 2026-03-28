const mongoose = require('mongoose');

const radioHostSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'main',
    unique: true,
    index: true
  },
  mode: {
    type: String,
    enum: ['fixed', 'random'],
    default: 'fixed'
  },
  fixedEverySongs: {
    type: Number,
    default: 2,
    min: 1,
    max: 20
  },
  randomMinSongs: {
    type: Number,
    default: 2,
    min: 1,
    max: 20
  },
  randomMaxSongs: {
    type: Number,
    default: 5,
    min: 1,
    max: 20
  },
  radioPlaylistMode: {
    type: String,
    enum: ['random', 'dj'],
    default: 'random'
  },
  djTheme: {
    type: String,
    enum: ['auto', 'mixed', 'energetic', 'chill', 'night', 'rock', 'pop', 'electro', 'hiphop', 'jazz'],
    default: 'auto'
  },
  requestDeskEnabled: {
    type: Boolean,
    default: false
  },
  /** Раз в сколько «песен» радио-ведущий пытается взять блок стола заказов в эфир */
  requestDeskEverySongs: {
    type: Number,
    default: 6,
    min: 1,
    max: 40
  },
  /** Минимум минут между автоматическими выходами стола в эфир (анти-спам) */
  requestDeskMinIntervalMinutes: {
    type: Number,
    default: 4,
    min: 1,
    max: 120
  },
  /** Вероятность короткой реплики с обращением к автору заявки (0–1) */
  requestDeskBanterChance: {
    type: Number,
    default: 0.22,
    min: 0,
    max: 1
  },
  deskIntroTemplate: {
    type: String,
    default: 'Слушайте, коротко про заявку со стола заказов.',
    maxlength: 500,
    trim: true
  },
  deskBodyTemplate: {
    type: String,
    default: 'Пишет {user}: {text}.',
    maxlength: 800,
    trim: true
  },
  deskOutroTemplate: {
    type: String,
    default: 'Продолжаем эфир.',
    maxlength: 500,
    trim: true
  },
  deskBanterTemplate: {
    type: String,
    default: '{user}, спасибо за заявку — ловим волну.',
    maxlength: 300,
    trim: true
  },
  deskLastBroadcastAt: {
    type: Date,
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('RadioHostSettings', radioHostSettingsSchema);

