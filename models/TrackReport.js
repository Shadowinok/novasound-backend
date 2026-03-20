const mongoose = require('mongoose');

const trackReportSchema = new mongoose.Schema(
  {
    track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    reasonCategory: {
      type: String,
      enum: ['hate', 'drugs', 'violence', 'extremism', 'sexual', 'other-serious', 'non-serious'],
      default: 'non-serious',
      index: true
    },
    isSerious: { type: Boolean, default: false, index: true },
    escalatedToAdmin: { type: Boolean, default: false, index: true },
    attemptNumber: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      index: true
    },
    aiSuggestedAction: {
      type: String,
      enum: ['leave', 'rejectTrack', 'needsManual'],
      default: 'needsManual'
    },
    adminAction: {
      type: String,
      enum: ['leave', 'rejectTrack', 'none'],
      default: 'none'
    },
    moderationComment: { type: String, default: '' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

trackReportSchema.index({ status: 1, createdAt: -1 });
// Один пользователь не должен иметь несколько одновременно открытых жалоб на один трек
trackReportSchema.index(
  { track: 1, reporter: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

module.exports = mongoose.model('TrackReport', trackReportSchema);

