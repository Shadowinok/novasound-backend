const mongoose = require('mongoose');

const CAMPAIGN_SUBMISSION_SOURCES = ['upload-optin', 'manual-send'];
const CAMPAIGN_SUBMISSION_STATUSES = ['pending', 'shortlisted', 'winner', 'editor_pick', 'rejected'];

const campaignSubmissionSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  trackId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Track',
    required: true,
    index: true
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  source: {
    type: String,
    enum: CAMPAIGN_SUBMISSION_SOURCES,
    default: 'manual-send',
    index: true
  },
  status: {
    type: String,
    enum: CAMPAIGN_SUBMISSION_STATUSES,
    default: 'pending',
    index: true
  },
  adminNote: {
    type: String,
    default: '',
    maxlength: 2000
  },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

campaignSubmissionSchema.index({ campaignId: 1, trackId: 1 }, { unique: true });
campaignSubmissionSchema.index({ campaignId: 1, status: 1, submittedAt: -1 });

module.exports = mongoose.model('CampaignSubmission', campaignSubmissionSchema);
module.exports.CAMPAIGN_SUBMISSION_SOURCES = CAMPAIGN_SUBMISSION_SOURCES;
module.exports.CAMPAIGN_SUBMISSION_STATUSES = CAMPAIGN_SUBMISSION_STATUSES;
