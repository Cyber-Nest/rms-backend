const Schedule = require("../models/schedule.model");
const Employee = require("../models/employee.model");
const Branch = require("../../company/models/branch.model");
const { getLocalDateStr, TIMEZONE } = require("../../../shared/utils/timezone");
const { DateTime } = require("luxon");

/**
 * Calculate shift duration in hours between HH:mm (or H) start and end times.
 * Handles overnight shifts (e.g. 16:00 to 01:00 = 9 hours).
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const str = String(timeStr).trim();
  if (str.includes(":")) {
    const [h, m] = str.split(":");
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }
  const h = parseFloat(str) || 0;
  return Math.round(h * 60);
}

function calculateShiftHours(startTime, endTime) {
  const startMins = parseTimeToMinutes(startTime);
  let endMins = parseTimeToMinutes(endTime);

  if (endMins <= startMins) {
    // Overnight shift: add 24 hours (1440 mins)
    endMins += 1440;
  }

  const diffMins = endMins - startMins;
  return Math.round((diffMins / 60) * 100) / 100;
}

/**
 * Fetch weekly schedule matrix for a given branch and date range (YYYY-MM-DD)
 */
exports.getWeeklySchedule = async (branchId, startDate, endDate) => {
  if (!branchId) throw new Error("branchId is required.");

  const start = startDate || getLocalDateStr();
  const startDt = DateTime.fromISO(start, { zone: TIMEZONE });
  const endDt = endDate
    ? DateTime.fromISO(endDate, { zone: TIMEZONE })
    : startDt.plus({ days: 6 });

  const startStr = startDt.toFormat("yyyy-MM-dd");
  const endStr = endDt.toFormat("yyyy-MM-dd");

  // Get active branch employees (excluding drivers)
  const employees = await Employee.find({
    branchId,
    isActive: true,
    role: { $ne: "driver" },
  })
    .select("_id employeeId name role phone email")
    .sort({ name: 1 })
    .lean();

  // Fetch all schedules in date range
  const schedules = await Schedule.find({
    branchId,
    date: { $gte: startStr, $lte: endStr },
  }).lean();

  // Map schedules by employeeId_date key
  const scheduleMap = new Map();
  schedules.forEach((s) => {
    const key = `${s.employeeId.toString()}_${s.date}`;
    scheduleMap.set(key, s);
  });

  // Get Branch details for header
  const branchObj = await Branch.findById(branchId)
    .select("name code address city province")
    .lean();

  return {
    branchInfo: {
      id: branchId,
      name: branchObj?.name || "Chicken Delight",
      code: branchObj?.code || "MAIN",
      address: branchObj?.address || "",
      locationStr: `${branchObj?.name || "CHICKEN DELIGHT"} (${branchObj?.address || ""}, ${branchObj?.city || ""}, ${branchObj?.province || "AB"})`,
    },
    startDate: startStr,
    endDate: endStr,
    employees,
    scheduleMap: Object.fromEntries(scheduleMap),
  };
};

/**
 * Upsert shift schedule entry for employee on date
 */
exports.saveShiftSchedule = async (branchId, payload) => {
  const { employeeId, date, isOff, shifts, notes } = payload;
  if (!branchId || !employeeId || !date) {
    throw new Error("branchId, employeeId, and date are required.");
  }

  let formattedShifts = [];
  let totalHours = 0;

  if (!isOff && Array.isArray(shifts)) {
    formattedShifts = shifts
      .filter((s) => s.startTime && s.endTime)
      .map((s) => {
        const segHours = calculateShiftHours(s.startTime, s.endTime);
        totalHours += segHours;
        return {
          startTime: String(s.startTime).trim(),
          endTime: String(s.endTime).trim(),
          hours: segHours,
        };
      });
  }

  totalHours = Math.round(totalHours * 100) / 100;

  const updated = await Schedule.findOneAndUpdate(
    { branchId, employeeId, date },
    {
      branchId,
      employeeId,
      date,
      isOff: !!isOff,
      shifts: isOff ? [] : formattedShifts,
      totalHours: isOff ? 0 : totalHours,
      notes: notes || "",
    },
    { new: true, upsert: true, runValidators: true }
  );

  return updated;
};

/**
 * Copy schedule from previous 7 days to target week (starting at targetStartDate)
 */
exports.copyPreviousWeekSchedule = async (branchId, targetStartDate) => {
  if (!branchId || !targetStartDate) {
    throw new Error("branchId and targetStartDate are required.");
  }

  const targetStartDt = DateTime.fromISO(targetStartDate, { zone: TIMEZONE });
  const prevStartDt = targetStartDt.minus({ days: 7 });

  const prevStartStr = prevStartDt.toFormat("yyyy-MM-dd");
  const prevEndStr = prevStartDt.plus({ days: 6 }).toFormat("yyyy-MM-dd");

  // Fetch previous week's schedule
  const prevSchedules = await Schedule.find({
    branchId,
    date: { $gte: prevStartStr, $lte: prevEndStr },
  }).lean();

  if (prevSchedules.length === 0) {
    throw new Error("No schedule found in the previous week to copy.");
  }

  let copiedCount = 0;
  for (const prev of prevSchedules) {
    const prevDateDt = DateTime.fromISO(prev.date, { zone: TIMEZONE });
    const dayDiff = prevDateDt.diff(prevStartDt, "days").days;
    const newDateStr = targetStartDt
      .plus({ days: dayDiff })
      .toFormat("yyyy-MM-dd");

    await Schedule.findOneAndUpdate(
      { branchId, employeeId: prev.employeeId, date: newDateStr },
      {
        branchId,
        employeeId: prev.employeeId,
        date: newDateStr,
        isOff: prev.isOff,
        shifts: prev.shifts || [],
        totalHours: prev.totalHours || 0,
        notes: prev.notes || "",
      },
      { upsert: true, new: true }
    );
    copiedCount++;
  }

  return { copiedCount, targetStartDate };
};

/**
 * Delete / Clear shift schedule for employee on date
 */
exports.deleteShiftSchedule = async (branchId, employeeId, date) => {
  if (!branchId || !employeeId || !date) {
    throw new Error("branchId, employeeId, and date are required.");
  }
  await Schedule.deleteOne({ branchId, employeeId, date });
  return { success: true };
};
