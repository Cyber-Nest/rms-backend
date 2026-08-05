const Driver = require("../models/Driver.model");
const DeliveryAssignment = require("../models/DeliveryAssignment.model");
const Vehicle = require("../models/Vehicle.model");
const DriverDropSettlement = require("../models/DriverDropSettlement.model");
const Order = require("../../order/models/order.model");
const Attendance = require("../../employee/models/attendance.model");
const Employee = require("../../employee/models/employee.model");
const driverDropPdfService = require("../services/driverDropPdf.service");

const logger = require("../../../shared/utils/logger");
const {
  authenticateChannel,
  triggerDeliveryAssigned,
  triggerDeliveryStatusUpdate,
  triggerDriverStatusChange,
  triggerOrderUpdated,
} = require("../../../config/pusher");

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "rms_super_secret_jwt_key";

// ─── Helper ───
const handleError = (res, error, status = 400) => {
  logger.error(`Delivery Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};

const getRestaurantIdFromReq = (req) => {
  let branchId =
    req.query.restaurantId ||
    req.query.branchId ||
    req.body.restaurantId ||
    req.body.branchId ||
    req.headers["x-branch-id"] ||
    req.headers["branchid"] ||
    req.headers["x-branchid"] ||
    req.branch?.branchId ||
    req.branch?._id;

  if (!branchId && req.cookies?.rms_branch_token) {
    try {
      const decoded = jwt.verify(req.cookies.rms_branch_token, JWT_SECRET);
      branchId = decoded?.branchId || decoded?._id;
    } catch (e) {}
  }

  return branchId ? String(branchId) : "default";
};

// ─── PUSHER AUTH ───
exports.pusherAuth = async (req, res) => {
  try {
    const { socket_id, channel_name } = req.body;
    if (!socket_id || !channel_name) {
      return res.status(400).json({
        success: false,
        message: "socket_id and channel_name are required.",
      });
    }

    // Validate channel name pattern (only allow our delivery channels)
    const validPatterns = [/^private-restaurant-.+$/, /^private-order-.+$/];
    const isValid = validPatterns.some((p) => p.test(channel_name));
    if (!isValid) {
      return res
        .status(403)
        .json({ success: false, message: "Invalid channel name." });
    }

    const authResponse = authenticateChannel(socket_id, channel_name);
    res.status(200).json(authResponse);
  } catch (error) {
    handleError(res, error, 500);
  }
};

// ─── BRANCH DASHBOARD APIs ───

exports.getDeliveryOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const restaurantId = getRestaurantIdFromReq(req);

    // Get today's start and end
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const query = {
      orderType: "delivery",
      branchId: restaurantId,
      $or: [
        {
          orderTiming: "now",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
        {
          orderTiming: "later",
          scheduledAt: { $gte: startOfDay, $lte: endOfDay },
        },
        {
          orderTiming: { $exists: false },
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
        //active undelivered orders from previous days
        {
          status: { $in: ["pending", "preparing", "ready"] },
        },
      ],
    };

    const orders = await Order.find(query)
      .select(
        "_id orderNumber customer status paymentStatus orderType total orderTiming scheduledAt createdAt dueAt items",
      )
      .sort({ createdAt: -1 })
      .lean();

    const orderIds = orders.map((o) => o._id);
    const assignments = await DeliveryAssignment.find({
      orderId: { $in: orderIds },
    })
      .populate("driverId", "_id name")
      .lean();

    const assignmentMap = {};
    assignments.forEach((assignment) => {
      if (assignment.orderId) {
        assignmentMap[assignment.orderId.toString()] = assignment;
      }
    });

    // Enrich orders with delivery assignment data
    const enrichedOrders = orders.map((order) => {
      const assignment = assignmentMap[order._id.toString()];

      let deliveryStatus = "assign";
      let assignedDriverId = null;

      if (assignment) {
        assignedDriverId = assignment.driverId?._id || null;
        if (
          assignment.status === "completed" ||
          assignment.status === "delivered"
        ) {
          deliveryStatus = "delivered";
        } else if (
          assignment.status === "en-route" ||
          assignment.status === "assigned"
        ) {
          deliveryStatus = "en-route";
        }
      }

      // If order itself is completed/cancelled, mark as delivered
      if (order.status === "completed" || order.status === "cancelled") {
        deliveryStatus = "delivered";
      }

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        customerName: order.customer?.name || "Unknown",
        customerPhone: order.customer?.phone || "",
        deliveryAddress: order.customer?.address || "",
        notes: order.notes || "",
        coordinates: {
          lat: order.customer?.lat || null,
          lng: order.customer?.lng || null,
        },
        status: deliveryStatus,
        assignmentStatus: assignment ? assignment.status : null,
        assignedDriverId,
        createdAt: order.createdAt,
        orderTiming: order.orderTiming,
        scheduledAt: order.scheduledAt,
        deliveredAt: assignment?.deliveredAt || null,
        duration: "",
        timeOrdered: new Date(order.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        items: (order.items || []).map((i) => `${i.quantity}x ${i.name}`),
        total: order.total || 0,
      };
    });

    const filtered = status
      ? enrichedOrders.filter((o) => o.status === status)
      : enrichedOrders;

    res.status(200).json({ success: true, data: filtered });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 *GET: Get all drivers for this restaurant.
 */
exports.getDrivers = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const drivers = await Driver.find({ restaurantId })
      .select(
        "_id driverId name phone status isDutyOnline color activeOrderIds currentLocation assignedVehicleId",
      )
      .populate(
        "assignedVehicleId",
        "_id number label isAssigned assignedDriverId",
      )
      .lean();

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Get all driver-role employees for this branch
    const employees = await Employee.find({
      branchId: restaurantId,
      $or: [{ role: "driver" }, { driverRef: { $exists: true, $ne: null } }],
      isActive: true,
    })
      .select("_id employeeId driverRef")
      .lean();

    // Get today's checked-in attendance records for these employees
    const empIds = employees.map((e) => e._id);
    const attendances = await Attendance.find({
      branchId: restaurantId,
      employeeId: { $in: empIds },
      date: todayStr,
      status: { $in: ["checked-in", "on-break"] },
    })
      .select("employeeId")
      .lean();

    const checkedInEmpIds = new Set(
      attendances.map((a) => a.employeeId.toString()),
    );

    const driverCheckedInMap = new Map();
    employees.forEach((emp) => {
      const isCheckedIn = checkedInEmpIds.has(emp._id.toString());
      if (emp.driverRef) {
        driverCheckedInMap.set(emp.driverRef.toString(), isCheckedIn);
      }
      if (emp.employeeId) {
        driverCheckedInMap.set(String(emp.employeeId).toUpperCase(), isCheckedIn);
      }
    });

    const enriched = drivers.map((driver) => {
      const assignedVehicle = driver.assignedVehicleId;
      const posCheckedIn =
        driverCheckedInMap.get(driver._id.toString()) ||
        driverCheckedInMap.get(String(driver.driverId).toUpperCase()) ||
        false;

      const isBusy = driver.status === "on-delivery" || driver.status === "returning";
      const computedStatus = isBusy
        ? driver.status
        : Boolean(driver.isDutyOnline)
        ? "available"
        : "offline";

      return {
        _id: driver._id,
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        status: computedStatus,
        isDutyOnline: Boolean(driver.isDutyOnline),
        color: driver.color,
        activeOrders: driver.activeOrderIds || [],
        currentLocation: { lat: null, lng: null },
        posCheckedIn,
        assignedVehicle: assignedVehicle
          ? {
              _id: assignedVehicle._id,
              number: assignedVehicle.number,
              label: assignedVehicle.label,
              isAssigned: assignedVehicle.isAssigned,
              assignedDriverId: assignedVehicle.assignedDriverId,
            }
          : null,
      };
    });

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Get all vehicles for this restaurant.
 */
exports.getVehicles = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);

    // Auto-migrate legacy 'default' vehicles to the active restaurant branch if any
    if (restaurantId !== "default") {
      const branchCount = await Vehicle.countDocuments({ restaurantId });
      if (branchCount === 0) {
        await Vehicle.updateMany(
          { restaurantId: "default" },
          { $set: { restaurantId } },
        );
      }
    }

    const vehicles = await Vehicle.find({ restaurantId })
      .select("_id number label status isAssigned assignedDriverId")
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({ success: true, data: vehicles });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Create a new vehicle.
 * Body: { number, label, restaurantId }
 */
exports.createVehicle = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    let { number, label } = req.body;
    if (!number || !label) {
      return res.status(400).json({
        success: false,
        message: "Vehicle number and label are required.",
      });
    }

    number = String(number).trim().toUpperCase();
    label = String(label).trim();

    // Alphanumeric validation
    const alphanumericRegex = /^[a-zA-Z0-9 -]+$/;
    if (!alphanumericRegex.test(number)) {
      return res.status(400).json({
        success: false,
        message:
          "Vehicle number must be alphanumeric (letters, numbers, space or hyphen only).",
      });
    }

    // Check if number already exists for this restaurant
    const existing = await Vehicle.findOne({ number, restaurantId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Vehicle number already exists for this restaurant.",
      });
    }

    const vehicle = new Vehicle({ number, label, restaurantId });
    await vehicle.save();

    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * PUT: Update an existing vehicle.
 * Params: id
 * Body: { number, label }
 */
exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    let { number, label } = req.body;
    const restaurantId = getRestaurantIdFromReq(req);

    if (!number || !label) {
      return res.status(400).json({
        success: false,
        message: "Vehicle number and label are required.",
      });
    }

    number = String(number).trim().toUpperCase();
    label = String(label).trim();

    // Alphanumeric validation
    const alphanumericRegex = /^[a-zA-Z0-9 -]+$/;
    if (!alphanumericRegex.test(number)) {
      return res.status(400).json({
        success: false,
        message:
          "Vehicle number must be alphanumeric (letters, numbers, space or hyphen only).",
      });
    }

    const vehicle = await Vehicle.findOne({ _id: id, restaurantId });
    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found." });
    }

    // Check for duplicate vehicle number if changed
    if (vehicle.number !== number) {
      const existing = await Vehicle.findOne({ number, restaurantId });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Vehicle number already exists for this restaurant.",
        });
      }
    }

    vehicle.number = number;
    vehicle.label = label;
    await vehicle.save();

    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * DELETE: Delete a vehicle.
 * Params: id
 */
exports.deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const restaurantId = getRestaurantIdFromReq(req);

    const vehicle = await Vehicle.findOne({ _id: id, restaurantId });
    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found." });
    }

    // If vehicle is assigned to a driver, unassign it first
    if (vehicle.isAssigned && vehicle.assignedDriverId) {
      await Driver.findByIdAndUpdate(vehicle.assignedDriverId, {
        assignedVehicleId: null,
      });
    }

    await Vehicle.findByIdAndDelete(id);

    res
      .status(200)
      .json({ success: true, message: "Vehicle deleted successfully." });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Assign a Driver to a Delivery Order.
 * Body: { orderId, driverId }
 */
exports.assignDriver = async (req, res) => {
  try {
    const { orderId, driverId } = req.body;
    if (!orderId || !driverId) {
      return res.status(400).json({
        success: false,
        message: "orderId and driverId are required.",
      });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }
    if (!driver.assignedVehicleId) {
      return res
        .status(400)
        .json({ success: false, message: "Driver has no vehicle assigned." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    // Check if already assigned
    const existingAssignment = await DeliveryAssignment.findOne({
      orderId,
      status: { $in: ["assigned", "en-route"] },
    });
    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: "Order is already assigned to a driver.",
      });
    }

    // Create delivery assignment
    const assignment = await DeliveryAssignment.create({
      orderId,
      driverId: driver._id,
      status: "assigned",
      assignedAt: new Date(),
      customerLocation: {
        lat: order.customer?.lat || null,
        lng: order.customer?.lng || null,
        address: order.customer?.address || "",
      },
      restaurantId: driver.restaurantId,
    });

    // Update driver status and active orders
    driver.status = "on-delivery";
    driver.activeOrderIds.push(orderId);
    await driver.save();

    // Get vehicle info for Pusher event
    const vehicle = await Vehicle.findById(driver.assignedVehicleId).lean();

    // Trigger Pusher events
    await triggerDeliveryAssigned(driver.restaurantId, orderId.toString(), {
      driverId: driver._id.toString(),
      name: driver.name,
      color: driver.color,
      phone: driver.phone || "",
      vehicleNumber: vehicle?.number || null,
    });

    res.status(201).json({
      success: true,
      data: {
        assignment,
        driver: {
          _id: driver._id,
          name: driver.name,
          status: driver.status,
        },
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Assign a vehicle to a driver.
 * Body: { driverId, vehicleId }
 */
exports.assignVehicle = async (req, res) => {
  try {
    const { driverId, vehicleId } = req.body;
    if (!driverId || !vehicleId) {
      return res.status(400).json({
        success: false,
        message: "driverId and vehicleId are required.",
      });
    }

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found." });
    }
    if (vehicle.isAssigned) {
      return res
        .status(400)
        .json({ success: false, message: "Vehicle is already assigned." });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    const employee = await Employee.findOne({
      branchId: driver.restaurantId,
      $or: [
        ...(driver.driverRef ? [{ _id: driver.driverRef }] : []),
        { employeeId: driver.driverId },
      ],
      isActive: true,
    })
      .select("_id")
      .lean();

    if (employee) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const att = await Attendance.findOne({
        branchId: driver.restaurantId,
        employeeId: employee._id,
        date: todayStr,
        status: { $in: ["checked-in", "on-break"] },
      })
        .select("status")
        .lean();

      if (!att) {
        return res.status(400).json({
          success: false,
          message:
            "Driver must check-in at POS terminal before a vehicle can be assigned.",
        });
      }
    }

    // Unassign current vehicle if any
    if (driver.assignedVehicleId) {
      await Vehicle.findByIdAndUpdate(driver.assignedVehicleId, {
        isAssigned: false,
        assignedDriverId: null,
      });
    }

    // Assign new vehicle
    vehicle.isAssigned = true;
    vehicle.assignedDriverId = driver._id;
    await vehicle.save();

    driver.assignedVehicleId = vehicle._id;
    await driver.save();

    res.status(200).json({ success: true, data: { driver, vehicle } });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Unassign vehicle from a driver.
 * Body: { driverId }
 */
exports.unassignVehicle = async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    if (driver.assignedVehicleId) {
      await Vehicle.findByIdAndUpdate(driver.assignedVehicleId, {
        isAssigned: false,
        assignedDriverId: null,
      });
      driver.assignedVehicleId = null;
      await driver.save();
    }

    res.status(200).json({ success: true, message: "Vehicle unassigned." });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Driver login with driverId + password.
 */
exports.driverLogin = async (req, res) => {
  try {
    const { driverId, password, branchId } = req.body;
    if (!driverId || !password) {
      return res.status(400).json({
        success: false,
        message: "driverId and password are required.",
      });
    }

    const cleanDriverId = driverId.trim().toUpperCase();
    const cleanPin = password.trim();

    // 1. Find Employee for this specific branch
    let employee = null;
    if (branchId) {
      employee = await Employee.findOne({
        branchId: String(branchId),
        $or: [{ employeeId: cleanDriverId }, { phone: cleanDriverId }],
        isActive: true,
      });
    }

    // 2. Find Driver record for this specific branch
    let driver = null;
    if (branchId) {
      driver = await Driver.findOne({
        restaurantId: String(branchId),
        $or: [
          { driverId: cleanDriverId },
          ...(employee?.driverRef ? [{ _id: employee.driverRef }] : []),
        ],
      });
    }

    // Fallback ONLY if no branchId was provided in request
    if (!branchId) {
      if (!driver) {
        driver = await Driver.findOne({ driverId: cleanDriverId });
      }
      if (!employee && driver?.driverRef) {
        employee = await Employee.findById(driver.driverRef);
      }
    }

    if (!driver && !employee) {
      return res.status(401).json({
        success: false,
        message: "Driver ID is not registered for this restaurant branch.",
      });
    }

    // Strict Branch Authorization Check
    if (branchId) {
      if (driver && String(driver.restaurantId) !== String(branchId)) {
        return res.status(401).json({
          success: false,
          message: "Driver ID is not registered for this restaurant branch.",
        });
      }
      if (employee && String(employee.branchId) !== String(branchId)) {
        return res.status(401).json({
          success: false,
          message: "Driver ID is not registered for this restaurant branch.",
        });
      }
    }

    //ONLY DRIVERS CAN LOGIN TO DRIVER 
    const isDriverRole =
      employee?.role === "driver" ||
      Boolean(employee?.driverRef) ||
      Boolean(driver);

    if (!isDriverRole) {
      return res.status(403).json({
        success: false,
        code: "NOT_A_DRIVER",
        message:
          "Access denied. Only employees registered as Drivers can log in to Driver App.",
      });
    }

    // Verify password / PIN
    let isPasswordValid = false;
    if (employee) {
      isPasswordValid = await employee.comparePin(cleanPin);
      if (isPasswordValid && driver && driver.password !== cleanPin) {
        driver.password = cleanPin;
        await driver.save();
      }
    } else if (driver) {
      isPasswordValid = driver.password === cleanPin;
    }

    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid 4-digit PIN." });
    }

    // Ensure driver record exists
    const targetBranchId =
      branchId || driver?.restaurantId || employee?.branchId;
    if (!driver && employee) {
      // Create Driver model linked to employee if missing
      driver = new Driver({
        driverId: employee.employeeId,
        name: employee.name,
        phone: employee.phone || "",
        password: cleanPin,
        restaurantId: String(targetBranchId),
        status: "available",
      });
      await driver.save();
      employee.driverRef = driver._id;
      await employee.save();
    }

    // ── MANDATORY POS CHECK-IN VERIFICATION ──
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (employee) {
      const todayAttendance = await Attendance.findOne({
        branchId: targetBranchId,
        employeeId: employee._id,
        date: todayStr,
      })
        .select("status")
        .lean();

      if (
        !todayAttendance ||
        (todayAttendance.status !== "checked-in" &&
          todayAttendance.status !== "on-break")
      ) {
        return res.status(403).json({
          success: false,
          code: "CHECK_IN_REQUIRED",
          message:
            "Please check-in first at the POS system before accessing Driver Web.",
        });
      }
    }

    // Check if the driver has active assignments to recover their state
    const activeAssignments = await DeliveryAssignment.find({
      driverId: driver._id,
      status: { $in: ["assigned", "en-route", "delivered"] },
    }).lean();

    let recoveredStatus = "available";
    let activeOrderIds = [];

    if (activeAssignments.length > 0) {
      activeOrderIds = activeAssignments.map((a) => a.orderId);
      const hasDelivered = activeAssignments.some(
        (a) => a.status === "delivered",
      );
      recoveredStatus = hasDelivered ? "returning" : "on-delivery";
    }

    await Driver.findByIdAndUpdate(driver._id, {
      status: recoveredStatus,
      isDutyOnline: true,
      activeOrderIds,
    });

    // Get vehicle info
    let assignedVehicle = null;
    if (driver.assignedVehicleId) {
      assignedVehicle = await Vehicle.findById(driver.assignedVehicleId).lean();
    }

    // Trigger status change
    await triggerDriverStatusChange(driver.restaurantId, {
      driverId: driver._id.toString(),
      status: recoveredStatus,
    });

    res.status(200).json({
      success: true,
      data: {
        _id: driver._id,
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        color: driver.color,
        status: recoveredStatus,
        restaurantId: driver.restaurantId,
        assignedVehicle,
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Get active delivery assignments for a driver.
 */
exports.getDriverAssignments = async (req, res) => {
  try {
    const { id } = req.params;

    const assignments = await DeliveryAssignment.find({
      driverId: id,
      status: { $in: ["assigned", "en-route", "delivered"] },
    })
      .populate("orderId")
      .sort({ assignedAt: -1 })
      .lean();

    // Enrich with order data
    const enriched = assignments.map((a) => {
      const order = a.orderId;
      return {
        ...a,
        orderId: order ? order._id : a.orderId,
        order: order
          ? {
              _id: order._id,
              orderNumber: order.orderNumber,
              customerName: order.customer?.name || "Unknown",
              customerPhone: order.customer?.phone || "",
              deliveryAddress: order.customer?.address || "",
              items: (order.items || []).map((i) => `${i.quantity}x ${i.name}`),
              total: order.total || 0,
              notes: order.notes || "",
            }
          : null,
      };
    });

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Driver marks a delivery as delivered. GPS continues (returning phase).
 */
exports.markDelivered = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await DeliveryAssignment.findById(assignmentId);
    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });
    }

    assignment.status = "delivered";
    assignment.deliveredAt = new Date();
    await assignment.save();

    const driver = await Driver.findById(assignment.driverId);
    if (driver) {
      driver.activeOrderIds = driver.activeOrderIds.filter(
        (oid) => oid.toString() !== assignment.orderId.toString(),
      );
      if (driver.activeOrderIds.length === 0) {
        driver.status = "returning";
      }
      await driver.save();
    }

    // Update the original order status to completed (delivered to customer)
    const order = await Order.findByIdAndUpdate(
      assignment.orderId,
      {
        status: "completed",
        $push: {
          statusHistory: {
            status: "completed",
            changedAt: new Date(),
            note: "Delivered to customer",
          },
        },
      },
      { new: true },
    );

    // Trigger Pusher events
    await triggerDeliveryStatusUpdate(
      assignment.restaurantId,
      assignment.orderId.toString(),
      {
        status: "delivered",
        driverId: assignment.driverId.toString(),
      },
    );

    if (order) {
      await triggerOrderUpdated(order);
    }

    if (driver && driver.activeOrderIds.length === 0) {
      await triggerDriverStatusChange(assignment.restaurantId, {
        driverId: driver._id.toString(),
        status: "returning",
      });
    }

    res.status(200).json({ success: true, data: assignment });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Auto-called when driver reaches restaurant (< 200m).
 * Sets assignment to completed, driver to available.
 */
exports.markCompleted = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await DeliveryAssignment.findById(assignmentId);
    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });
    }

    assignment.status = "completed";
    assignment.completedAt = new Date();
    await assignment.save();

    // Set driver to available if online, else offline
    const driver = await Driver.findById(assignment.driverId);
    if (driver) {
      driver.status = driver.isDutyOnline ? "available" : "offline";
      driver.activeOrderIds = [];
      await driver.save();

      await triggerDriverStatusChange(driver.restaurantId, {
        driverId: driver._id.toString(),
        status: driver.status,
      });
    }

    // Also update the original order status to completed
    await Order.findByIdAndUpdate(assignment.orderId, {
      status: "completed",
      $push: {
        statusHistory: {
          status: "completed",
          changedAt: new Date(),
          note: "Delivery completed",
        },
      },
    });

    res.status(200).json({ success: true, data: assignment });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * PATCH: Driver goes online/offline.
 * Body: { status: 'available' | 'offline' }
 */
exports.updateDriverStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["available", "offline"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'available' or 'offline'.",
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      id,
      { status, isDutyOnline: status === "available" },
      { new: true },
    ).lean();

    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    await triggerDriverStatusChange(driver.restaurantId, {
      driverId: driver._id.toString(),
      status,
    });

    res.status(200).json({ success: true, data: driver });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Get a single driver by ID with vehicle populated.
 */
exports.getDriverById = async (req, res) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id)
      .populate("assignedVehicleId")
      .lean();
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    // Check today's POS attendance status
    let posCheckedIn = true;
    try {
      const employee = await Employee.findOne({
        branchId: driver.restaurantId,
        $or: [
          ...(driver.driverRef ? [{ _id: driver.driverRef }] : []),
          { employeeId: driver.driverId },
        ],
        isActive: true,
      })
        .select("_id branchId")
        .lean();

      if (employee) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const att = await Attendance.findOne({
          branchId: employee.branchId,
          employeeId: employee._id,
          date: todayStr,
        })
          .select("status")
          .lean();

        if (!att || att.status === "checked-out") {
          posCheckedIn = false;
        }
      }
    } catch (e) {}

    let assignedVehicle = null;
    if (driver.assignedVehicleId) {
      assignedVehicle = driver.assignedVehicleId;
    }

    res.status(200).json({
      success: true,
      data: {
        _id: driver._id,
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        color: driver.color,
        status: posCheckedIn ? driver.status : "offline",
        posCheckedIn,
        restaurantId: driver.restaurantId,
        assignedVehicle: assignedVehicle
          ? {
              _id: assignedVehicle._id,
              number: assignedVehicle.number,
              label: assignedVehicle.label,
              isAssigned: assignedVehicle.isAssigned,
              assignedDriverId: assignedVehicle.assignedDriverId,
            }
          : null,
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// ─── USER TRACKING API ───
/**
 * GET: Get delivery tracking info for a specific order.
 */
exports.trackDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;

    const assignment = await DeliveryAssignment.findOne({
      orderId,
      status: { $in: ["assigned", "en-route", "delivered"] },
    }).lean();

    if (!assignment) {
      return res.status(200).json({
        success: true,
        data: { assigned: false, message: "No driver assigned yet." },
      });
    }

    const driver = await Driver.findById(assignment.driverId).lean();
    let vehicle = null;
    if (driver?.assignedVehicleId) {
      vehicle = await Vehicle.findById(driver.assignedVehicleId).lean();
    }

    res.status(200).json({
      success: true,
      data: {
        assigned: true,
        assignmentId: assignment._id,
        status: assignment.status,
        assignedAt: assignment.assignedAt,
        deliveredAt: assignment.deliveredAt,
        driver: driver
          ? {
              _id: driver._id,
              name: driver.name,
              color: driver.color,
              phone: driver.phone,
            }
          : null,
        vehicle: vehicle
          ? {
              number: vehicle.number,
              label: vehicle.label,
            }
          : null,
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Unassign Driver from Order
 * Body: { orderId }
 */
exports.unassignDriver = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "orderId is required." });
    }

    const assignment = await DeliveryAssignment.findOne({
      orderId,
      status: { $in: ["assigned", "en-route"] },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "No active assignment found for this order.",
      });
    }

    const driverId = assignment.driverId;
    const restaurantId = assignment.restaurantId || "default";

    // Delete assignment
    await DeliveryAssignment.deleteOne({ _id: assignment._id });

    // Update driver state
    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.activeOrderIds = driver.activeOrderIds.filter(
        (oid) => oid.toString() !== orderId.toString(),
      );
      if (driver.activeOrderIds.length === 0) {
        driver.status = driver.isDutyOnline ? "available" : "offline";
      }
      await driver.save();

      // Trigger status change Pusher event
      await triggerDriverStatusChange(restaurantId, {
        driverId: driver._id.toString(),
        status: driver.status,
      });
    }

    // Trigger Pusher events to update maps in real-time
    const pusher = require("../../../config/pusher");
    if (pusher.pusherInstance) {
      // 1. Tell order tracking map driver is unassigned
      pusher.pusherInstance.trigger(
        `private-order-${orderId}`,
        "delivery-unassigned",
        {
          orderId,
        },
      );
      // 2. Tell branch dashboard to re-fetch/update
      pusher.pusherInstance.trigger(
        `private-restaurant-${restaurantId}`,
        "delivery-assigned",
        {
          unassigned: true,
          orderId,
        },
      );
    }

    res
      .status(200)
      .json({ success: true, message: "Driver unassigned successfully." });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Complete driver assignment manually from branch dashboard
 * Params: driverId
 */
exports.completeActiveAssignment = async (req, res) => {
  try {
    const { driverId } = req.params;

    // Find all delivered (returning) assignments for this driver
    await DeliveryAssignment.updateMany(
      { driverId, status: "delivered" },
      { $set: { status: "completed", completedAt: new Date() } },
    );

    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.status = "available";
      driver.activeOrderIds = [];
      await driver.save();

      // Trigger status change Pusher event
      await triggerDriverStatusChange(driver.restaurantId || "default", {
        driverId: driver._id.toString(),
        status: "available",
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Driver is now available." });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Fetch drivers for Driver Drop Dashboard for a given date
 * Query params: date (YYYY-MM-DD), branchId / restaurantId
 */
exports.getDriverDropDrivers = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const dateStr = req.query.date || new Date().toISOString().split("T")[0];

    // Find all driver employees for this branch
    const employees = await Employee.find({
      branchId: restaurantId,
      $or: [{ role: "driver" }, { driverRef: { $exists: true, $ne: null } }],
    })
      .select("_id driverRef employeeId name")
      .lean();

    const employeeIds = employees.map((e) => e._id);

    // Find attendance records for selected date
    const attendances = await Attendance.find({
      branchId: restaurantId,
      employeeId: { $in: employeeIds },
      date: dateStr,
    })
      .select("employeeId status")
      .lean();

    const checkedInEmpIds = new Set(
      attendances.map((a) => a.employeeId.toString()),
    );

    // Find existing settlements for this date
    const settlements = await DriverDropSettlement.find({
      branchId: restaurantId,
      date: dateStr,
    })
      .select("driverId status totalSales netCashPayoutToDriver")
      .lean();

    const settlementMap = new Map();
    settlements.forEach((s) => {
      if (s.driverId) {
        settlementMap.set(s.driverId.toString(), s);
      }
    });

    const validDriverIds = new Set();
    employees.forEach((emp) => {
      if (checkedInEmpIds.has(emp._id.toString()) && emp.driverRef) {
        validDriverIds.add(emp.driverRef.toString());
      }
    });
    settlements.forEach((s) => {
      if (s.driverId) {
        validDriverIds.add(s.driverId.toString());
      }
    });

    let drivers = [];
    if (validDriverIds.size > 0) {
      drivers = await Driver.find({
        restaurantId,
        _id: { $in: Array.from(validDriverIds) },
      })
        .select("_id driverId name phone status color assignedVehicleId")
        .populate("assignedVehicleId", "number label")
        .lean();
    } else {
      const empCodes = employees
        .filter((e) => checkedInEmpIds.has(e._id.toString()))
        .map((e) => e.employeeId);
      if (empCodes.length > 0) {
        drivers = await Driver.find({
          restaurantId,
          driverId: { $in: empCodes },
        })
          .select("_id driverId name phone status color assignedVehicleId")
          .populate("assignedVehicleId", "number label")
          .lean();
      }
    }

    const result = drivers.map((d) => {
      const settlement = settlementMap.get(d._id.toString());
      let vehicleStr = "No Vehicle";
      if (d.assignedVehicleId) {
        const v = d.assignedVehicleId;
        const label = v.label || "";
        if (label.toLowerCase().includes("vehicle")) {
          vehicleStr = label;
        } else if (label && v.number) {
          vehicleStr = `Vehicle #${v.number} - ${label}`;
        } else if (v.number) {
          vehicleStr = `Vehicle #${v.number}`;
        }
      }

      return {
        id: d._id.toString(),
        driverId: d.driverId || d._id.toString().slice(-4),
        name: d.name,
        phone: d.phone || "",
        vehicle: vehicleStr,
        status: settlement
          ? "Completed Shift"
          : d.status === "offline"
            ? "Available"
            : d.status,
        isSettled: Boolean(settlement),
        settlementSummary: settlement || null,
      };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Fetch live delivered orders breakdown & totals for a specific driver and date
 * Query params: driverId, date, branchId / restaurantId
 */
