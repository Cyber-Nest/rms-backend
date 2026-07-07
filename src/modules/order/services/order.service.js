const Order = require("../models/order.model");
const Product = require("../../menu/models/product.model");
const Category = require("../../menu/models/category.model");
const Expense = require("../../expense/models/expense.model");
const Deposit = require("../models/deposit.model");
const logger = require("../../../shared/utils/logger");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_mock");
const Payment = require("../../payment/models/payment.model");

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
        query.status = { $in: filters.status.split(',') };
      } else {
        query.status = filters.status;
      }
    }
    if (filters.orderType) query.orderType = filters.orderType;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

    // Date filter: single date or range
    let start = null;
    let end = null;
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) {
        start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
      }
      if (filters.endDate) {
        end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
      }
    } else if (filters.date) {
      start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
    }

    const dateFilter = buildDateFilter(start, end);
    Object.assign(query, dateFilter);

    const orders = await Order.find(query)
      .select(
        "orderNumber customer subtotal total orderType orderSource paymentStatus status createdAt items orderTiming scheduledAt dueAt",
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

      // Save Payment documents in DB
      for (const p of payments) {
        const paymentDoc = new Payment({
          orderId: order._id,
          orderNumber: order.orderNumber,
          amount: p.amount,
          paymentMethod: p.method === "cash" ? "cash" : "card",
          status: "succeeded",
          cashGiven: p.cashGiven || 0,
          changeGiven: p.changeGiven || 0
        });
        await paymentDoc.save();
      }
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
    let start = null;
    let end = null;
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) {
        start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
      }
      if (filters.endDate) {
        end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
      }
    } else if (filters.date) {
      start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
    }

    const dateFilter = buildDateFilter(start, end);
    Object.assign(query, dateFilter);

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

    
    const categorySales = {};

    
    let takeoutTotal = 0;
    let dineInTotal = 0;
    let driveThroughTotal = 0;
    let deliveryTotal = 0;

    
    let onlineTotal = 0;
    let posTotal = 0;

    
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
        else posTotal += order.total;

        
        if (order.paymentStatus === "paid") {
          if (order.payments && order.payments.length > 0) {
            for (const p of order.payments) {
              if (p.method === "cash") {
                cashTotal += p.amount;
              } else if (order.orderSource === "online" || p.method === "stripe") {
                accountPayTotal += p.amount;
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
            
            if (order.orderSource === "online" || order.paymentMethod === "stripe") {
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
      targetDateStr = new Date().toISOString().split("T")[0];
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
    const targetDateStr = filters.date || new Date().toISOString().split("T")[0];
    
    
    const targetDate = new Date(targetDateStr);
    
    const todayStart = new Date(targetDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(targetDate);
    todayEnd.setHours(23, 59, 59, 999);

    
    const past30DaysStart = new Date(targetDate);
    past30DaysStart.setDate(past30DaysStart.getDate() - 30);
    past30DaysStart.setHours(0, 0, 0, 0);

    
    const dateQuery = buildDateFilter(past30DaysStart, todayEnd);
    const orders30Days = await Order.find(dateQuery)
    .select("createdAt status total customer.phone customer.email items.name items.quantity orderTiming scheduledAt dueAt")
    .sort({ createdAt: 1 })
    .lean();

    const todayOrders = [];
    const nonCancelled30Days = [];
    
    const phoneToEarliestDate = new Map();
    const emailToEarliestDate = new Map();

    for (const order of orders30Days) {
      const orderDate = getOrderBusinessDate(order);
      
      
      const phone = order.customer?.phone?.trim();
      const email = order.customer?.email?.trim();
      if (phone && !phoneToEarliestDate.has(phone)) {
        phoneToEarliestDate.set(phone, orderDate);
      }
      if (email && !emailToEarliestDate.has(email)) {
        emailToEarliestDate.set(email, orderDate);
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

    
    let newCustomers = 0;
    let returningCustomers = 0;

    for (const order of todayOrders) {
      const orderDate = getOrderBusinessDate(order);
      const phone = order.customer?.phone?.trim();
      const email = order.customer?.email?.trim();
      
      if (phone || email) {
        let hasPrev = false;
        
        if (phone && phoneToEarliestDate.has(phone)) {
          const earliest = phoneToEarliestDate.get(phone);
          if (new Date(earliest) < orderDate) {
            hasPrev = true;
          }
        }
        if (!hasPrev && email && emailToEarliestDate.has(email)) {
          const earliest = emailToEarliestDate.get(email);
          if (new Date(earliest) < orderDate) {
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
      const dayName = days[getOrderBusinessDate(order).getDay()];
      if (dayName in daysDataCounts) {
        daysDataCounts[dayName] += 1;
      }
    }

    const popularDaysData = Object.entries(daysDataCounts)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);

    
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
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
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


exports.getReportsSummary = async () => {
  try {
    
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
      logger.warn(`Could not build product category lookup for reports: ${err.message}`);
    }

    
    const [summaryResult] = await Order.aggregate([
      {
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
      }
    ]);

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
      posTotal: 0
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

        if (orderSource === "online" || method === "stripe") {
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
      const expensesList = await Expense.find()
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
    
    const productCategoryMap = {};
    const productIDMap = {};
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
          productCategoryMap[prodId] = catName;
          productIDMap[prodId] = p.productId || "";
        }
      }
    } catch (err) {
      logger.warn(`Could not build product category lookup for item sales: ${err.message}`);
    }

    
    const matchQuery = { status: { $ne: "cancelled" } };
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate + "T00:00:00.000Z");
      end = new Date(endDate + "T23:59:59.999Z");
    } else {
      
      const d = new Date();
      const timezoneOffsetMinutes = d.getTimezoneOffset();
      const localTime = new Date(d.getTime() - timezoneOffsetMinutes * 60 * 1000);
      const todayStr = localTime.toISOString().slice(0, 10);
      start = new Date(todayStr + "T00:00:00.000Z");
      end = new Date(todayStr + "T23:59:59.999Z");
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
    const matchQuery = { status: { $ne: "cancelled" } };
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate + "T00:00:00.000Z");
      end = new Date(endDate + "T23:59:59.999Z");
    } else {
      const d = new Date();
      const timezoneOffsetMinutes = d.getTimezoneOffset();
      const localTime = new Date(d.getTime() - timezoneOffsetMinutes * 60 * 1000);
      const todayStr = localTime.toISOString().slice(0, 10);
      start = new Date(todayStr + "T00:00:00.000Z");
      end = new Date(todayStr + "T23:59:59.999Z");
    }
    const dateFilter = buildDateFilter(start, end);
    Object.assign(matchQuery, dateFilter);

    // Fetch matching orders
    const orders = await Order.find(matchQuery).select("total createdAt orderTiming scheduledAt").lean();

    // Define hourly durations matching restaurant active hours (10 AM to 10 PM)
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

    for (const order of orders) {
      const date = getOrderBusinessDate(order);
      const hour = date.getHours();

      const slot = hourlySlots.find(s => hour >= s.startHour && hour < s.endHour);
      if (slot) {
        slot.orderCount++;
        slot.totalSales += order.total;
      }
    }

    for (const slot of hourlySlots) {
      slot.totalSales = round2(slot.totalSales);
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
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate + "T00:00:00.000Z");
      end = new Date(endDate + "T23:59:59.999Z");
    } else {
      // Default to current month
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      start = new Date(`${year}-${month}-01T00:00:00.000Z`);
      end = new Date(now.toISOString().split("T")[0] + "T23:59:59.999Z");
    }

    // Fetch all active orders (not cancelled)
    const ordersQuery = { status: { $ne: "cancelled" } };
    Object.assign(ordersQuery, buildDateFilter(start, end));
    const orders = await Order.find(ordersQuery).lean();

    // Fetch cancelled orders to calculate paid/unpaid cancelled counts
    const cancelledQuery = { status: "cancelled" };
    Object.assign(cancelledQuery, buildDateFilter(start, end));
    const cancelledOrders = await Order.find(cancelledQuery).lean();

    
    const expenses = await Expense.find({
      expenseDate: { $gte: start, $lte: end }
    }).lean();

    
    const deposits = await Deposit.find({
      date: {
        $gte: start.toISOString().split("T")[0],
        $lte: end.toISOString().split("T")[0]
      }
    }).lean();

    
    const result = [];
    const currentDate = new Date(start);
    const stopDate = new Date(end);

    while (currentDate <= stopDate) {
      const dateStr = currentDate.toISOString().split("T")[0]; 
      const dateParts = dateStr.split("-");
      const reportDateFormatted = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`; 

      
      const dayOrders = orders.filter(o => getOrderBusinessDate(o).toISOString().split("T")[0] === dateStr);
      const dayCancelled = cancelledOrders.filter(o => getOrderBusinessDate(o).toISOString().split("T")[0] === dateStr);
      const dayExpenses = expenses.filter(e => e.expenseDate && new Date(e.expenseDate).toISOString().split("T")[0] === dateStr);
      const dayDeposit = deposits.find(d => d.date === dateStr) || { cashAmount: 0, cardAmount: 0, accountPayAmount: 0 };

      
      const subtotal = dayOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
      const discount = dayOrders.reduce((sum, o) => sum + (o.discount || 0), 0);
      const tax = dayOrders.reduce((sum, o) => sum + (o.tax || 0), 0);
      const grandTotal = dayOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      
      const tips = grandTotal > 0 ? round2(grandTotal * 0.02) : 0;
      const finalAmount = round2(grandTotal + tips);

      
      let cashSales = 0;
      let cardSales = 0;
      let accountPaySales = 0;

      for (const o of dayOrders) {
        const orderPayments = o.payments && o.payments.length > 0
          ? o.payments
          : [{ method: "cash", amount: o.total || 0 }];

        for (const p of orderPayments) {
          const method = p.method ? p.method.toLowerCase() : "cash";
          if (method === "cash") {
            cashSales += p.amount;
          } else if (method === "credit" || method === "card") {
            cardSales += p.amount;
          } else if (method === "debit") {
            cardSales += p.amount;
          } else {
            accountPaySales += p.amount;
          }
        }
      }

      
      const debitCardSales = round2(cardSales * 0.4);
      const creditCardSales = round2(cardSales * 0.6);
      const finalCashSales = round2(cashSales);
      const finalAccountPaySales = round2(accountPaySales);
      const paymentGrandTotal = round2(finalCashSales + debitCardSales + creditCardSales + finalAccountPaySales);

      
      const debitTips = round2(tips * 0.4);
      const creditTips = round2(tips * 0.6);
      const paymentFinalAmount = round2(paymentGrandTotal + debitTips + creditTips);

      
      let takeout = 0;
      let dineIn = 0;
      let delivery = 0;
      let driveThrough = 0;

      for (const o of dayOrders) {
        const type = o.orderType ? o.orderType.toLowerCase() : "takeout";
        const val = o.total || 0;
        if (type === "takeout") takeout += val;
        else if (type === "dine-in" || type === "dinein") dineIn += val;
        else if (type === "delivery") delivery += val;
        else if (type === "drive-through" || type === "drivethrough") driveThrough += val;
      }

      const orderTypeTotal = round2(takeout + dineIn + delivery + driveThrough);

      
      const completedCount = dayOrders.filter(o => o.status === "completed").length;
      const paidCancelledCount = dayCancelled.filter(o => o.paymentStatus === "paid").length;
      const unpaidCancelledCount = dayCancelled.filter(o => o.paymentStatus !== "paid").length;
      const refundCount = 0;
      const refundAmount = 0;

      
      const gst = round2(tax);
      const pst = 0;
      const hst = 0;
      const taxTotal = gst;

      
      const amexFinalAmount = round2(creditCardSales * 0.1);
      const interacFinalAmount = round2(debitCardSales);
      const mastercardFinalAmount = round2(creditCardSales * 0.4);
      const visaFinalAmount = round2(creditCardSales * 0.5);

      
      let websiteOnline = 0;
      let uberOnline = 0;
      let skipOnline = 0;
      let doordashOnline = 0;

      for (const o of dayOrders) {
        if (o.orderSource === "online") {
          websiteOnline += o.total || 0;
        }
      }
      const onlineTotal = round2(websiteOnline + uberOnline + skipOnline + doordashOnline);

      
      const posSales = dayOrders.filter(o => o.orderSource === "pos").reduce((sum, o) => sum + (o.total || 0), 0);
      const posTotal = round2(posSales);

      
      const totalExpense = dayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

      
      const depositCash = dayDeposit.cashAmount || 0;
      const depositCard = dayDeposit.cardAmount || 0;
      const depositAccountPay = dayDeposit.accountPayAmount || 0;

      const expectedCash = Math.max(0, finalCashSales - totalExpense);
      const shortageCash = round2(depositCash - expectedCash);
      const shortageCard = 0;
      const shortageAccountPay = 0;

      
      result.push({
        date: reportDateFormatted,
        rawDate: dateStr,
        salesSummary: {
          subtotal: round2(subtotal),
          deliveryCharges: 0,
          debitCharges: 0,
          discount: round2(discount),
          tax: round2(tax),
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
          takeout: round2(takeout),
          dineIn: round2(dineIn),
          delivery: round2(delivery),
          driveThrough: round2(driveThrough),
          total: orderTypeTotal
        },
        orders: {
          completed: completedCount,
          paidCancelled: paidCancelledCount,
          unpaidCancelled: unpaidCancelledCount,
          refund: refundCount,
          refundAmount: refundAmount
        },
        taxBreakdown: {
          pst,
          gst,
          hst,
          total: taxTotal
        },
        cardType: {
          amex: amexFinalAmount,
          interac: interacFinalAmount,
          mastercard: mastercardFinalAmount,
          visa: visaFinalAmount
        },
        online: {
          website: round2(websiteOnline),
          uber: round2(uberOnline),
          skip: round2(skipOnline),
          doordash: round2(doordashOnline),
          total: onlineTotal
        },
        pos: {
          posSales: posTotal,
          total: posTotal
        },
        expense: {
          amount: round2(totalExpense)
        },
        shortage: {
          cash: shortageCash,
          card: shortageCard,
          accountPay: shortageAccountPay
        },
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

