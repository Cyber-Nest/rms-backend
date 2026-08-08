const Driver = require("../models/Driver.model");
const DeliveryAssignment = require("../models/DeliveryAssignment.model");
const Vehicle = require("../models/Vehicle.model");
const DriverDropSettlement = require("../models/DriverDropSettlement.model");
const Order = require("../../order/models/order.model");
const Attendance = require("../../employee/models/attendance.model");
const Employee = require("../../employee/models/employee.model");
const driverDropPdfService = require("../services/driverDropPdf.service");
const logger = require("../../../shared/utils/logger");
const { generateSignedQrPayload, verifyQrPayload } = require("../../../shared/utils/qrSigning");

const {
  getLocalStartOfDay,
  getLocalEndOfDay,
  getLocalDateStr,
} = require("../../../shared/utils/timezone");
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

    const validPatterns = [/^private-restaurant-.+$/, /^private-order-.+$/];
    const isValid = validPatterns.some((p) => p.test(channel_name));
    if (!isValid) {
      return res
        .status(403)
        .json({ success: false, message: "Invalid channel name." });
    }

    let branchId = null;
    let isSuperAdmin = false;

    let token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : req.cookies?.rms_branch_token || req.headers["x-branch-token"];

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        branchId = decoded.branchId || decoded.restaurantId || decoded._id;
        isSuperAdmin = decoded.role === "super_admin";
      } catch (e) {}
    }

    const authResponse = authenticateChannel(socket_id, channel_name, {
      branchId,
      isSuperAdmin,
    });
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
    const [drivers, employees] = await Promise.all([
      Driver.find({ restaurantId })
        .select(
          "_id driverId name phone status isDutyOnline color activeOrderIds currentLocation assignedVehicleId",
        )
        .populate(
          "assignedVehicleId",
          "_id number label isAssigned assignedDriverId",
        )
        .lean(),
      Employee.find({
        branchId: restaurantId,
        $or: [{ role: "driver" }, { driverRef: { $exists: true, $ne: null } }],
        isActive: true,
      })
        .select("_id employeeId driverRef")
        .lean(),
    ]);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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

    const alphanumericRegex = /^[a-zA-Z0-9 -]+$/;
    if (!alphanumericRegex.test(number)) {
      return res.status(400).json({
        success: false,
        message:
          "Vehicle number must be alphanumeric (letters, numbers, space or hyphen only).",
      });
    }

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

    if (driver.isDutyOnline) {
      driver.status = "on-delivery";
    } else {
      driver.status = "offline";
    }
    driver.activeOrderIds.push(orderId);
    await driver.save();

    const vehicle = await Vehicle.findById(driver.assignedVehicleId).lean();

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

    if (driver.assignedVehicleId) {
      await Vehicle.findByIdAndUpdate(driver.assignedVehicleId, {
        isAssigned: false,
        assignedDriverId: null,
      });
    }

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
    const idRegex = new RegExp("^" + cleanDriverId + "$", "i");

    let employee = null;
    let driver = null;

    if (branchId) {
      employee = await Employee.findOne({
        branchId: String(branchId),
        $or: [{ employeeId: idRegex }, { phone: cleanDriverId }],
        isActive: true,
      });

      driver = await Driver.findOne({
        restaurantId: String(branchId),
        $or: [
          { driverId: idRegex },
          ...(employee?.driverRef ? [{ _id: employee.driverRef }] : []),
        ],
      });
    }

    // Global fallback if not found with specific branchId
    if (!employee) {
      employee = await Employee.findOne({
        $or: [{ employeeId: idRegex }, { phone: cleanDriverId }],
        isActive: true,
      });
    }

    if (!driver) {
      driver = await Driver.findOne({
        $or: [
          { driverId: idRegex },
          ...(employee?.driverRef ? [{ _id: employee.driverRef }] : []),
        ],
      });
    }

    if (!driver && !employee) {
      return res.status(401).json({
        success: false,
        message: "Driver ID is not registered in the system.",
      });
    }

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

    let isPasswordValid = false;
    if (employee) {
      isPasswordValid = await employee.comparePin(cleanPin);
      if (isPasswordValid && driver) {
        const matches = await driver.comparePassword(cleanPin);
        if (!matches) {
          driver.password = cleanPin;
          await driver.save();
        }
      }
    } else if (driver) {
      isPasswordValid = await driver.comparePassword(cleanPin);
    }

    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid 4-digit PIN." });
    }

    const targetBranchId =
      branchId || driver?.restaurantId || employee?.branchId;
    if (!driver && employee) {
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

    let assignedVehicle = null;
    if (driver.assignedVehicleId) {
      assignedVehicle = await Vehicle.findById(driver.assignedVehicleId).lean();
    }

    await triggerDriverStatusChange(driver.restaurantId, {
      driverId: driver._id.toString(),
      status: recoveredStatus,
    });

    // Generate JWT token for driver session
    const driverToken = jwt.sign(
      {
        _id: driver._id.toString(),
        driverId: driver.driverId,
        restaurantId: driver.restaurantId,
      },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

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
        token: driverToken,
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

    // Ownership check: driver can only view their own assignments
    if (req.driver && String(req.driver._id) !== String(id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own assignments.",
      });
    }

    const assignments = await DeliveryAssignment.find({
      driverId: id,
      status: { $in: ["assigned", "en-route", "delivered"] },
    })
      .populate("orderId")
      .sort({ assignedAt: -1 })
      .lean();

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
 * POST: Driver marks a delivery as delivered.
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

    // Ownership check:
    if (
      req.driver &&
      String(req.driver._id) !== String(assignment.driverId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update your own deliveries.",
      });
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

    if (
      req.driver &&
      String(req.driver._id) !== String(assignment.driverId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only complete your own deliveries.",
      });
    }

    assignment.status = "completed";
    assignment.completedAt = new Date();
    await assignment.save();

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
 */
