const employeeService = require("../services/employee.service");
const logger = require("../../../shared/utils/logger");

const getBranchIdFromReq = (req) => {
  return (
    req.query.branchId ||
    req.body.branchId ||
    req.activeBranchId ||
    req.branch?.branchId ||
    req.branch?._id
  );
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

exports.verifyPin = async (req, res) => {
  try {
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
