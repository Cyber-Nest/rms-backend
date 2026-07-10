const orderService = require('../services/order.service');
const receiptPdfService = require('../services/receiptPdf.service');
const reportPdfService = require('../services/reportPdf.service');
const reportExcelService = require('../services/reportExcel.service');
const logger = require('../../../shared/utils/logger');
const { getLocalDateStr } = require('../../../shared/utils/timezone');

const formatDateOnly = (dateStr) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  return dateStr;
};

const handleError = (res, error, status = 400) => {
  logger.error(`Order Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};


exports.createOrder = async (req, res) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.getAllOrders = async (req, res) => {
  try {
    const { status, orderType, paymentStatus, date, startDate, endDate, fields, excludeReceptionCompleted } = req.query;
    const orders = await orderService.getAllOrders({
      status,
      orderType,
      paymentStatus,
      date,
      startDate,
      endDate,
      fields,
      excludeReceptionCompleted: excludeReceptionCompleted === 'true'
    });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getSalesSummary = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    const summary = await orderService.getSalesSummary({ date, startDate, endDate });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getReportsSummary = async (req, res) => {
  try {
    const summary = await orderService.getReportsSummary();
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getItemSalesSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await orderService.getItemSalesSummary({ startDate, endDate });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getHourlySalesSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await orderService.getHourlySalesSummary({ startDate, endDate });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getMonthlySalesSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await orderService.getMonthlySalesSummary({ startDate, endDate });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};



exports.getDashboardMetrics = async (req, res) => {
  try {
    const { date } = req.query;
    const metrics = await orderService.getDashboardMetrics({ date });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getUniqueCustomers = async (req, res) => {
  try {
    const { date } = req.query;
    const customers = await orderService.getUniqueCustomers({ date });
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getOrderById = async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 404);
  }
};


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


exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note, receptionCompleted } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required.' });
    const order = await orderService.updateOrderStatus(req.params.id, status, note, receptionCompleted);
    res.status(200).json({
      success: true,
      data: {
        _id: order._id,
        status: order.status,
        receptionCompleted: order.receptionCompleted
      }
    });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.markOrderPaid = async (req, res) => {
  try {
    const { payments } = req.body;
    const order = await orderService.markOrderPaid(req.params.id, payments);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.cancelOrder = async (req, res) => {
  try {
    const order = await orderService.cancelOrder(req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};


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


exports.updateOrderItems = async (req, res) => {
  try {
    const order = await orderService.updateOrderItems(req.params.id, req.body);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.saveDeposit = async (req, res) => {
  try {
    const { date, cashAmount, cardAmount, accountPayAmount } = req.body;
    const deposit = await orderService.saveDeposit({ date, cashAmount, cardAmount, accountPayAmount });
    res.status(200).json({ success: true, data: deposit });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.exportReport = async (req, res) => {
  try {
    const { type, format, startDate, endDate, search, status } = req.query;
    if (!type || !format) {
      return res.status(400).json({ success: false, message: "Type and format query parameters are required." });
    }

    let reportData = [];
    const dateRangeStr = startDate === endDate 
      ? formatDateOnly(startDate) 
      : `${formatDateOnly(startDate)} - ${formatDateOnly(endDate)}`;

    if (type === "item_sales") {
      reportData = await orderService.getItemSalesSummary({ startDate, endDate });
    } else if (type === "hourly_sales") {
      reportData = await orderService.getHourlySalesSummary({ startDate, endDate });
    } else if (type === "monthly_sales_summary") {
      reportData = await orderService.getMonthlySalesSummary({ startDate, endDate });
    } else if (type === "cash_out_summary") {
      const allOrders = await orderService.getAllOrders({ startDate, endDate, status: "completed" });
      const groups = {};
      allOrders.forEach((order) => {
        const empName = order.customer?.name === 'No Name' || !order.customer?.name ? 'Manager' : order.customer.name;
        if (!groups[empName]) {
          groups[empName] = {
            employeeName: empName,
            orderCount: 0,
            lastCashOut: order.createdAt,
            totalAmount: 0
          };
        }
        groups[empName].orderCount += 1;
        groups[empName].totalAmount += order.total;
        if (new Date(order.createdAt) > new Date(groups[empName].lastCashOut)) {
          groups[empName].lastCashOut = order.createdAt;
        }
      });
      reportData = Object.values(groups);
    } else if (type === "failed_transaction" || type === "refund_orders") {
      const allOrders = await orderService.getAllOrders({ startDate, endDate });
      reportData = allOrders.filter((order) => {
        if (type === "failed_transaction") {
          const isFailed = order.status === 'cancelled' || order.paymentStatus === 'unpaid';
          if (!isFailed) return false;
        } else {
          const isRefunded = order.status === 'cancelled';
          if (!isRefunded) return false;
        }

        if (search && search.trim() !== '') {
          const kw = search.toLowerCase().trim();
          const numMatch = order.orderNumber.toLowerCase().includes(kw);
          const nameMatch = order.customer?.name?.toLowerCase().includes(kw) || false;
          const phoneMatch = order.customer?.phone?.includes(kw) || false;
          if (!numMatch && !nameMatch && !phoneMatch) return false;
        }

        if (status && status !== '') {
          if (order.status !== status) return false;
        }

        return true;
      });
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${type}-report-${startDate}-to-${endDate}.pdf`);
      reportPdfService.generateReportPdf(type, reportData, dateRangeStr, res);
    } else {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${type}-report-${startDate}-to-${endDate}.csv`);
      reportExcelService.generateReportCsv(type, reportData, dateRangeStr, res);
    }
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.downloadSalesSummaryPdf = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    const summary = await orderService.getSalesSummary({ date, startDate, endDate });

    const fileDateStr = date || startDate || getLocalDateStr();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=sales-summary-${fileDateStr}.pdf`);

    receiptPdfService.generateSalesSummaryReceiptPdf(summary, fileDateStr, res);
  } catch (error) {
    handleError(res, error, 500);
  }
};
