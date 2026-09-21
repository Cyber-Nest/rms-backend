const Attendance = require("../models/attendance.model");
const Employee = require("../models/employee.model");
const Schedule = require("../models/schedule.model");
const Driver = require("../../delivery/models/Driver.model");
const Vehicle = require("../../delivery/models/Vehicle.model");
const bcrypt = require("bcryptjs");
const { DateTime } = require("luxon");

const { triggerAttendanceUpdated, triggerDriverStatusChange } = require("../../../config/pusher");
const { getLocalDateStr, TIMEZONE } = require("../../../shared/utils/timezone");

const getTodayDateStr = () => getLocalDateStr();

// Helper: Calculate minutes between two dates
const diffInMinutes = (start, end) => {
  if (!start || !end) return 0;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60)));
};

function parseTimeToMins(timeStr) {
  if (!timeStr) return 0;
  const str = String(timeStr).trim();
  if (str.includes(":")) {
    const [h, m] = str.split(":");
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }
  const h = parseFloat(str) || 0;
  return Math.round(h * 60);
}

function formatMinutesTo12H(totalMins) {
  let mins = totalMins % 1440;
  if (mins < 0) mins += 1440;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  const mStr = m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mStr} ${period}`;
}

// ── Auto-Checkout Sweeper ──
// Runs on every check-in and attendance list fetch.
// If an employee's autoCheckoutGraceTime has passed and they are still checked in,
// the system automatically closes the shift at the scheduled end time.
const checkAndAutoCheckoutOverdueShifts = async (branchId) => {
  if (!branchId) return;

  try {
    const now = DateTime.now().setZone(TIMEZONE);
    const dateStr = getTodayDateStr();

    // Past-date open shifts (employee forgot to checkout) are also caught via $lte
    const activeRecords = await Attendance.find({
      branchId,
      date: { $lte: dateStr },
      status: { $in: ["checked-in", "on-break"] },
    });

    for (const attendance of activeRecords) {
      const activeShift = attendance.shifts[attendance.shifts.length - 1];
      if (!activeShift || activeShift.checkOut) continue;

      if (activeShift.autoCheckoutGraceTime) {
        const graceTimeDt = DateTime.fromJSDate(activeShift.autoCheckoutGraceTime, { zone: TIMEZONE });
        if (now >= graceTimeDt) {
          // Auto-Checkout triggered
          const [endH, endM] = (activeShift.scheduledShiftEnd || "16:00").split(":").map(Number);
          // Use checkIn date as base so past-date shifts get correct checkout date
          const scheduledCheckOutDt = DateTime.fromJSDate(activeShift.checkIn, { zone: TIMEZONE })
            .set({ hour: endH, minute: endM, second: 0, millisecond: 0 });
          const checkOutJsDate = scheduledCheckOutDt.toJSDate();

          // Auto-close open break if any
          if (attendance.status === "on-break") {
            const openBreak = activeShift.breaks.find((b) => !b.breakOut);
            if (openBreak) {
              openBreak.breakOut = checkOutJsDate;
            }
          }

          // Calculate break minutes
          let totalBreakMins = 0;
          activeShift.breaks.forEach((b) => {
            if (b.breakIn && b.breakOut) {
              totalBreakMins += diffInMinutes(b.breakIn, b.breakOut);
            }
          });
          activeShift.totalBreakMinutes = totalBreakMins;

          const totalShiftMins = diffInMinutes(activeShift.checkIn, checkOutJsDate);
          activeShift.totalWorkMinutes = Math.max(0, totalShiftMins - totalBreakMins);
          activeShift.checkOut = checkOutJsDate;
          activeShift.autoCheckedOut = true;
          activeShift.notes = `Auto-Checked Out by System (Shift End: ${activeShift.scheduledShiftEnd || "Scheduled End"})`;

          attendance.status = "checked-out";
          await attendance.save();

          // Trigger Pusher realtime update
          try {
            await triggerAttendanceUpdated(branchId, {
              employeeId: attendance.employeeId,
              status: "auto-checked-out",
              date: dateStr,
            });
          } catch (pe) {}
        }
      }
    }
  } catch (err) {
    console.error("Error in checkAndAutoCheckoutOverdueShifts:", err.message);
  }
};
exports.checkAndAutoCheckoutOverdueShifts = checkAndAutoCheckoutOverdueShifts;

// ── Check In ──
// Schedule-aware: validates shift times, supports Manager PIN override for unscheduled employees
exports.checkIn = async (branchId, employeeId, managerPin) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  // Run auto-checkout sweeper first
  await checkAndAutoCheckoutOverdueShifts(branchId);

  const employee = await Employee.findOne({ _id: employeeId, branchId, isActive: true });
  if (!employee) {
    throw new Error("Employee not found or inactive");
  }

  const now = DateTime.now().setZone(TIMEZONE);
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

  // ── Schedule Validation ──
  const schedule = await Schedule.findOne({ branchId, employeeId, date: dateStr });

  let matchedSegment = null;
  let isManagerOverride = false;
  let approvingManager = null;

  const isDriverRole = employee.role === "driver";
  const hasValidSchedule = schedule && !schedule.isOff && schedule.shifts && schedule.shifts.length > 0;

  if (isDriverRole) {
    // Drivers are excluded from Employee Schedule matrix — direct check-in allowed
    matchedSegment = null;
    isManagerOverride = false;
  } else if (!hasValidSchedule) {
    // Employee is OFF or No Schedule assigned — Manager PIN required
    if (!managerPin) {
      throw new Error(
        "NOT_SCHEDULED: You are not scheduled to work today. Manager PIN approval is required to check in."
      );
    }

    // Verify Manager PIN
    const managers = await Employee.find({
      branchId,
      isActive: true,
      role: "manager",
    });

    let pinValid = false;
    for (const mgr of managers) {
      const match = await bcrypt.compare(managerPin, mgr.pin);
      if (match) {
        pinValid = true;
        approvingManager = mgr;
        break;
      }
    }

    if (!pinValid) {
      throw new Error("INVALID_MANAGER_PIN: Invalid Manager PIN. Override authorization failed.");
    }

    isManagerOverride = true;
  } else {
    // Employee HAS scheduled shifts for today — validate time window
    const nowMins = now.hour * 60 + now.minute;
    const sortedShifts = [...schedule.shifts].sort(
      (a, b) => parseTimeToMins(a.startTime) - parseTimeToMins(b.startTime)
    );

    // Find closest matching segment
    let candidate = null;
    for (const seg of sortedShifts) {
      const startMins = parseTimeToMins(seg.startTime);
      const endMins = parseTimeToMins(seg.endTime);

      if (nowMins >= startMins - 5 && (nowMins <= endMins || endMins <= startMins)) {
        candidate = seg;
        break;
      }
    }

    if (!candidate) {
      candidate = sortedShifts.find((seg) => parseTimeToMins(seg.startTime) > nowMins) || sortedShifts[0];
    }

    const startMins = parseTimeToMins(candidate.startTime);
    // 5-minute early buffer: earliest allowed = scheduled start - 5 mins
    if (nowMins < startMins - 5) {
      const earliestStr = formatMinutesTo12H(startMins - 5);
      const shiftStartStr = formatMinutesTo12H(startMins);
      throw new Error(
        `EARLY_CHECKIN: Early Check-In Not Allowed! Your shift starts at ${shiftStartStr}. You can check in starting at ${earliestStr}.`
      );
    }

    matchedSegment = candidate;
  }

  // ── Build New Shift Record ──
  let autoCheckoutGraceTime = null;
  let scheduledStartStr = "";
  let scheduledEndStr = "";

  if (matchedSegment) {
    scheduledStartStr = matchedSegment.startTime;
    scheduledEndStr = matchedSegment.endTime;

    const [endH, endM] = matchedSegment.endTime.split(":").map(Number);
    // Grace time = scheduledEnd + 2 minutes
    const graceDt = now
      .set({ hour: endH, minute: endM, second: 0, millisecond: 0 })
      .plus({ minutes: 2 });
    autoCheckoutGraceTime = graceDt.toJSDate();
  }

  attendance.shifts.push({
    checkIn: now.toJSDate(),
    checkOut: null,
    breaks: [],
    totalWorkMinutes: 0,
    totalBreakMinutes: 0,
    scheduledShiftStart: scheduledStartStr,
    scheduledShiftEnd: scheduledEndStr,
    autoCheckoutGraceTime,
    autoCheckedOut: false,
    managerOverride: isManagerOverride,
    managerOverrideBy:
      isManagerOverride && approvingManager
        ? { name: approvingManager.name, employeeId: approvingManager.employeeId }
        : { name: "", employeeId: "" },
    notes: isDriverRole
      ? "Driver Duty Check-In"
      : isManagerOverride && approvingManager
      ? `Checked in via Manager Override — Approved by: ${approvingManager.name} (#${approvingManager.employeeId})`
      : "",
  });

  attendance.status = "checked-in";
  await attendance.save();

  // Trigger Pusher event
  try {
    await triggerAttendanceUpdated(branchId, {
      employeeId,
      status: "checked-in",
      date: dateStr,
    });
  } catch (pe) {}

  return exports.getAttendanceWithEmployee(attendance._id);
};

