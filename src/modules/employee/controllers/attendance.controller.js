const attendanceService = require("../services/attendance.service");
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

exports.checkIn = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { employeeId } = req.body;
    const data = await attendanceService.checkIn(branchId, employeeId);
    res.status(200).json({
      success: true,
      message: "Checked in successfully",
      data,
    });
  } catch (error) {
    logger.error(`Error in checkIn: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.breakIn = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { employeeId } = req.body;
    const data = await attendanceService.breakIn(branchId, employeeId);
    res.status(200).json({
      success: true,
      message: "Break started successfully",
      data,
    });
  } catch (error) {
    logger.error(`Error in breakIn: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.breakOut = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { employeeId } = req.body;
    const data = await attendanceService.breakOut(branchId, employeeId);
    res.status(200).json({
      success: true,
      message: "Break ended successfully",
      data,
    });
  } catch (error) {
    logger.error(`Error in breakOut: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { employeeId } = req.body;
    const data = await attendanceService.checkOut(branchId, employeeId);
    res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data,
    });
  } catch (error) {
    logger.error(`Error in checkOut: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTodayAttendanceList = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const dateStr = req.query.date || null;
    const data = await attendanceService.getTodayAttendanceList(branchId, dateStr);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error(`Error fetching today attendance list: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getEmployeeAttendanceHistory = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;
    const data = await attendanceService.getEmployeeAttendanceHistory(branchId, employeeId, startDate, endDate);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error(`Error fetching employee attendance history: ${error.message}`);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
