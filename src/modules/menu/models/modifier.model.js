const mongoose = require('mongoose');

const modifierOptionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Option name is required'],
    trim: true,
  },
  image: {
    type: String,
    default: '',
  },
  price: {
    type: Number,
    required: [true, 'Option price offset is required'],
    default: 0,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  modifierGroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ModifierGroup'
  }]
});

// Virtual to map _id to id for frontend compatibility
modifierOptionSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
modifierOptionSchema.set('toJSON', { virtuals: true });
modifierOptionSchema.set('toObject', { virtuals: true });

const modifierGroupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Modifier group name is required'],
    trim: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  minSelection: {
    type: Number,
    default: 0,
  },
  maxSelection: {
    type: Number,
    default: 1,
  },
  displayType: {
    type: String,
    enum: ['radio', 'checkbox', 'card'],
    default: 'radio',
  },
  options: [modifierOptionSchema]
}, {
  timestamps: true
});

// Virtual to map _id to id
modifierGroupSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
modifierGroupSchema.set('toJSON', { virtuals: true });
modifierGroupSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ModifierGroup', modifierGroupSchema);
