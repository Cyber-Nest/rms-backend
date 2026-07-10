const mongoose = require("mongoose");
const { getLocalDateStr, getLocalStartOfDay, getLocalEndOfDay } = require("../../../shared/utils/timezone");


const selectedModifierSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    groupName: { type: String, required: true },
    optionId: { type: String, required: true },
    optionName: { type: String, required: true },
    price: { type: Number, default: 0 },
    isRoot: { type: Boolean, default: true },
  },
  { _id: false },
);

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: String, required: true },
    name: { type: String, required: true },
    image: { type: String, default: "" },
    basePrice: { type: Number, required: true },
    selectedModifiers: { type: [selectedModifierSchema], default: [] },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const paymentEntrySchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["cash", "card", "credit", "debit"],
      required: true,
    },
    amount: { type: Number, required: true },
    personName: { type: String, default: "" }, 
    cashGiven: { type: Number, default: 0 }, 
    changeGiven: { type: Number, default: 0 }, 
    transactionId: { type: String, default: "" },
    cardBrand: { type: String, default: "" },
    cardFunding: { type: String, default: "" },
    cardLast4: { type: String, default: "" },
  },
  { _id: false },
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    postalCode: { type: String, default: "" },
  },
  { _id: false },
);


const OrderCounterSchema = new mongoose.Schema({
  _id: { type: String }, 
  count: { type: Number, default: 0 },
});
const OrderCounter = mongoose.model("OrderCounter", OrderCounterSchema);


const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, index: true },
    orderType: {
      type: String,
      enum: ["takeout", "drive-through", "dine-in", "delivery"],
      required: true,
    },
    orderSource: {
      type: String,
      enum: ["pos", "online", "doordash", "skip", "ubereats"],
      default: "pos",
    },

    
    items: { type: [orderItemSchema], required: true },

    
    subtotal: { type: Number, required: true },
    taxRate: { type: Number, default: 0.05 }, 
    tax: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ["none", "promo", "percentage", "flat"],
      default: "none",
    },
    promoCode: { type: String, default: "" },
    total: { type: Number, required: true },

    
    paymentTiming: {
      type: String,
      enum: ["pay-now", "pay-later"],
      default: "pay-now",
    },
    paymentType: {
      type: String,
      enum: ["one-time", "split"],
      default: "one-time",
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "paid",
    },
    payments: { type: [paymentEntrySchema], default: [] },

    
    orderTiming: {
      type: String,
      enum: ["now", "later"],
      default: "now",
    },
    scheduledAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },

    
    customer: { type: customerSchema, default: null },

    
    notes: { type: String, default: "" },

    
    status: {
      type: String,
      enum: ["pending", "preparing", "ready", "completed", "cancelled"],
      default: "pending",
    },
    receptionCompleted: {
      type: Boolean,
      default: false,
    },
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  {
    timestamps: true,
  },
);


orderSchema.statics.generateOrderNumber = async function (
  orderType,
  scheduledAt,
) {
  const targetDate = scheduledAt ? new Date(scheduledAt) : new Date();

  // Get date string in local timezone
  const dateString = getLocalDateStr(targetDate);

  // Get local day boundaries as UTC Date objects
  const startOfDay = getLocalStartOfDay(dateString);
  const endOfDay = getLocalEndOfDay(dateString);

  const countToday = await this.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  if (countToday === 0) {
    await OrderCounter.findOneAndUpdate(
      { _id: dateString },
      { $set: { count: 0 } },
      { upsert: true }
    );
  }

  const counter = await OrderCounter.findOneAndUpdate(
    { _id: dateString },
    { $inc: { count: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const orderSeq = counter.count + 100;
  return String(orderSeq);
};

orderSchema.statics.previewNextOrderNumber = async function (orderType) {
  // Get date string in local timezone
  const dateString = getLocalDateStr();

  // Get local day boundaries as UTC Date objects
  const startOfDay = getLocalStartOfDay(dateString);
  const endOfDay = getLocalEndOfDay(dateString);

  const countToday = await this.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  if (countToday === 0) {
    return "101";
  }

  const counter = await OrderCounter.findOne({ _id: dateString });
  const currentCount = counter ? counter.count : 0;
  return String(currentCount + 101);
};

orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ scheduledAt: 1 }, { sparse: true });
orderSchema.index({ "customer.phone": 1 }, { sparse: true });
orderSchema.index({ "customer.email": 1 }, { sparse: true });

module.exports = mongoose.model("Order", orderSchema);
