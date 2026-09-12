const orderService = require('../services/order.service');
const receiptPdfService = require('../services/receiptPdf.service');
const reportPdfService = require('../services/reportPdf.service');
const reportExcelService = require('../services/reportExcel.service');
const silentPrintService = require('../services/silentPrint.service');
const emailReceiptService = require('../services/emailReceipt.service');
const Order = require('../models/order.model');
const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/utils/logger');
const { getLocalDateStr } = require('../../../shared/utils/timezone');
const { triggerPrintJob } = require('../../../config/pusher');

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
    const { status, orderType, paymentStatus, date, startDate, endDate, fields, excludeReceptionCompleted, excludeKitchenCleared, page, limit, search, branchId } = req.query;
    const orders = await orderService.getAllOrders({
      branchId,
      status,
      orderType,
      paymentStatus,
      date,
      startDate,
      endDate,
      fields,
      excludeReceptionCompleted: excludeReceptionCompleted === 'true',
      excludeKitchenCleared: excludeKitchenCleared === 'true',
      page,
      limit,
      search
    });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getSalesSummary = async (req, res) => {
  try {
    const { date, startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getSalesSummary({ date, startDate, endDate, branchId: activeBranchId });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getReportsSummary = async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getReportsSummary({ startDate, endDate, branchId: activeBranchId });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getItemSalesSummary = async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getItemSalesSummary({ startDate, endDate, branchId: activeBranchId });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getHourlySalesSummary = async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getHourlySalesSummary({ startDate, endDate, branchId: activeBranchId });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getMonthlySalesSummary = async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getMonthlySalesSummary({ startDate, endDate, branchId: activeBranchId });
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error, 500);
  }
};



