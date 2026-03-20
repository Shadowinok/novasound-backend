const mongoose = require('mongoose');

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

module.exports = mongoose.model('Track', trackSchema);
