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

exports.getAllBranches = async (query = {}) => {
  const filter = {};
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true" || query.isActive === true;
  }
  return await Branch.find(filter).sort({ createdAt: -1 });
};

exports.getBranchById = async (id) => {
  const branch = await Branch.findById(id);
  if (!branch) {
    throw new Error("Branch not found");
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
