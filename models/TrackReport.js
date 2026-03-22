const mongoose = require('mongoose');

const trackReportSchema = new mongoose.Schema(
  {
    track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** content — жалоба на трек/текст; cover — на обложку */
    reportType: {
      type: String,
      enum: ['content', 'cover'],
      default: 'content',
      index: true
    },
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
      enum: ['leave', 'rejectTrack', 'rejectCover', 'none'],
      default: 'none'
    },
    moderationComment: { type: String, default: '' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

trackReportSchema.index({ status: 1, createdAt: -1 });
// Одна открытая жалоба на трек на пользователя по типу (контент / обложка)
trackReportSchema.index(
  { track: 1, reporter: 1, status: 1, reportType: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

module.exports = mongoose.model('TrackReport', trackReportSchema);

