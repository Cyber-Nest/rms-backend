const employeeService = require("../services/employee.service");
const logger = require("../../../shared/utils/logger");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const getBranchIdFromReq = (req) => {
  return (
    req.query.branchId ||
    req.body.branchId ||
    req.headers["x-branch-id"] ||
    req.headers["branchid"] ||
    req.headers["x-branchid"] ||
    req.activeBranchId ||
    req.branch?.branchId ||
    req.branch?._id
  );
};

// Helper: validate that the terminal has an active master session
const validateTerminalSession = (req) => {
  let token = null;

  //Check Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  // Check HTTP cookies
  else if (req.cookies && req.cookies.rms_branch_token) {
    token = req.cookies.rms_branch_token;
  }
  // Check custom headers
  else if (req.headers["x-branch-token"]) {
    token = req.headers["x-branch-token"];
  }
  else if (req.headers["rms_branch_token"]) {
    token = req.headers["rms_branch_token"];
  }
  // Check body / query token
  else if (req.body?.rms_branch_token || req.query?.rms_branch_token) {
    token = req.body?.rms_branch_token || req.query?.rms_branch_token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded) return decoded;
    } catch (e) {
      logger.warn(`Terminal session token verification warning: ${e.message}`);
    }
  }

  const branchId = getBranchIdFromReq(req);
  if (branchId && branchId !== "default") {
    return { branchId };
  }

  return null;
};

exports.createEmployee = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const employee = await employeeService.createEmployee(branchId, req.body);
    res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: employee,
    });
  } catch (error) {
    logger.error(`Error creating employee: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllEmployees = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const employees = await employeeService.getAllEmployees(branchId, req.query);
    res.status(200).json({
      success: true,
      data: employees,
    });
  } catch (error) {
    logger.error(`Error fetching employees: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getEmployeeById = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const employee = await employeeService.getEmployeeById(branchId, req.params.id);
    res.status(200).json({
      success: true,
      data: employee,
    });
  } catch (error) {
    logger.error(`Error fetching employee by ID: ${error.message}`);
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const employee = await employeeService.updateEmployee(branchId, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Employee updated successfully",
      data: employee,
    });
  } catch (error) {
    logger.error(`Error updating employee: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const result = await employeeService.deleteEmployee(branchId, req.params.id);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error(`Error deleting employee: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updatePermissions = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { permissions } = req.body;
    const updated = await employeeService.updatePermissions(branchId, req.params.id, permissions);
    res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      data: updated,
    });
  } catch (error) {
    logger.error(`Error updating permissions: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.verifyPin = async (req, res) => {
  try {
    // ── Terminal session guard ──
    const terminalSession = validateTerminalSession(req);
    if (!terminalSession) {
      return res.status(401).json({
        success: false,
        message: "No active terminal session. Ask manager to do Master Login first.",
      });
    }

    const branchId = getBranchIdFromReq(req);
    const { employeeId, pin } = req.body;
    const result = await employeeService.verifyEmployeePin(branchId, employeeId, pin);
    res.status(200).json({
      success: true,
      message: "PIN verified successfully",
      data: result,
    });
  } catch (error) {
    logger.error(`Error verifying employee PIN: ${error.message}`);
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
};

exports.loginAsCode = async (req, res) => {
  try {
    // ── Terminal session guard ──
    const terminalSession = validateTerminalSession(req);
    if (!terminalSession) {
      return res.status(401).json({
        success: false,
        message: "No active terminal session. Ask manager to do Master Login first.",
      });
    }

    const branchId = getBranchIdFromReq(req);
    const { employeeId, pin } = req.body;
    const result = await employeeService.loginAsCode(branchId, employeeId, pin);
    res.status(200).json({
      success: true,
      message: "Terminal logged in successfully",
      data: result,
    });
  } catch (error) {
    logger.error(`Error in loginAsCode: ${error.message}`);
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
};
