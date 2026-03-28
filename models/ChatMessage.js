const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 2000, trim: true },
  removed: { type: Boolean, default: false },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removedReason: { type: String, default: '' }
}, { timestamps: true });

chatMessageSchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
