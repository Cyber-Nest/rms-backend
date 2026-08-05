const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    description: { type: String, default: '' },
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: null },

    applicableChannel: {
      type: String,
      enum: ['both', 'online', 'pos'],
      default: 'both',
      index: true,
    },
    applicableScope: {
      type: String,
      enum: ['all_categories', 'specific_categories'],
      default: 'all_categories',
    },
    categoryIds: [{ type: String }],

    applicableBranchScope: {
      type: String,
      enum: ['all_branches', 'specific_branches'],
      default: 'all_branches',
    },
    branchIds: [{ type: String }],

    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },

    startDate: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

promoSchema.index({ code: 1, isActive: 1 });
promoSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Promo', promoSchema);
