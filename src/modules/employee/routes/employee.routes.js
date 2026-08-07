const express = require("express");
const router = express.Router();
const employeeController = require("../controllers/employee.controller");
const attendanceController = require("../controllers/attendance.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");
const enforceBranch = require("../../../shared/middleware/enforceBranch");

// ── Protected Employee Management Routes ──
router.post("/employees", protectBranch, enforceBranch, employeeController.createEmployee);
router.get("/employees", protectBranch, enforceBranch, employeeController.getAllEmployees);
router.get("/employee/employees", protectBranch, enforceBranch, employeeController.getAllEmployees);
router.get("/employees/:id", protectBranch, enforceBranch, employeeController.getEmployeeById);
router.patch("/employees/:id", protectBranch, enforceBranch, employeeController.updateEmployee);
router.delete("/employees/:id", protectBranch, enforceBranch, employeeController.deleteEmployee);
router.patch("/employees/:id/permissions", protectBranch, enforceBranch, employeeController.updatePermissions);

// PIN Verification & Terminal Session Login
router.post("/employees/verify-pin", protectBranch, enforceBranch, employeeController.verifyPin);
router.post("/employees/login-code", protectBranch, enforceBranch, employeeController.loginAsCode);

// Attendance Actions
router.post("/attendance/check-in", protectBranch, enforceBranch, attendanceController.checkIn);
router.post("/attendance/break-in", protectBranch, enforceBranch, attendanceController.breakIn);
router.post("/attendance/break-out", protectBranch, enforceBranch, attendanceController.breakOut);
router.post("/attendance/check-out", protectBranch, enforceBranch, attendanceController.checkOut);
router.get("/attendance", protectBranch, enforceBranch, attendanceController.getTodayAttendanceList);
router.get("/attendance/employee/:employeeId", protectBranch, enforceBranch, attendanceController.getEmployeeAttendanceHistory);

module.exports = router;
