const mongoose = require('mongoose');

const hostLineSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['joke', 'fact', 'news-bridge', 'news-outro', 'track-next', 'track-current'],
    required: true,
    index: true
  },
  text: { type: String, required: true, trim: true },
  hash: { type: String, required: true },
  source: { type: String, default: 'seed' }, // seed | remote
  mood: {
    type: String,
    enum: ['neutral', 'warm', 'playful', 'serious', 'energetic'],
    default: 'neutral',
    index: true
  },
  cue: {
    type: String,
    enum: ['none', 'smile', 'serious'],
    default: 'none'
  },
  rateMin: { type: Number, default: 6 },
  rateMax: { type: Number, default: 14 },
  safeForKids: { type: Boolean, default: true, index: true },
  archived: { type: Boolean, default: false, index: true },
  usedCount: { type: Number, default: 0 },
  maxUses: { type: Number, default: 36 },
  lastUsedAt: { type: Date, default: null }
}, { timestamps: true });

hostLineSchema.index({ type: 1, hash: 1 }, { unique: true });

module.exports = mongoose.model('HostLine', hostLineSchema);
