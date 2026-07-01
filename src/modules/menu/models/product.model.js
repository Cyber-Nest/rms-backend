const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required'],
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  image: {
    type: String,
    default: '',
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
  },
  badge: {
    type: String,
    enum: ['Popular', 'Best Seller', 'New', null],
    default: null,
  },
  isPopular: {
    type: Boolean,
    default: false,
  },
  itemType: {
    type: String,
    enum: ['simple', 'combo'],
    default: 'simple',
  },
  modifierGroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ModifierGroup',
  }],
  isActive: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true
});

// Virtual to map _id to id for frontend compatibility
productSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
