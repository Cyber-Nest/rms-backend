const mongoose = require("mongoose");

const settledOrderSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderNumber: { type: String, default: "" },
    customerName: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    time: { type: String, default: "" },
    total: { type: Number, default: 0 },
    dc: { type: Number, default: 6.0 }, // Delivery charge
    pd: { type: String, enum: ["PP", "TM", "CS"], default: "PP" }, // PP=Prepaid, TM=Terminal, CS=Cash
    prepaidTip: { type: Number, default: 0 },
    terminalTip: { type: Number, default: 0 },
    cashGiven: { type: Number, default: 0 },
  },
  { _id: false }
);

const driverDropSettlementSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    driverCode: {
      type: String,
      default: "",
    },
    driverName: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    orders: {
      type: [settledOrderSchema],
      default: [],
    },
    totalOrders: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    prepaidSales: { type: Number, default: 0 },
    prepaidTips: { type: Number, default: 0 },
    totalNewSales: { type: Number, default: 0 },
    terminalSales: { type: Number, default: 0 },
    terminalTips: { type: Number, default: 0 },
    cashSales: { type: Number, default: 0 },
    saleDue: { type: Number, default: 0 },
    driverBaseCommission: { type: Number, default: 0 },
    additionalCommission: { type: Number, default: 0 },
    additionalReason: { type: String, default: "" },
    driverTotalCommission: { type: Number, default: 0 },
    totalTipsEarned: { type: Number, default: 0 },
    totalDriverEarning: { type: Number, default: 0 },
    netCashPayoutToDriver: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["settled"],
      default: "settled",
    },
    settledBy: {
      type: String,
      default: "Manager",
    },
    settledAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

driverDropSettlementSchema.index(
  { branchId: 1, date: 1, driverId: 1 },
  { unique: true }
);

driverDropSettlementSchema.index({ branchId: 1, date: 1 });

module.exports = mongoose.model("DriverDropSettlement", driverDropSettlementSchema);
