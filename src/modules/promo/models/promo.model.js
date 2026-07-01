const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: { type: String, default: '' },
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, default: 0 },   // min subtotal to apply
    maxDiscount:    { type: Number, default: null },  // cap for percentage
    usageLimit:     { type: Number, default: null },  // null = unlimited
    usedCount:      { type: Number, default: 0 },
    expiresAt:      { type: Date,   default: null },  // null = never expires
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Promo', promoSchema);
