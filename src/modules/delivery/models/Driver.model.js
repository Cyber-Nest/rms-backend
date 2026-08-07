const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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
    isDutyOnline: {
      type: Boolean,
      default: false,
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

driverSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (err) {
    throw err;
  }
});

driverSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password.startsWith("$2a$") && !this.password.startsWith("$2b$")) {
    return candidatePassword === this.password;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Driver", driverSchema);
