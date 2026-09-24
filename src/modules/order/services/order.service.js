const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Product = require("../../menu/models/product.model");
const Category = require("../../menu/models/category.model");
const Expense = require("../../expense/models/expense.model");
const Deposit = require("../models/deposit.model");
const DriverDropSettlement = require("../../delivery/models/DriverDropSettlement.model");
const logger = require("../../../shared/utils/logger");
const {
  getLocalDateStr,
  getLocalStartOfDay,
  getLocalEndOfDay,
  getLocalHour,
  getLocalDayName,
} = require("../../../shared/utils/timezone");
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;
const Payment = require("../../payment/models/payment.model");
const {
  triggerNewOrder,
  triggerOrderUpdated,
} = require("../../../config/pusher");

const round2 = (num) => {
  if (typeof num !== "number" || isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const buildDateFilter = (start, end, baseFilter = {}) => {
  const query = {};
  if (baseFilter.branchId) {
    if (mongoose.Types.ObjectId.isValid(baseFilter.branchId)) {
      query.$or = [
        { branchId: new mongoose.Types.ObjectId(baseFilter.branchId) },
        { branchId: String(baseFilter.branchId) },
      ];
    } else {
      query.branchId = baseFilter.branchId;
    }
  }

  const dateOr = [];
  if (start && end) {
    dateOr.push(
      { businessDate: { $gte: start, $lte: end } },
      { businessDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
      { businessDate: null, createdAt: { $gte: start, $lte: end } }
    );
  } else if (start) {
    dateOr.push(
      { businessDate: { $gte: start } },
      { businessDate: { $exists: false }, createdAt: { $gte: start } },
      { businessDate: null, createdAt: { $gte: start } }
    );
  } else if (end) {
    dateOr.push(
      { businessDate: { $lte: end } },
      { businessDate: { $exists: false }, createdAt: { $lte: end } },
      { businessDate: null, createdAt: { $lte: end } }
    );
  }

  if (dateOr.length > 0) {
    if (query.$or) {
      return {
        $and: [{ $or: query.$or }, { $or: dateOr }],
      };
    } else {
      query.$or = dateOr;
    }
  }
  return query;
};

let productLookupCache = null;
let lastCacheTime = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const getProductLookups = async () => {
  const now = Date.now();
  if (productLookupCache && now - lastCacheTime < CACHE_DURATION_MS) {
    return productLookupCache;
  }

  const categoryMap = {};
  const idMap = {};
  try {
    const products = await Product.find()
      .select("_id categoryId productId")
      .populate({ path: "categoryId", select: "name" })
      .lean();

    for (const p of products) {
      const prodId = p._id ? p._id.toString() : "";
      const catName =
        p.categoryId && typeof p.categoryId === "object"
          ? p.categoryId.name
          : "Other";
      if (prodId) {
        categoryMap[prodId] = catName;
        idMap[prodId] = p.productId || "";
      }
    }
    productLookupCache = { categoryMap, idMap };
    lastCacheTime = now;
  } catch (err) {
    logger.warn(`Could not build product lookup maps: ${err.message}`);
    if (!productLookupCache)
      productLookupCache = { categoryMap: {}, idMap: {} };
  }
  return productLookupCache;
};

exports.clearProductLookupCache = () => {
  productLookupCache = null;
  lastCacheTime = 0;
};

const getOrderBusinessDate = (order) => {
  return order.orderTiming === "later" && order.scheduledAt
    ? new Date(order.scheduledAt)
    : new Date(order.createdAt);
};

// ── Create Order ──────────────────────────────────────────────
exports.createOrder = async (orderData) => {
  try {
    const orderNumber = await Order.generateOrderNumber(
      orderData.orderType,
      orderData.orderTiming === "later" ? orderData.scheduledAt : null,
      orderData.branchId || null,
    );

    let paymentStatus =
      orderData.paymentTiming === "pay-later" ? "unpaid" : "paid";
    let payments = orderData.payments || [];
    let paymentIntent = null;

    if (orderData.paymentMethod === "stripe" && orderData.paymentIntentId) {
      if (!stripe)
        throw new Error(
          "Stripe is not configured. STRIPE_SECRET_KEY is missing.",
        );
      paymentIntent = await stripe.paymentIntents.retrieve(
        orderData.paymentIntentId,
        {
          expand: ["payment_method"],
        },
      );
      if (paymentIntent.status !== "succeeded") {
        throw new Error(
          `Stripe payment verification failed. Intent status: ${paymentIntent.status}`,
        );
      }

      const pmObj = paymentIntent.payment_method || {};
      const cardDetails =
        pmObj.card ||
        paymentIntent.charges?.data[0]?.payment_method_details?.card ||
        {};
      const cardBrand = cardDetails.brand || "";
      const cardFunding = cardDetails.funding || "";
      const cardLast4 = cardDetails.last4 || "";

      paymentStatus = "paid";
      payments = [
        {
          method: "card",
          amount: orderData.total,
          transactionId: orderData.paymentIntentId,
          cardBrand,
          cardFunding,
          cardLast4,
        },
      ];
    }

    // ── Moneris Terminal Payment ──────────────────────────────
    if (orderData.paymentMethod === "moneris" && orderData.monerisReceiptId) {
      paymentStatus = "paid";
      const monerisCardType = orderData.monerisCardType || "";
      // INTERAC debit → method = 'interac', else 'card'
      const method = monerisCardType.toUpperCase().includes("INTERAC") ? "interac" : "card";
      payments = [
        {
          method,
          amount: orderData.total,
          transactionId: orderData.monerisReceiptId,
          cardLast4: orderData.monerisCardLast4 || "",
          monerisReceiptId:    orderData.monerisReceiptId,
          monerisTerminalId:   orderData.monerisTerminalId || "",
          monerisAuthCode:     orderData.monerisAuthCode || "",
          monerisResponseCode: orderData.monerisResponseCode || "",
          monerisCardType:     monerisCardType,
        },
      ];
    }

    let dueAt = orderData.dueAt;
    if (!dueAt) {
      if (orderData.orderTiming === "later" && orderData.scheduledAt) {
        dueAt = new Date(orderData.scheduledAt);
      } else {
        let prepTimeMinutes = 15;
        try {
          let b = null;
          if (orderData.branchId) {
            b = await Branch.findById(orderData.branchId)
              .select("settings")
              .lean();
          }
          if (!b) {
            b = await Branch.findOne().select("settings").lean();
          }
          if (b?.settings?.mainSettings?.defaultTimeMinutes) {
            prepTimeMinutes =
              Number(b.settings.mainSettings.defaultTimeMinutes) || 15;
          }
        } catch (e) {}
        dueAt = new Date(Date.now() + prepTimeMinutes * 60 * 1000);
      }
    }

    const order = new Order({
      ...orderData,
      customer:
        orderData.customer &&
        orderData.customer.name &&
        orderData.customer.name.trim()
          ? orderData.customer
          : { name: "No Name", phone: "", email: "" },
      orderNumber,
      paymentStatus,
      payments,
      dueAt,
      tip: Number(orderData.tip) || 0,
      statusHistory: [
        {
          status: "pending",
          changedAt: new Date(),
          note: "New order placed",
          userName: orderData.placedBy || "Manager",
        },
      ],
    });

    await order.save();

    if (order.promoCode) {
      try {
        const promoService = require("../../promo/services/promo.service");
        promoService.incrementUsage(order.promoCode);
      } catch (err) {
        logger.error(`Failed to increment promo usage: ${err.message}`);
      }
    }

    triggerNewOrder(order).catch((err) => {
      logger.error(`Error triggering real-time Pusher event: ${err.message}`);
    });

    if (paymentIntent) {
      const charge = paymentIntent.charges?.data[0] || {};
      const cardDetails = charge.payment_method_details?.card || {};
      const cardBrand = cardDetails.brand || "";
      const cardFunding = cardDetails.funding || "";
      const cardLast4 = cardDetails.last4 || "";

      const paymentDoc = new Payment({
        orderId: order._id,
        branchId: order.branchId || null,
        orderNumber: order.orderNumber,
        amount: order.total,
        paymentMethod: "stripe",
        status: "succeeded",
        transactionId: orderData.paymentIntentId,
        cardBrand,
        cardFunding,
        cardLast4,
        rawStripeResponse: paymentIntent,
      });
      await paymentDoc.save();
    }

    // ── Save Moneris Payment Document ─────────────────────────
    if (orderData.paymentMethod === "moneris" && orderData.monerisReceiptId) {
      try {
        const monerisPaymentDoc = new Payment({
          orderId:             order._id,
          branchId:            order.branchId || null,
          orderNumber:         order.orderNumber,
          amount:              order.total,
          paymentMethod:       "moneris",
          status:              "succeeded",
          transactionId:       orderData.monerisReceiptId,
          cardLast4:           orderData.monerisCardLast4 || "",
          monerisReceiptId:    orderData.monerisReceiptId,
          monerisTerminalId:   orderData.monerisTerminalId || "",
          monerisAuthCode:     orderData.monerisAuthCode || "",
          monerisResponseCode: orderData.monerisResponseCode || "",
          monerisCardType:     orderData.monerisCardType || "",
          rawMonerisResponse:  orderData.rawMonerisResponse || null,
        });
        await monerisPaymentDoc.save();
      } catch (err) {
        logger.error(`Failed to save Moneris payment doc: ${err.message}`);
      }
    }

    logger.info(
      `Order created: ${orderNumber} for branch: ${order.branchName || "Main"}`,
    );
    return order;
  } catch (error) {
    logger.error(`Order Service Error: createOrder - ${error.message}`);
    throw error;
  }
};

// ── Get All Orders ────────────────────────────────────────────
exports.getAllOrders = async (filters = {}) => {
  try {
    let query = {};

    if (filters.branchId) {
      query.branchId = filters.branchId;
    }

    if (filters.status) {
      if (typeof filters.status === "string" && filters.status.includes(",")) {
        const statuses = filters.status.split(",");
        if (filters.excludeReceptionCompleted) {
          query.status = { $in: statuses };
          query.receptionCompleted = { $ne: true };
        } else {
          query.status = { $in: statuses };
        }
      } else {
        if (filters.excludeReceptionCompleted) {
          query.status = filters.status;
          query.receptionCompleted = { $ne: true };
        } else {
          query.status = filters.status;
        }
      }
    }
    if (filters.orderType) query.orderType = filters.orderType;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

    if (filters.excludeKitchenCleared) {
      query.kitchenCleared = { $ne: true };
    }

    let start = null;
    let end = null;
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) {
        start = getLocalStartOfDay(filters.startDate);
      }
      if (filters.endDate) {
        end = getLocalEndOfDay(filters.endDate);
      }
    } else if (filters.date) {
      start = getLocalStartOfDay(filters.date);
      end = getLocalEndOfDay(filters.date);
    }

    query = buildDateFilter(start, end, query);

    if (filters.search) {
      const escaped = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escaped, "i");
      const searchOr = [
        { orderNumber: searchRegex },
        { "customer.name": searchRegex },
        { "customer.phone": searchRegex },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    let selectFields =
      "orderNumber customer subtotal total orderType orderSource paymentStatus paymentType payments status createdAt items orderTiming scheduledAt dueAt receptionCompleted";
    if (filters.fields) {
      selectFields = filters.fields.split(",").join(" ");
    }

    const isPaginated =
      filters.page !== undefined || filters.limit !== undefined;

    if (isPaginated) {
      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(filters.limit) || 50));
      const skip = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        Order.find(query)
          .select(selectFields)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Order.countDocuments(query),
      ]);

      return {
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } else {
      const orders = await Order.find(query)
        .select(selectFields)
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();
      return orders;
    }
  } catch (error) {
    logger.error(`Order Service Error: getAllOrders - ${error.message}`);
    throw error;
  }
};

