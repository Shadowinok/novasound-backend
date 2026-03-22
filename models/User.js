const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerifyTokenHash: {
    type: String,
    default: ''
  },
  emailVerifyExpires: {
    type: Date,
    default: null
  },
  /** Последняя отправка письма подтверждения (регистрация / повтор) — для кулдауна */
  lastVerificationEmailAt: {
    type: Date,
    default: null
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  acceptedTerms: {
    type: Boolean,
    default: false
  },
  termsVersion: {
    type: String,
    default: ''
  }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
