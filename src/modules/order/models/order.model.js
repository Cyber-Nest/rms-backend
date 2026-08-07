const mongoose = require("mongoose");
const {
  getLocalDateStr,
  getLocalStartOfDay,
  getLocalEndOfDay,
} = require("../../../shared/utils/timezone");

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
    selectedSize: {
      sizeCode: { type: String, default: "" },
      sizeName: { type: String, default: "" },
      price: { type: Number, default: 0 },
    },
    selectedModifiers: { type: [selectedModifierSchema], default: [] },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true },
    note: { type: String, default: "" },
    kitchenLabel: {
      type: String,
      enum: ["chicken", "pizza"],
      default: "chicken",
    },
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
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
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
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    branchName: {
      type: String,
      default: "Main Branch",
    },
    branchCode: {
      type: String,
      default: "MAIN",
    },
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
    deliveryFee: { type: Number, default: 0 },
    tip: { type: Number, default: 0 },
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
      enum: ["paid", "unpaid", "refunded"],
      default: "paid",
    },
    payments: { type: [paymentEntrySchema], default: [] },

    refundedAt: { type: Date, default: null },
    refundedBy: { type: String, default: "" },
    refundReason: { type: String, default: "" },

    orderTiming: {
      type: String,
      enum: ["now", "later"],
      default: "now",
    },
    scheduledAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },

    customer: { type: customerSchema, default: null },

    notes: { type: String, default: "" },
    placedBy: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "preparing", "ready", "completed", "cancelled"],
      default: "pending",
    },
    receptionCompleted: {
      type: Boolean,
      default: false,
    },
    kitchenCleared: {
      type: Boolean,
      default: false,
    },
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        note: String,
        userName: String,
      },
    ],
    businessDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

orderSchema.pre("save", function () {
  if (this.orderTiming === "later" && this.scheduledAt) {
    this.businessDate = new Date(this.scheduledAt);
  } else if (this.createdAt) {
    this.businessDate = new Date(this.createdAt);
  } else {
    this.businessDate = new Date();
  }
});

orderSchema.statics.generateOrderNumber = async function (
  orderType,
  scheduledAt,
  branchId = null,
) {
  const targetDate = scheduledAt ? new Date(scheduledAt) : new Date();

  // Get date string in local timezone
  const dateString = getLocalDateStr(targetDate);
  const counterKey = `${branchId ? branchId.toString() : "main"}_${dateString}`;

  // Atomic increment with upsert — fast, no race conditions, zero locks
  const counter = await OrderCounter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { count: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const orderSeq = counter.count + 100;
  return String(orderSeq);
};

orderSchema.statics.previewNextOrderNumber = async function (
  orderType,
  branchId = null,
) {
  const dateString = getLocalDateStr();
  const counterKey = `${branchId ? branchId.toString() : "main"}_${dateString}`;

  const counter = await OrderCounter.findOne({ _id: counterKey }).lean();
  const currentCount = counter ? counter.count : 0;
  return String(currentCount + 101);
};

orderSchema.index({ orderNumber: 1 });
orderSchema.index({ businessDate: -1 });
orderSchema.index({ branchId: 1, businessDate: -1 });
orderSchema.index({ branchId: 1, status: 1, businessDate: -1 });
orderSchema.index({ branchId: 1, status: 1, kitchenCleared: 1 });
orderSchema.index({ branchId: 1, status: 1, receptionCompleted: 1 });
orderSchema.index({ "customer.phone": 1 }, { sparse: true });
orderSchema.index({ "customer.email": 1 }, { sparse: true });

module.exports = mongoose.model("Order", orderSchema);
