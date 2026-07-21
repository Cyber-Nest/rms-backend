const Driver = require("../models/Driver.model");
const DeliveryAssignment = require("../models/DeliveryAssignment.model");
const Vehicle = require("../models/Vehicle.model");
const Order = require("../../order/models/order.model");
const logger = require("../../../shared/utils/logger");
const {
  authenticateChannel,
  triggerDeliveryAssigned,
  triggerDeliveryStatusUpdate,
  triggerDriverStatusChange,
  triggerOrderUpdated,
} = require("../../../config/pusher");

// ─── Helper ───
const handleError = (res, error, status = 400) => {
  logger.error(`Delivery Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};


// ─── PUSHER AUTH ───
exports.pusherAuth = async (req, res) => {
  try {
    const { socket_id, channel_name } = req.body;
    if (!socket_id || !channel_name) {
      return res.status(400).json({ success: false, message: "socket_id and channel_name are required." });
    }

    // Validate channel name pattern (only allow our delivery channels)
    const validPatterns = [
      /^private-restaurant-.+$/,
      /^private-order-.+$/,
    ];
    const isValid = validPatterns.some((p) => p.test(channel_name));
    if (!isValid) {
      return res.status(403).json({ success: false, message: "Invalid channel name." });
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

    // Get today's start and end 
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const query = {
      orderType: "delivery",
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
        }
      ]
    };

    const orders = await Order.find(query)
      .select("_id orderNumber customer status paymentStatus orderType total orderTiming scheduledAt createdAt dueAt")
      .sort({ createdAt: -1 })
      .lean();

    const orderIds = orders.map(o => o._id);
    const assignments = await DeliveryAssignment.find({ orderId: { $in: orderIds } })
      .populate("driverId")
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
        if (assignment.status === "completed" || assignment.status === "delivered") {
          deliveryStatus = "delivered";
        } else if (assignment.status === "en-route" || assignment.status === "assigned") {
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
    const { restaurantId = "default" } = req.query;
    const drivers = await Driver.find({ restaurantId })
      .select("_id driverId name phone status color activeOrderIds currentLocation assignedVehicleId")
      .populate("assignedVehicleId")
      .lean();

    const enriched = drivers.map((driver) => {
      const assignedVehicle = driver.assignedVehicleId;

      return {
        _id: driver._id,
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
        color: driver.color,
        activeOrders: driver.activeOrderIds || [],
        currentLocation: { lat: null, lng: null }, 
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
    const { restaurantId = "default" } = req.query;
    const vehicles = await Vehicle.find({ restaurantId })
      .select("_id number label status isAssigned assignedDriverId")
      .sort({ number: 1 })
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
    const { number, label, restaurantId = "default" } = req.body;
    if (!number || !label) {
      return res.status(400).json({ success: false, message: "Vehicle number and label are required." });
    }

    // Alphanumeric validation
    const alphanumericRegex = /^[a-zA-Z0-9 -]+$/;
    if (!alphanumericRegex.test(number)) {
      return res.status(400).json({ success: false, message: "Vehicle number must be alphanumeric (letters, numbers, space or hyphen only)." });
    }

    // Check if number already exists for this restaurant
    const existing = await Vehicle.findOne({ number, restaurantId });
    if (existing) {
      return res.status(400).json({ success: false, message: "Vehicle number already exists." });
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
    const { number, label } = req.body;

    if (!number || !label) {
      return res.status(400).json({ success: false, message: "Vehicle number and label are required." });
    }

    // Alphanumeric validation
    const alphanumericRegex = /^[a-zA-Z0-9 -]+$/;
    if (!alphanumericRegex.test(number)) {
      return res.status(400).json({ success: false, message: "Vehicle number must be alphanumeric (letters, numbers, space or hyphen only)." });
    }

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    // Check for duplicate vehicle number if changed
    if (vehicle.number !== number) {
      const existing = await Vehicle.findOne({ number, restaurantId: vehicle.restaurantId });
      if (existing) {
        return res.status(400).json({ success: false, message: "Vehicle number already exists." });
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
    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    // If vehicle is assigned to a driver, unassign it first
    if (vehicle.isAssigned && vehicle.assignedDriverId) {
      await Driver.findByIdAndUpdate(vehicle.assignedDriverId, {
        assignedVehicleId: null
      });
    }

    await Vehicle.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Vehicle deleted successfully." });
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
      return res.status(400).json({ success: false, message: "orderId and driverId are required." });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }
    if (!driver.assignedVehicleId) {
      return res.status(400).json({ success: false, message: "Driver has no vehicle assigned." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    // Check if already assigned
    const existingAssignment = await DeliveryAssignment.findOne({
      orderId,
      status: { $in: ["assigned", "en-route"] },
    });
    if (existingAssignment) {
      return res.status(400).json({ success: false, message: "Order is already assigned to a driver." });
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
      return res.status(400).json({ success: false, message: "driverId and vehicleId are required." });
    }

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }
    if (vehicle.isAssigned) {
      return res.status(400).json({ success: false, message: "Vehicle is already assigned." });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found." });
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
      return res.status(404).json({ success: false, message: "Driver not found." });
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

// ─── DRIVER APP APIs ───
/**
 * POST: Driver login with driverId + password. (plan password)
 */
exports.driverLogin = async (req, res) => {
  try {
    const { driverId, password } = req.body;
    if (!driverId || !password) {
      return res.status(400).json({ success: false, message: "driverId and password are required." });
    }

    const driver = await Driver.findOne({ driverId }).lean();
    if (!driver) {
      return res.status(401).json({ success: false, message: "Invalid driver ID." });
    }

    // V1: Plain text comparison (no bcrypt)
    if (driver.password !== password) {
      return res.status(401).json({ success: false, message: "Invalid password." });
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
      const hasDelivered = activeAssignments.some((a) => a.status === "delivered");
      recoveredStatus = hasDelivered ? "returning" : "on-delivery";
    }

    await Driver.findByIdAndUpdate(driver._id, {
      status: recoveredStatus,
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
      return res.status(404).json({ success: false, message: "Assignment not found." });
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
      { new: true }
    );

    // Trigger Pusher events
    await triggerDeliveryStatusUpdate(assignment.restaurantId, assignment.orderId.toString(), {
      status: "delivered",
      driverId: assignment.driverId.toString(),
    });

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
      return res.status(404).json({ success: false, message: "Assignment not found." });
    }

    assignment.status = "completed";
    assignment.completedAt = new Date();
    await assignment.save();

    // Set driver to available
    const driver = await Driver.findById(assignment.driverId);
    if (driver) {
      driver.status = "available";
      driver.activeOrderIds = [];
      await driver.save();

      await triggerDriverStatusChange(driver.restaurantId, {
        driverId: driver._id.toString(),
        status: "available",
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
      return res.status(400).json({ success: false, message: "Status must be 'available' or 'offline'." });
    }

    const driver = await Driver.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    ).lean();

    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found." });
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
    const driver = await Driver.findById(id).populate("assignedVehicleId").lean();
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }
    
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
        status: driver.status,
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
      return res.status(400).json({ success: false, message: "orderId is required." });
    }

    const assignment = await DeliveryAssignment.findOne({
      orderId,
      status: { $in: ["assigned", "en-route"] },
    });

    if (!assignment) {
      return res.status(404).json({ success: false, message: "No active assignment found for this order." });
    }

    const driverId = assignment.driverId;
    const restaurantId = assignment.restaurantId || "default";

    // Delete assignment
    await DeliveryAssignment.deleteOne({ _id: assignment._id });

    // Update driver state
    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.activeOrderIds = driver.activeOrderIds.filter(
        (oid) => oid.toString() !== orderId.toString()
      );
      if (driver.activeOrderIds.length === 0) {
        driver.status = "available";
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
      pusher.pusherInstance.trigger(`private-order-${orderId}`, "delivery-unassigned", {
        orderId,
      });
      // 2. Tell branch dashboard to re-fetch/update
      pusher.pusherInstance.trigger(`private-restaurant-${restaurantId}`, "delivery-assigned", {
        unassigned: true,
        orderId,
      });
    }

    res.status(200).json({ success: true, message: "Driver unassigned successfully." });
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
      { $set: { status: "completed", completedAt: new Date() } }
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

    res.status(200).json({ success: true, message: "Driver is now available." });
  } catch (error) {
    handleError(res, error, 500);
  }
};
