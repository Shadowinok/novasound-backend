const mongoose = require('mongoose');

const radioHostSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'main',
    unique: true,
    index: true
  },
  mode: {
    type: String,
    enum: ['fixed', 'random'],
    default: 'fixed'
  },
  fixedEverySongs: {
    type: Number,
    default: 2,
    min: 1,
    max: 20
  },
  randomMinSongs: {
    type: Number,
    default: 2,
    min: 1,
    max: 20
  },
  randomMaxSongs: {
    type: Number,
    default: 5,
    min: 1,
    max: 20
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('RadioHostSettings', radioHostSettingsSchema);

