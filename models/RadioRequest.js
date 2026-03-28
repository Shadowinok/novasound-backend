const mongoose = require('mongoose');

const radioRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 500, trim: true },
  status: {
    type: String,
    enum: ['pending', 'picked', 'skipped', 'played'],
    default: 'pending',
    index: true
  },
  pickedAt: { type: Date, default: null }
}, { timestamps: true });

radioRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RadioRequest', radioRequestSchema);
