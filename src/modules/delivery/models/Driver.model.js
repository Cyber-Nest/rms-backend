const mongoose = require("mongoose");

const driverSchema = new mongoose.Schema(
  {
    driverId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      default: "",
    },
    password: {
      type: String,
      required: true,
    },
    color: {
      type: String,
      default: "#3B82F6",
    },
    status: {
      type: String,
      enum: ["available", "on-delivery", "returning", "offline"],
      default: "offline",
    },
    assignedVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    activeOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    restaurantId: {
      type: String,
      default: "default",
    },
  },
  {
    timestamps: true,
  },
);

driverSchema.index({ driverId: 1 }, { unique: true });
driverSchema.index({ restaurantId: 1, status: 1 });

module.exports = mongoose.model("Driver", driverSchema);
