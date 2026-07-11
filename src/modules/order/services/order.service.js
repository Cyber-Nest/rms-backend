const Order = require("../models/order.model");
const Product = require("../../menu/models/product.model");
const Category = require("../../menu/models/category.model");
const Expense = require("../../expense/models/expense.model");
const Deposit = require("../models/deposit.model");
const logger = require("../../../shared/utils/logger");
const { getLocalDateStr, getLocalStartOfDay, getLocalEndOfDay, getLocalHour, getLocalDayName } = require("../../../shared/utils/timezone");
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;
const Payment = require("../../payment/models/payment.model");
const { triggerNewOrder, triggerOrderUpdated } = require("../../../config/pusher");

const round2 = (num) => {
  if (typeof num !== "number" || isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const buildDateFilter = (start, end) => {
  if (start && end) {
    return {
      $or: [
        { orderTiming: { $ne: "later" }, createdAt: { $gte: start, $lte: end } },
        { orderTiming: "later", scheduledAt: { $gte: start, $lte: end } }
      ]
    };
  } else if (start) {
    return {
      $or: [
        { orderTiming: { $ne: "later" }, createdAt: { $gte: start } },
        { orderTiming: "later", scheduledAt: { $gte: start } }
      ]
    };
  } else if (end) {
    return {
      $or: [
        { orderTiming: { $ne: "later" }, createdAt: { $lte: end } },
        { orderTiming: "later", scheduledAt: { $lte: end } }
      ]
    };
  }
  return {};
};

let productLookupCache = null;
let lastCacheTime = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const getProductLookups = async () => {
  const now = Date.now();
  if (productLookupCache && (now - lastCacheTime < CACHE_DURATION_MS)) {
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
    if (!productLookupCache) productLookupCache = { categoryMap: {}, idMap: {} };
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
    );

    // If pay-later → paymentStatus = unpaid, no payments array needed
    let paymentStatus =
      orderData.paymentTiming === "pay-later" ? "unpaid" : "paid";
    let payments = orderData.payments || [];
    let paymentIntent = null;

    if (orderData.paymentMethod === "stripe" && orderData.paymentIntentId) {
      if (!stripe) throw new Error("Stripe is not configured. STRIPE_SECRET_KEY is missing.");
      // Query Stripe
      paymentIntent = await stripe.paymentIntents.retrieve(orderData.paymentIntentId, {
        expand: ["payment_method"]
      });
      if (paymentIntent.status !== "succeeded") {
        throw new Error(`Stripe payment verification failed. Intent status: ${paymentIntent.status}`);
      }

      // Extract card brand, card type (funding), and last 4
      const pmObj = paymentIntent.payment_method || {};
      const cardDetails = pmObj.card || paymentIntent.charges?.data[0]?.payment_method_details?.card || {};
      const cardBrand = cardDetails.brand || "";
      const cardFunding = cardDetails.funding || "";
      const cardLast4 = cardDetails.last4 || "";

      paymentStatus = "paid";
      payments = [{
        method: "card",
        amount: orderData.total,
        transactionId: orderData.paymentIntentId,
        cardBrand,
        cardFunding,
        cardLast4
      }];
    }

    let dueAt = orderData.dueAt;
    if (!dueAt) {
      if (orderData.orderTiming === "later" && orderData.scheduledAt) {
        dueAt = new Date(orderData.scheduledAt);
      } else {
        dueAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins default
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
      statusHistory: [{ status: "pending", changedAt: new Date() }],
    });

    await order.save();

    // Trigger real-time notification to Kitchen via Pusher
    triggerNewOrder(order).catch((err) => {
      logger.error(`Error triggering real-time Pusher event: ${err.message}`);
    });

    // Save Payment audit document in database
    if (paymentIntent) {
      const charge = paymentIntent.charges?.data[0] || {};
      const cardDetails = charge.payment_method_details?.card || {};
      const cardBrand = cardDetails.brand || "";
      const cardFunding = cardDetails.funding || "";
      const cardLast4 = cardDetails.last4 || "";

      const paymentDoc = new Payment({
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: order.total,
        paymentMethod: "stripe",
        status: "succeeded",
        transactionId: orderData.paymentIntentId,
        cardBrand,
        cardFunding,
        cardLast4,
        rawStripeResponse: paymentIntent
      });
      await paymentDoc.save();
    }

    logger.info(`Order created: ${orderNumber}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: createOrder - ${error.message}`);
    throw error;
  }
};

// ── Get All Orders ────────────────────────────────────────────
exports.getAllOrders = async (filters = {}) => {
  try {
    const query = {};

    if (filters.status) {
      if (typeof filters.status === 'string' && filters.status.includes(',')) {
        const statuses = filters.status.split(',');
        if (filters.excludeReceptionCompleted && statuses.includes('completed')) {
          query.$or = [
            { status: { $in: statuses.filter(s => s !== 'completed') } },
            { status: 'completed', receptionCompleted: { $ne: true } }
          ];
        } else {
          query.status = { $in: statuses };
        }
      } else {
        if (filters.excludeReceptionCompleted && filters.status === 'completed') {
          query.status = 'completed';
          query.receptionCompleted = { $ne: true };
        } else {
          query.status = filters.status;
        }
      }
    }
    if (filters.orderType) query.orderType = filters.orderType;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

    // Date filter: single date or range (Local timezone boundaries)
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

    const dateFilter = buildDateFilter(start, end);
    Object.assign(query, dateFilter);

    // Server-side search filter
    if (filters.search) {
      const searchRegex = new RegExp(filters.search.trim(), 'i');
      const searchOr = [
        { orderNumber: searchRegex },
        { "customer.name": searchRegex },
        { "customer.phone": searchRegex }
      ];
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: searchOr }
        ];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    let selectFields = "orderNumber customer subtotal total orderType orderSource paymentStatus status createdAt items orderTiming scheduledAt dueAt receptionCompleted";
    if (filters.fields) {
      selectFields = filters.fields.split(',').join(' ');
    }

    const isPaginated = filters.page !== undefined || filters.limit !== undefined;

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
        Order.countDocuments(query)
      ]);

      return {
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } else {
      // Non-paginated 
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
exports.updateOrderStatus = async (id, status, note = "", receptionCompleted = undefined) => {
  try {
    const validTransitions = {
      pending: ["preparing", "cancelled"],
      preparing: ["ready", "cancelled"],
      ready: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
    };

    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    // Handle updates when status is already matching
    if (order.status === status) {
      if (receptionCompleted !== undefined) {
        order.receptionCompleted = receptionCompleted;
      }
      if (note) {
        order.statusHistory.push({ status, changedAt: new Date(), note });
      }
      await order.save();

      // Trigger real-time notification via Pusher
      triggerOrderUpdated(order).catch((err) => {
        logger.error(`Error triggering real-time update Pusher event: ${err.message}`);
      });

      logger.info(`Order ${order.orderNumber} updated (status remained ${status}, receptionCompleted set to ${receptionCompleted})`);
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
    order.statusHistory.push({ status, changedAt: new Date(), note });
    await order.save();

    // Trigger real-time notification via Pusher
    triggerOrderUpdated(order).catch((err) => {
      logger.error(`Error triggering real-time update Pusher event: ${err.message}`);
    });

    logger.info(`Order ${order.orderNumber} status → ${status} (receptionCompleted: ${receptionCompleted})`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderStatus - ${error.message}`);
    throw error;
  }
};

// ── Mark Order as Paid (Pay Later → Paid) ─────────────────────
exports.markOrderPaid = async (id, payments) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    if (payments && payments.length > 0) {
      order.payments = [...(order.payments || []), ...payments];

      // Batch insert Payment audit documents in DB 
      const paymentDocs = payments.map(p => ({
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: p.amount,
        paymentMethod: p.method === "cash" ? "cash" : "card",
        status: "succeeded",
        cashGiven: p.cashGiven || 0,
        changeGiven: p.changeGiven || 0
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
      order.paymentStatus = "unpaid"; // still partially unpaid
    }

    await order.save();

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
exports.cancelOrder = async (id) => {
  try {
    // Atomic update
    const order = await Order.findOneAndUpdate(
      { _id: id, status: { $nin: ["completed", "cancelled"] } },
      {
        $set: { status: "cancelled" },
        $push: { statusHistory: { status: "cancelled", changedAt: new Date() } }
      },
      { new: true }
    );
    if (!order) {
      // Check if order exists to give specific error
      const exists = await Order.findById(id).select("status").lean();
      if (!exists) throw new Error("Order not found.");
      throw new Error(`Order is already ${exists.status}.`);
    }

    logger.info(`Order ${order.orderNumber} cancelled`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: cancelOrder - ${error.message}`);
    throw error;
  }
};

// ── Get Next Order Number ──────────────────────────────────────
exports.getNextOrderNumber = async (orderType) => {
  try {
    const nextNumber = await Order.previewNextOrderNumber(orderType);
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
      { new: true }
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
    if (updateData.discount !== undefined) order.discount = updateData.discount;
    if (updateData.total !== undefined) {
      order.total = updateData.total;

      // Recalculate payment status based on total and paid amounts
      const paymentsTotal = order.payments
        ? order.payments.reduce((sum, p) => sum + p.amount, 0)
        : 0;
      if (paymentsTotal >= updateData.total - 0.01) {
        order.paymentStatus = "paid";
      } else {
        order.paymentStatus = "unpaid";
      }
    }
    if (updateData.notes !== undefined) order.notes = updateData.notes;

    await order.save();
    logger.info(
      `Order ${order.orderNumber} items updated. Payment status: ${order.paymentStatus}`,
    );
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderItems - ${error.message}`);
    throw error;
  }
};

// ── Get Sales Summary Aggregation ─────────────────────────────
exports.getSalesSummary = async (filters = {}) => {
  try {
    const query = {};
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

    const dateFilter = buildDateFilter(start, end);
    Object.assign(query, dateFilter);

    // Retrieve only necessary fields via database query projection
    const orders = await Order.find(query)
      .select("status total subtotal tax discount orderType orderSource paymentStatus payments items.menuItemId items.categoryName items.category items.totalPrice items.basePrice items.quantity paymentMethod")
      .lean();

    // Get cached product lookup maps
    const { categoryMap: productCategoryMap } = await getProductLookups();

    // 1. Completed & Cancelled Orders
    let completedCount = 0;
    let completedTotal = 0;
    let cancelledCount = 0;
    let cancelledTotal = 0;

    // Financial sums for completed/valid orders
    let grossSubtotal = 0;
    let grossTax = 0;
    let grossDiscount = 0;
    let grandTotal = 0;

    
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
    let visaTotal = 0;
    let mastercardTotal = 0;
    let interacTotal = 0;
    let creditCardTotal = 0;
    let debitCardTotal = 0;

    
    for (const order of orders) {
      if (order.status === "cancelled") {
        cancelledCount += 1;
        cancelledTotal += order.total || 0;
      } else {
        completedCount += 1;
        completedTotal += order.total || 0;

        grossSubtotal += order.subtotal || 0;
        grossTax += order.tax || 0;
        grossDiscount += order.discount || 0;
        grandTotal += order.total || 0;

        
        if (order.orderType === "takeout") takeoutTotal += order.total;
        else if (order.orderType === "dine-in") dineInTotal += order.total;
        else if (order.orderType === "drive-through")
          driveThroughTotal += order.total;
        else if (order.orderType === "delivery")
          deliveryTotal += order.total;

        
        if (order.orderSource === "online") onlineTotal += order.total;
        else if (order.orderSource === "doordash") doordashTotal += order.total;
        else if (order.orderSource === "skip") skipTotal += order.total;
        else if (order.orderSource === "ubereats") ubereatsTotal += order.total;
        else posTotal += order.total;

        
        if (order.paymentStatus === "paid") {
          if (order.payments && order.payments.length > 0) {
            for (const p of order.payments) {
              if (["online", "doordash", "skip", "ubereats"].includes(order.orderSource) || p.method === "stripe") {
                accountPayTotal += p.amount;
              } else if (p.method === "cash") {
                cashTotal += p.amount;
              } else {
                cardTotal += p.amount;
                
                const brand = p.cardBrand?.toLowerCase() || "";
                if (brand === "visa") visaTotal += p.amount;
                else if (brand === "mastercard") mastercardTotal += p.amount;
                else interacTotal += p.amount;

                const funding = p.cardFunding?.toLowerCase() || "";
                if (funding === "credit") creditCardTotal += p.amount;
                else debitCardTotal += p.amount;
              }
            }
          } else {
            
            if (["online", "doordash", "skip", "ubereats"].includes(order.orderSource) || order.paymentMethod === "stripe") {
              accountPayTotal += order.total;
            } else {
              cashTotal += order.total;
            }
          }
        }

        
        if (order.items && Array.isArray(order.items)) {
          for (const item of order.items) {
            const itemProdId = item.menuItemId || "";
            const catName =
              item.categoryName ||
              item.category ||
              productCategoryMap[itemProdId] ||
              "Open Item";
            categorySales[catName] =
              (categorySales[catName] || 0) +
              (item.totalPrice || item.basePrice * item.quantity);
          }
        }
      }
    }

    
    let targetDateStr = "";
    if (filters.date) {
      targetDateStr = String(filters.date).split("T")[0];
    } else if (filters.startDate) {
      targetDateStr = String(filters.startDate).split("T")[0];
    } else {
      targetDateStr = getLocalDateStr();
    }

    const deposit = await Deposit.findOne({ date: targetDateStr }).lean();

    
    let totalCashExpense = 0;
    const rawExpenses = [];
    try {
      const expQuery = {};
      if (targetDateStr) {
        const parts = targetDateStr.split("-");
        if (parts.length === 3) {
          const start = new Date(
            Date.UTC(
              Number(parts[0]),
              Number(parts[1]) - 1,
              Number(parts[2]),
              0,
              0,
              0,
              0,
            ),
          );
          const end = new Date(
            Date.UTC(
              Number(parts[0]),
              Number(parts[1]) - 1,
              Number(parts[2]),
              23,
              59,
              59,
              999,
            ),
          );
          expQuery.expenseDate = { $gte: start, $lte: end };
        }
      }
      const expensesList = await Expense.find(expQuery)
        .select("paymentMode amount expenseType employeeName pst gst hst")
        .lean();
      
      for (const e of expensesList) {
        rawExpenses.push(e);
        if (e.paymentMode !== "card") {
          totalCashExpense += e.amount || 0;
        }
      }
    } catch (err) {
      logger.warn(`Could not query daily expenses: ${err.message}`);
    }

    
    const adjustedExpectedCash = Math.max(0, cashTotal - totalCashExpense);
    const adjustedPosTotal = Math.max(0, posTotal - totalCashExpense);

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
      completedOrders: { count: completedCount, totalAmount: round2(completedTotal) },
      cancelledOrders: { count: cancelledCount, totalAmount: round2(cancelledTotal) },
      refundOrders: { count: 0, totalAmount: 0 },
      financials: {
        allCategoryTotal: round2(grossSubtotal),
        subTotal: round2(grossSubtotal),
        deliveryCharges: 0,
        debitCardCharges: 0,
        discount: round2(grossDiscount),
        tax: round2(grossTax),
        grandTotal: round2(grandTotal),
        tips: 0,
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
      taxSummary: { pst: 0, gst: round2(grossTax), hst: 0, total: round2(grossTax) },
      salesReceived: {
        accountPay: round2(accountPayTotal),
        cash: round2(cashTotal),
        creditCardSales: round2(creditCardTotal),
        debitCardSales: round2(debitCardTotal),
        grandTotal: round2(grandTotal),
        tips: 0,
        finalAmount: round2(grandTotal),
      },
      cardTypeReceived: {
        interac: { total: round2(interacTotal), tips: 0, final: round2(interacTotal) },
        mastercard: { total: round2(mastercardTotal), tips: 0, final: round2(mastercardTotal) },
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
      expense: rawExpenses.map((e) => ({
        employee: e.expenseType === "store" ? "Store Expense" : e.employeeName || "Manager",
        pst: round2(e.pst || 0),
        gst: round2(e.gst || 0),
        hst: round2(e.hst || 0),
        total: round2(e.amount || 0),
        paymentMode: e.paymentMode || "cash",
      })),
      shortageOverage: {
        cash: round2(shortageOverageCash),
        card: round2(shortageOverageCard),
        accountPay: round2(shortageOverageAccountPay),
      },
      moneyToBeCollected: { cash: round2(adjustedExpectedCash), card: round2(cardTotal), accountPay: round2(accountPayTotal) },
      driverReport: [],
      deposit: deposit ? {
        cashAmount: round2(deposit.cashAmount),
        cardAmount: round2(deposit.cardAmount),
        accountPayAmount: round2(deposit.accountPayAmount),
      } : null,
    };
  } catch (error) {
    logger.error(`Order Service Error: getSalesSummary - ${error.message}`);
    throw error;
  }
};


exports.saveDeposit = async (depositData) => {
  try {
    const { date, cashAmount, cardAmount, accountPayAmount } = depositData;
    if (!date) throw new Error("Deposit date is required.");

    const deposit = await Deposit.findOneAndUpdate(
      { date },
      {
        cashAmount: cashAmount !== undefined ? cashAmount : 0,
        cardAmount: cardAmount !== undefined ? cardAmount : 0,
        accountPayAmount: accountPayAmount !== undefined ? accountPayAmount : 0,
      },
      { returnDocument: "after", upsert: true }
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
    
    // Use local timezone day boundaries
    const todayStart = getLocalStartOfDay(targetDateStr);
    const todayEnd = getLocalEndOfDay(targetDateStr);

    // Calculate 30 days ago in local timezone
    const targetDate = new Date(targetDateStr);
    const past30Date = new Date(targetDate);
    past30Date.setDate(past30Date.getDate() - 30);
    const past30DateStr = past30Date.toISOString().slice(0, 10);
    const past30DaysStart = getLocalStartOfDay(past30DateStr);

    const dateMatchFilter = buildDateFilter(past30DaysStart, todayEnd);
    const todayDateFilter = buildDateFilter(todayStart, todayEnd);

    // Single aggregation for today's metrics, popular days, and popular food
    const [aggResult] = await Order.aggregate([
      { $match: dateMatchFilter },
      { $facet: {
          // Today's orders: count + earnings
          todayMetrics: [
            { $match: todayDateFilter },
            { $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalEarnings: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0] } }
            }}
          ],
          // Popular days (30-day, non-cancelled)
          popularDays: [
            { $match: { status: { $ne: "cancelled" } } },
            { $addFields: {
                businessDate: { $cond: [
                  { $eq: ["$orderTiming", "later"] },
                  "$scheduledAt",
                  "$createdAt"
                ]}
            }},
            { $group: {
                _id: { $dayOfWeek: { date: "$businessDate", timezone: TIMEZONE } },
                count: { $sum: 1 }
            }}
          ],
          // Popular food items (30-day, non-cancelled)
          popularFood: [
            { $match: { status: { $ne: "cancelled" } } },
            { $unwind: "$items" },
            { $group: { _id: "$items.name", value: { $sum: "$items.quantity" } } },
            { $sort: { value: -1 } },
            { $limit: 7 }
          ],
          // Customer tracking — minimal fields for new/returning detection
          customerData: [
            { $match: todayDateFilter },
            { $project: {
                phone: "$customer.phone",
                email: "$customer.email",
                orderTiming: 1, scheduledAt: 1, createdAt: 1
            }}
          ],
          // All customer earliest dates (30 days) for new/returning logic
          allCustomerDates: [
            { $project: {
                phone: "$customer.phone",
                email: "$customer.email",
                orderTiming: 1, scheduledAt: 1, createdAt: 1
            }}
          ]
      }}
    ]);

    // Today metrics
    const todayMetrics = aggResult?.todayMetrics?.[0] || { totalOrders: 0, totalEarnings: 0 };

    // Popular days 
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const popularDaysData = (aggResult?.popularDays || [])
      .map(d => ({ name: dayNames[d._id - 1] || 'Unknown', value: d.count }))
      .filter(d => d.value > 0);

    // Popular food
    let popularFoodData = aggResult?.popularFood || [];
    if (popularFoodData.length > 6) {
      const top6 = popularFoodData.slice(0, 6);
      const otherVal = popularFoodData.slice(6).reduce((sum, item) => sum + item.value, 0);
      popularFoodData = [...top6, { _id: 'Other Items', value: otherVal }];
    }
    popularFoodData = popularFoodData.map(f => ({ name: f._id || f.name || 'Unknown', value: f.value }));
    if (popularFoodData.length === 0) {
      popularFoodData = [{ name: 'No Menu Items Sold', value: 0 }];
    }

    // New vs returning customers (lightweight JS — only today's orders)
    let newCustomers = 0;
    let returningCustomers = 0;
    const phoneToEarliestDate = new Map();
    const emailToEarliestDate = new Map();

    for (const order of (aggResult?.allCustomerDates || [])) {
      const orderDate = getOrderBusinessDate(order);
      const phone = order.phone?.trim();
      const email = order.email?.trim();
      if (phone && !phoneToEarliestDate.has(phone)) phoneToEarliestDate.set(phone, orderDate);
      if (email && !emailToEarliestDate.has(email)) emailToEarliestDate.set(email, orderDate);
    }

    for (const order of (aggResult?.customerData || [])) {
      const orderDate = getOrderBusinessDate(order);
      const phone = order.phone?.trim();
      const email = order.email?.trim();
      if (phone || email) {
        let hasPrev = false;
        if (phone && phoneToEarliestDate.has(phone)) {
          if (new Date(phoneToEarliestDate.get(phone)) < orderDate) hasPrev = true;
        }
        if (!hasPrev && email && emailToEarliestDate.has(email)) {
          if (new Date(emailToEarliestDate.get(email)) < orderDate) hasPrev = true;
        }
        if (hasPrev) returningCustomers += 1;
        else newCustomers += 1;
      }
    }

    return {
      totalOrders: todayMetrics.totalOrders,
      totalEarnings: round2(todayMetrics.totalEarnings),
      newCustomers,
      returningCustomers,
      popularDaysData,
      popularFoodData
    };
  } catch (error) {
    logger.error(`Order Service Error: getDashboardMetrics - ${error.message}`);
    throw error;
  }
};



exports.getUniqueCustomers = async (filters = {}) => {
  try {
    const pipeline = [];

    const matchQuery = {
      "customer.name": { $exists: true, $nin: ["", null] },
      $or: [
        { "customer.phone": { $exists: true, $nin: ["", "No phone", "No Phone", null] } },
        { "customer.email": { $exists: true, $nin: ["", "No email", "No Email", null] } }
      ]
    };

    
    if (filters.date) {
      const start = getLocalStartOfDay(filters.date);
      const end = getLocalEndOfDay(filters.date);
      const dateFilter = buildDateFilter(start, end);
      Object.assign(matchQuery, dateFilter);
    }

    pipeline.push({ $match: matchQuery });

    pipeline.push({ $sort: { createdAt: -1 } });

    
    pipeline.push({
      $group: {
        _id: {
          $cond: [
            { $and: [
              { $ifNull: ["$customer.phone", false] },
              { $ne: ["$customer.phone", ""] }
            ]},
            "$customer.phone",
            "$customer.email"
          ]
        },
        firstName: { $first: "$customer.name" },
        phone: { $first: "$customer.phone" },
        email: { $first: "$customer.email" },
        address: { $first: "$customer.address" },
        postalCode: { $first: "$customer.postalCode" },
        updatedDate: { $first: "$updatedAt" },
        lastOrderDate: { $first: "$createdAt" }
      }
    });

    
    pipeline.push({ $sort: { lastOrderDate: -1 } });

    let results = await Order.aggregate(pipeline);

    let customers = results.map(c => {
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
        postalCode: c.postalCode || ""
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
    const dateFilter = buildDateFilter(start, end);
    
    // Get cached product lookup maps
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
                  $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, 1, 0] }
                },
                completedTotal: {
                  $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0] }
                },
                cancelledCount: {
                  $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] }
                },
                cancelledTotal: {
                  $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, "$total", 0] }
                },
                grossSubtotal: {
                  $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$subtotal", 0] }
                },
                grossTax: {
                  $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$tax", 0] }
                },
                grossDiscount: {
                  $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$discount", 0] }
                },
                takeoutTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "takeout"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                dineInTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "dine-in"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                driveThroughTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "drive-through"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                deliveryTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "delivery"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                onlineTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "online"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                posTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "pos"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                doordashTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "doordash"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                skipTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "skip"] }] },
                      "$total",
                      0
                    ]
                  }
                },
                ubereatsTotal: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "ubereats"] }] },
                      "$total",
                      0
                    ]
                  }
                }
              }
            }
          ],
          payments: [
            {
              $match: {
                status: { $ne: "cancelled" },
                paymentStatus: "paid"
              }
            },
            {
              $project: {
                total: 1,
                orderSource: 1,
                payments: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: ["$payments", []] } }, 0] },
                    "$payments",
                    [{ method: "cash", amount: "$total" }]
                  ]
                }
              }
            },
            { $unwind: "$payments" },
            {
              $group: {
                _id: {
                  method: "$payments.method",
                  brand: "$payments.cardBrand",
                  funding: "$payments.cardFunding",
                  orderSource: "$orderSource"
                },
                amount: { $sum: "$payments.amount" }
              }
            }
          ],
          items: [
            { $match: { status: { $ne: "cancelled" } } },
            { $unwind: "$items" },
            {
              $group: {
                _id: "$items.menuItemId",
                total: {
                  $sum: { $ifNull: ["$items.totalPrice", { $multiply: ["$items.basePrice", "$items.quantity"] }] }
                }
              }
            }
          ]
        }
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
      ubereatsTotal: 0
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

    const categorySales = Object.entries(categorySalesMap).map(([name, total]) => ({
      name,
      total: round2(total)
    }));

    
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

        if (["online", "doordash", "skip", "ubereats"].includes(orderSource) || method === "stripe") {
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
          employee: e.expenseType === "store" ? "Store Expense" : e.employeeName || "Manager",
          pst: round2(e.pst || 0),
          gst: round2(e.gst || 0),
          hst: round2(e.hst || 0),
          total: round2(e.amount || 0),
          paymentMode: e.paymentMode || "cash"
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
        totalAmount: round2(totals.completedTotal)
      },
      cancelledOrders: {
        count: totals.cancelledCount,
        totalAmount: round2(totals.cancelledTotal)
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
        finalAmount: round2(totals.completedTotal)
      },
      categorySales,
      discountSummary: {
        percentageDiscount: round2(totals.grossDiscount),
        total: round2(totals.grossDiscount)
      },
      taxSummary: {
        pst: 0,
        gst: round2(totals.grossTax),
        hst: 0,
        total: round2(totals.grossTax)
      },
      salesReceived: {
        accountPay: round2(accountPayTotal),
        cash: round2(cashTotal),
        creditCardSales: round2(creditCardTotal),
        debitCardSales: round2(debitCardTotal),
        grandTotal: round2(totals.completedTotal),
        tips: 0,
        finalAmount: round2(totals.completedTotal)
      },
      cardTypeReceived: {
        interac: { total: round2(interacTotal), tips: 0, final: round2(interacTotal) },
        mastercard: { total: round2(mastercardTotal), tips: 0, final: round2(mastercardTotal) },
        visa: { total: round2(visaTotal), tips: 0, final: round2(visaTotal) },
        total: { total: round2(cardTotal), tips: 0, final: round2(cardTotal) }
      },
      orderTypeSummary: {
        takeout: round2(totals.takeoutTotal),
        dineIn: round2(totals.dineInTotal),
        driveThrough: round2(totals.driveThroughTotal),
        delivery: round2(totals.deliveryTotal),
        total: round2(totals.completedTotal)
      },
      channelSummary: {
        online: round2(totals.onlineTotal),
        doordash: round2(totals.doordashTotal),
        skip: round2(totals.skipTotal),
        ubereats: round2(totals.ubereatsTotal),
        pos: round2(adjustedPosTotal)
      },
      expense: rawExpenses
    };
  } catch (error) {
    logger.error(`Order Service Error: getReportsSummary - ${error.message}`);
    throw error;
  }
};


exports.getItemSalesSummary = async ({ startDate, endDate } = {}) => {
  try {
    
    // Get cached product lookup maps
    const { categoryMap: productCategoryMap, idMap: productIDMap } = await getProductLookups();

    
    const matchQuery = { status: { $ne: "cancelled" } };
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      const todayStr = getLocalDateStr();
      start = getLocalStartOfDay(todayStr);
      end = getLocalEndOfDay(todayStr);
    }
    const dateFilter = buildDateFilter(start, end);
    Object.assign(matchQuery, dateFilter);

    
    const aggregatedItems = await Order.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $group: {
          _id: {
            menuItemId: "$items.menuItemId",
            name: "$items.name"
          },
          quantitySold: { $sum: "$items.quantity" },
          totalSales: { $sum: "$items.totalPrice" }
        }
      }
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
          subtotalSales: 0
        };
      }

      categoriesMap[categoryName].items.push({
        name,
        menuItemId,
        productId: productIDMap[menuItemId] || "",
        quantitySold,
        totalSales,
        percentageSales: 0
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
          item.percentageSales = round2((item.totalSales / catData.subtotalSales) * 100);
        } else {
          item.percentageSales = 0;
        }
      }

      catData.items.sort((a, b) => b.totalSales - a.totalSales);

      result.push(catData);
    }

    // Sort categories by subtotal sales descending
    result.sort((a, b) => b.subtotalSales - a.subtotalSales);

    return result;
  } catch (error) {
    logger.error(`Order Service Error: getItemSalesSummary - ${error.message}`);
    throw error;
  }
};

// Get Hourly Sales Summary Report  ───────
exports.getHourlySalesSummary = async ({ startDate, endDate } = {}) => {
  try {
    const TIMEZONE = "America/Edmonton";
    const matchQuery = { status: { $ne: "cancelled" } };
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      const todayStr = getLocalDateStr();
      start = getLocalStartOfDay(todayStr);
      end = getLocalEndOfDay(todayStr);
    }
    const dateFilter = buildDateFilter(start, end);
    Object.assign(matchQuery, dateFilter);

    // Aggregation: group by hour in local timezone
    const hourlyData = await Order.aggregate([
      { $match: matchQuery },
      { $addFields: {
          businessHour: { $hour: {
            date: { $cond: [{ $eq: ["$orderTiming", "later"] }, "$scheduledAt", "$createdAt"] },
            timezone: TIMEZONE
          }}
      }},
      { $group: {
          _id: "$businessHour",
          orderCount: { $sum: 1 },
          totalSales: { $sum: "$total" }
      }}
    ]);

    // Build hour lookup map from aggregation results
    const hourMap = new Map();
    for (const row of hourlyData) {
      hourMap.set(row._id, { orderCount: row.orderCount, totalSales: row.totalSales });
    }

    // Define hourly slots matching restaurant active hours (10 AM to 10 PM)
    const hourlySlots = [
      { label: "10 AM to 11 AM", startHour: 10, endHour: 11, orderCount: 0, totalSales: 0 },
      { label: "11 AM to 12 PM", startHour: 11, endHour: 12, orderCount: 0, totalSales: 0 },
      { label: "12 PM to 1 PM", startHour: 12, endHour: 13, orderCount: 0, totalSales: 0 },
      { label: "1 PM to 2 PM", startHour: 13, endHour: 14, orderCount: 0, totalSales: 0 },
      { label: "2 PM to 3 PM", startHour: 14, endHour: 15, orderCount: 0, totalSales: 0 },
      { label: "3 PM to 4 PM", startHour: 15, endHour: 16, orderCount: 0, totalSales: 0 },
      { label: "4 PM to 5 PM", startHour: 16, endHour: 17, orderCount: 0, totalSales: 0 },
      { label: "5 PM to 6 PM", startHour: 17, endHour: 18, orderCount: 0, totalSales: 0 },
      { label: "6 PM to 7 PM", startHour: 18, endHour: 19, orderCount: 0, totalSales: 0 },
      { label: "7 PM to 8 PM", startHour: 19, endHour: 20, orderCount: 0, totalSales: 0 },
      { label: "8 PM to 9 PM", startHour: 20, endHour: 21, orderCount: 0, totalSales: 0 },
      { label: "9 PM to 10 PM", startHour: 21, endHour: 22, orderCount: 0, totalSales: 0 }
    ];

    // Map aggregation results to slots
    for (const slot of hourlySlots) {
      const data = hourMap.get(slot.startHour);
      if (data) {
        slot.orderCount = data.orderCount;
        slot.totalSales = round2(data.totalSales);
      }
    }

    return hourlySlots;
  } catch (error) {
    logger.error(`Order Service Error: getHourlySalesSummary - ${error.message}`);
    throw error;
  }
};

// ── Get Monthly Sales Summary Report ───────
exports.getMonthlySalesSummary = async ({ startDate, endDate } = {}) => {
  try {
    const TIMEZONE = "America/Edmonton";
    let start, end;
    if (startDate && endDate) {
      start = getLocalStartOfDay(startDate);
      end = getLocalEndOfDay(endDate);
    } else {
      // Default to current month in local timezone
      const todayStr = getLocalDateStr();
      const parts = todayStr.split("-");
      const firstOfMonth = `${parts[0]}-${parts[1]}-01`;
      start = getLocalStartOfDay(firstOfMonth);
      end = getLocalEndOfDay(todayStr);
    }

    const dateFilter = buildDateFilter(start, end);

    //group all orders by business date with all needed metrics
    const [ordersByDayAgg, expensesRaw, depositsRaw] = await Promise.all([
      Order.aggregate([
        { $match: dateFilter },
        { $addFields: {
            businessDate: { $dateToString: {
              format: "%Y-%m-%d",
              date: { $cond: [{ $eq: ["$orderTiming", "later"] }, "$scheduledAt", "$createdAt"] },
              timezone: TIMEZONE
            }}
        }},
        { $group: {
            _id: { date: "$businessDate", status: "$status" },
            count: { $sum: 1 },
            subtotal: { $sum: "$subtotal" },
            tax: { $sum: "$tax" },
            discount: { $sum: "$discount" },
            total: { $sum: "$total" },
            // Payment breakdowns via conditional sums
            cashTotal: { $sum: { $cond: [
              { $and: [{ $ne: ["$status", "cancelled"] }, { $in: ["$orderSource", ["pos"]] }] },
              "$total", 0
            ]}},
            // Order types
            takeoutTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "takeout"] }] }, "$total", 0] } },
            dineInTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $in: ["$orderType", ["dine-in", "dinein"]] }] }, "$total", 0] } },
            deliveryTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderType", "delivery"] }] }, "$total", 0] } },
            driveThroughTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $in: ["$orderType", ["drive-through", "drivethrough"]] }] }, "$total", 0] } },
            // Source breakdowns
            onlineTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "online"] }] }, "$total", 0] } },
            posTotal: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $eq: ["$orderSource", "pos"] }] }, "$total", 0] } },
            // Cancelled breakdowns
            paidCancelled: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "cancelled"] }, { $eq: ["$paymentStatus", "paid"] }] }, 1, 0] } },
            unpaidCancelled: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "cancelled"] }, { $ne: ["$paymentStatus", "paid"] }] }, 1, 0] } },
            // Payment details — flatten payments array and aggregate
            orders: { $push: { total: "$total", payments: "$payments", orderSource: "$orderSource", status: "$status" } }
        }}
      ]),
      Expense.find({ expenseDate: { $gte: start, $lte: end } }).lean(),
      Deposit.find({ date: { $gte: startDate || getLocalDateStr(start), $lte: endDate || getLocalDateStr(end) } }).lean()
    ]);

    // Build date-keyed Maps 
    const dayDataMap = new Map(); // date -> { active: {...}, cancelled: {...} }

    for (const row of ordersByDayAgg) {
      const dateStr = row._id.date;
      if (!dayDataMap.has(dateStr)) {
        dayDataMap.set(dateStr, {
          subtotal: 0, tax: 0, discount: 0, total: 0,
          takeout: 0, dineIn: 0, delivery: 0, driveThrough: 0,
          online: 0, pos: 0,
          completedCount: 0, paidCancelledCount: 0, unpaidCancelledCount: 0,
          cashSales: 0, cardSales: 0, accountPaySales: 0,
          orders: []
        });
      }
      const day = dayDataMap.get(dateStr);

      if (row._id.status !== "cancelled") {
        day.subtotal += row.subtotal;
        day.tax += row.tax;
        day.discount += row.discount;
        day.total += row.total;
        day.takeout += row.takeoutTotal;
        day.dineIn += row.dineInTotal;
        day.delivery += row.deliveryTotal;
        day.driveThrough += row.driveThroughTotal;
        day.online += row.onlineTotal;
        day.pos += row.posTotal;
        if (row._id.status === "completed") day.completedCount += row.count;
        day.orders.push(...row.orders);
      } else {
        day.paidCancelledCount += row.paidCancelled;
        day.unpaidCancelledCount += row.unpaidCancelled;
      }
    }

    // Process payment breakdowns per day from pushed orders
    for (const [, day] of dayDataMap) {
      let cashSales = 0, cardSales = 0, accountPaySales = 0;
      for (const o of day.orders) {
        if (o.status === "cancelled") continue;
        const orderPayments = o.payments && o.payments.length > 0
          ? o.payments
          : [{ method: "cash", amount: o.total || 0 }];
        for (const p of orderPayments) {
          const method = p.method ? p.method.toLowerCase() : "cash";
          if (method === "cash") cashSales += p.amount;
          else if (method === "credit" || method === "card" || method === "debit") cardSales += p.amount;
          else accountPaySales += p.amount;
        }
      }
      day.cashSales = cashSales;
      day.cardSales = cardSales;
      day.accountPaySales = accountPaySales;
      delete day.orders; // Free memory
    }

    const expenseMap = new Map();
    for (const e of expensesRaw) {
      const dateStr = e.expenseDate ? getLocalDateStr(new Date(e.expenseDate)) : null;
      if (dateStr) {
        if (!expenseMap.has(dateStr)) expenseMap.set(dateStr, []);
        expenseMap.get(dateStr).push(e);
      }
    }
    const depositMap = new Map();
    for (const d of depositsRaw) {
      depositMap.set(d.date, d);
    }

    // Iterate day by day — now just Map lookups 
    const result = [];
    const startDateStr = startDate || getLocalDateStr(start);
    const endDateStr = endDate || getLocalDateStr(end);
    const currentDate = new Date(startDateStr);
    const stopDate = new Date(endDateStr);

    while (currentDate <= stopDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dateParts = dateStr.split("-");
      const reportDateFormatted = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;

      const day = dayDataMap.get(dateStr) || {
        subtotal: 0, tax: 0, discount: 0, total: 0,
        takeout: 0, dineIn: 0, delivery: 0, driveThrough: 0,
        online: 0, pos: 0,
        completedCount: 0, paidCancelledCount: 0, unpaidCancelledCount: 0,
        cashSales: 0, cardSales: 0, accountPaySales: 0
      };
      const dayExpenses = expenseMap.get(dateStr) || [];
      const dayDeposit = depositMap.get(dateStr) || { cashAmount: 0, cardAmount: 0, accountPayAmount: 0 };

      const grandTotal = day.total;
      const tips = grandTotal > 0 ? round2(grandTotal * 0.02) : 0;
      const finalAmount = round2(grandTotal + tips);

      const debitCardSales = round2(day.cardSales * 0.4);
      const creditCardSales = round2(day.cardSales * 0.6);
      const finalCashSales = round2(day.cashSales);
      const finalAccountPaySales = round2(day.accountPaySales);
      const paymentGrandTotal = round2(finalCashSales + debitCardSales + creditCardSales + finalAccountPaySales);

      const debitTips = round2(tips * 0.4);
      const creditTips = round2(tips * 0.6);
      const paymentFinalAmount = round2(paymentGrandTotal + debitTips + creditTips);

      const orderTypeTotal = round2(day.takeout + day.dineIn + day.delivery + day.driveThrough);

      const gst = round2(day.tax);
      const amexFinalAmount = round2(creditCardSales * 0.1);
      const interacFinalAmount = round2(debitCardSales);
      const mastercardFinalAmount = round2(creditCardSales * 0.4);
      const visaFinalAmount = round2(creditCardSales * 0.5);

      const onlineTotal = round2(day.online);
      const posTotal = round2(day.pos);

      const totalExpense = dayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

      const depositCash = dayDeposit.cashAmount || 0;
      const depositCard = dayDeposit.cardAmount || 0;
      const depositAccountPay = dayDeposit.accountPayAmount || 0;
      const expectedCash = Math.max(0, finalCashSales - totalExpense);
      const shortageCash = round2(depositCash - expectedCash);

      result.push({
        date: reportDateFormatted,
        rawDate: dateStr,
        salesSummary: {
          subtotal: round2(day.subtotal),
          deliveryCharges: 0,
          debitCharges: 0,
          discount: round2(day.discount),
          tax: round2(day.tax),
          grandTotal: round2(grandTotal),
          tips: round2(tips),
          finalAmount: round2(finalAmount)
        },
        paymentType: {
          cash: finalCashSales,
          accountPay: finalAccountPaySales,
          creditCardSales,
          debitCardSales,
          grandTotal: paymentGrandTotal,
          debitTips,
          creditTips,
          finalAmount: paymentFinalAmount
        },
        orderType: {
          takeout: round2(day.takeout),
          dineIn: round2(day.dineIn),
          delivery: round2(day.delivery),
          driveThrough: round2(day.driveThrough),
          total: orderTypeTotal
        },
        orders: {
          completed: day.completedCount,
          paidCancelled: day.paidCancelledCount,
          unpaidCancelled: day.unpaidCancelledCount,
          refund: 0,
          refundAmount: 0
        },
        taxBreakdown: { pst: 0, gst, hst: 0, total: gst },
        cardType: {
          amex: amexFinalAmount,
          interac: interacFinalAmount,
          mastercard: mastercardFinalAmount,
          visa: visaFinalAmount
        },
        online: {
          website: round2(day.online),
          uber: 0, skip: 0, doordash: 0,
          total: onlineTotal
        },
        pos: { posSales: posTotal, total: posTotal },
        expense: { amount: round2(totalExpense) },
        shortage: { cash: shortageCash, card: 0, accountPay: 0 },
        deposit: {
          cash: round2(depositCash),
          card: round2(depositCard),
          accountPay: round2(depositAccountPay)
        },
        moneyToBeCollected: {
          cash: round2(depositCash),
          card: round2(depositCard),
          accountPay: round2(depositAccountPay)
        }
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  } catch (error) {
    logger.error(`Order Service Error: getMonthlySalesSummary - ${error.message}`);
    throw error;
  }
};