// ── Get Single Order ──────────────────────────────────────────
exports.getOrderById = async (id) => {
  try {
    const order = await Order.findById(id).lean();
    if (!order) throw new Error("Order not found.");
    return order;
  } catch (error) {
    logger.error(`Order Service Error: getOrderById - ${error.message}`);
    throw error;
  }
};

// ── Update Order Status ───────────────────────────────────────
exports.updateOrderStatus = async (
  id,
  status,
  note = "",
  receptionCompleted = undefined,
  userName = "Manager",
) => {
  try {
    const validTransitions = {
      pending: ["preparing", "ready", "cancelled"],
      preparing: ["ready", "cancelled"],
      ready: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
    };

    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    if (order.status === status) {
      if (receptionCompleted !== undefined) {
        order.receptionCompleted = receptionCompleted;
      }
      if (note) {
        order.statusHistory.push({
          status,
          changedAt: new Date(),
          note,
          userName,
        });
      }
      await order.save();

      triggerOrderUpdated(order).catch((err) => {
        logger.error(
          `Error triggering real-time update Pusher event: ${err.message}`,
        );
      });

      logger.info(
        `Order ${order.orderNumber} updated (status remained ${status}, receptionCompleted set to ${receptionCompleted})`,
      );
      return order;
    }

    const allowed = validTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new Error(
        `Cannot transition from "${order.status}" to "${status}".`,
      );
    }

    order.status = status;
    if (receptionCompleted !== undefined) {
      order.receptionCompleted = receptionCompleted;
    }
    order.statusHistory.push({ status, changedAt: new Date(), note, userName });
    await order.save();

    triggerOrderUpdated(order).catch((err) => {
      logger.error(
        `Error triggering real-time update Pusher event: ${err.message}`,
      );
    });

    logger.info(
      `Order ${order.orderNumber} status → ${status} (receptionCompleted: ${receptionCompleted})`,
    );
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderStatus - ${error.message}`);
    throw error;
  }
};

// ── Clear from Kitchen ────────────────────────────────────────
exports.kitchenClear = async (id, userName = "Manager") => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    if (!order.kitchenCleared) {
      order.kitchenCleared = true;
      order.statusHistory.push({
        status: order.status,
        changedAt: new Date(),
        note: "Cleared from kitchen (Handed over)",
        userName,
      });
      await order.save();

      triggerOrderUpdated(order).catch((err) => {
        logger.error(
          `Error triggering real-time update Pusher event: ${err.message}`,
        );
      });
      logger.info(`Order ${order.orderNumber} cleared from kitchen.`);
    }

    return order;
  } catch (error) {
    logger.error(`Order Service Error: kitchenClear - ${error.message}`);
    throw error;
  }
};

// ── Mark Order as Paid ─────────────────────
exports.markOrderPaid = async (id, payments) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    if (payments && payments.length > 0) {
      order.payments = [...(order.payments || []), ...payments];

      const paymentDocs = payments.map((p) => ({
        orderId: order._id,
        branchId: order.branchId || null,
        orderNumber: order.orderNumber,
        amount: p.amount,
        paymentMethod: p.method === "cash" ? "cash" : "card",
        status: "succeeded",
        cashGiven: p.cashGiven || 0,
        changeGiven: p.changeGiven || 0,
      }));
      await Payment.insertMany(paymentDocs);
    }

    const paymentsTotal = order.payments
      ? order.payments.reduce((sum, p) => sum + p.amount, 0)
      : 0;
    if (paymentsTotal >= order.total - 0.01) {
      order.paymentStatus = "paid";
      order.paymentTiming = "pay-now";
    } else {
      order.paymentStatus = "unpaid";
    }

    await order.save();
    try {
      triggerOrderUpdated(order);
    } catch (pushErr) {
      logger.warn(`Pusher update trigger error in markOrderPaid: ${pushErr.message}`);
    }

    logger.info(
      `Order ${order.orderNumber} payments updated. Total paid: ${paymentsTotal}`,
    );
    return order;
  } catch (error) {
    logger.error(`Order Service Error: markOrderPaid - ${error.message}`);
    throw error;
  }
};

// ── Cancel Order ──────────────────────────────────────────────
exports.cancelOrder = async (id, { reason = "", userName = "Manager" } = {}) => {
  try {
    const noteText = reason ? `Order Cancelled: ${reason.trim()}` : "Order Cancelled";
    const order = await Order.findOneAndUpdate(
      { _id: id, status: { $ne: "cancelled" } },
      {
        $set: { status: "cancelled", cancelReason: reason.trim() },
        $push: {
          statusHistory: { status: "cancelled", note: noteText, userName, changedAt: new Date() },
        },
      },
      { new: true },
    );
    if (!order) {
      const exists = await Order.findById(id).select("status").lean();
      if (!exists) throw new Error("Order not found.");
      throw new Error(`Order is already ${exists.status}.`);
    }

    triggerOrderUpdated(order).catch((err) => {
      logger.error(`Error triggering cancel Pusher event: ${err.message}`);
    });

    logger.info(`Order ${order.orderNumber} cancelled by ${userName}. Reason: ${reason}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: cancelOrder - ${error.message}`);
    throw error;
  }
};

// ── Refund Order ────────────
exports.refundOrder = async (id, { reason = "", userName = "Manager" } = {}) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    const isPos =
      order.orderSource === "pos" ||
      order.placedBy === "POS SYSTEM" ||
      !["online", "doordash", "skip", "ubereats"].includes(order.orderSource);
    if (!isPos) {
      throw new Error("Refund is only allowed for orders placed via POS System.");
    }

    if (order.paymentStatus === "refunded") {
      throw new Error("Order has already been refunded.");
    }

    if (order.status === "cancelled") {
      throw new Error("Cancelled orders cannot be refunded.");
    }

    order.status = "cancelled";
    order.paymentStatus = "refunded";
    order.refundedAt = new Date();
    order.refundedBy = userName;
    order.refundReason = reason.trim() || "Customer POS Refund";

    order.statusHistory.push({
      status: "refunded",
      changedAt: new Date(),
      note: `Order Refunded: ${reason.trim() || "POS Refund"}`,
      userName,
    });

    await order.save();

    triggerOrderUpdated(order).catch((err) => {
      logger.error(`Error triggering order refund Pusher event: ${err.message}`);
    });

    logger.info(`Order ${order.orderNumber} refunded by ${userName}`);

    return {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      refundedAt: order.refundedAt,
      refundedBy: order.refundedBy,
      refundReason: order.refundReason,
      total: order.total,
    };
  } catch (error) {
    logger.error(`Order Service Error: refundOrder - ${error.message}`);
    throw error;
  }
};

// ── Get Next Order Number ──────────────────────────────────────
exports.getNextOrderNumber = async (orderType, branchId = null) => {
  try {
    const nextNumber = await Order.previewNextOrderNumber(orderType, branchId);
    return nextNumber;
  } catch (error) {
    logger.error(`Order Service Error: getNextOrderNumber - ${error.message}`);
    throw error;
  }
};

// ── Update Order Due Time ─────────────────────────────────────
exports.updateOrderDueTime = async (id, dueAt) => {
  try {
    const order = await Order.findByIdAndUpdate(
      id,
      { $set: { dueAt: new Date(dueAt) } },
      { new: true },
    );
    if (!order) throw new Error("Order not found.");

    logger.info(`Order ${order.orderNumber} due time updated to ${dueAt}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderDueTime - ${error.message}`);
    throw error;
  }
};

// ── Update Order Items ─────────────────────────────────────────
exports.updateOrderItems = async (id, updateData) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    if (updateData.items) {
      order.items = updateData.items;
    }
    if (updateData.subtotal !== undefined) order.subtotal = updateData.subtotal;
    if (updateData.tax !== undefined) order.tax = updateData.tax;
    if (updateData.deliveryFee !== undefined) order.deliveryFee = updateData.deliveryFee;
    if (updateData.discount !== undefined) order.discount = updateData.discount;
    if (updateData.total !== undefined) order.total = updateData.total;
    if (updateData.orderType !== undefined) order.orderType = updateData.orderType;
    if (updateData.orderSource !== undefined) order.orderSource = updateData.orderSource;
    if (updateData.paymentTiming !== undefined) order.paymentTiming = updateData.paymentTiming;
    if (updateData.paymentType !== undefined) order.paymentType = updateData.paymentType;
    if (updateData.paymentMethod !== undefined) order.paymentMethod = updateData.paymentMethod;
    if (updateData.customer !== undefined) order.customer = updateData.customer;
    if (updateData.notes !== undefined) order.notes = updateData.notes;

    if (updateData.payments && Array.isArray(updateData.payments) && updateData.payments.length > 0) {
      order.payments = [...(order.payments || []), ...updateData.payments];
      for (const p of updateData.payments) {
        await Payment.create({
          orderId: order._id,
          orderNumber: order.orderNumber,
          branchId: order.branchId,
          amount: p.amount,
          method: p.method || "cash",
          transactionId: p.transactionId || null,
          cardBrand: p.cardBrand || "",
          cardFunding: p.cardFunding || "",
          cardLast4: p.cardLast4 || "",
          status: "completed",
        }).catch((err) => logger.warn(`Payment create error in updateOrderItems: ${err.message}`));
      }
    }

    const paymentsTotal = order.payments
      ? order.payments.reduce((sum, p) => sum + (p.amount || 0), 0)
      : 0;
    if (paymentsTotal >= (order.total || 0) - 0.01) {
      order.paymentStatus = "paid";
    } else if (order.paymentTiming === "pay-now" && updateData.payments && updateData.payments.length > 0) {
      order.paymentStatus = "paid";
    } else {
      order.paymentStatus = "unpaid";
    }

    await order.save();
    try {
      triggerOrderUpdated(order);
    } catch (pushErr) {
      logger.warn(`Pusher update trigger error: ${pushErr.message}`);
    }

    logger.info(
      `Order ${order.orderNumber} items updated. Type: ${order.orderType}, Payment status: ${order.paymentStatus}`,
    );
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderItems - ${error.message}`);
    throw error;
  }
};