// ── Break In ──
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

  const hasOpenBreak = activeShift.breaks.some((b) => !b.breakOut);
  if (hasOpenBreak) {
    throw new Error("Employee is already on a break");
  }

  activeShift.breaks.push({
    breakIn: DateTime.now().setZone(TIMEZONE).toJSDate(),
    breakOut: null,
  });

  attendance.status = "on-break";
  await attendance.save();

  return exports.getAttendanceWithEmployee(attendance._id);
};

// ── Break Out ──
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

  openBreak.breakOut = DateTime.now().setZone(TIMEZONE).toJSDate();

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

// ── Check Out ──
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

  // Auto-close open break if on break
  if (attendance.status === "on-break") {
    const openBreak = activeShift.breaks.find((b) => !b.breakOut);
    if (openBreak) {
      openBreak.breakOut = DateTime.now().setZone(TIMEZONE).toJSDate();
    }
  }

  // Lazy Auto-Checkout Grace Check:
  // If employee presses checkout AFTER grace window, snap checkout to scheduledShiftEnd
  const nowDt = DateTime.now().setZone(TIMEZONE);
  let checkOutTime = nowDt.toJSDate();
  let isLateManualCheckout = false;

  if (activeShift.autoCheckoutGraceTime) {
    const graceTimeDt = DateTime.fromJSDate(activeShift.autoCheckoutGraceTime, { zone: TIMEZONE });
    if (nowDt >= graceTimeDt && activeShift.scheduledShiftEnd) {
      const [endH, endM] = activeShift.scheduledShiftEnd.split(":").map(Number);
      const scheduledEndDt = DateTime.fromJSDate(activeShift.checkIn, { zone: TIMEZONE })
        .set({ hour: endH, minute: endM, second: 0, millisecond: 0 });
      checkOutTime = scheduledEndDt.toJSDate();
      isLateManualCheckout = true;
    }
  }

  const now = checkOutTime;
  activeShift.checkOut = now;
  if (isLateManualCheckout) {
    activeShift.autoCheckedOut = true;
    activeShift.notes = `Auto-Checked Out by System (Shift End: ${activeShift.scheduledShiftEnd})`;
  }

  let totalBreakMins = 0;
  activeShift.breaks.forEach((b) => {
    if (b.breakIn && b.breakOut) {
      totalBreakMins += diffInMinutes(b.breakIn, b.breakOut);
    }
  });
  activeShift.totalBreakMinutes = totalBreakMins;

  const totalShiftMins = diffInMinutes(activeShift.checkIn, now);
  activeShift.totalWorkMinutes = Math.max(0, totalShiftMins - totalBreakMins);

  attendance.status = "checked-out";
  await attendance.save();

  // If employee is a driver, auto-set driver offline
  try {
    const employee = await Employee.findOne({ _id: employeeId, branchId }).select("role driverRef employeeId").lean();

    if (employee && (employee.role === "driver" || employee.driverRef)) {
      const driverFilter = employee.driverRef
        ? { _id: employee.driverRef }
        : { driverId: employee.employeeId };

      const driverDoc = await Driver.findOne(driverFilter);
      if (driverDoc) {
        if (driverDoc.assignedVehicleId) {
          await Vehicle.findByIdAndUpdate(driverDoc.assignedVehicleId, {
            isAssigned: false,
            assignedDriverId: null,
          });
        }

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

// ── Get Attendance With Employee Populated ──
exports.getAttendanceWithEmployee = async (attendanceId) => {
  const doc = await Attendance.findById(attendanceId)
    .populate("employeeId", "name employeeId role phone email address isActive")
    .lean();
  return doc;
};

// ── Today's Attendance List ──
exports.getTodayAttendanceList = async (branchId, dateStr = null) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  // Run sweeper on every attendance list fetch
  await checkAndAutoCheckoutOverdueShifts(branchId);

  const targetDate = dateStr || getTodayDateStr();

  const employees = await Employee.find({ branchId, isActive: true })
    .select("name employeeId role phone email address isActive")
    .sort({ name: 1 })
    .lean();

  const attendances = await Attendance.find({ branchId, date: targetDate }).lean();

  const attendanceMap = new Map();
  attendances.forEach((att) => {
    attendanceMap.set(String(att.employeeId), att);
  });

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

// ── Employee Attendance History ──
exports.getEmployeeAttendanceHistory = async (branchId, employeeId, startDate, endDate) => {
  if (!branchId || !employeeId) {
    throw new Error("Branch ID and Employee ID are required");
  }

  const filter = { branchId, employeeId };

  if (startDate && endDate) {
    filter.date = { $gte: startDate, $lte: endDate };
  }

  const history = await Attendance.find(filter).sort({ date: -1 }).lean();

  return history;
};

// ── Attendance Report (Payroll Report) ──
exports.getAttendanceReport = async (branchId, options = {}) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  // Run auto-checkout sweeper first
  await checkAndAutoCheckoutOverdueShifts(branchId);

  const { startDate, endDate, employeeId, role } = options;

  const query = { branchId };

  if (startDate && endDate) {
    query.date = { $gte: startDate, $lte: endDate };
  } else if (startDate) {
    query.date = { $gte: startDate };
  } else if (endDate) {
    query.date = { $lte: endDate };
  }

  if (employeeId) {
    query.employeeId = employeeId;
  }

  const attendanceDocs = await Attendance.find(query)
    .populate("employeeId", "name employeeId role phone email address isActive")
    .sort({ date: -1 })
    .lean();

  const filteredDocs = attendanceDocs.filter((doc) => {
    if (!doc.employeeId) return false;
    if (role && role !== "all") {
      return doc.employeeId.role === role;
    }
    return true;
  });

  const rows = [];
  let grandTotalWorkMins = 0;
  let grandTotalBreakMins = 0;
  let totalShiftsCount = 0;
  const uniqueEmployeeIds = new Set();

  filteredDocs.forEach((doc) => {
    const emp = doc.employeeId;
    if (!emp) return;
    uniqueEmployeeIds.add(String(emp._id));

    const dateStr = doc.date;
    let formattedDateDay = dateStr;
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const dayName = dt.toLocaleDateString("en-US", { weekday: "short" });
      formattedDateDay = `${dateStr} (${dayName})`;
    } catch (e) {}

    const shifts = doc.shifts || [];

    if (shifts.length === 0) {
      rows.push({
        attendanceId: String(doc._id),
        employeeId: emp.employeeId,
        employeeName: emp.name,
        role: emp.role,
        date: dateStr,
        dateDayStr: formattedDateDay,
        startTime: "--",
        endTime: "--",
        totalShiftHours: 0,
        breaks: [],
        totalBreakHours: 0,
        totalPayableHours: 0,
        status: doc.status,
        scheduledShiftStart: "",
        scheduledShiftEnd: "",
        autoCheckedOut: false,
        managerOverride: false,
        notes: "",
        segmentIndex: 1,
        totalSegments: 0,
      });
    } else {
      shifts.forEach((shift, sIdx) => {
        totalShiftsCount++;

        const checkInIso = shift.checkIn;
        const checkOutIso = shift.checkOut;

        const startTimeStr = checkInIso
          ? new Date(checkInIso).toLocaleTimeString("en-US", {
              timeZone: "America/Edmonton",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "--";

        const endTimeStr = checkOutIso
          ? new Date(checkOutIso).toLocaleTimeString("en-US", {
              timeZone: "America/Edmonton",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : shift.checkIn
          ? "Working..."
          : "--";

        const endTime = checkOutIso ? new Date(checkOutIso) : new Date();
        const startTime = checkInIso ? new Date(checkInIso) : new Date();
        const grossMins = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)));
        const grossHrs = parseFloat((grossMins / 60).toFixed(2));

        const breaks = shift.breaks || [];
        let totalBreakMins = 0;

        const formattedBreaks = breaks.map((b) => {
          const bInStr = b.breakIn
            ? new Date(b.breakIn).toLocaleTimeString("en-US", {
                timeZone: "America/Edmonton",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })
            : "--";
          const bOutStr = b.breakOut
            ? new Date(b.breakOut).toLocaleTimeString("en-US", {
                timeZone: "America/Edmonton",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })
            : b.breakIn
            ? "On Break"
            : "--";

          const bDuration = diffInMinutes(b.breakIn, b.breakOut || new Date());
          totalBreakMins += bDuration;

          return {
            breakIn: bInStr,
            breakOut: bOutStr,
            durationMins: bDuration,
          };
        });

        const totalBreakHrs = parseFloat((totalBreakMins / 60).toFixed(2));
        const netWorkMins = Math.max(0, grossMins - totalBreakMins);
        const payableHrs = parseFloat((netWorkMins / 60).toFixed(2));

        grandTotalWorkMins += netWorkMins;
        grandTotalBreakMins += totalBreakMins;

        rows.push({
          attendanceId: String(doc._id),
          shiftId: String(shift._id || sIdx),
          employeeId: emp.employeeId,
          employeeName: emp.name,
          role: emp.role,
          date: dateStr,
          dateDayStr: formattedDateDay,
          startTime: startTimeStr,
          endTime: endTimeStr,
          rawCheckIn: shift.checkIn,
          rawCheckOut: shift.checkOut,
          rawBreaks: (shift.breaks || []).map((b) => ({
            breakIn: b.breakIn,
            breakOut: b.breakOut,
            _id: b._id,
          })),
          totalShiftHours: grossHrs,
          breaks: formattedBreaks,
          totalBreakHours: totalBreakHrs,
          totalPayableHours: payableHrs,
          status: !shift.checkOut ? doc.status : "checked-out",
          scheduledShiftStart: shift.scheduledShiftStart || "",
          scheduledShiftEnd: shift.scheduledShiftEnd || "",
          autoCheckedOut: !!shift.autoCheckedOut,
          managerOverride: !!shift.managerOverride,
          managerOverrideBy: shift.managerOverrideBy || { name: "", employeeId: "" },
          notes: shift.notes || "",
          segmentIndex: sIdx + 1,
          totalSegments: shifts.length,
        });
      });
    }
  });

  return {
    summary: {
      totalPayableHours: parseFloat((grandTotalWorkMins / 60).toFixed(2)),
      totalBreakHours: parseFloat((grandTotalBreakMins / 60).toFixed(2)),
      totalShifts: totalShiftsCount,
      totalEmployees: uniqueEmployeeIds.size,
    },
    rows,
  };
};

// ── Edit Attendance Shift (Manager correction) ──
exports.editAttendanceShift = async (branchId, payload) => {
  const { attendanceId, shiftId, checkIn, checkOut, breaks } = payload;

  if (!attendanceId) {
    throw new Error("Attendance Record ID is required");
  }

  const query = { _id: attendanceId };
  if (branchId) {
    query.branchId = branchId;
  }

  const doc = await Attendance.findOne(query);
  if (!doc) {
    throw new Error("Attendance record not found");
  }

  let shift = doc.shifts.id(shiftId);
  if (!shift && typeof shiftId === "number") {
    shift = doc.shifts[shiftId];
  }
  if (!shift) {
    shift = doc.shifts[0];
  }
  if (!shift) {
    throw new Error("Shift record not found");
  }

  if (checkIn) {
    shift.checkIn = new Date(checkIn);
  }

  if (checkOut !== undefined) {
    shift.checkOut = checkOut ? new Date(checkOut) : null;
  }

  if (Array.isArray(breaks)) {
    shift.breaks = breaks.map((b) => ({
      breakIn: new Date(b.breakIn),
      breakOut: b.breakOut ? new Date(b.breakOut) : null,
    }));
  }

  let totalBreakMins = 0;
  (shift.breaks || []).forEach((b) => {
    if (b.breakIn) {
      const duration = diffInMinutes(b.breakIn, b.breakOut || new Date());
      totalBreakMins += duration;
    }
  });

  const startTime = shift.checkIn ? new Date(shift.checkIn) : new Date();
  const endTime = shift.checkOut ? new Date(shift.checkOut) : new Date();
  const grossMins = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)));

  shift.totalBreakMinutes = totalBreakMins;
  shift.totalWorkMinutes = Math.max(0, grossMins - totalBreakMins);

  if (shift.checkOut) {
    doc.status = "checked-out";
  } else {
    const lastBreak = shift.breaks && shift.breaks[shift.breaks.length - 1];
    if (lastBreak && lastBreak.breakIn && !lastBreak.breakOut) {
      doc.status = "on-break";
    } else {
      doc.status = "checked-in";
    }
  }

  doc.markModified("shifts");
  await doc.save();

  // Trigger Pusher realtime update
  try {
    await triggerAttendanceUpdated(branchId, {
      employeeId: doc.employeeId,
      status: "shift-edited",
      date: doc.date,
    });
  } catch (pe) {}

  return exports.getAttendanceReport(branchId, {
    employeeId: doc.employeeId,
    startDate: doc.date,
    endDate: doc.date,
  });
};
