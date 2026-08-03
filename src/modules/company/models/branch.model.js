const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Branch code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Branch email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Branch password is required"],
      select: true,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isLive: {
      type: Boolean,
      default: false,
      index: true,
    },
    isLocationConfigured: {
      type: Boolean,
      default: false,
      index: true,
    },
    qrCodePayload: {
      type: String,
      default: "",
    },
    settings: {
      mainSettings: {
        timezone: { type: String, default: 'Mountain Standard Time (MST) - America/Edmonton' },
        defaultTimeMinutes: { type: Number, default: 15 },
        reportingStartTime: { type: String, default: '12:00 AM' },
        reportingEndTime: { type: String, default: '12:00 AM' },
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        commission: { type: Number, default: 0 },
        gstNumber: { type: String, default: '123456789' },
        isEmergencyClosed: { type: Boolean, default: false },
      },
      taxFeesSettings: {
        deliveryFee: { type: Number, default: 4.99 },
        gstTaxRate: { type: Number, default: 5 },
        pstTaxRate: { type: Number, default: 0 },
        hstTaxRate: { type: Number, default: 0 },
      },
      storeTimings: [{
        day: { type: String },
        startTime: { type: String, default: '10:00 AM' },
        endTime: { type: String, default: '09:00 PM' },
        isHoliday: { type: String, default: 'No' },
      }],
      storeTimingsUpdates: [{
        id: { type: String },
        startDate: { type: String },
        endDate: { type: String },
        startTime: { type: String },
        endTime: { type: String },
        status: { type: Boolean, default: true },
        createdAt: { type: String },
      }],
      holidays: [{
        id: { type: String },
        startDate: { type: String },
        endDate: { type: String },
        status: { type: Boolean, default: true },
        createdAt: { type: String },
      }],
      terminals: [{
        id: { type: String },
        realDevices: { type: String, default: 'No' },
        terminalName: { type: String },
        terminalId: { type: String },
        apiToken: { type: String },
        storeId: { type: String },
        createdDate: { type: String },
      }],
      tills: [{
        id: { type: String },
        tillNo: { type: String },
        tillName: { type: String },
        createdDate: { type: String },
      }],
    },
  },
  {
    timestamps: true,
  }
);

branchSchema.index({ code: 1 }, { unique: true });
branchSchema.index({ email: 1 }, { unique: true });
branchSchema.index({ isActive: 1, isLive: 1 });
branchSchema.index({ lat: 1, lng: 1 });

// Hash password, compute location flag, and ensure QR payload before saving
branchSchema.pre("save", async function () {
  if (
    this.lat !== null &&
    this.lng !== null &&
    this.lat !== undefined &&
    this.lng !== undefined &&
    !(this.lat === 0 && this.lng === 0)
  ) {
    this.isLocationConfigured = true;
  } else {
    this.isLocationConfigured = false;
  }

  if (!this.qrCodePayload) {
    this.qrCodePayload = JSON.stringify({
      type: "BRANCH_PAIRING_QR",
      branchId: String(this._id),
      branchName: this.name,
      branchCode: this.code,
    });
  }

  if (!this.isModified("password")) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (err) {
    throw err;
  }
});

// Compare password instance method
branchSchema.methods.comparePassword = async function (candidatePassword) {
  // Fallback for old plain text passwords if any exist
  if (!this.password.startsWith("$2a$") && !this.password.startsWith("$2b$")) {
    return candidatePassword === this.password;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Branch", branchSchema);
