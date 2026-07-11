const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "stripe"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "refunded"],
      default: "pending",
    },
    transactionId: { type: String, default: "" },
    cardBrand: { type: String, default: "" },
    cardFunding: { type: String, default: "" },
    cardLast4: { type: String, default: "" },
    rawStripeResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast lookups
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ orderNumber: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