exports.getDashboardMetrics = async (req, res) => {
  try {
    const { date, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const metrics = await orderService.getDashboardMetrics({ date, branchId: activeBranchId });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    handleError(res, error, 500);
  }
};


exports.getUniqueCustomers = async (req, res) => {
  try {
    const activeBranchId = req.activeBranchId || req.query.branchId;
    const { date } = req.query;
    const customers = await orderService.getUniqueCustomers({ date, branchId: activeBranchId });
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
    await receiptPdfService.generateReceiptPdf(order, res);
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.silentPrintOrderReceipt = async (req, res) => {
  let tempPdfPath = null;
  try {
    const { id } = req.params;
    const { printerName } = req.body || {};

    const order = await orderService.getOrderById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const cleanOrderNum = (order.orderNumber || id).replace('#', '');
    const filename = `receipt-${cleanOrderNum}-${Date.now()}.pdf`;
    tempPdfPath = silentPrintService.getTempReceiptPath(filename);

    const writeStream = fs.createWriteStream(tempPdfPath);
    await receiptPdfService.generateReceiptPdf(order, writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const printResult = await silentPrintService.printPdfSilently(tempPdfPath, printerName);

    const paperSize = req.body?.paperSize || '80mm';
    const itemsFilter = req.body?.itemsFilter || 'all';
    const activeBranchId = order.branchId || req.branch?.branchId || req.branch?._id;

    if (activeBranchId) {
      await triggerPrintJob(activeBranchId, {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        pdfUrl: `/api/orders/${order._id}/pdf?paperSize=${paperSize}&itemsFilter=${itemsFilter}`,
        paperSize,
        itemsFilter,
        printerName: printerName || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Receipt sent to thermal printer successfully for order ${order.orderNumber}`,
      printer: printResult.printer || 'Default Printer',
    });
  } catch (error) {
    logger.error(`Silent Print Order Receipt Error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: `Failed to print receipt: ${error.message}`,
    });
  } finally {
    if (tempPdfPath) {
      setTimeout(() => {
        if (fs.existsSync(tempPdfPath)) fs.unlink(tempPdfPath, () => {});
      }, 15000);
    }
  }
};

exports.silentPrintSalesSummary = async (req, res) => {
  let tempPdfPath = null;
  try {
    const { date, startDate, endDate, branchId, printerName } = req.body || {};
    const targetDate = date || startDate || req.query.date;
    const activeBranchId = branchId || req.query.branchId || req.branch?.branchId || req.branch?._id;

    const summary = await orderService.getSalesSummary({ date: targetDate, startDate, endDate, branchId: activeBranchId });
    if (!summary) {
      return res.status(404).json({ success: false, message: 'Sales summary data not found' });
    }

    const fileDateStr = targetDate || getLocalDateStr();
    const filename = `sales-summary-${fileDateStr}-${Date.now()}.pdf`;
    tempPdfPath = silentPrintService.getTempReceiptPath(filename);

    const writeStream = fs.createWriteStream(tempPdfPath);
    await receiptPdfService.generateSalesSummaryReceiptPdf(summary, fileDateStr, writeStream, activeBranchId);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const printResult = await silentPrintService.printPdfSilently(tempPdfPath, printerName);

    if (activeBranchId) {
      await triggerPrintJob(activeBranchId, {
        orderId: `sales-summary-${fileDateStr}`,
        orderNumber: `SALES-SUMMARY-${fileDateStr}`,
        type: 'sales-summary',
        date: fileDateStr,
        pdfUrl: `/api/orders/sales-summary/pdf?date=${fileDateStr}&branchId=${activeBranchId}`,
        paperSize: '80mm',
        printerName: printerName || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Sales summary receipt sent to thermal printer successfully',
      printer: printResult.printer || 'Default Printer',
      pdfUrl: `/api/orders/sales-summary/pdf?date=${fileDateStr}&branchId=${activeBranchId}`,
    });
  } catch (error) {
    logger.error(`Silent Print Sales Summary Error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to print sales summary receipt',
    });
  } finally {
    if (tempPdfPath) {
      setTimeout(() => {
        if (fs.existsSync(tempPdfPath)) fs.unlink(tempPdfPath, () => {});
      }, 15000);
    }
  }
};



exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note, receptionCompleted, userName, employeeName } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required.' });
    const order = await orderService.updateOrderStatus(
      req.params.id,
      status,
      note,
      receptionCompleted,
      userName || employeeName || 'Manager'
    );
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


exports.kitchenClear = async (req, res) => {
  try {
    const { userName, employeeName } = req.body || {};
    const order = await orderService.kitchenClear(req.params.id, userName || employeeName || 'Manager');
    res.status(200).json({
      success: true,
      data: {
        _id: order._id,
        status: order.status,
        kitchenCleared: order.kitchenCleared
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
    const { reason, userName, employeeName } = req.body || {};
    const order = await orderService.cancelOrder(req.params.id, {
      reason: reason || "",
      userName: userName || employeeName || "Manager",
    });
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.refundOrder = async (req, res) => {
  try {
    const { reason, userName, employeeName } = req.body || {};
    const result = await orderService.refundOrder(req.params.id, {
      reason,
      userName: userName || employeeName || 'Manager',
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.getNextOrderNumber = async (req, res) => {
  try {
    const { type, branchId } = req.query;
    if (!type) {
      return res.status(400).json({ success: false, message: 'type query parameter is required.' });
    }
    const nextNumber = await orderService.getNextOrderNumber(type, branchId || null);
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
    const { date, cashAmount, cardAmount, accountPayAmount, branchId } = req.body;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const deposit = await orderService.saveDeposit({ date, cashAmount, cardAmount, accountPayAmount, branchId: activeBranchId });
    res.status(200).json({ success: true, data: deposit });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.exportReport = async (req, res) => {
  try {
    const { type, format, startDate, endDate, search, status, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    if (!type || !format) {
      return res.status(400).json({ success: false, message: "Type and format query parameters are required." });
    }

    let reportData = [];
    const dateRangeStr = startDate === endDate 
      ? formatDateOnly(startDate) 
      : `${formatDateOnly(startDate)} - ${formatDateOnly(endDate)}`;

    if (type === "item_sales") {
      reportData = await orderService.getItemSalesSummary({ startDate, endDate, branchId: activeBranchId });
    } else if (type === "hourly_sales") {
      reportData = await orderService.getHourlySalesSummary({ startDate, endDate, branchId: activeBranchId });
    } else if (type === "monthly_sales_summary") {
      reportData = await orderService.getMonthlySalesSummary({ startDate, endDate, branchId: activeBranchId });
    } else if (type === "cash_out_summary") {
      const allOrders = await orderService.getAllOrders({ startDate, endDate, status: "completed", branchId: activeBranchId });
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
      const allOrders = await orderService.getAllOrders({ startDate, endDate, branchId: activeBranchId });
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
      await reportPdfService.generateReportPdf(type, reportData, dateRangeStr, res, activeBranchId);
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
    const { date, startDate, endDate, branchId } = req.query;
    const activeBranchId = branchId || req.branch?.branchId || req.branch?._id;
    const summary = await orderService.getSalesSummary({ date, startDate, endDate, branchId: activeBranchId });

    const fileDateStr = date || startDate || getLocalDateStr();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=sales-summary-${fileDateStr}.pdf`);

    await receiptPdfService.generateSalesSummaryReceiptPdf(summary, fileDateStr, res, activeBranchId);
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.getNextOrderNumber = async (req, res) => {
  try {
    const { type, branchId } = req.query;
    const activeBranchId = req.activeBranchId || branchId;
    const nextNumber = await orderService.getNextOrderNumber(type, activeBranchId);
    res.status(200).json({ success: true, data: nextNumber });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.searchCustomer = async (req, res) => {
  try {
    const { query, branchId } = req.query;
    const activeBranchId = req.activeBranchId || branchId || req.branch?.branchId || req.branch?._id;
    const customer = await orderService.searchCustomer({
      query,
      branchId: activeBranchId,
    });
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "No customer found." });
    }
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.sendReceiptEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Recipient email is required." });
    }

    const cleanEmail = email.trim();
    const cleanName = name && name.trim() ? name.trim() : "";

    const orderDoc = await Order.findById(id);
    if (!orderDoc) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (!orderDoc.customer) {
      orderDoc.customer = { name: cleanName || "No Name", email: cleanEmail, phone: "" };
    } else {
      orderDoc.customer.email = cleanEmail;
      if (cleanName) {
        orderDoc.customer.name = cleanName;
      }
    }
    await orderDoc.save();

    let pdfBuffer = null;
    try {
      pdfBuffer = await receiptPdfService.generateReceiptBuffer(orderDoc.toObject ? orderDoc.toObject() : orderDoc);
    } catch (pdfErr) {
      logger.warn(`Could not generate PDF buffer for email: ${pdfErr.message}`);
    }

    await emailReceiptService.sendReceiptEmail({
      to: cleanEmail,
      customerName: orderDoc.customer?.name || cleanName || "Valued Customer",
      order: orderDoc.toObject ? orderDoc.toObject() : orderDoc,
      pdfBuffer,
    });

    logger.info(`Receipt email for order ${orderDoc.orderNumber} sent to ${cleanEmail}`);
    res.status(200).json({
      success: true,
      message: `Receipt for order ${orderDoc.orderNumber} sent successfully to ${cleanEmail}`,
      customer: orderDoc.customer,
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

