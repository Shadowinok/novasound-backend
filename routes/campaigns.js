const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Campaign = require('../models/Campaign');
const CampaignSubmission = require('../models/CampaignSubmission');
const Track = require('../models/Track');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/active', async (req, res) => {
  try {
    const now = new Date();
    const list = await Campaign.find({
      status: 'active',
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }
      ]
    })
      .sort({ startsAt: 1, createdAt: -1 })
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка чтения активных кампаний' });
  }
});

router.post('/:id/submit-track', protect, [
  param('id').isMongoId(),
  body('trackId').isMongoId().withMessage('Некорректный trackId'),
  body('source').optional({ nullable: true }).isIn(['manual-send', 'upload-optin'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign || campaign.status !== 'active') {
      return res.status(404).json({ message: 'Кампания не найдена или не активна' });
    }
    const now = new Date();
    if ((campaign.startsAt && campaign.startsAt > now) || (campaign.endsAt && campaign.endsAt <= now)) {
      return res.status(400).json({ message: 'Срок кампании неактуален' });
    }
    const track = await Track.findById(req.body.trackId).lean();
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (String(track.author) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Можно отправлять только свои треки' });
    }
    if (track.status !== 'approved' && !campaign.allowUploadOptIn) {
      return res.status(400).json({ message: 'Для этой кампании нужны одобренные треки' });
    }
    const submission = await CampaignSubmission.findOneAndUpdate(
      { campaignId: campaign._id, trackId: track._id },
      {
        $setOnInsert: {
          campaignId: campaign._id,
          trackId: track._id,
          authorId: req.user._id,
          source: req.body.source || 'manual-send',
          status: 'pending',
          submittedAt: new Date()
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
      .populate({ path: 'trackId', select: 'title coverImage status author', populate: { path: 'author', select: 'username' } })
      .populate('authorId', 'username')
      .lean();
    res.json(submission);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Ошибка отправки трека в кампанию' });
  }
});

module.exports = router;
