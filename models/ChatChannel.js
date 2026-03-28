const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: {
    type: String,
    enum: ['member', 'moderator', 'owner'],
    default: 'member'
  }
}, { _id: false });

const chatChannelSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['general', 'dm', 'group'],
    required: true
  },
  slug: { type: String, sparse: true, unique: true, trim: true },
  dmKey: { type: String, sparse: true, unique: true, trim: true },
  title: { type: String, default: '', trim: true, maxlength: 120 },
  members: [memberSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

chatChannelSchema.index({ type: 1, slug: 1 });

module.exports = mongoose.model('ChatChannel', chatChannelSchema);