// ── Get Sales Summary Aggregation ─────────────────────────────
const ACCOUNT_PAY_SOURCES = new Set(["online", "doordash", "skip", "ubereats"]);

const getBranchFilter = (branchId) => {
  if (!branchId) return null;
  if (mongoose.Types.ObjectId.isValid(branchId)) {
    return {
      $or: [
        { branchId: new mongoose.Types.ObjectId(branchId) },
        { branchId },
      ],
    };
  }
  return { branchId };
};

exports.getSalesSummary = async (filters = {}) => {
  try {
    let start = null;
    let end = null;
    let targetDateStr = "";

    if (filters.startDate || filters.endDate) {
      if (filters.startDate) {
        start = getLocalStartOfDay(filters.startDate);
        targetDateStr = String(filters.startDate).split("T")[0];
      }
      if (filters.endDate) {
        end = getLocalEndOfDay(filters.endDate);
      }
    } else if (filters.date) {
      start = getLocalStartOfDay(filters.date);
      end = getLocalEndOfDay(filters.date);
      targetDateStr = String(filters.date).split("T")[0];
    } else {
      targetDateStr = getLocalDateStr();
      start = getLocalStartOfDay(targetDateStr);
      end = getLocalEndOfDay(targetDateStr);
    }

    const baseFilter = filters.branchId ? { branchId: filters.branchId } : {};
    const query = buildDateFilter(start, end, baseFilter);

    const branchQuery = getBranchFilter(filters.branchId);

    const expQuery = {};
    if (branchQuery) Object.assign(expQuery, branchQuery);
    if (start && end) {
      expQuery.expenseDate = { $gte: start, $lte: end };
    }

    const dropQuery = { date: targetDateStr, ...branchQuery };
    const depositQuery = { date: targetDateStr, ...branchQuery };

    const [
      orders,
      deposit,
      expensesList,
      { categoryMap: productCategoryMap = {} } = {},
      driverSettlements,
    ] = await Promise.all([
      Order.find(query)
        .select(
          "status tip total subtotal tax discount orderType orderSource paymentStatus payments items.menuItemId items.categoryName items.category items.totalPrice items.basePrice items.quantity paymentMethod",
        )
        .lean(),
      Deposit.findOne(depositQuery).lean(),
      Expense.find(expQuery)
        .select("paymentMode amount expenseType employeeName pst gst hst")
        .lean()
        .catch(() => []),
      getProductLookups(),
      DriverDropSettlement.find(dropQuery)
        .lean()
        .catch(() => []),
    ]);

    let completedCount = 0;
    let completedTotal = 0;
    let cancelledCount = 0;
    let cancelledTotal = 0;
    let refundedCount = 0;
    let refundedTotal = 0;

    let grossSubtotal = 0;
    let grossTax = 0;
    let grossDiscount = 0;
    let grandTotal = 0;
    let totalTips = 0;

    const categorySales = {};

    let takeoutTotal = 0;
    let dineInTotal = 0;
    let driveThroughTotal = 0;
    let deliveryTotal = 0;

    let onlineTotal = 0;
    let posTotal = 0;
    let doordashTotal = 0;
    let skipTotal = 0;
    let ubereatsTotal = 0;

    let cashTotal = 0;
    let cardTotal = 0;
    let accountPayTotal = 0;
    let unpaidTotal = 0;
    let amexTotal = 0;
    let visaTotal = 0;
    let mastercardTotal = 0;
    let interacTotal = 0;
    let creditCardTotal = 0;
    let debitCardTotal = 0;

    for (const order of orders) {
      const {
        status,
        paymentStatus,
        total = 0,
        subtotal = 0,
        tax = 0,
        discount = 0,
        tip = 0,
        orderType,
        orderSource,
        payments,
        paymentMethod,
        items,
      } = order;

      if (paymentStatus === "refunded" || status === "refunded") {
        refundedCount++;
        refundedTotal += total;
      } else if (status === "cancelled") {
        cancelledCount++;
        cancelledTotal += total;
      } else {
        if (status === "completed") {
          completedCount++;
          completedTotal += total;
        }

        grossSubtotal += subtotal;
        grossTax += tax;
        grossDiscount += discount;
        grandTotal += total;
        totalTips += tip;

        switch (orderType) {
          case "takeout":
            takeoutTotal += total;
            break;
          case "dine-in":
          case "dinein":
            dineInTotal += total;
            break;
          case "drive-through":
          case "drivethrough":
            driveThroughTotal += total;
            break;
          case "delivery":
            deliveryTotal += total;
            break;
        }

        const src = (orderSource || "pos").toLowerCase();
        switch (src) {
          case "online":
            onlineTotal += total;
            break;
          case "doordash":
            doordashTotal += total;
            break;
          case "skip":
            skipTotal += total;
            break;
          case "ubereats":
          case "uber":
            ubereatsTotal += total;
            break;
          default:
            posTotal += total;
            break;
        }

        if (paymentStatus === "paid") {
          const isAccountPaySource = ACCOUNT_PAY_SOURCES.has(src);
          if (payments && payments.length > 0) {
            for (const p of payments) {
              const amount = p.amount || 0;
              const pMethod = (p.method || "").toLowerCase();
              if (isAccountPaySource || pMethod === "stripe") {
                accountPayTotal += amount;
              } else if (pMethod === "cash") {
                cashTotal += amount;
              } else {
                cardTotal += amount;

                const brand = (p.cardBrand || "").toLowerCase();
                const funding = (p.cardFunding || "").toLowerCase();

                if (brand.includes("visa")) {
                  visaTotal += amount;
                  creditCardTotal += amount;
                } else if (brand.includes("master")) {
                  mastercardTotal += amount;
                  creditCardTotal += amount;
                } else if (brand.includes("amex") || brand.includes("american")) {
                  amexTotal += amount;
                  creditCardTotal += amount;
                } else if (brand.includes("interac") || funding === "debit" || pMethod === "debit") {
                  interacTotal += amount;
                  debitCardTotal += amount;
                } else {
                  if (funding === "credit") {
                    creditCardTotal += amount;
                    visaTotal += amount;
                  } else {
                    interacTotal += amount;
                    debitCardTotal += amount;
                  }
                }
              }
            }
          } else {
            if (isAccountPaySource || paymentMethod === "stripe") {
              accountPayTotal += total;
            } else {
              cashTotal += total;
            }
          }
        } else {
          unpaidTotal += total;
        }

        if (items && items.length > 0) {
          for (const item of items) {
            const itemProdId = item.menuItemId || "";
            const catName =
              item.categoryName ||
              item.category ||
              productCategoryMap[itemProdId] ||
              "Open Item";
            const itemAmount = item.totalPrice || (item.basePrice || 0) * (item.quantity || 0);
            categorySales[catName] = (categorySales[catName] || 0) + itemAmount;
          }
        }
      }
    }

    let totalCashExpense = 0;
    const rawExpenses = (expensesList || []).map((e) => {
      const amount = e.amount || 0;
      if (e.paymentMode !== "card") {
        totalCashExpense += amount;
      }
      return {
        employee:
          e.expenseType === "store"
            ? "Store Expense"
            : e.employeeName || "Manager",
        pst: round2(e.pst || 0),
        gst: round2(e.gst || 0),
        hst: round2(e.hst || 0),
        total: round2(amount),
        paymentMode: e.paymentMode || "cash",
      };
    });

    let totalDriverCashPayout = 0;
    const driverReport = (driverSettlements || []).map((ds) => {
      totalDriverCashPayout += ds.netCashPayoutToDriver || 0;
      return {
        driverName: ds.driverName,
        shiftNumber: ds.shiftNumber || 1,
        deliveryCount: ds.totalOrders,
        prepaidSales: round2(ds.prepaidSales),
        cashSales: round2(ds.cashSales),
        cardSales: round2(ds.terminalSales),
        prepaidTip: round2(ds.prepaidTips),
        terminalTip: round2(ds.terminalTips),
        totalTip: round2(ds.totalTipsEarned),
        totalSales: round2(ds.totalSales),
        driverEarning: round2(ds.totalDriverEarning),
        expectedPayout: round2(ds.netCashPayoutToDriver),
      };
    });

    const adjustedExpectedCash = cashTotal - totalCashExpense - totalDriverCashPayout;
    const adjustedPosTotal = posTotal;
    const totalPaymentsReceived = accountPayTotal + cashTotal + cardTotal + unpaidTotal;

    let shortageOverageCash = 0;
    let shortageOverageCard = 0;
    let shortageOverageAccountPay = 0;

    if (deposit) {
      shortageOverageCash = deposit.cashAmount - adjustedExpectedCash;
      shortageOverageCard = deposit.cardAmount - cardTotal;
      shortageOverageAccountPay = deposit.accountPayAmount - accountPayTotal;
    }

    return {
      dateRange: {
        startDate: filters.startDate,
        endDate: filters.endDate || filters.date,
      },
      completedOrders: {
        count: completedCount,
        totalAmount: round2(completedTotal),
      },
      cancelledOrders: {
        count: cancelledCount,
        totalAmount: round2(cancelledTotal),
      },
      refundOrders: {
        count: refundedCount,
        totalAmount: round2(refundedTotal),
      },
      financials: {
        allCategoryTotal: round2(grossSubtotal),
        subTotal: round2(grossSubtotal),
        deliveryCharges: 0,
        debitCardCharges: 0,
        discount: round2(grossDiscount),
        tax: round2(grossTax),
        grandTotal: round2(grandTotal),
        tips: round2(totalTips),
        finalAmount: round2(grandTotal),
      },
      categorySales: Object.entries(categorySales).map(([name, total]) => ({
        name,
        total: round2(total),
      })),
      discountSummary: {
        percentageDiscount: round2(grossDiscount),
        total: round2(grossDiscount),
      },
      taxSummary: {
        pst: 0,
        gst: round2(grossTax),
        hst: 0,
        total: round2(grossTax),
      },
      salesReceived: {
        accountPay: round2(accountPayTotal),
        cash: round2(cashTotal),
        creditCardSales: round2(creditCardTotal),
        debitCardSales: round2(debitCardTotal),
        unpaid: round2(unpaidTotal),
        grandTotal: round2(totalPaymentsReceived),
        tips: round2(totalTips),
        finalAmount: round2(totalPaymentsReceived + totalTips),
      },
      cardTypeReceived: {
        interac: {
          total: round2(interacTotal),
          tips: 0,
          final: round2(interacTotal),
        },
        mastercard: {
          total: round2(mastercardTotal),
          tips: 0,
          final: round2(mastercardTotal),
        },
        visa: { total: round2(visaTotal), tips: 0, final: round2(visaTotal) },
        total: { total: round2(cardTotal), tips: 0, final: round2(cardTotal) },
      },
      orderTypeSummary: {
        takeout: round2(takeoutTotal),
        dineIn: round2(dineInTotal),
        driveThrough: round2(driveThroughTotal),
        delivery: round2(deliveryTotal),
        total: round2(grandTotal),
      },
      channelSummary: {
        online: round2(onlineTotal),
        doordash: round2(doordashTotal),
        skip: round2(skipTotal),
        ubereats: round2(ubereatsTotal),
        pos: round2(adjustedPosTotal),
      },
      expense: rawExpenses,
      shortageOverage: {
        cash: round2(shortageOverageCash),
        card: round2(shortageOverageCard),
        accountPay: round2(shortageOverageAccountPay),
      },
      moneyToBeCollected: {
        cash: round2(adjustedExpectedCash),
        card: round2(cardTotal),
        accountPay: round2(accountPayTotal),
      },
      driverReport,
      deposit: deposit
        ? {
            cashAmount: round2(deposit.cashAmount),
            cardAmount: round2(deposit.cardAmount),
            accountPayAmount: round2(deposit.accountPayAmount),
          }
        : null,
    };
  } catch (error) {
    logger.error(`Order Service Error: getSalesSummary - ${error.message}`);
    throw error;
  }
};

