const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
    try {
      const TrackReport = require('../models/TrackReport');
      await TrackReport.updateMany({ reportType: { $exists: false } }, { $set: { reportType: 'content' } });
    } catch (e) {
      console.warn('TrackReport migration:', e.message);
    }
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
