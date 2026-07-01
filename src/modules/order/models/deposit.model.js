const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, 'Deposit date is required'],
      unique: true,
      index: true, // index for quick queries by date
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

module.exports = mongoose.model('Deposit', depositSchema);