exports.saveDeposit = async (depositData) => {
  try {
    const { date, cashAmount, cardAmount, accountPayAmount, branchId } =
      depositData;
    if (!date) throw new Error("Deposit date is required.");

    const query = { date, ...(branchId ? { branchId } : {}) };
    const deposit = await Deposit.findOneAndUpdate(
      query,
      {
        cashAmount: cashAmount !== undefined ? cashAmount : 0,
        cardAmount: cardAmount !== undefined ? cardAmount : 0,
        accountPayAmount: accountPayAmount !== undefined ? accountPayAmount : 0,
        ...(branchId ? { branchId } : {}),
      },
      { returnDocument: "after", upsert: true },
    );
    return deposit;
  } catch (error) {
    logger.error(`Order Service Error: saveDeposit - ${error.message}`);
    throw error;
  }
};

exports.getDashboardMetrics = async (filters = {}) => {
  try {
    const targetDateStr = filters.date || getLocalDateStr();
    const TIMEZONE = "America/Edmonton";

    const todayStart = getLocalStartOfDay(targetDateStr);
    const todayEnd = getLocalEndOfDay(targetDateStr);

    const targetDate = new Date(targetDateStr);
    const past30Date = new Date(targetDate);
    past30Date.setDate(past30Date.getDate() - 30);
    const past30DateStr = past30Date.toISOString().slice(0, 10);
    const past30DaysStart = getLocalStartOfDay(past30DateStr);

    const branchIdFilter = {};
    if (filters.branchId) {
      if (mongoose.Types.ObjectId.isValid(filters.branchId)) {
        branchIdFilter.branchId = new mongoose.Types.ObjectId(filters.branchId);
      } else {
        branchIdFilter.branchId = filters.branchId;
      }
    }

    const dateMatchFilter = buildDateFilter(
      past30DaysStart,
      todayEnd,
      branchIdFilter,
    );
    const todayDateFilter = buildDateFilter(
      todayStart,
      todayEnd,
      branchIdFilter,
    );

    const [aggResult] = await Order.aggregate([
      { $match: dateMatchFilter },
      {
        $facet: {
          todayMetrics: [
            { $match: todayDateFilter },
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalEarnings: {
                  $sum: {
                    $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0],
                  },
                },
              },
            },
          ],
          popularDays: [
            { $match: { status: { $ne: "cancelled" } } },
            {
              $group: {
                _id: {
                  $dayOfWeek: {
                    date: { $ifNull: ["$businessDate", { $ifNull: ["$createdAt", "$$NOW"] }] },
                    timezone: TIMEZONE,
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
          popularFood: [
            { $match: { status: { $ne: "cancelled" } } },
            { $unwind: "$items" },
            {
              $group: {
                _id: "$items.name",
                value: { $sum: "$items.quantity" },
              },
            },
            { $sort: { value: -1 } },
            { $limit: 7 },
          ],
          customerData: [
            { $match: todayDateFilter },
            {
              $match: {
                $or: [
                  { "customer.phone": { $exists: true, $nin: ["", null] } },
                  { "customer.email": { $exists: true, $nin: ["", null] } },
                ],
              },
            },
            {
              $project: {
                phone: "$customer.phone",
                email: "$customer.email",
                businessDate: 1,
              },
            },
          ],
          allCustomerDates: [
            {
              $match: {
                $or: [
                  { "customer.phone": { $exists: true, $nin: ["", null] } },
                  { "customer.email": { $exists: true, $nin: ["", null] } },
                ],
              },
            },
            {
              $project: {
                phone: "$customer.phone",
                email: "$customer.email",
                businessDate: 1,
              },
            },
          ],
        },
      },
    ]);

    const todayMetrics = aggResult?.todayMetrics?.[0] || {
      totalOrders: 0,
      totalEarnings: 0,
    };

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const popularDaysData = (aggResult?.popularDays || [])
      .map((d) => ({ name: dayNames[d._id - 1] || "Unknown", value: d.count }))
      .filter((d) => d.value > 0);

    let popularFoodData = aggResult?.popularFood || [];
    if (popularFoodData.length > 6) {
      const top6 = popularFoodData.slice(0, 6);
      const otherVal = popularFoodData
        .slice(6)
        .reduce((sum, item) => sum + item.value, 0);
      popularFoodData = [...top6, { _id: "Other Items", value: otherVal }];
    }
    popularFoodData = popularFoodData.map((f) => ({
      name: f._id || f.name || "Unknown",
      value: f.value,
    }));
    if (popularFoodData.length === 0) {
      popularFoodData = [{ name: "No Menu Items Sold", value: 0 }];
    }

    let newCustomers = 0;
    let returningCustomers = 0;
    const phoneToEarliestDate = new Map();
    const emailToEarliestDate = new Map();

    for (const order of aggResult?.allCustomerDates || []) {
      const orderDate = order.businessDate ? new Date(order.businessDate) : new Date();
      const phone = order.phone?.trim();
      const email = order.email?.trim();
      if (phone) {
        const existing = phoneToEarliestDate.get(phone);
        if (!existing || orderDate < existing) {
          phoneToEarliestDate.set(phone, orderDate);
        }
      }
      if (email) {
        const existing = emailToEarliestDate.get(email);
        if (!existing || orderDate < existing) {
          emailToEarliestDate.set(email, orderDate);
        }
      }
    }

    const seenCustomers = new Set();
    for (const order of aggResult?.customerData || []) {
      const phone = order.phone?.trim();
      const email = order.email?.trim();
      const customerKey = phone || email;
      if (!customerKey) continue;

      if (seenCustomers.has(customerKey)) continue;
      seenCustomers.add(customerKey);

      let hasPrev = false;
      if (phone && phoneToEarliestDate.has(phone)) {
        if (new Date(phoneToEarliestDate.get(phone)) < todayStart)
          hasPrev = true;
      }
      if (!hasPrev && email && emailToEarliestDate.has(email)) {
        if (new Date(emailToEarliestDate.get(email)) < todayStart)
          hasPrev = true;
      }
      if (hasPrev) returningCustomers += 1;
      else newCustomers += 1;
    }

    return {
      totalOrders: todayMetrics.totalOrders,
      totalEarnings: round2(todayMetrics.totalEarnings),
      newCustomers,
      returningCustomers,
      popularDaysData,
      popularFoodData,
    };
  } catch (error) {
    logger.error(`Order Service Error: getDashboardMetrics - ${error.message}`);
    throw error;
  }
};

exports.getUniqueCustomers = async (filters = {}) => {
  try {
    let matchQuery = {
      "customer.name": { $exists: true, $nin: ["", null] },
      $or: [
        {
          "customer.phone": {
            $exists: true,
            $nin: ["", "No phone", "No Phone", null],
          },
        },
        {
          "customer.email": {
            $exists: true,
            $nin: ["", "No email", "No Email", null],
          },
        },
      ],
    };

    if (filters.date) {
      const start = getLocalStartOfDay(filters.date);
      const end = getLocalEndOfDay(filters.date);
      matchQuery = buildDateFilter(start, end, matchQuery);
    }

    if (filters.branchId) {
      matchQuery.branchId = new mongoose.Types.ObjectId(filters.branchId);
    }

    const pipeline = [
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              {
                $and: [
                  { $ifNull: ["$customer.phone", false] },
                  { $ne: ["$customer.phone", ""] },
                ],
              },
              "$customer.phone",
              "$customer.email",
            ],
          },
          firstName: { $first: "$customer.name" },
          phone: { $first: "$customer.phone" },
          email: { $first: "$customer.email" },
          address: { $first: "$customer.address" },
          postalCode: { $first: "$customer.postalCode" },
          updatedDate: { $first: "$updatedAt" },
          lastOrderDate: { $first: "$createdAt" },
        },
      },
      { $sort: { lastOrderDate: -1 } },
    ];

    let results = await Order.aggregate(pipeline);

    let customers = results.map((c) => {
      const nameParts = (c.firstName || "").trim().split(/\s+/);
      const fName = nameParts[0] || "";
      const lName = nameParts.slice(1).join(" ") || "";
      return {
        firstName: fName,
        lastName: lName,
        phone: c.phone || "",
        email: c.email || "",
        updatedDate: c.updatedDate || c.lastOrderDate,
        lastOrderDate: c.lastOrderDate,
        address: c.address || "",
        postalCode: c.postalCode || "",
      };
    });

    return customers;
  } catch (error) {
    logger.error(`Order Service Error: getUniqueCustomers - ${error.message}`);
    throw error;
  }
};

