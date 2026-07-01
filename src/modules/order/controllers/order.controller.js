const orderService = require('../services/order.service');
const receiptPdfService = require('../services/receiptPdf.service');
const logger = require('../../../shared/utils/logger');

const handleError = (res, error, status = 400) => {
  logger.error(`Order Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};

// POST /api/orders
exports.createOrder = async (req, res) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// GET /api/orders
exports.getAllOrders = async (req, res) => {
  try {
    const { status, orderType, paymentStatus, date, startDate, endDate } = req.query;
    const orders = await orderService.getAllOrders({ status, orderType, paymentStatus, date, startDate, endDate });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// GET /api/orders/sales-summary
exports.getSalesSummary = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    const summary = await orderService.getSalesSummary({ date, startDate, endDate });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// GET /api/orders/dashboard-metrics
exports.getDashboardMetrics = async (req, res) => {
  try {
    const { date } = req.query;
    const metrics = await orderService.getDashboardMetrics({ date });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// GET /api/orders/customers
exports.getUniqueCustomers = async (req, res) => {
  try {
    const { date } = req.query;
    const customers = await orderService.getUniqueCustomers({ date });
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// GET /api/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 404);
  }
};

// GET /api/orders/:id/pdf
exports.downloadReceiptPdf = async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderNumber}.pdf`);
    receiptPdfService.generateReceiptPdf(order, res);
  } catch (error) {
    handleError(res, error, 500);
  }
};

// PATCH /api/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required.' });
    const order = await orderService.updateOrderStatus(req.params.id, status, note);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// PATCH /api/orders/:id/payment  — mark pay-later as paid
exports.markOrderPaid = async (req, res) => {
  try {
    const { payments } = req.body;
    const order = await orderService.markOrderPaid(req.params.id, payments);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// DELETE /api/orders/:id  — cancel order
exports.cancelOrder = async (req, res) => {
  try {
    const order = await orderService.cancelOrder(req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// GET /api/orders/next-number
exports.getNextOrderNumber = async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) {
      return res.status(400).json({ success: false, message: 'type query parameter is required.' });
    }
    const nextNumber = await orderService.getNextOrderNumber(type);
    res.status(200).json({ success: true, data: nextNumber });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// PATCH /api/orders/:id/due-time
exports.updateOrderDueTime = async (req, res) => {
  try {
    const { dueAt } = req.body;
    if (!dueAt) return res.status(400).json({ success: false, message: 'dueAt is required.' });
    const order = await orderService.updateOrderDueTime(req.params.id, dueAt);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// PATCH /api/orders/:id  — update order items
exports.updateOrderItems = async (req, res) => {
  try {
    const order = await orderService.updateOrderItems(req.params.id, req.body);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// POST /api/orders/sales-summary/deposit
exports.saveDeposit = async (req, res) => {
  try {
    const { date, cashAmount, cardAmount, accountPayAmount } = req.body;
    const deposit = await orderService.saveDeposit({ date, cashAmount, cardAmount, accountPayAmount });
    res.status(200).json({ success: true, data: deposit });
  } catch (error) {
    handleError(res, error, 400);
  }
};
