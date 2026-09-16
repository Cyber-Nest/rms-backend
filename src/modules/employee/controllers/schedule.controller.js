const scheduleService = require("../services/schedule.service");

// GET /employees/schedule?branchId=&startDate=&endDate=
exports.getWeeklySchedule = async (req, res) => {
  try {
    const branchId = req.branchId || req.query.branchId;
    const { startDate, endDate } = req.query;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    const data = await scheduleService.getWeeklySchedule(branchId, startDate, endDate);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("getWeeklySchedule error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /employees/schedule
exports.saveShiftSchedule = async (req, res) => {
  try {
    const branchId = req.branchId || req.body.branchId;
    const { employeeId, date, isOff, shifts, notes } = req.body;

    if (!branchId || !employeeId || !date) {
      return res.status(400).json({ success: false, message: "branchId, employeeId, and date are required" });
    }

    const result = await scheduleService.saveShiftSchedule(branchId, {
      employeeId,
      date,
      isOff,
      shifts,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: "Schedule saved successfully",
      data: result,
    });
  } catch (err) {
    console.error("saveShiftSchedule error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /employees/schedule
exports.deleteShiftSchedule = async (req, res) => {
  try {
    const branchId = req.branchId || req.query.branchId;
    const { employeeId, date } = req.query;

    if (!branchId || !employeeId || !date) {
      return res.status(400).json({ success: false, message: "branchId, employeeId, and date are required" });
    }

    await scheduleService.deleteShiftSchedule(branchId, employeeId, date);

    return res.status(200).json({
      success: true,
      message: "Schedule entry deleted",
    });
  } catch (err) {
    console.error("deleteShiftSchedule error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /employees/schedule/copy-week
exports.copyPreviousWeekSchedule = async (req, res) => {
  try {
    const branchId = req.branchId || req.body.branchId;
    const { targetStartDate } = req.body;

    if (!branchId || !targetStartDate) {
      return res.status(400).json({ success: false, message: "branchId and targetStartDate are required" });
    }

    const result = await scheduleService.copyPreviousWeekSchedule(branchId, targetStartDate);

    return res.status(200).json({
      success: true,
      message: `Copied ${result.copiedCount} schedules to week starting ${result.targetStartDate}`,
      data: result,
    });
  } catch (err) {
    console.error("copyPreviousWeekSchedule error:", err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};