exports.getReportsSummary = async (filters = {}) => {
  try {
    let start = null;
    let end = null;
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) {
        start = getLocalStartOfDay(filters.startDate);
      }
      if (filters.endDate) {
        end = getLocalEndOfDay(filters.endDate);
      }
    }
    const baseFilter = filters.branchId
      ? { branchId: new mongoose.Types.ObjectId(filters.branchId) }
      : {};
    const dateFilter = buildDateFilter(start, end, baseFilter);

    const { categoryMap: productCategoryMap } = await getProductLookups();

    const pipeline = [];
    if (Object.keys(dateFilter).length > 0) {
      pipeline.push({ $match: dateFilter });
    }
    pipeline.push({
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              completedCount: {
                $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, 1, 0] },
              },
              completedTotal: {
                $sum: {
                  $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0],
                },
              },
              cancelledCount: {
                $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
              },
              cancelledTotal: {
                $sum: {
                  $cond: [{ $eq: ["$status", "cancelled"] }, "$total", 0],
                },
              },
              grossSubtotal: {
                $sum: {
                  $cond: [{ $ne: ["$status", "cancelled"] }, "$subtotal", 0],
                },
              },
              grossTax: {
                $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$tax", 0] },
              },
              grossDiscount: {
                $sum: {
                  $cond: [{ $ne: ["$status", "cancelled"] }, "$discount", 0],
                },
              },
              takeoutTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderType", "takeout"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              dineInTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderType", "dine-in"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              driveThroughTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderType", "drive-through"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              deliveryTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderType", "delivery"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              onlineTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderSource", "online"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              posTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderSource", "pos"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              doordashTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderSource", "doordash"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              skipTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderSource", "skip"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              ubereatsTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $eq: ["$orderSource", "ubereats"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
            },
          },
        ],
        payments: [
          {
            $match: {
              status: { $ne: "cancelled" },
              paymentStatus: "paid",
            },
          },
          {
            $project: {
              total: 1,
              orderSource: 1,
              payments: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$payments", []] } }, 0] },
                  "$payments",
                  [{ method: "cash", amount: "$total" }],
                ],
              },
            },
          },
          { $unwind: "$payments" },
          {
            $group: {
              _id: {
                method: "$payments.method",
                brand: "$payments.cardBrand",
                funding: "$payments.cardFunding",
                orderSource: "$orderSource",
              },
              amount: { $sum: "$payments.amount" },
            },
          },
        ],
        items: [
          { $match: { status: { $ne: "cancelled" } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.menuItemId",
              total: {
                $sum: {
                  $ifNull: [
                    "$items.totalPrice",
                    { $multiply: ["$items.basePrice", "$items.quantity"] },
                  ],
                },
              },
            },
          },
        ],
      },
    });
    const [summaryResult] = await Order.aggregate(pipeline);

    const totals = summaryResult?.totals?.[0] || {
      completedCount: 0,
      completedTotal: 0,
      cancelledCount: 0,
      cancelledTotal: 0,
      grossSubtotal: 0,
      grossTax: 0,
      grossDiscount: 0,
      takeoutTotal: 0,
      dineInTotal: 0,
      driveThroughTotal: 0,
      onlineTotal: 0,
      posTotal: 0,
      doordashTotal: 0,
      skipTotal: 0,
      ubereatsTotal: 0,
    };

    const categorySalesMap = {};
    if (summaryResult?.items) {
      for (const itemGroup of summaryResult.items) {
        const prodId = itemGroup._id || "";
        const catName = productCategoryMap[prodId] || "Open Item";
        const val = itemGroup.total || 0;
        categorySalesMap[catName] = (categorySalesMap[catName] || 0) + val;
      }
    }

    const categorySales = Object.entries(categorySalesMap).map(
      ([name, total]) => ({
        name,
        total: round2(total),
      }),
    );

    let cashTotal = 0;
    let cardTotal = 0;
    let accountPayTotal = 0;
    let visaTotal = 0;
    let mastercardTotal = 0;
    let interacTotal = 0;
    let creditCardTotal = 0;
    let debitCardTotal = 0;

    if (summaryResult?.payments) {
      for (const p of summaryResult.payments) {
        const method = p._id?.method;
        const brand = p._id?.brand?.toLowerCase() || "";
        const funding = p._id?.funding?.toLowerCase() || "";
        const orderSource = p._id?.orderSource;

        if (
          ["online", "doordash", "skip", "ubereats"].includes(orderSource) ||
          method === "stripe"
        ) {
          accountPayTotal += p.amount;
        } else if (method === "cash") {
          cashTotal += p.amount;
        } else {
          cardTotal += p.amount;
          if (brand === "visa") visaTotal += p.amount;
          else if (brand === "mastercard") mastercardTotal += p.amount;
          else interacTotal += p.amount;

          if (funding === "credit") creditCardTotal += p.amount;
          else debitCardTotal += p.amount;
        }
      }
    }

    let totalCashExpense = 0;
    const rawExpenses = [];
    try {
      const expQuery = {};
      if (filters.branchId) expQuery.branchId = filters.branchId;
      if (start && end) {
        expQuery.expenseDate = { $gte: start, $lte: end };
      } else if (start) {
        expQuery.expenseDate = { $gte: start };
      } else if (end) {
        expQuery.expenseDate = { $lte: end };
      }
      const expensesList = await Expense.find(expQuery)
        .select("paymentMode amount expenseType employeeName pst gst hst")
        .lean();

      for (const e of expensesList) {
        rawExpenses.push({
          employee:
            e.expenseType === "store"
              ? "Store Expense"
              : e.employeeName || "Manager",
          pst: round2(e.pst || 0),
          gst: round2(e.gst || 0),
          hst: round2(e.hst || 0),
          total: round2(e.amount || 0),
          paymentMode: e.paymentMode || "cash",
        });
        if (e.paymentMode !== "card") {
          totalCashExpense += e.amount || 0;
        }
      }
    } catch (err) {
      logger.warn(`Could not query expenses for reports: ${err.message}`);
    }

    const adjustedPosTotal = Math.max(0, totals.posTotal - totalCashExpense);

    return {
      completedOrders: {
        count: totals.completedCount,
        totalAmount: round2(totals.completedTotal),
      },
      cancelledOrders: {
        count: totals.cancelledCount,
        totalAmount: round2(totals.cancelledTotal),
      },
      refundOrders: { count: 0, totalAmount: 0 },
      financials: {
        allCategoryTotal: round2(totals.grossSubtotal),
        subTotal: round2(totals.grossSubtotal),
        deliveryCharges: 0,
        debitCardCharges: 0,
        discount: round2(totals.grossDiscount),
        tax: round2(totals.grossTax),
        grandTotal: round2(totals.completedTotal),
        tips: 0,
        finalAmount: round2(totals.completedTotal),
      },
      categorySales,
      discountSummary: {
        percentageDiscount: round2(totals.grossDiscount),
        total: round2(totals.grossDiscount),
      },
      taxSummary: {
        pst: 0,
        gst: round2(totals.grossTax),
        hst: 0,
        total: round2(totals.grossTax),
      },
      salesReceived: {
        accountPay: round2(accountPayTotal),
        cash: round2(cashTotal),
        creditCardSales: round2(creditCardTotal),
        debitCardSales: round2(debitCardTotal),
        grandTotal: round2(totals.completedTotal),
        tips: 0,
        finalAmount: round2(totals.completedTotal),
      },
      cardTypeReceived: {
        interac: {
          total: round2(interacTotal),
          tips: 0,
          final: round2(interacTotal),
        },
        mastercard: {
          total: round2(mastercardTotal),
          tips: 0,
          final: round2(mastercardTotal),
        },
        visa: { total: round2(visaTotal), tips: 0, final: round2(visaTotal) },
        total: { total: round2(cardTotal), tips: 0, final: round2(cardTotal) },
      },
      orderTypeSummary: {
        takeout: round2(totals.takeoutTotal),
        dineIn: round2(totals.dineInTotal),
        driveThrough: round2(totals.driveThroughTotal),
        delivery: round2(totals.deliveryTotal),
        total: round2(totals.completedTotal),
      },
      channelSummary: {
        online: round2(totals.onlineTotal),
        doordash: round2(totals.doordashTotal),
        skip: round2(totals.skipTotal),
        ubereats: round2(totals.ubereatsTotal),
        pos: round2(adjustedPosTotal),
      },
      expense: rawExpenses,
    };
  } catch (error) {
    logger.error(`Order Service Error: getReportsSummary - ${error.message}`);
    throw error;
  }
};

