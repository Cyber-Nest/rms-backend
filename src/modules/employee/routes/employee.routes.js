const express = require("express");
const router = express.Router();
const employeeController = require("../controllers/employee.controller");
const attendanceController = require("../controllers/attendance.controller");
const scheduleController = require("../controllers/schedule.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");
const enforceBranch = require("../../../shared/middleware/enforceBranch");

// ── PIN Verification & Terminal Session Login (must come BEFORE /:id) ──
router.post("/employees/verify-pin", protectBranch, enforceBranch, employeeController.verifyPin);
router.post("/employees/login-code", protectBranch, enforceBranch, employeeController.loginAsCode);

// ── Employee Schedule Routes (must come BEFORE /:id) ──
router.get("/employees/schedule", protectBranch, enforceBranch, scheduleController.getWeeklySchedule);
router.post("/employees/schedule", protectBranch, enforceBranch, scheduleController.saveShiftSchedule);
router.delete("/employees/schedule", protectBranch, enforceBranch, scheduleController.deleteShiftSchedule);
router.post("/employees/schedule/copy-week", protectBranch, enforceBranch, scheduleController.copyPreviousWeekSchedule);

// ── Employee CRUD Routes (parameterized — must come AFTER specific routes) ──
router.post("/employees", protectBranch, enforceBranch, employeeController.createEmployee);
router.get("/employees", protectBranch, enforceBranch, employeeController.getAllEmployees);
router.get("/employee/employees", protectBranch, enforceBranch, employeeController.getAllEmployees);
router.get("/employees/:id", protectBranch, enforceBranch, employeeController.getEmployeeById);
router.patch("/employees/:id", protectBranch, enforceBranch, employeeController.updateEmployee);
router.delete("/employees/:id", protectBranch, enforceBranch, employeeController.deleteEmployee);
router.patch("/employees/:id/permissions", protectBranch, enforceBranch, employeeController.updatePermissions);

// ── Attendance Action Routes ──
router.post("/attendance/check-in", protectBranch, enforceBranch, attendanceController.checkIn);
router.post("/attendance/break-in", protectBranch, enforceBranch, attendanceController.breakIn);
router.post("/attendance/break-out", protectBranch, enforceBranch, attendanceController.breakOut);
router.post("/attendance/check-out", protectBranch, enforceBranch, attendanceController.checkOut);
router.get("/attendance", protectBranch, enforceBranch, attendanceController.getTodayAttendanceList);
router.get("/attendance/employee/:employeeId", protectBranch, enforceBranch, attendanceController.getEmployeeAttendanceHistory);

// ── Attendance Report & Edit Routes ──
router.get("/attendance/report", protectBranch, enforceBranch, attendanceController.getAttendanceReport);
router.patch("/attendance/edit-shift", protectBranch, enforceBranch, attendanceController.editAttendanceShift);

module.exports = router;

