const Order = require("../models/order.model");
const Product = require("../../menu/models/product.model");
const Category = require("../../menu/models/category.model");
const Expense = require("../../expense/models/expense.model");
const Deposit = require("../models/deposit.model");
const logger = require("../../../shared/utils/logger");

const round2 = (num) => {
  if (typeof num !== "number" || isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// ── Create Order ──────────────────────────────────────────────
exports.createOrder = async (orderData) => {
  try {
    const orderNumber = await Order.generateOrderNumber(
      orderData.orderType,
      orderData.orderTiming === "later" ? orderData.scheduledAt : null,
    );

    // If pay-later → paymentStatus = unpaid, no payments array needed
    const paymentStatus =
      orderData.paymentTiming === "pay-later" ? "unpaid" : "paid";

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
      dueAt,
      statusHistory: [{ status: "pending", changedAt: new Date() }],
    });

    await order.save();
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
        query.status = { $in: filters.status.split(',') };
      } else {
        query.status = filters.status;
      }
    }
    if (filters.orderType) query.orderType = filters.orderType;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

    // Date filter: single date or range
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    } else if (filters.date) {
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(query)
      .select(
        "orderNumber customer subtotal total orderType orderSource paymentStatus status createdAt items",
      )
      .sort({ createdAt: -1 })
      .lean();

    return orders;
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
exports.updateOrderStatus = async (id, status, note = "") => {
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

    const allowed = validTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new Error(
        `Cannot transition from "${order.status}" to "${status}".`,
      );
    }

    order.status = status;
    order.statusHistory.push({ status, changedAt: new Date(), note });
    await order.save();

    logger.info(`Order ${order.orderNumber} status → ${status}`);
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
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");
    if (["completed", "cancelled"].includes(order.status)) {
      throw new Error(`Order is already ${order.status}.`);
    }

    order.status = "cancelled";
    order.statusHistory.push({ status: "cancelled", changedAt: new Date() });
    await order.save();

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
    const order = await Order.findById(id);
    if (!order) throw new Error("Order not found.");

    order.dueAt = new Date(dueAt);
    await order.save();

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
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    } else if (filters.date) {
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    // Retrieve only necessary fields via database query projection
    const orders = await Order.find(query)
      .select("status total subtotal tax discount orderType orderSource paymentStatus payments items")
      .lean();

    // Fetch products to build category lookup map with projection
    const productCategoryMap = {};
    try {
      const products = await Product.find()
        .select("_id categoryId")
        .populate({ path: "categoryId", select: "name" })
        .lean();
      
      for (const p of products) {
        const prodId = p._id ? p._id.toString() : "";
        const catName =
          p.categoryId && typeof p.categoryId === "object"
            ? p.categoryId.name
            : "";
        if (prodId && catName) {
          productCategoryMap[prodId] = catName;
        }
      }
    } catch (err) {
      logger.warn(`Could not build product category lookup: ${err.message}`);
    }

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

    // Categories map
    const categorySales = {};

    // Order Types
    let takeoutTotal = 0;
    let dineInTotal = 0;
    let driveThroughTotal = 0;

    // Channels
    let onlineTotal = 0;
    let posTotal = 0;

    // Payment methods
    let cashTotal = 0;
    let cardTotal = 0;

    // Standard optimized loop (avoiding callback contexts)
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

        // Order types
        if (order.orderType === "takeout") takeoutTotal += order.total;
        else if (order.orderType === "dine-in") dineInTotal += order.total;
        else if (order.orderType === "drive-through")
          driveThroughTotal += order.total;

        // Channel
        if (order.orderSource === "online") onlineTotal += order.total;
        else posTotal += order.total;

        // Payments
        if (order.paymentStatus === "paid") {
          if (order.payments && order.payments.length > 0) {
            for (const p of order.payments) {
              if (p.method === "cash") cashTotal += p.amount;
              else cardTotal += p.amount;
            }
          } else {
            // fallback if payments array is missing/empty (e.g. old orders)
            cashTotal += order.total;
          }
        }

        // Category breakdown from items
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

    // Query daily deposit record
    let targetDateStr = "";
    if (filters.date) {
      targetDateStr = String(filters.date).split("T")[0];
    } else if (filters.startDate) {
      targetDateStr = String(filters.startDate).split("T")[0];
    } else {
      targetDateStr = new Date().toISOString().split("T")[0];
    }

    const deposit = await Deposit.findOne({ date: targetDateStr }).lean();

    // Query expenses for the same day to calculate totalCashExpense
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

    // Deduct cash expenses from expected totals
    const adjustedExpectedCash = Math.max(0, cashTotal - totalCashExpense);
    const adjustedPosTotal = Math.max(0, posTotal - totalCashExpense);

    let shortageOverageCash = 0;
    let shortageOverageCard = 0;
    let shortageOverageAccountPay = 0;

    if (deposit) {
      shortageOverageCash = deposit.cashAmount - adjustedExpectedCash;
      shortageOverageCard = deposit.cardAmount - cardTotal;
      shortageOverageAccountPay = deposit.accountPayAmount - 0;
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
        accountPay: 0,
        cash: round2(cashTotal),
        creditCardSales: 0,
        debitCardSales: round2(cardTotal),
        grandTotal: round2(grandTotal),
        tips: 0,
        finalAmount: round2(grandTotal),
      },
      cardTypeReceived: {
        interac: { total: round2(cardTotal), tips: 0, final: round2(cardTotal) },
        mastercard: { total: 0, tips: 0, final: 0 },
        visa: { total: 0, tips: 0, final: 0 },
        total: { total: round2(cardTotal), tips: 0, final: round2(cardTotal) },
      },
      orderTypeSummary: {
        takeout: round2(takeoutTotal),
        dineIn: round2(dineInTotal),
        driveThrough: round2(driveThroughTotal),
        total: round2(grandTotal),
      },
      channelSummary: {
        online: round2(onlineTotal),
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
      moneyToBeCollected: { cash: round2(adjustedExpectedCash), card: round2(cardTotal), accountPay: 0 },
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

// ── Save Deposit ───────────────────────────────────────────────
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

// ── Get Dashboard Metrics Aggregation ──────────────────────────
exports.getDashboardMetrics = async (filters = {}) => {
  try {
    const targetDateStr = filters.date || new Date().toISOString().split("T")[0];
    
    // Parse target date and set day boundaries
    const targetDate = new Date(targetDateStr);
    
    const todayStart = new Date(targetDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(targetDate);
    todayEnd.setHours(23, 59, 59, 999);

    // 30 Days ago boundaries
    const past30DaysStart = new Date(targetDate);
    past30DaysStart.setDate(past30DaysStart.getDate() - 30);
    past30DaysStart.setHours(0, 0, 0, 0);

    // Fetch all orders in the 30-day window in one query with projection
    const orders30Days = await Order.find({
      createdAt: { $gte: past30DaysStart, $lte: todayEnd }
    })
    .select("createdAt status total customer.phone customer.email items.name items.quantity")
    .sort({ createdAt: 1 })
    .lean();

    const todayOrders = [];
    const nonCancelled30Days = [];
    
    const phoneToEarliestDate = new Map();
    const emailToEarliestDate = new Map();

    for (const order of orders30Days) {
      const orderDate = new Date(order.createdAt);
      
      // Store earliest order date for phone and email
      const phone = order.customer?.phone?.trim();
      const email = order.customer?.email?.trim();
      if (phone && !phoneToEarliestDate.has(phone)) {
        phoneToEarliestDate.set(phone, order.createdAt);
      }
      if (email && !emailToEarliestDate.has(email)) {
        emailToEarliestDate.set(email, order.createdAt);
      }

      if (orderDate >= todayStart && orderDate <= todayEnd) {
        todayOrders.push(order);
      }
      if (order.status !== 'cancelled') {
        nonCancelled30Days.push(order);
      }
    }

    const totalOrders = todayOrders.length;
    let totalEarnings = 0;
    
    for (const order of todayOrders) {
      if (order.status !== 'cancelled') {
        totalEarnings += order.total || 0;
      }
    }

    // Calculate New vs Returning Customers in memory (no N+1 queries)
    let newCustomers = 0;
    let returningCustomers = 0;

    for (const order of todayOrders) {
      const phone = order.customer?.phone?.trim();
      const email = order.customer?.email?.trim();
      
      if (phone || email) {
        let hasPrev = false;
        
        if (phone && phoneToEarliestDate.has(phone)) {
          const earliest = phoneToEarliestDate.get(phone);
          if (new Date(earliest) < new Date(order.createdAt)) {
            hasPrev = true;
          }
        }
        if (!hasPrev && email && emailToEarliestDate.has(email)) {
          const earliest = emailToEarliestDate.get(email);
          if (new Date(earliest) < new Date(order.createdAt)) {
            hasPrev = true;
          }
        }

        if (hasPrev) {
          returningCustomers += 1;
        } else {
          newCustomers += 1;
        }
      }
    }

    // Popular Days Distribution
    const daysDataCounts = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0,
      Sunday: 0
    };

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const order of nonCancelled30Days) {
      const dayName = days[new Date(order.createdAt).getDay()];
      if (dayName in daysDataCounts) {
        daysDataCounts[dayName] += 1;
      }
    }

    const popularDaysData = Object.entries(daysDataCounts)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);

    // Popular Food Distribution
    const foodDataCounts = {};
    for (const order of nonCancelled30Days) {
      if (order.items && Array.isArray(order.items)) {
        for (const item of order.items) {
          const itemName = item.name;
          if (itemName) {
            foodDataCounts[itemName] = (foodDataCounts[itemName] || 0) + (item.quantity || 1);
          }
        }
      }
    }

    const sortedFood = Object.entries(foodDataCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    let popularFoodData = [];
    if (sortedFood.length > 6) {
      popularFoodData = sortedFood.slice(0, 6);
      const otherVal = sortedFood.slice(6).reduce((sum, item) => sum + item.value, 0);
      popularFoodData.push({ name: 'Other Items', value: otherVal });
    } else {
      popularFoodData = sortedFood;
    }

    if (popularFoodData.length === 0) {
      popularFoodData = [{ name: 'No Menu Items Sold', value: 0 }];
    }

    return {
      totalOrders,
      totalEarnings: round2(totalEarnings),
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


// ── Get Unique Customers List ──────────────────────────────────
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

    // Filter by date in the database layer (leveraging indexes) rather than in application memory
    if (filters.date) {
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    pipeline.push({ $match: matchQuery });

    pipeline.push({ $sort: { createdAt: -1 } });

    // Group by phone or email
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

    // Sort customers by lastOrderDate descending
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
