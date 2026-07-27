const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
  },
  slug: {
    type: String,
    required: [true, 'Category slug is required'],
    trim: true,
    unique: true,
  },
  image: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  displayOrder: {
    type: Number,
    default: 0,
  },
  disabledBranches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  }]
}, {
  timestamps: true
});

categorySchema.index({ isActive: 1, displayOrder: 1 });

module.exports = mongoose.model('Category', categorySchema);
