const mongoose = require("mongoose");

const deliveryAssignmentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
    },
    status: {
      type: String,
      enum: ["assigned", "en-route", "delivered", "completed"],
      default: "assigned",
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    // Set when driver returns to restaurant (auto-detected at 200m)
    completedAt: {
      type: Date,
      default: null,
    },
    customerLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      address: { type: String, default: "" },
    },
    restaurantId: {
      type: String,
      default: "default",
    },
  },
  {
    timestamps: true,
  },
);

deliveryAssignmentSchema.index({ orderId: 1 });
deliveryAssignmentSchema.index({ driverId: 1, status: 1 });
deliveryAssignmentSchema.index({ restaurantId: 1, status: 1 });

module.exports = mongoose.model("DeliveryAssignment", deliveryAssignmentSchema);
