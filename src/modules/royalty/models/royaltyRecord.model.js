const mongoose = require("mongoose");

const royaltyRecordSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch ID is required"],
      index: true,
    },
    branchName: {
      type: String,
      required: true,
      trim: true,
    },
    branchCode: {
      type: String,
      required: true,
      trim: true,
    },
    branchCreatedAt: {
      type: Date,
      required: true,
    },

    // Period info
    periodType: {
      type: String,
      enum: ["monthly", "custom"],
      default: "monthly",
    },
    periodLabel: {
      type: String,
      required: true,
      trim: true,
      // e.g. "October 2026" or "Oct 13 – Oct 31, 2026"
    },
    // Actual calculated start = MAX(branch.createdAt, selectedPeriodStart)
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },

    // Sales data
    totalSales: {
      type: Number,
      required: true,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    netTotal: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    includeTax: {
      type: Boolean,
      default: false,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },

    // Royalty — snapshot of rate at time of generation
    royaltyRate: {
      type: Number,
      required: true,
      default: 0,
    },
    royaltyAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    // Advertisement — snapshot of rate at time of generation
    advertisementType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    advertisementRate: {
      type: Number,
      required: true,
      default: 0,
    },
    advertisementAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    // Total due
    totalDue: {
      type: Number,
      required: true,
      default: 0,
    },

    // Payment tracking
    status: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    paidNote: {
      type: String,
      default: "",
      trim: true,
    },

    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

royaltyRecordSchema.index(
  { branchId: 1, startDate: 1, endDate: 1 },
  { unique: true }
);

royaltyRecordSchema.index({ status: 1, branchId: 1 });
royaltyRecordSchema.index({ startDate: -1, endDate: -1 });

module.exports = mongoose.model("RoyaltyRecord", royaltyRecordSchema);
