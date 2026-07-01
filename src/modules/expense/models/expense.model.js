const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: [true, 'Expense category is required'],
      trim: true,
    },
    expenseType: {
      type: String,
      enum: ['employee', 'store'],
      default: 'store',
    },
    employeeName: {
      type: String,
      default: 'Manager',
      trim: true,
    },
    expenseDate: {
      type: Date,
      default: Date.now,
    },
    paymentMode: {
      type: String,
      enum: ['cash', 'card'],
      default: 'cash',
    },
    amount: {
      type: Number,
      required: [true, 'Expense amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    pst: {
      type: Number,
      default: 0,
      min: 0,
    },
    gst: {
      type: Number,
      default: 0,
      min: 0,
    },
    hst: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ expenseDate: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
