const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  description: {
    type: String,
    default: '',
    maxlength: 1000
  },
  coverImage: {
    type: String,
    default: ''
  },
  tracks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Track'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  /** false = только владелец (и админ) видит в каталоге и на главной */
  isPublic: {
    type: Boolean,
    default: true
  },
  /** Показывать на главной странице */
  featuredOnHome: {
    type: Boolean,
    default: false,
    index: true
  },
  /** Порядок на главной (меньше = выше) */
  featuredOrder: {
    type: Number,
    default: 100,
    min: 0,
    max: 9999
  },
  /** Служебный стабильный ключ для авто-синхронизации (не зависит от title) */
  systemKey: {
    type: String,
    default: '',
    trim: true,
    maxlength: 120,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Playlist', playlistSchema);
