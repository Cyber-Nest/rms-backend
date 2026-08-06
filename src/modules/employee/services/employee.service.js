const Employee = require("../models/employee.model");
const Driver = require("../../delivery/models/Driver.model");
const Attendance = require("../models/attendance.model");

// Helper to get local date string YYYY-MM-DD
const getTodayDateStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Generate next Employee ID for a branch: 001, 002, 003, etc.
const generateNextEmployeeId = async (branchId) => {
  const employees = await Employee.find({ branchId }).select("employeeId").lean();
  let maxSeq = 0;
  
  employees.forEach((emp) => {
    if (emp.employeeId) {
      const seqStr = String(emp.employeeId).replace(/^EMP-?/i, "").trim();
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  });

  const nextSeq = maxSeq + 1;
  return String(nextSeq).padStart(3, "0");
};

exports.createEmployee = async (branchId, employeeData) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const { name, email, phone, address, role, pin } = employeeData;

  if (!name || !name.trim()) {
    throw new Error("Employee name is required");
  }

  if (!role) {
    throw new Error("Role is required");
  }

  if (phone && phone.trim()) {
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      throw new Error("Phone number must be exactly 10 digits");
    }
  }

  if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error("Please enter a valid email address");
  }

  if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
    throw new Error("PIN must be exactly 4 digits");
  }

  const cleanPin = String(pin).trim();
  const employeeId = await generateNextEmployeeId(branchId);

  let driverRef = null;

  // If role is driver, create a corresponding Driver entry
  if (role === "driver") {
    try {
      const existingDriver = await Driver.findOne({ driverId: employeeId });
      if (!existingDriver) {
        const driver = new Driver({
          driverId: employeeId,
          name: name.trim(),
          phone: phone ? phone.trim() : "",
          password: cleanPin,
          restaurantId: String(branchId),
          status: "offline",
        });
        const savedDriver = await driver.save();
        driverRef = savedDriver._id;
      } else {
        driverRef = existingDriver._id;
      }
    } catch (err) {
      console.warn("Could not create linked Driver model:", err.message);
    }
  }

  const employee = new Employee({
    branchId,
    employeeId,
    name: name.trim(),
    email: email ? email.trim() : "",
    phone: phone ? phone.trim() : "",
    address: address ? address.trim() : "",
    role,
    pin: cleanPin, // Pre-save hook will hash this
    driverRef,
    ...(employeeData.permissions && typeof employeeData.permissions === "object"
      ? { permissions: employeeData.permissions }
      : {}),
  });

  await employee.save();

  // Return without pin hash
  const result = employee.toObject();
  delete result.pin;
  return result;
};

exports.getAllEmployees = async (branchId, query = {}) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const filter = { branchId };

  if (query.role) {
    filter.role = query.role;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true" || query.isActive === true;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [
      { name: searchRegex },
      { employeeId: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
    ];
  }

  const employees = await Employee.find(filter)
    .select("-pin")
    .sort({ createdAt: -1 })
    .lean();

  return employees;
};

exports.getEmployeeById = async (branchId, id) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const employee = await Employee.findOne({ _id: id, branchId })
    .select("-pin")
    .lean();

  if (!employee) {
    throw new Error("Employee not found");
  }

  return employee;
};

exports.updateEmployee = async (branchId, id, updateData) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const employee = await Employee.findOne({ _id: id, branchId });
  if (!employee) {
    throw new Error("Employee not found");
  }

  if (updateData.name !== undefined) employee.name = updateData.name.trim();
  
  if (updateData.email !== undefined && updateData.email.trim() !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updateData.email.trim())) {
      throw new Error("Please enter a valid email address");
    }
    employee.email = updateData.email.trim();
  } else if (updateData.email === "") {
    employee.email = "";
  }

  if (updateData.phone !== undefined && updateData.phone.trim() !== "") {
    const phoneDigits = updateData.phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      throw new Error("Phone number must be exactly 10 digits");
    }
    employee.phone = updateData.phone.trim();
  } else if (updateData.phone === "") {
    employee.phone = "";
  }

  if (updateData.address !== undefined) employee.address = updateData.address.trim();
  if (updateData.isActive !== undefined) employee.isActive = Boolean(updateData.isActive);
  if (updateData.permissions && typeof updateData.permissions === "object") {
    employee.permissions = { ...employee.permissions, ...updateData.permissions };
  }

  if (updateData.pin !== undefined && updateData.pin !== "") {
    const cleanPin = String(updateData.pin).trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new Error("PIN must be exactly 4 digits");
    }
    employee.pin = cleanPin; // Will be hashed in pre-save
  }

  // Handle role changes & driver sync
  if (updateData.role !== undefined && updateData.role !== employee.role) {
    const oldRole = employee.role;
    employee.role = updateData.role;

    if (updateData.role === "driver" && !employee.driverRef) {
      try {
        const driver = new Driver({
          driverId: employee.employeeId,
          name: employee.name,
          phone: employee.phone,
          password: "0000",
          restaurantId: String(branchId),
          status: "offline",
        });
        const savedDriver = await driver.save();
        employee.driverRef = savedDriver._id;
      } catch (e) {}
    }
  }

  try {
    const driverFilter = employee.driverRef
      ? { _id: employee.driverRef }
      : { driverId: employee.employeeId };
    const driverUpdate = {
      name: employee.name,
      phone: employee.phone,
    };
    if (updateData.pin !== undefined && updateData.pin !== "") {
      driverUpdate.password = String(updateData.pin).trim();
    }
    await Driver.findOneAndUpdate(driverFilter, driverUpdate);
  } catch (e) {}

  await employee.save();

  const result = employee.toObject();
  delete result.pin;
  return result;
};

