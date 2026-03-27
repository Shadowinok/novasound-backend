const mongoose = require('mongoose');

const CAMPAIGN_TYPES = ['track_week', 'challenge', 'special'];
const CAMPAIGN_STATUSES = ['draft', 'active', 'closed', 'archived'];

const campaignSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, trim: true, maxlength: 160, unique: true, index: true },
  type: { type: String, enum: CAMPAIGN_TYPES, default: 'track_week', index: true },
  status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft', index: true },
  startsAt: { type: Date, default: null, index: true },
  endsAt: { type: Date, default: null, index: true },
  rulesText: { type: String, default: '', maxlength: 5000 },
  hostIntroText: { type: String, default: '', maxlength: 1000 },
  hostOutroText: { type: String, default: '', maxlength: 1000 },
  allowExistingTracks: { type: Boolean, default: true },
  allowUploadOptIn: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true }
}, { timestamps: true });

campaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
module.exports.CAMPAIGN_TYPES = CAMPAIGN_TYPES;
module.exports.CAMPAIGN_STATUSES = CAMPAIGN_STATUSES;
