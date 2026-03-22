const mongoose = require('mongoose');

const listenLogSchema = new mongoose.Schema({
  track: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Track',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  ip: {
    type: String,
    default: ''
  },
  listenedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

listenLogSchema.index({ track: 1, user: 1, ip: 1, listenedAt: -1 });
listenLogSchema.index({ listenedAt: -1 });

module.exports = mongoose.model('ListenLog', listenLogSchema);
