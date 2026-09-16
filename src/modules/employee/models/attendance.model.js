const mongoose = require("mongoose");

const breakSchema = new mongoose.Schema(
  {
    breakIn: {
      type: Date,
      required: true,
    },
    breakOut: {
      type: Date,
      default: null,
    },
  },
  { _id: true }
);

const managerOverrideBySchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    employeeId: { type: String, default: "" },
  },
  { _id: false }
);

const shiftSchema = new mongoose.Schema(
  {
    checkIn: {
      type: Date,
      required: true,
    },
    checkOut: {
      type: Date,
      default: null,
    },
    breaks: [breakSchema],
    totalWorkMinutes: {
      type: Number,
      default: 0,
    },
    totalBreakMinutes: {
      type: Number,
      default: 0,
    },
    // ── Schedule-Aware Check-In Fields ──
    scheduledShiftStart: {
      type: String, // e.g. "09:00"
      default: "",
    },
    scheduledShiftEnd: {
      type: String, // e.g. "17:00"
      default: "",
    },
    autoCheckoutGraceTime: {
      type: Date,  // Scheduled end + 2 min — triggers auto-checkout sweeper
      default: null,
    },
    autoCheckedOut: {
      type: Boolean,
      default: false,
    },
    managerOverride: {
      type: Boolean,
      default: false,
    },
    managerOverrideBy: {
      type: managerOverrideBySchema,
      default: () => ({ name: "", employeeId: "" }),
    },
    notes: {
      type: String,
      default: "",
    },
  },
  { _id: true }
);

const attendanceSchema = new mongoose.Schema(
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
      type: String, // Format: YYYY-MM-DD
      required: [true, "Date string is required"],
      index: true,
    },
    status: {
      type: String,
      enum: ["checked-in", "on-break", "checked-out"],
      default: "checked-out",
    },
    shifts: [shiftSchema],
  },
  {
    timestamps: true,
  }
);

attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ branchId: 1, date: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
