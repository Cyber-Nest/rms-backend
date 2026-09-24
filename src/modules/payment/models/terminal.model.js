const mongoose = require("mongoose");

const terminalSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    terminalName: { type: String, required: true, trim: true },
    terminalId:   { type: String, required: true, trim: true }, // Moneris Terminal ID (e.g. A2080515)
    apiToken:     { type: String, required: true },              // Moneris API Token
    storeId:      { type: String, required: true, trim: true }, // Moneris Store ID
    istConfigCode:{ type: String, default: "" },                // Moneris IST Config Code (required for Cloud API)
    isRealDevice: { type: Boolean, default: false },            // false = sandbox, true = production
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "Manager" },
  },
  { timestamps: true }
);

terminalSchema.index({ branchId: 1, isActive: 1 });

module.exports = mongoose.model("Terminal", terminalSchema);
