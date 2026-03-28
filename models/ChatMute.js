const mongoose = require('mongoose');

const chatMuteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    until: { type: Date, required: true, index: true },
    reason: { type: String, default: '', maxlength: 500, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

chatMuteSchema.index({ user: 1, until: -1 });

module.exports = mongoose.model('ChatMute', chatMuteSchema);