exports.getDriverDropSummary = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const { driverId, date } = req.query;
    if (!driverId) {
      return res
        .status(400)
        .json({ success: false, message: "driverId is required" });
    }

    const targetDate = date || new Date().toISOString().split("T")[0];
    const startOfDay = new Date(`${targetDate}T00:00:00.000Z`);
    const endOfDay = new Date(`${targetDate}T23:59:59.999Z`);

    // Check if already settled
    const existingSettlement = await DriverDropSettlement.findOne({
      branchId: restaurantId,
      driverId,
      date: targetDate,
    }).lean();

    if (existingSettlement) {
      const orders = (existingSettlement.orders || []).map((o) => ({
        ...o,
        ticketName: o.ticketName || `${o.orderNumber || ""} ${o.customerName || "Customer"}`.trim(),
      }));
      return res.status(200).json({
        success: true,
        data: {
          isSettled: true,
          settlement: existingSettlement,
          orders,
        },
      });
    }

    // Find all delivery assignments for this driver on the date
    const assignments = await DeliveryAssignment.find({
      driverId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("orderId")
      .lean();

    // Map orders
    const orders = assignments
      .filter((a) => a.orderId)
      .map((a) => {
        const order = a.orderId;

        // Payment Detail code: PP (Prepaid online), TM (Terminal card), CS (Cash)
        let pd = "CS";
        if (
          ["online", "doordash", "skip", "ubereats"].includes(order.orderSource) ||
          order.paymentMethod === "stripe"
        ) {
          pd = "PP";
        } else if (
          (order.payments &&
            order.payments.some(
              (p) =>
                p.method === "card" ||
                p.method === "debit" ||
                p.method === "credit",
            )) ||
          order.paymentMethod === "card"
        ) {
          pd = "TM";
        } else {
          pd = "CS";
        }

        const prepaidTip = pd === "PP" ? order.tip || 0 : 0;
        const terminalTip = pd === "TM" ? order.tip || 0 : 0;
        const cashGiven = pd === "CS" ? order.total || 0 : 0;

        return {
          id: order._id.toString(),
          ticketName: `${order.orderNumber} ${order.customer?.name || "Customer"}`,
          customerName: order.customer?.name || "Customer",
          phone: order.customer?.phone || "",
          address: order.customer?.address || "",
          time: new Date(order.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
          total: order.total || 0,
          dc: 6.0,
          pd,
          prepaidTip,
          terminalTip,
          cashGiven,
        };
      });

    res.status(200).json({
      success: true,
      data: {
        isSettled: false,
        settlement: null,
        orders,
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * POST: Submit Driver Drop Settlement
 * Body: { branchId, driverId, date, terminalSales, terminalTips, cashSales, additionalCommission, additionalReason, settledBy }
 */
exports.settleDriverDrop = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const {
      driverId,
      date,
      terminalSales = 0,
      terminalTips = 0,
      cashSales = 0,
      additionalCommission = 0,
      additionalReason = "",
      settledBy = "Manager",
    } = req.body;

    if (!driverId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "driverId and date are required." });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const assignments = await DeliveryAssignment.find({
      driverId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("orderId")
      .lean();

    const orders = assignments
      .filter((a) => a.orderId)
      .map((a) => {
        const order = a.orderId;
        let pd = "CS";
        if (
          ["online", "doordash", "skip", "ubereats"].includes(order.orderSource) ||
          order.paymentMethod === "stripe"
        ) {
          pd = "PP";
        } else if (
          (order.payments &&
            order.payments.some(
              (p) =>
                p.method === "card" ||
                p.method === "debit" ||
                p.method === "credit",
            )) ||
          order.paymentMethod === "card"
        ) {
          pd = "TM";
        } else {
          pd = "CS";
        }

        return {
          orderId: order._id,
          orderNumber: order.orderNumber,
          ticketName: `${order.orderNumber || ""} ${order.customer?.name || "Customer"}`.trim(),
          customerName: order.customer?.name || "Customer",
          phone: order.customer?.phone || "",
          address: order.customer?.address || "",
          time: new Date(order.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
          total: order.total || 0,
          dc: 6.0,
          pd,
          prepaidTip: pd === "PP" ? order.tip || 0 : 0,
          terminalTip: pd === "TM" ? order.tip || 0 : 0,
          cashGiven: pd === "CS" ? order.total || 0 : 0,
        };
      });

    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
    const prepaidOrders = orders.filter((o) => o.pd === "PP");
    const prepaidSales = prepaidOrders.reduce((sum, o) => sum + o.total, 0);
    const prepaidTips = orders.reduce((sum, o) => sum + o.prepaidTip, 0);
    const totalNewSales = Math.max(0, totalSales - prepaidSales - prepaidTips);

    const enteredTerminalSales = parseFloat(terminalSales) || 0;
    const enteredTerminalTips = parseFloat(terminalTips) || 0;
    const enteredCashSales = parseFloat(cashSales) || 0;

    const saleDue =
      Math.round(
        (totalNewSales -
          enteredTerminalSales -
          enteredTerminalTips -
          enteredCashSales) *
          100,
      ) / 100;

    if (saleDue > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit settlement while Sale Due is $${saleDue.toFixed(2)}. Reconciliation must be $0.00 or less.`,
      });
    }

    const driverBaseCommission = totalOrders * 6.0;
    const extraComm = parseFloat(additionalCommission) || 0;
    const driverTotalCommission = driverBaseCommission + extraComm;
    const totalTipsEarned = prepaidTips + enteredTerminalTips;
    const totalDriverEarning = driverTotalCommission + totalTipsEarned;
    const netCashPayoutToDriver = totalDriverEarning;

    const settlementPayload = {
      branchId: restaurantId,
      driverId: driver._id,
      driverCode: driver.driverId || "",
      driverName: driver.name,
      date,
      orders,
      totalOrders,
      totalSales,
      prepaidSales,
      prepaidTips,
      totalNewSales,
      terminalSales: enteredTerminalSales,
      terminalTips: enteredTerminalTips,
      cashSales: enteredCashSales,
      saleDue,
      driverBaseCommission,
      additionalCommission: extraComm,
      additionalReason,
      driverTotalCommission,
      totalTipsEarned,
      totalDriverEarning,
      netCashPayoutToDriver,
      status: "settled",
      settledBy,
      settledAt: new Date(),
    };

    const settlement = await DriverDropSettlement.findOneAndUpdate(
      { branchId: restaurantId, date, driverId: driver._id },
      { $set: settlementPayload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.status(200).json({ success: true, data: settlement });
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Download Driver Drop PDF Receipt (sales report, commission slip, or both)
 * Query params: driverId, date, type (sales | commission | both)
 */
exports.downloadDriverDropPdf = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const { driverId, date, type = "both" } = req.query;

    if (!driverId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "driverId and date are required." });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    const settlement = await DriverDropSettlement.findOne({
      branchId: restaurantId,
      driverId,
      date,
    }).lean();

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    let orders = [];
    if (settlement && settlement.orders && settlement.orders.length > 0) {
      orders = settlement.orders;
    } else {
      const assignments = await DeliveryAssignment.find({
        driverId,
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      })
        .populate("orderId")
        .lean();

      orders = assignments
        .filter((a) => a.orderId)
        .map((a) => {
          const order = a.orderId;
          let pd = "CS";
          if (
            ["online", "doordash", "skip", "ubereats"].includes(order.orderSource) ||
            order.paymentMethod === "stripe"
          ) {
            pd = "PP";
          } else if (
            (order.payments &&
              order.payments.some(
                (p) =>
                  p.method === "card" ||
                  p.method === "debit" ||
                  p.method === "credit",
              )) ||
            order.paymentMethod === "card"
          ) {
            pd = "TM";
          } else {
            pd = "CS";
          }
          return {
            orderNumber: order.orderNumber,
            ticketName: `${order.orderNumber || ""} ${order.customer?.name || "Customer"}`.trim(),
            customerName: order.customer?.name || "Customer",
            total: order.total || 0,
            dc: 6.0,
            pd,
            prepaidTip: pd === "PP" ? order.tip || 0 : 0,
            terminalTip: pd === "TM" ? order.tip || 0 : 0,
          };
        });
    }

    const driverCode = driver.driverId || driver._id.toString().slice(-4);
    const filename = `Driver_Receipt_${type}_${driverCode}_${date}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await driverDropPdfService.generateDriverDropPdf(
      { driver, date, type, settlement, orders, branchId: restaurantId },
      res
    );
  } catch (error) {
    handleError(res, error, 500);
  }
};
