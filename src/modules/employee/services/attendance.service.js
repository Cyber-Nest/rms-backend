const Attendance = require("../models/attendance.model");
const Employee = require("../models/employee.model");
const Driver = require("../../delivery/models/Driver.model");
const Vehicle = require("../../delivery/models/Vehicle.model");

const { triggerDriverStatusChange } = require("../../../config/pusher");

const getTodayDateStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper: Calculate minutes between two dates
const diffInMinutes = (start, end) => {
  if (!start || !end) return 0;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60)));
};

exports.checkIn = async (branchId, employeeId) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const employee = await Employee.findOne({ _id: employeeId, branchId, isActive: true });
  if (!employee) {
    throw new Error("Employee not found or inactive");
  }

  const dateStr = getTodayDateStr();
  let attendance = await Attendance.findOne({ branchId, employeeId, date: dateStr });

  if (!attendance) {
    attendance = new Attendance({
      branchId,
      employeeId,
      date: dateStr,
      status: "checked-out",
      shifts: [],
    });
  }

  if (attendance.status === "checked-in" || attendance.status === "on-break") {
    throw new Error("Employee is already checked in");
  }

  // Create new shift
  attendance.shifts.push({
    checkIn: new Date(),
    checkOut: null,
    breaks: [],
    totalWorkMinutes: 0,
    totalBreakMinutes: 0,
  });

  attendance.status = "checked-in";
  await attendance.save();

  return exports.getAttendanceWithEmployee(attendance._id);
};

exports.breakIn = async (branchId, employeeId) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const dateStr = getTodayDateStr();
  const attendance = await Attendance.findOne({ branchId, employeeId, date: dateStr });

  if (!attendance || attendance.status !== "checked-in") {
    throw new Error("Employee must be checked-in to start a break");
  }

  const activeShift = attendance.shifts[attendance.shifts.length - 1];
  if (!activeShift || activeShift.checkOut) {
    throw new Error("No active shift found to start break");
  }

  // Check if already on open break
  const hasOpenBreak = activeShift.breaks.some((b) => !b.breakOut);
  if (hasOpenBreak) {
    throw new Error("Employee is already on a break");
  }

  activeShift.breaks.push({
    breakIn: new Date(),
    breakOut: null,
  });

  attendance.status = "on-break";
  await attendance.save();

  return exports.getAttendanceWithEmployee(attendance._id);
};

exports.breakOut = async (branchId, employeeId) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const dateStr = getTodayDateStr();
  const attendance = await Attendance.findOne({ branchId, employeeId, date: dateStr });

  if (!attendance || attendance.status !== "on-break") {
    throw new Error("Employee is not currently on break");
  }

  const activeShift = attendance.shifts[attendance.shifts.length - 1];
  if (!activeShift || activeShift.checkOut) {
    throw new Error("No active shift found to end break");
  }

  const openBreak = activeShift.breaks.find((b) => !b.breakOut);
  if (!openBreak) {
    throw new Error("No active break found to end");
  }

  openBreak.breakOut = new Date();

  // Recalculate total break minutes for this shift
  let totalBreakMins = 0;
  activeShift.breaks.forEach((b) => {
    if (b.breakIn && b.breakOut) {
      totalBreakMins += diffInMinutes(b.breakIn, b.breakOut);
    }
  });
  activeShift.totalBreakMinutes = totalBreakMins;

  attendance.status = "checked-in";
  await attendance.save();

  return exports.getAttendanceWithEmployee(attendance._id);
};

exports.checkOut = async (branchId, employeeId) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const dateStr = getTodayDateStr();
  const attendance = await Attendance.findOne({ branchId, employeeId, date: dateStr });

  if (!attendance || attendance.status === "checked-out") {
    throw new Error("Employee is not currently checked in");
  }

  const activeShift = attendance.shifts[attendance.shifts.length - 1];
  if (!activeShift || activeShift.checkOut) {
    throw new Error("No active shift found to check out");
  }

  // If on break, auto close break first
  if (attendance.status === "on-break") {
    const openBreak = activeShift.breaks.find((b) => !b.breakOut);
    if (openBreak) {
      openBreak.breakOut = new Date();
    }
  }

  const now = new Date();
  activeShift.checkOut = now;

  // Calculate total break minutes
  let totalBreakMins = 0;
  activeShift.breaks.forEach((b) => {
    if (b.breakIn && b.breakOut) {
      totalBreakMins += diffInMinutes(b.breakIn, b.breakOut);
    }
  });
  activeShift.totalBreakMinutes = totalBreakMins;

  // Calculate total gross shift minutes and net work minutes
  const totalShiftMins = diffInMinutes(activeShift.checkIn, now);
  activeShift.totalWorkMinutes = Math.max(0, totalShiftMins - totalBreakMins);

  attendance.status = "checked-out";
  await attendance.save();

  // If employee is a driver, automatically update Driver model status to offline and unassign vehicle
  try {
    const employee = await Employee.findOne({ _id: employeeId, branchId }).select("role driverRef employeeId").lean();

    if (employee && (employee.role === "driver" || employee.driverRef)) {

      const driverFilter = employee.driverRef
        ? { _id: employee.driverRef }
        : { driverId: employee.employeeId };

      const driverDoc = await Driver.findOne(driverFilter);
      if (driverDoc) {
        // Auto-unassign vehicle if assigned
        if (driverDoc.assignedVehicleId) {
          await Vehicle.findByIdAndUpdate(driverDoc.assignedVehicleId, {
            isAssigned: false,
            assignedDriverId: null,
          });
        }

        // Set driver offline, unassign vehicle, clear active orders
        driverDoc.status = "offline";
        driverDoc.isDutyOnline = false;
        driverDoc.assignedVehicleId = null;
        driverDoc.activeOrderIds = [];
        await driverDoc.save();

        try {
          await triggerDriverStatusChange(String(branchId), {
            driverId: driverDoc._id.toString(),
            status: "offline",
            posCheckedIn: false,
            checkedOut: true,
          });
        } catch (pe) {}
      }
    }
  } catch (err) {
    console.warn("Could not set driver status offline on checkout:", err.message);
  }

  return exports.getAttendanceWithEmployee(attendance._id);
};

exports.getAttendanceWithEmployee = async (attendanceId) => {
  const doc = await Attendance.findById(attendanceId)
    .populate("employeeId", "name employeeId role phone email address isActive")
    .lean();
  return doc;
};

exports.getTodayAttendanceList = async (branchId, dateStr = null) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const targetDate = dateStr || getTodayDateStr();

  // Get all active employees for this branch
  const employees = await Employee.find({ branchId, isActive: true })
    .select("name employeeId role phone email address isActive")
    .sort({ name: 1 })
    .lean();

  // Get today's attendance records
  const attendances = await Attendance.find({ branchId, date: targetDate }).lean();

  const attendanceMap = new Map();
  attendances.forEach((att) => {
    attendanceMap.set(String(att.employeeId), att);
  });

  // Combine employees with their attendance status
  const result = employees.map((emp) => {
    const att = attendanceMap.get(String(emp._id));
    return {
      employee: emp,
      attendance: att || null,
      status: att ? att.status : "checked-out",
      shifts: att ? att.shifts : [],
    };
  });

  return {
    date: targetDate,
    records: result,
  };
};

exports.getEmployeeAttendanceHistory = async (branchId, employeeId, startDate, endDate) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const filter = { branchId, employeeId };

  if (startDate && endDate) {
    filter.date = { $gte: startDate, $lte: endDate };
  }

  const history = await Attendance.find(filter)
    .sort({ date: -1 })
    .lean();

  return history;
};