exports.deleteEmployee = async (branchId, id) => {
  if (!branchId) {
    throw new Error("Branch ID is required");
  }

  const employee = await Employee.findOneAndUpdate(
    { _id: id, branchId },
    { isActive: false },
    { new: true }
  );

  if (!employee) {
    throw new Error("Employee not found");
  }

  return { message: "Employee deactivated successfully" };
};

const VALID_PERMISSION_KEYS = [
  // Separate route pages
  "pos", "kitchen", "reception_view", "delivery", "driver_drop",
  "vehicles", "customers", "employees", "menus", "setting",
  // /employee/orders sub-tabs
  "dashboard", "orders", "orders_list", "sales_summary", "expense_payout", "reports",
  "item_sales", "hourly_sales", "cash_out_summary",
  "monthly_sales_summary", "failed_transaction", "refund_orders",
];

exports.updatePermissions = async (branchId, id, permissions) => {
  if (!branchId) throw new Error("Branch ID is required");
  if (!permissions || typeof permissions !== "object") {
    throw new Error("Permissions object is required");
  }

  const employee = await Employee.findOne({ _id: id, branchId });
  if (!employee) throw new Error("Employee not found");

  // Build $set payload — only accept known keys
  const $set = {};
  for (const key of VALID_PERMISSION_KEYS) {
    if (key in permissions) {
      $set[`permissions.${key}`] = Boolean(permissions[key]);
    }
  }

  const updated = await Employee.findByIdAndUpdate(
    id,
    { $set },
    { new: true }
  ).select("-pin").lean();

  return updated;
};

exports.verifyEmployeePin = async (branchId, employeeId, pin) => {
  if (!branchId || !employeeId || !pin) {
    throw new Error("Branch ID, Employee ID, and PIN are required");
  }

  const cleanPin = String(pin).trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    throw new Error("PIN must be exactly 4 digits");
  }

  const employee = await Employee.findOne({
    branchId,
    employeeId: employeeId.trim().toUpperCase(),
    isActive: true,
  });

  if (!employee) {
    throw new Error("Employee not found or inactive");
  }

  const isMatch = await employee.comparePin(cleanPin);
  if (!isMatch) {
    throw new Error("Invalid 4-digit PIN");
  }

  // Fetch today's attendance status for this employee
  const dateStr = getTodayDateStr();
  const attendance = await Attendance.findOne({
    branchId,
    employeeId: employee._id,
    date: dateStr,
  }).lean();

  const empObj = employee.toObject();
  delete empObj.pin;

  let currentStatus = "checked-out";
  let activeShift = null;

  if (attendance) {
    currentStatus = attendance.status;
    if (attendance.shifts && attendance.shifts.length > 0) {
      activeShift = attendance.shifts[attendance.shifts.length - 1];
    }
  }

  return {
    employee: empObj,
    todayAttendance: {
      status: currentStatus,
      date: dateStr,
      activeShift,
      allShifts: attendance ? attendance.shifts : [],
    },
  };
};

exports.loginAsCode = async (branchId, employeeId, pin) => {
  if (!branchId || !employeeId || !pin) {
    throw new Error("Branch ID, Employee ID, and PIN are required");
  }

  const cleanPin = String(pin).trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    throw new Error("PIN must be exactly 4 digits");
  }

  const employee = await Employee.findOne({
    branchId,
    employeeId: employeeId.trim().toUpperCase(),
    isActive: true,
  });

  if (!employee) {
    throw new Error("Employee not found or inactive");
  }

  if (employee.role === "driver") {
    throw new Error("Driver accounts cannot log in to POS terminal.");
  }

  const isMatch = await employee.comparePin(cleanPin);
  if (!isMatch) {
    throw new Error("Invalid 4-digit PIN");
  }

  const empObj = employee.toObject();
  delete empObj.pin;

  return {
    employee: empObj,
  };
};