exports.updateDriverStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (req.driver && String(req.driver._id) !== String(id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update your own status.",
      });
    }

    if (!["available", "offline"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'available' or 'offline'.",
      });
    }

    const existingDriver = await Driver.findById(id);
    if (!existingDriver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

    let targetStatus = status;
    let targetDutyOnline = status === "available";

    if (status === "available" && existingDriver.activeOrderIds && existingDriver.activeOrderIds.length > 0) {
      targetStatus = "on-delivery";
      targetDutyOnline = true;
    }

    existingDriver.status = targetStatus;
    existingDriver.isDutyOnline = targetDutyOnline;
    await existingDriver.save();

    await triggerDriverStatusChange(existingDriver.restaurantId, {
      driverId: existingDriver._id.toString(),
      status: targetStatus,
      isDutyOnline: targetDutyOnline,
    });

    res.status(200).json({ success: true, data: existingDriver });
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

    if (req.driver && String(req.driver._id) !== String(id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own profile.",
      });
    }

    const driver = await Driver.findById(id)
      .populate("assignedVehicleId")
      .lean();
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found." });
    }

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
              status: driver.status,
              isDutyOnline: Boolean(driver.isDutyOnline),
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

    await DeliveryAssignment.deleteOne({ _id: assignment._id });

    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.activeOrderIds = driver.activeOrderIds.filter(
        (oid) => oid.toString() !== orderId.toString(),
      );
      if (driver.activeOrderIds.length === 0) {
        driver.status = driver.isDutyOnline ? "available" : "offline";
      }
      await driver.save();

      await triggerDriverStatusChange(restaurantId, {
        driverId: driver._id.toString(),
        status: driver.status,
      });
    }

    const pusher = require("../../../config/pusher");
    if (pusher.pusherInstance) {
      pusher.pusherInstance.trigger(
        `private-order-${orderId}`,
        "delivery-unassigned",
        {
          orderId,
        },
      );
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
 */
exports.completeActiveAssignment = async (req, res) => {
  try {
    const { driverId } = req.params;

    await DeliveryAssignment.updateMany(
      { driverId, status: "delivered" },
      { $set: { status: "completed", completedAt: new Date() } },
    );

    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.status = "available";
      driver.activeOrderIds = [];
      await driver.save();

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
 */
exports.getDriverDropDrivers = async (req, res) => {
  try {
    const restaurantId = getRestaurantIdFromReq(req);
    const dateStr = req.query.date || new Date().toISOString().split("T")[0];

    const employees = await Employee.find({
      branchId: restaurantId,
      $or: [{ role: "driver" }, { driverRef: { $exists: true, $ne: null } }],
    })
      .select("_id driverRef employeeId name")
      .lean();

    const employeeIds = employees.map((e) => e._id);

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

    const targetDate = date || getLocalDateStr();
    const startOfDay = getLocalStartOfDay(targetDate);
    const endOfDay = getLocalEndOfDay(targetDate);

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

    const targetDate = date || getLocalDateStr();
    const startOfDay = getLocalStartOfDay(targetDate);
    const endOfDay = getLocalEndOfDay(targetDate);

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
 * GET: Download Driver Drop PDF Receipt
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

    const targetDate = date || getLocalDateStr();
    const startOfDay = getLocalStartOfDay(targetDate);
    const endOfDay = getLocalEndOfDay(targetDate);

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

/**
 * POST: Verify a signed Store QR token 
 */
exports.verifyStoreQr = async (req, res) => {
  try {
    const { qrToken } = req.body;
    if (!qrToken) {
      return res.status(400).json({
        success: false,
        message: "QR token is required.",
      });
    }

    // Try to verify as signed HMAC token
    try {
      const payload = verifyQrPayload(qrToken);

      return res.status(200).json({
        success: true,
        data: {
          branchId: payload.branchId,
          branchName: payload.branchName,
          branchCode: payload.branchCode,
          apiUrl: payload.apiUrl || "",
          verified: true,
          method: "signed",
        },
      });
    } catch (signedError) {
      // Fallback: Try to parse as plain JSON (backward compatibility for old QR codes)
      try {
        let parsed = null;
        const trimmed = qrToken.trim();
        if (trimmed.startsWith("{")) {
          parsed = JSON.parse(trimmed);
        } else {
          parsed = JSON.parse(decodeURIComponent(trimmed));
        }

        if (parsed && (parsed.type === "BRANCH_PAIRING_QR" || parsed.branchId)) {
          logger.warn(
            `[QR] Plain JSON QR used for branch ${parsed.branchId} — consider upgrading to signed QR`
          );
          return res.status(200).json({
            success: true,
            data: {
              branchId: parsed.branchId,
              branchName: parsed.branchName || parsed.name || "Restaurant Branch",
              branchCode: parsed.branchCode || parsed.code || "STORE",
              apiUrl: parsed.apiUrl || "",
              verified: true,
              method: "legacy_plain",
            },
          });
        }
      } catch (plainError) {
        // Both methods failed
      }

      return res.status(403).json({
        success: false,
        code: "INVALID_QR",
        message: "Invalid or tampered QR code. Please scan a valid Restaurant Store QR code.",
      });
    }
  } catch (error) {
    handleError(res, error, 500);
  }
};

/**
 * GET: Generate a signed QR token for a branch 
 */
exports.generateBranchQrToken = async (req, res) => {
  try {
    const branchId = req.params.branchId || req.activeBranchId;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required.",
      });
    }

    const Branch = require("../../company/models/branch.model");
    const branch = await Branch.findById(branchId).select("name code").lean();
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found.",
      });
    }

    let apiUrl =
      process.env.API_PUBLIC_URL ||
      `${req.protocol}://${req.get("host")}/api`;

    if (!apiUrl.includes("localhost") && !apiUrl.includes("127.0.0.1") && apiUrl.startsWith("http://")) {
      apiUrl = apiUrl.replace("http://", "https://");
    }

    const signedToken = generateSignedQrPayload({
      branchId: String(branchId),
      branchName: branch.name,
      branchCode: branch.code,
      apiUrl,
    });

    res.status(200).json({
      success: true,
      data: {
        signedToken,
        branchId: String(branchId),
        branchName: branch.name,
        branchCode: branch.code,
        apiUrl,
      },
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};
