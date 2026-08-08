const Pusher = require("pusher");
const logger = require("../shared/utils/logger");

let pusherInstance = null;

if (
  process.env.PUSHER_APP_ID &&
  process.env.PUSHER_KEY &&
  process.env.PUSHER_SECRET &&
  process.env.PUSHER_CLUSTER
) {
  pusherInstance = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });
  logger.info("Pusher initialized successfully.");
} else {
  logger.warn(
    "Pusher env variables are missing. Real-time updates will be disabled.",
  );
}

/**
 * Triggers a real-time event to notify the kitchen dashboard about a new order.
 */
const triggerNewOrder = async (order) => {
  if (!pusherInstance) {
    logger.debug("Pusher is not initialized, skipping trigger.");
    return;
  }

  try {
    const channels = ["orders"];
    if (order.branchId) {
      channels.push(`orders-${order.branchId.toString()}`);
    }

    await pusherInstance.trigger(channels, "new-order", {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderSource: order.orderSource,
      orderType: order.orderType,
      orderTiming: order.orderTiming,
      scheduledAt: order.scheduledAt,
      createdAt: order.createdAt,
      branchId: order.branchId || null,
      branchName: order.branchName || "",
      branchCode: order.branchCode || "",
      items: (order.items || []).map(item => ({
        name: item.name,
        quantity: item.quantity
      }))
    });
    logger.info(`Pusher 'new-order' event triggered on channels [${channels.join(", ")}] for: ${order.orderNumber}`);
  } catch (error) {
    logger.error(`Failed to trigger Pusher event: ${error.message}`);
  }
};

const triggerOrderUpdated = async (order) => {
  if (!pusherInstance) {
    logger.debug("Pusher is not initialized, skipping trigger.");
    return;
  }

  try {
    const channels = ["orders", `private-order-${order._id.toString()}`];
    if (order.branchId) {
      channels.push(`orders-${order.branchId.toString()}`);
    }

    await pusherInstance.trigger(channels, "order-updated", {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderSource: order.orderSource,
      orderType: order.orderType,
      orderTiming: order.orderTiming,
      scheduledAt: order.scheduledAt,
      createdAt: order.createdAt,
      kitchenCleared: order.kitchenCleared,
      receptionCompleted: order.receptionCompleted,
      branchId: order.branchId || null,
      branchName: order.branchName || "",
      branchCode: order.branchCode || "",
    });
    logger.info(`Pusher 'order-updated' event triggered on channels [${channels.join(", ")}] for: ${order.orderNumber}`);
  } catch (error) {
    logger.error(`Failed to trigger Pusher event: ${error.message}`);
  }
};


const authenticateChannel = (socketId, channelName, context = {}) => {
  if (!pusherInstance) {
    throw new Error("Pusher is not initialized.");
  }

  if (channelName.startsWith("private-order-")) {
    return pusherInstance.authorizeChannel(socketId, channelName);
  }

  if (channelName.startsWith("private-restaurant-")) {
    const channelBranchId = channelName.replace("private-restaurant-", "").trim();
    const reqBranchId = context.branchId ? String(context.branchId) : null;

    if (reqBranchId && reqBranchId !== channelBranchId && !context.isSuperAdmin) {
      throw new Error("Forbidden: Cannot subscribe to another restaurant's private channel.");
    }
    return pusherInstance.authorizeChannel(socketId, channelName);
  }

  return pusherInstance.authorizeChannel(socketId, channelName);
};


const triggerDeliveryAssigned = async (restaurantId, orderId, driverInfo) => {
  if (!pusherInstance) {
    logger.debug("Pusher is not initialized, skipping delivery-assigned trigger.");
    return;
  }

  const payload = {
    orderId,
    driverId: driverInfo.driverId,
    driverName: driverInfo.name,
    driverColor: driverInfo.color,
    driverPhone: driverInfo.phone || null,
    vehicleNumber: driverInfo.vehicleNumber || null,
    assignedAt: new Date().toISOString(),
  };

  try {
    await Promise.all([
      pusherInstance.trigger(`private-restaurant-${restaurantId}`, "delivery-assigned", payload),
      pusherInstance.trigger(`private-order-${orderId}`, "delivery-assigned", payload),
    ]);
    logger.info(`Pusher 'delivery-assigned' triggered for order: ${orderId}`);
  } catch (error) {
    logger.error(`Failed to trigger delivery-assigned: ${error.message}`);
  }
};

const triggerDeliveryStatusUpdate = async (restaurantId, orderId, statusData) => {
  if (!pusherInstance) {
    logger.debug("Pusher is not initialized, skipping delivery-status-update trigger.");
    return;
  }

  const payload = {
    orderId,
    status: statusData.status,
    driverId: statusData.driverId || null,
    timestamp: new Date().toISOString(),
  };

  try {
    const channels = [`private-restaurant-${restaurantId}`];
    if (statusData.status !== "completed") {
      channels.push(`private-order-${orderId}`);
    }
    await pusherInstance.trigger(channels, "delivery-status-update", payload);
    logger.info(`Pusher 'delivery-status-update' (${statusData.status}) for order: ${orderId}`);
  } catch (error) {
    logger.error(`Failed to trigger delivery-status-update: ${error.message}`);
  }
};

const triggerDriverStatusChange = async (restaurantId, driverData) => {
  if (!pusherInstance) {
    logger.debug("Pusher is not initialized, skipping driver-status-change trigger.");
    return;
  }

  try {
    await pusherInstance.trigger(`private-restaurant-${restaurantId}`, "driver-status-change", {
      driverId: driverData.driverId,
      status: driverData.status,
      posCheckedIn: driverData.posCheckedIn,
      checkedOut: driverData.checkedOut,
      timestamp: new Date().toISOString(),
    });
    logger.info(`Pusher 'driver-status-change' (${driverData.status}) for driver: ${driverData.driverId}`);
  } catch (error) {
    logger.error(`Failed to trigger driver-status-change: ${error.message}`);
  }
};

module.exports = {
  pusherInstance,
  triggerNewOrder,
  triggerOrderUpdated,
  authenticateChannel,
  triggerDeliveryAssigned,
  triggerDeliveryStatusUpdate,
  triggerDriverStatusChange,
};
