const branchService = require("../services/branch.service");
const logger = require("../../../shared/utils/logger");

exports.createBranch = async (req, res) => {
  try {
    const branch = await branchService.createBranch(req.body);
    res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: branch,
    });
  } catch (error) {
    logger.error(`Error creating branch: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllBranches = async (req, res) => {
  try {
    const branches = await branchService.getAllBranches(req.query);
    res.status(200).json({
      success: true,
      data: branches,
    });
  } catch (error) {
    logger.error(`Error fetching branches: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getBranchById = async (req, res) => {
  try {
    const branch = await branchService.getBranchById(req.params.id);
    res.status(200).json({
      success: true,
      data: branch,
    });
  } catch (error) {
    logger.error(`Error fetching branch by ID: ${error.message}`);
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const branch = await branchService.updateBranch(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      data: branch,
    });
  } catch (error) {
    logger.error(`Error updating branch: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    await branchService.deleteBranch(req.params.id);
    res.status(200).json({
      success: true,
      message: "Branch deleted successfully",
    });
  } catch (error) {
    logger.error(`Error deleting branch: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.loginBranch = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const { branch, token } = await branchService.loginBranch(email, password);

    res.cookie("rms_branch_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

    res.status(200).json({
      success: true,
      message: "Branch login successful",
      data: {
        ...branch,
        token,
      },
    });
  } catch (error) {
    logger.error(`Error logging in branch: ${error.message}`);
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
};

exports.logoutBranch = async (req, res) => {
  res.clearCookie("rms_branch_token");
  res.status(200).json({
    success: true,
    message: "Branch logged out successfully",
  });
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const branchId = req.branch?._id || req.body.branchId;

    if (!branchId || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Branch ID, current password, and new password are required",
      });
    }

    const result = await branchService.changeBranchPassword(branchId, currentPassword, newPassword);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error(`Error changing branch password: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getMe = async (req, res) => {
  try {
    const branchId = req.branch?.branchId || req.branch?._id;
    if (!branchId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Branch ID missing in token",
      });
    }

    const branch = await branchService.getBranchById(branchId);
    if (!branch.isActive) {
      return res.status(401).json({
        success: false,
        message: "This branch is inactive",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: branch._id,
        name: branch.name,
        code: branch.code,
        email: branch.email,
        address: branch.address,
        city: branch.city,
        phone: branch.phone,
        lat: branch.lat,
        lng: branch.lng,
        isActive: branch.isActive,
      },
    });
  } catch (error) {
    logger.error(`Error fetching logged in branch profile: ${error.message}`);
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
};
