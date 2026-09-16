const mongoose = require("mongoose");

const shiftSegmentSchema = new mongoose.Schema(
  {
    startTime: { type: String, required: true }, // e.g. "09:00", "9", "17:30"
    endTime: { type: String, required: true },   // e.g. "16:00", "16", "23:00"
    hours: { type: Number, required: true, default: 0 },
  },
  { _id: true }
);

const scheduleSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch ID is required"],
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Employee ID is required"],
      index: true,
    },
    date: {
      type: String, // Format: YYYY-MM-DD (local timezone date)
      required: [true, "Date is required"],
      index: true,
    },
    isOff: {
      type: Boolean,
      default: false,
    },
    shifts: [shiftSegmentSchema],
    totalHours: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

scheduleSchema.index({ branchId: 1, employeeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Schedule", scheduleSchema);
