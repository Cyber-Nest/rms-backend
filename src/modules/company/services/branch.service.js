const Branch = require("../models/branch.model");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "rms_super_secret_jwt_key";

exports.createBranch = async (branchData) => {
  const existingCode = await Branch.findOne({ code: branchData.code.toUpperCase() });
  if (existingCode) {
    throw new Error(`Branch with code '${branchData.code}' already exists.`);
  }

  const existingEmail = await Branch.findOne({ email: branchData.email.toLowerCase() });
  if (existingEmail) {
    throw new Error(`Branch with email '${branchData.email}' already exists.`);
  }

  const branch = new Branch({
    ...branchData,
    code: branchData.code.toUpperCase(),
    email: branchData.email.toLowerCase(),
  });

  return await branch.save();
};

exports.ensureBranchQrCodes = async () => {
  try {
    const unseededBranches = await Branch.find({
      $or: [{ qrCodePayload: { $exists: false } }, { qrCodePayload: "" }, { qrCodePayload: null }],
    });
    if (unseededBranches.length === 0) return;

    for (const b of unseededBranches) {
      b.qrCodePayload = JSON.stringify({
        type: "BRANCH_PAIRING_QR",
        branchId: String(b._id),
        branchName: b.name,
        branchCode: b.code,
      });
      await b.save();
    }
  } catch (err) {
    console.error("Error generating branch QR codes:", err.message);
  }
};

exports.getAllBranches = async (query = {}) => {
  await exports.ensureBranchQrCodes();
  const filter = {};
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true" || query.isActive === true;
  }
  return await Branch.find(filter).sort({ createdAt: -1 });
};

exports.getPublicBranches = async () => {
  await exports.ensureBranchQrCodes();
  return await Branch.find({ isActive: true })
    .select("name code address phone email openingHours isActive qrCodePayload")
    .sort({ name: 1 })
    .lean();
};

exports.getBranchById = async (id) => {
  const branch = await Branch.findById(id);
  if (!branch) {
    throw new Error("Branch not found");
  }
  if (!branch.qrCodePayload) {
    branch.qrCodePayload = JSON.stringify({
      type: "BRANCH_PAIRING_QR",
      branchId: String(branch._id),
      branchName: branch.name,
      branchCode: branch.code,
    });
    await branch.save();
  }
  return branch;
};

exports.updateBranch = async (id, updateData) => {
  if (updateData.code) {
    updateData.code = updateData.code.toUpperCase();
    const existing = await Branch.findOne({ code: updateData.code, _id: { $ne: id } });
    if (existing) {
      throw new Error(`Branch code '${updateData.code}' is already taken.`);
    }
  }

  if (updateData.email) {
    updateData.email = updateData.email.toLowerCase();
    const existing = await Branch.findOne({ email: updateData.email, _id: { $ne: id } });
    if (existing) {
      throw new Error(`Branch email '${updateData.email}' is already taken.`);
    }
  }

  // If updating password, fetch branch & let pre-save hook hash it
  let branch = await Branch.findById(id);
  if (!branch) {
    throw new Error("Branch not found");
  }

  Object.assign(branch, updateData);
  return await branch.save();
};

exports.deleteBranch = async (id) => {
  const branch = await Branch.findByIdAndDelete(id);
  if (!branch) {
    throw new Error("Branch not found");
  }
  return branch;
};

exports.loginBranch = async (email, password) => {
  const branch = await Branch.findOne({ email: email.toLowerCase() });
  if (!branch) {
    throw new Error("Invalid branch email or password");
  }

  if (!branch.isActive) {
    throw new Error("This branch account is inactive. Please contact admin.");
  }

  const isMatch = await branch.comparePassword(password);
  if (!isMatch) {
    throw new Error("Invalid branch email or password");
  }

  const token = jwt.sign(
    {
      branchId: branch._id,
      name: branch.name,
      code: branch.code,
      email: branch.email,
      role: "branch",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return {
    branch: {
      _id: branch._id,
      name: branch.name,
      code: branch.code,
      email: branch.email,
      address: branch.address,
      city: branch.city,
      phone: branch.phone,
      lat: branch.lat,
      lng: branch.lng,
    },
    token,
  };
};

exports.changeBranchPassword = async (branchId, currentPassword, newPassword) => {
  const branch = await Branch.findById(branchId);
  if (!branch) {
    throw new Error("Branch not found");
  }

  const isMatch = await branch.comparePassword(currentPassword);
  if (!isMatch) {
    throw new Error("Current password is incorrect");
  }

  branch.password = newPassword;
  await branch.save();
  return { message: "Password updated successfully" };
};

exports.getBranchSettings = async (branchId) => {
  const branch = await Branch.findById(branchId).select("settings name code").lean();
  if (!branch) {
    throw new Error("Branch not found");
  }
  return branch.settings || {};
};

exports.updateBranchSettings = async (branchId, settingsData) => {
  const $set = {};

  if (settingsData.mainSettings) {
    const ms = settingsData.mainSettings;
    // Cast numeric fields explicitly so they save correctly
    if (ms.defaultTimeMinutes !== undefined) ms.defaultTimeMinutes = Number(ms.defaultTimeMinutes) || 15;
    if (ms.defaultTime !== undefined) ms.defaultTimeMinutes = Number(ms.defaultTimeMinutes || ms.defaultTime) || 15;
    if (ms.latitude !== undefined) ms.latitude = Number(ms.latitude) || 0;
    if (ms.longitude !== undefined) ms.longitude = Number(ms.longitude) || 0;
    if (ms.commission !== undefined) ms.commission = Number(ms.commission) || 0;
    $set['settings.mainSettings'] = ms;
  }
  if (settingsData.taxFeesSettings) {
    const tf = settingsData.taxFeesSettings;
    if (tf.deliveryFee !== undefined) tf.deliveryFee = Number(tf.deliveryFee) || 0;
    if (tf.gstTaxRate !== undefined) tf.gstTaxRate = Number(tf.gstTaxRate) || 0;
    if (tf.pstTaxRate !== undefined) tf.pstTaxRate = Number(tf.pstTaxRate) || 0;
    if (tf.hstTaxRate !== undefined) tf.hstTaxRate = Number(tf.hstTaxRate) || 0;
    $set['settings.taxFeesSettings'] = tf;
  }
  if (settingsData.storeTimings) {
    $set['settings.storeTimings'] = settingsData.storeTimings;
  }
  if (settingsData.storeTimingsUpdates) {
    $set['settings.storeTimingsUpdates'] = settingsData.storeTimingsUpdates;
  }
  if (settingsData.holidays) {
    $set['settings.holidays'] = settingsData.holidays;
  }
  if (settingsData.terminals) {
    $set['settings.terminals'] = settingsData.terminals;
  }
  if (settingsData.tills) {
    $set['settings.tills'] = settingsData.tills;
  }

  const updated = await Branch.findByIdAndUpdate(
    branchId,
    { $set },
    { new: true, runValidators: false }
  ).lean();

  if (!updated) throw new Error('Branch not found');
  return updated.settings || {};
};