exports.getItemSalesSummary = async ({ startDate, endDate, branchId } = {}) => {
  try {
    const { categoryMap: productCategoryMap, idMap: productIDMap } =
      await getProductLookups();

    const baseFilter = {
      status: { $ne: "cancelled" },
      ...(branchId ? { branchId } : {}),
    };
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      const todayStr = getLocalDateStr();
      start = getLocalStartOfDay(todayStr);
      end = getLocalEndOfDay(todayStr);
    }
    const matchQuery = buildDateFilter(start, end, baseFilter);

    const aggregatedItems = await Order.aggregate([
      { $match: matchQuery },
      { $project: { items: 1 } },
      { $unwind: "$items" },
      {
        $group: {
          _id: {
            menuItemId: "$items.menuItemId",
            name: "$items.name",
          },
          quantitySold: { $sum: "$items.quantity" },
          totalSales: { $sum: "$items.totalPrice" },
        },
      },
    ]);

    const categoriesMap = {};

    for (const item of aggregatedItems) {
      const menuItemId = item._id.menuItemId;
      const name = item._id.name;
      const quantitySold = item.quantitySold;
      const totalSales = round2(item.totalSales);

      const categoryName = productCategoryMap[menuItemId] || "Other";

      if (!categoriesMap[categoryName]) {
        categoriesMap[categoryName] = {
          categoryName,
          items: [],
          subtotalSold: 0,
          subtotalSales: 0,
        };
      }

      categoriesMap[categoryName].items.push({
        name,
        menuItemId,
        productId: productIDMap[menuItemId] || "",
        quantitySold,
        totalSales,
        percentageSales: 0,
      });

      categoriesMap[categoryName].subtotalSold += quantitySold;
      categoriesMap[categoryName].subtotalSales += totalSales;
    }

    const result = [];
    for (const catName of Object.keys(categoriesMap)) {
      const catData = categoriesMap[catName];
      catData.subtotalSales = round2(catData.subtotalSales);

      for (const item of catData.items) {
        if (catData.subtotalSales > 0) {
          item.percentageSales = round2(
            (item.totalSales / catData.subtotalSales) * 100,
          );
        } else {
          item.percentageSales = 0;
        }
      }

      catData.items.sort((a, b) => b.totalSales - a.totalSales);

      result.push(catData);
    }

    result.sort((a, b) => b.subtotalSales - a.subtotalSales);

    return result;
  } catch (error) {
    logger.error(`Order Service Error: getItemSalesSummary - ${error.message}`);
    throw error;
  }
};

