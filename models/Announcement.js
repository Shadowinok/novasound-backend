const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    default: '',
    trim: true,
    maxlength: 2000
  },
  /**
   * Если задан, на главной анонс будет ссылаться на трек.
   * Можно использовать как “анонс релиза”.
   */
  trackId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Track',
    default: null,
    index: true
  },
  pinned: {
    type: Boolean,
    default: false,
    index: true
  },
  pinnedOrder: {
    type: Number,
    default: 100,
    index: true
  },
  /** Дата окончания показа на главной. null = показывать всегда */
  expiresAt: {
    type: Date,
    default: null,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, { timestamps: true });

announcementSchema.index({ pinned: -1, pinnedOrder: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);

