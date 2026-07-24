const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, 'Deposit date is required'],
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    cashAmount: {
      type: Number,
      default: 0,
      min: [0, 'Deposit amount cannot be negative'],
    },
    cardAmount: {
      type: Number,
      default: 0,
      min: [0, 'Deposit amount cannot be negative'],
    },
    accountPayAmount: {
      type: Number,
      default: 0,
      min: [0, 'Deposit amount cannot be negative'],
    },
  },
  { timestamps: true }
);

depositSchema.index({ branchId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Deposit', depositSchema);