exports.getHourlySalesSummary = async ({
  startDate,
  endDate,
  branchId,
} = {}) => {
  try {
    const TIMEZONE = "America/Edmonton";
    const baseFilter = {
      status: { $in: ["pending", "preparing", "ready", "completed"] },
      ...(branchId ? { branchId } : {}),
    };
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      const todayStr = getLocalDateStr();
      start = getLocalStartOfDay(todayStr);
      end = getLocalEndOfDay(todayStr);
    }
    const matchQuery = buildDateFilter(start, end, baseFilter);

    const hourlyData = await Order.aggregate([
      { $match: matchQuery },
      {
        $project: {
          total: 1,
          businessHour: {
            $hour: {
              date: { $ifNull: ["$businessDate", "$createdAt"] },
              timezone: TIMEZONE,
            },
          },
        },
      },
      {
        $group: {
          _id: "$businessHour",
          orderCount: { $sum: 1 },
          totalSales: { $sum: "$total" },
        },
      },
    ]);

    const hourMap = new Map();
    for (const row of hourlyData) {
      hourMap.set(row._id, {
        orderCount: row.orderCount,
        totalSales: row.totalSales,
      });
    }

    const hourlySlots = [];
    for (let h = 0; h < 24; h++) {
      let label = "";
      if (h === 0) {
        label = "12 AM to 1 AM";
      } else if (h === 12) {
        label = "12 PM to 1 PM";
      } else if (h < 12) {
        label = `${h} AM to ${h + 1 === 12 ? "12 PM" : h + 1 + " AM"}`;
      } else {
        const hr12 = h - 12;
        label = `${hr12} PM to ${hr12 + 1 === 12 ? "12 AM" : hr12 + 1 + " PM"}`;
      }
      hourlySlots.push({
        label,
        startHour: h,
        endHour: (h + 1) % 24,
        orderCount: 0,
        totalSales: 0,
      });
    }

    for (const slot of hourlySlots) {
      const data = hourMap.get(slot.startHour);
      if (data) {
        slot.orderCount = data.orderCount;
        slot.totalSales = round2(data.totalSales);
      }
    }

    return hourlySlots;
  } catch (error) {
    logger.error(
      `Order Service Error: getHourlySalesSummary - ${error.message}`,
    );
    throw error;
  }
};

