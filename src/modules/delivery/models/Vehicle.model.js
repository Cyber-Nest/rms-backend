const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    isAssigned: {
      type: Boolean,
      default: false,
    },
    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
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

vehicleSchema.index({ restaurantId: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
