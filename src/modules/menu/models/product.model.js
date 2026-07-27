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
  isOutOfStock: {
    type: Boolean,
    default: false,
  },
  kitchenLabel: {
    type: String,
    enum: ['chicken', 'pizza'],
    default: 'chicken',
  },
  productId: {
    type: String,
    unique: true,
    sparse: true,
  },
  disabledBranches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  }],
  outOfStockBranches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  }]
}, {
  timestamps: true
});


const ProductCounterSchema = new mongoose.Schema({
  _id: { type: String }, 
  count: { type: Number, default: 2000 },
});
const ProductCounter = mongoose.model("ProductCounter", ProductCounterSchema);

productSchema.pre('save', async function() {
  if (this.isNew && !this.productId) {
    const counter = await ProductCounter.findOneAndUpdate(
      { _id: "productId" },
      { $inc: { count: 1 } },
      { new: true, upsert: true }
    );
    this.productId = `M${counter.count}`;
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
productSchema.index({ isActive: 1, categoryId: 1 });
productSchema.index({ disabledBranches: 1 });
productSchema.index({ outOfStockBranches: 1 });

module.exports = mongoose.model('Product', productSchema);
