const mongoose = require('mongoose');

const chatMessageReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true, index: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    textSnapshot: { type: String, default: '', maxlength: 2000 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminNote: { type: String, default: '', maxlength: 1000 }
  },
  { timestamps: true }
);

chatMessageReportSchema.index({ message: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model('ChatMessageReport', chatMessageReportSchema);
