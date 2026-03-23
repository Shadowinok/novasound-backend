const mongoose = require('mongoose');

const GENRES = ['rock-metal', 'pop', 'jazz', 'hiphop-rap', 'electronic', 'other'];

const trackSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    minlength: 3,
    maxlength: 100
  },
  description: {
    type: String,
    default: '',
    maxlength: 2000
  },
  genre: {
    type: String,
    enum: GENRES,
    required: true,
    default: 'other',
    index: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  audioFileId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  coverImage: {
    type: String,
    default: ''
  },
  /** Новая обложка на проверке (публично ещё старая coverImage) */
  coverImagePending: {
    type: String,
    default: ''
  },
  /** none | pending — после ИИ/админа снова none */
  coverChangeStatus: {
    type: String,
    enum: ['none', 'pending'],
    default: 'none',
    index: true
  },
  coverModerationComment: {
    type: String,
    default: ''
  },
  duration: {
    type: Number,
    required: true,
    min: 30
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  moderationComment: {
    type: String,
    default: ''
  },
  plays: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  dislikes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  rejectedAt: Date,
  approvedAt: Date
}, { timestamps: true });

trackSchema.index({ status: 1, createdAt: -1 });
trackSchema.index({ author: 1, createdAt: -1 });
trackSchema.index({ plays: -1 });
trackSchema.index({ genre: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Track', trackSchema);
module.exports.GENRES = GENRES;
