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
    },
  },
  {
    timestamps: true,
  }
);

branchSchema.index({ code: 1 }, { unique: true });
branchSchema.index({ email: 1 }, { unique: true });

// Hash password before saving if modified
branchSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
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
