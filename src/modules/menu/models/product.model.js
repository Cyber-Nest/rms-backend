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
  },
  productId: {
    type: String,
    unique: true,
    sparse: true,
  }
}, {
  timestamps: true
});


productSchema.pre('save', async function() {
  if (this.isNew && !this.productId) {
    const Product = this.constructor;
    const products = await Product.find({ productId: { $regex: /^M\d+$/ } }, 'productId');
    let nextNumber = 2000;
    if (products.length > 0) {
      const numbers = products.map(p => {
        const match = p.productId.match(/^M(\d+)$/);
        return match ? parseInt(match[1], 10) : 2000;
      });
      const maxNumber = Math.max(...numbers);
      nextNumber = maxNumber + 1;
    }
    this.productId = `M${nextNumber}`;
  }
});


productSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

productSchema.index({ categoryId: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ name: 1 });

module.exports = mongoose.model('Product', productSchema);
