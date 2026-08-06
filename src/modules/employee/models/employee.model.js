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
    permissions: {
      pos:                    { type: Boolean, default: true  }, // always-on default
      kitchen:                { type: Boolean, default: false },
      reception_view:         { type: Boolean, default: false },
      delivery:               { type: Boolean, default: false },
      driver_drop:            { type: Boolean, default: false },
      vehicles:               { type: Boolean, default: false },
      customers:              { type: Boolean, default: false },
      employees:              { type: Boolean, default: false },
      menus:                  { type: Boolean, default: false },
      setting:                { type: Boolean, default: false },
      //orders sub-tabs
      dashboard:              { type: Boolean, default: false },
      orders:                 { type: Boolean, default: false },
      orders_list:            { type: Boolean, default: false },
      sales_summary:          { type: Boolean, default: false },
      expense_payout:         { type: Boolean, default: false },
      reports:                { type: Boolean, default: false },
      item_sales:             { type: Boolean, default: false },
      hourly_sales:           { type: Boolean, default: false },
      cash_out_summary:       { type: Boolean, default: false },
      monthly_sales_summary:  { type: Boolean, default: false },
      failed_transaction:     { type: Boolean, default: false },
      refund_orders:          { type: Boolean, default: false },
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
