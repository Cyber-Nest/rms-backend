const express = require("express");
const router = express.Router();
const employeeController = require("../controllers/employee.controller");
const attendanceController = require("../controllers/attendance.controller");

// Employee CRUD
router.post("/employees", employeeController.createEmployee);
router.get("/employees", employeeController.getAllEmployees);
router.get("/employee/employees", employeeController.getAllEmployees);
router.get("/employees/:id", employeeController.getEmployeeById);
router.patch("/employees/:id", employeeController.updateEmployee);
router.delete("/employees/:id", employeeController.deleteEmployee);
router.patch("/employees/:id/permissions", employeeController.updatePermissions);

// PIN Verification for Check-In/Out modal
router.post("/employees/verify-pin", employeeController.verifyPin);

// Terminal Session Login As Code
router.post("/employees/login-code", employeeController.loginAsCode);

// Attendance Actions
router.post("/attendance/check-in", attendanceController.checkIn);
router.post("/attendance/break-in", attendanceController.breakIn);
router.post("/attendance/break-out", attendanceController.breakOut);
router.post("/attendance/check-out", attendanceController.checkOut);
router.get("/attendance", attendanceController.getTodayAttendanceList);
router.get("/attendance/employee/:employeeId", attendanceController.getEmployeeAttendanceHistory);

module.exports = router;
