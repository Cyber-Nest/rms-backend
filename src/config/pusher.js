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
    // Broadcast to global 'orders' channel for V1
    await pusherInstance.trigger("orders", "new-order", {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderSource: order.orderSource,
      orderType: order.orderType,
      orderTiming: order.orderTiming,
      scheduledAt: order.scheduledAt,
      createdAt: order.createdAt,
      items: (order.items || []).map(item => ({
        name: item.name,
        quantity: item.quantity
      }))
    });
    logger.info(`Pusher 'new-order' event triggered for: ${order.orderNumber}`);
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
    await pusherInstance.trigger("orders", "order-updated", {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderSource: order.orderSource,
      orderType: order.orderType,
      orderTiming: order.orderTiming,
      scheduledAt: order.scheduledAt,
      createdAt: order.createdAt,
    });
    logger.info(`Pusher 'order-updated' event triggered for: ${order.orderNumber}`);
  } catch (error) {
    logger.error(`Failed to trigger Pusher event: ${error.message}`);
  }
};

module.exports = {
  triggerNewOrder,
  triggerOrderUpdated,
};
