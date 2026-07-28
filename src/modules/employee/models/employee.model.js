const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const employeeSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch ID is required"],
      index: true,
    },
    employeeId: {
      type: String,
      required: [true, "Employee ID is required"],
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Employee name is required"],
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      enum: ["manager", "supervisor", "driver", "cashier", "chef", "crew-member"],
      required: [true, "Role is required"],
    },
    pin: {
      type: String,
      required: [true, "PIN is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    driverRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

employeeSchema.index({ branchId: 1, employeeId: 1 }, { unique: true });
employeeSchema.index({ branchId: 1, isActive: 1 });

// Pre-save hook to hash PIN if modified
employeeSchema.pre("save", async function () {
  if (!this.isModified("pin")) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  } catch (err) {
    throw err;
  }
});

// Method to compare PIN
employeeSchema.methods.comparePin = async function (candidatePin) {
  if (!this.pin.startsWith("$2a$") && !this.pin.startsWith("$2b$")) {
    return candidatePin === this.pin;
  }
  return await bcrypt.compare(candidatePin, this.pin);
};

module.exports = mongoose.model("Employee", employeeSchema);