exports.getMonthlySalesSummary = async ({
  startDate,
  endDate,
  branchId,
} = {}) => {
  try {
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      const todayStr = getLocalDateStr();
      const parts = todayStr.split("-");
      const firstOfMonth = `${parts[0]}-${parts[1]}-01`;
      start = getLocalStartOfDay(firstOfMonth);
      end = getLocalEndOfDay(todayStr);
    }

    const baseFilter = branchId ? { branchId } : {};
    const dateFilter = buildDateFilter(start, end, baseFilter);
    const branchQuery = getBranchFilter(branchId);

    const expQuery = {};
    if (branchQuery) Object.assign(expQuery, branchQuery);
    if (start && end) {
      expQuery.expenseDate = { $gte: start, $lte: end };
    }

    const dropQuery = { ...branchQuery };
    const depositQuery = { ...branchQuery };

    const [
      orders,
      expensesList,
      depositsList,
      driverSettlementsList,
      { categoryMap: productCategoryMap = {} } = {},
    ] = await Promise.all([
      Order.find(dateFilter)
        .select(
          "status tip total subtotal tax discount deliveryFee orderType orderSource paymentStatus payments items.menuItemId items.categoryName items.category items.totalPrice items.basePrice items.quantity paymentMethod promoCode businessDate createdAt",
        )
        .lean(),
      Expense.find(expQuery)
        .select("expenseDate paymentMode amount expenseType employeeName pst gst hst")
        .lean()
        .catch(() => []),
      Deposit.find(depositQuery)
        .lean()
        .catch(() => []),
      DriverDropSettlement.find(dropQuery)
        .lean()
        .catch(() => []),
      getProductLookups(),
    ]);

    const ordersByDay = new Map();
    for (const order of orders) {
      const dateVal = order.businessDate || order.createdAt;
      const dateStr = dateVal ? getLocalDateStr(new Date(dateVal)) : "";
      if (!dateStr) continue;
      if (!ordersByDay.has(dateStr)) {
        ordersByDay.set(dateStr, []);
      }
      ordersByDay.get(dateStr).push(order);
    }

    const expensesByDay = new Map();
    for (const e of expensesList) {
      const dateStr = e.expenseDate ? getLocalDateStr(new Date(e.expenseDate)) : "";
      if (!dateStr) continue;
      if (!expensesByDay.has(dateStr)) {
        expensesByDay.set(dateStr, []);
      }
      expensesByDay.get(dateStr).push(e);
    }

    const depositByDay = new Map();
    for (const d of depositsList) {
      if (d.date) {
        depositByDay.set(d.date, d);
      }
    }

    const settlementsByDay = new Map();
    for (const ds of driverSettlementsList) {
      if (ds.date) {
        if (!settlementsByDay.has(ds.date)) {
          settlementsByDay.set(ds.date, []);
        }
        settlementsByDay.get(ds.date).push(ds);
      }
    }

    const startDateStr = startDate || getLocalDateStr(start);
    const endDateStr = endDate || getLocalDateStr(end);
    const currentDate = new Date(startDateStr);
    const stopDate = new Date(endDateStr);

    const result = [];

    while (currentDate <= stopDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dateParts = dateStr.split("-");
      const reportDateFormatted = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;

      const dayOrders = ordersByDay.get(dateStr) || [];
      const dayExpenses = expensesByDay.get(dateStr) || [];
      const dayDeposit = depositByDay.get(dateStr) || null;
      const daySettlements = settlementsByDay.get(dateStr) || [];

      let completedCount = 0;
      let paidCancelledCount = 0;
      let unpaidCancelledCount = 0;
      let refundCount = 0;
      let refundAmount = 0;

      let grossSubtotal = 0;
      let grossDeliveryFee = 0;
      let grossTax = 0;
      let grossDiscount = 0;
      let grandTotal = 0;
      let totalTips = 0;

      let takeoutTotal = 0;
      let dineInTotal = 0;
      let driveThroughTotal = 0;
      let deliveryTotal = 0;

      let websiteTotal = 0;
      let uberTotal = 0;
      let skipTotal = 0;
      let doordashTotal = 0;
      let posTotal = 0;

      let cashTotal = 0;
      let cardTotal = 0;
      let accountPayTotal = 0;
      let amexTotal = 0;
      let visaTotal = 0;
      let mastercardTotal = 0;
      let interacTotal = 0;
      let creditCardTotal = 0;
      let debitCardTotal = 0;

      const promoMap = new Map();

      for (const order of dayOrders) {
        const {
          status,
          paymentStatus,
          total = 0,
          subtotal = 0,
          tax = 0,
          discount = 0,
          deliveryFee = 0,
          tip = 0,
          orderType,
          orderSource,
          payments,
          paymentMethod,
          promoCode,
        } = order;

        if (paymentStatus === "refunded" || status === "refunded") {
          refundCount++;
          refundAmount += total;
        } else if (status === "cancelled") {
          if (paymentStatus === "paid") {
            paidCancelledCount++;
          } else {
            unpaidCancelledCount++;
          }
        } else {
          if (status === "completed") {
            completedCount++;
          }
          grossSubtotal += subtotal;
          grossDeliveryFee += deliveryFee;
          grossTax += tax;
          grossDiscount += discount;
          grandTotal += total;
          totalTips += tip;

          if (promoCode) {
            const codeKey = String(promoCode).toUpperCase();
            if (!promoMap.has(codeKey)) {
              promoMap.set(codeKey, { code: codeKey, count: 0, totalDiscount: 0 });
            }
            const pData = promoMap.get(codeKey);
            pData.count += 1;
            pData.totalDiscount += Number(discount || 0);
          }

          switch (orderType) {
            case "takeout":
              takeoutTotal += total;
              break;
            case "dine-in":
            case "dinein":
              dineInTotal += total;
              break;
            case "drive-through":
            case "drivethrough":
              driveThroughTotal += total;
              break;
            case "delivery":
              deliveryTotal += total;
              break;
          }

          const src = (orderSource || "pos").toLowerCase();
          switch (src) {
            case "online":
              websiteTotal += total;
              break;
            case "doordash":
              doordashTotal += total;
              break;
            case "skip":
              skipTotal += total;
              break;
            case "ubereats":
            case "uber":
              uberTotal += total;
              break;
            default:
              posTotal += total;
              break;
          }

          if (paymentStatus === "paid") {
            const isAccountPaySource = ACCOUNT_PAY_SOURCES.has(src);
            if (payments && payments.length > 0) {
              for (const p of payments) {
                const amount = p.amount || 0;
                const pMethod = (p.method || "").toLowerCase();
                if (isAccountPaySource || pMethod === "stripe") {
                  accountPayTotal += amount;
                } else if (pMethod === "cash") {
                  cashTotal += amount;
                } else {
                  cardTotal += amount;

                  const brand = (p.cardBrand || "").toLowerCase();
                  const funding = (p.cardFunding || "").toLowerCase();

                  if (brand.includes("visa")) {
                    visaTotal += amount;
                    creditCardTotal += amount;
                  } else if (brand.includes("master")) {
                    mastercardTotal += amount;
                    creditCardTotal += amount;
                  } else if (brand.includes("amex") || brand.includes("american")) {
                    amexTotal += amount;
                    creditCardTotal += amount;
                  } else if (brand.includes("interac") || funding === "debit" || pMethod === "debit") {
                    interacTotal += amount;
                    debitCardTotal += amount;
                  } else {
                    if (funding === "credit") {
                      creditCardTotal += amount;
                      visaTotal += amount;
                    } else {
                      interacTotal += amount;
                      debitCardTotal += amount;
                    }
                  }
                }
              }
            } else {
              if (isAccountPaySource || paymentMethod === "stripe") {
                accountPayTotal += total;
              } else {
                cashTotal += total;
              }
            }
          }
        }
      }

      let totalCashExpense = 0;
      for (const e of dayExpenses) {
        if (e.paymentMode !== "card") {
          totalCashExpense += e.amount || 0;
        }
      }

      let totalDriverCashPayout = 0;
      for (const ds of daySettlements) {
        totalDriverCashPayout += ds.netCashPayoutToDriver || 0;
      }

      const expectedCash = Math.max(0, cashTotal - totalCashExpense - totalDriverCashPayout);

      const depositCash = dayDeposit ? (dayDeposit.cashAmount || 0) : 0;
      const depositCard = dayDeposit ? (dayDeposit.cardAmount || 0) : 0;
      const depositAccountPay = dayDeposit ? (dayDeposit.accountPayAmount || 0) : 0;

      const shortageCash = dayDeposit ? round2(depositCash - expectedCash) : 0;
      const shortageCard = dayDeposit ? round2(depositCard - cardTotal) : 0;
      const shortageAccountPay = dayDeposit ? round2(depositAccountPay - accountPayTotal) : 0;

      const totalPaymentsReceived = accountPayTotal + cashTotal + cardTotal;
      const onlineTotal = websiteTotal + uberTotal + skipTotal + doordashTotal;
      const orderTypeTotal = takeoutTotal + dineInTotal + deliveryTotal + driveThroughTotal;

      const promoSummary = Array.from(promoMap.values()).map((p) => ({
        code: p.code,
        count: p.count,
        totalDiscount: round2(p.totalDiscount),
      }));

      result.push({
        date: reportDateFormatted,
        rawDate: dateStr,
        salesSummary: {
          subtotal: round2(grossSubtotal),
          deliveryCharges: round2(grossDeliveryFee),
          debitCharges: 0,
          discount: round2(grossDiscount),
          tax: round2(grossTax),
          grandTotal: round2(grandTotal),
          tips: round2(totalTips),
          finalAmount: round2(grandTotal + totalTips),
          promoSummary,
        },
        paymentType: {
          cash: round2(cashTotal),
          accountPay: round2(accountPayTotal),
          creditCardSales: round2(creditCardTotal),
          debitCardSales: round2(debitCardTotal),
          grandTotal: round2(totalPaymentsReceived),
          debitTips: 0,
          creditTips: 0,
          finalAmount: round2(totalPaymentsReceived + totalTips),
        },
        orderType: {
          takeout: round2(takeoutTotal),
          dineIn: round2(dineInTotal),
          delivery: round2(deliveryTotal),
          driveThrough: round2(driveThroughTotal),
          total: round2(orderTypeTotal),
        },
        orders: {
          completed: completedCount,
          paidCancelled: paidCancelledCount,
          unpaidCancelled: unpaidCancelledCount,
          refund: refundCount,
          refundAmount: round2(refundAmount),
        },
        taxBreakdown: { pst: 0, gst: round2(grossTax), hst: 0, total: round2(grossTax) },
        cardType: {
          amex: round2(amexTotal),
          interac: round2(interacTotal),
          mastercard: round2(mastercardTotal),
          visa: round2(visaTotal),
        },
        online: {
          website: round2(websiteTotal),
          uber: round2(uberTotal),
          skip: round2(skipTotal),
          doordash: round2(doordashTotal),
          total: round2(onlineTotal),
        },
        pos: { posSales: round2(posTotal), total: round2(posTotal) },
        expense: { amount: round2(totalCashExpense) },
        shortage: {
          cash: shortageCash,
          card: shortageCard,
          accountPay: shortageAccountPay,
          shortage: round2(shortageCash < 0 ? Math.abs(shortageCash) : 0),
          overage: round2(shortageCash > 0 ? shortageCash : 0),
        },
        deposit: {
          cash: round2(depositCash),
          card: round2(depositCard),
          accountPay: round2(depositAccountPay),
        },
        moneyToBeCollected: {
          cash: round2(expectedCash),
          card: round2(cardTotal),
          accountPay: round2(accountPayTotal),
        },
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  } catch (error) {
    logger.error(
      `Order Service Error: getMonthlySalesSummary - ${error.message}`,
    );
    throw error;
  }
};

exports.searchCustomer = async ({ query, branchId } = {}) => {
  try {
    if (!query || query.trim().length < 3) {
      return null;
    }

    const cleanQuery = query.trim();
    const isPhone = /^\d+$/.test(cleanQuery);

    const searchConditions = [];
    if (isPhone) {
      // Phone lookup: prefix match on customer.phone field
      searchConditions.push({
        "customer.phone": { $regex: `^${cleanQuery}`, $options: "i" },
      });
    } else {
      // Email lookup: prefix match on customer.email or partial name match
      searchConditions.push({
        "customer.email": { $regex: `^${escapeRegex(cleanQuery)}`, $options: "i" },
      });
      searchConditions.push({
        "customer.name": { $regex: escapeRegex(cleanQuery), $options: "i" },
      });
    }

    const matchQuery = {
      $or: searchConditions,
      "customer.name": { $exists: true, $nin: ["", null, "No Name"] },
    };

    if (branchId) {
      matchQuery.branchId = new mongoose.Types.ObjectId(branchId);
    }

    // Find the most recent order for this customer
    const order = await Order.findOne(matchQuery)
      .sort({ createdAt: -1 })
      .select("customer createdAt")
      .lean();

    if (!order || !order.customer) return null;

    const c = order.customer;
    const nameParts = (c.name || "").trim().split(/\s+/);
    return {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      postalCode: c.postalCode || "",
      lastOrderDate: order.createdAt,
    };
  } catch (error) {
    logger.error(`Order Service Error: searchCustomer - ${error.message}`);
    throw error;
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

