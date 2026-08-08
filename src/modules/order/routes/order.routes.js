const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const protectBranch = require('../../../shared/middleware/protectBranch');
const enforceBranch = require('../../../shared/middleware/enforceBranch');

// ── Public Order Creation Endpoint ──
router.post('/', orderController.createOrder);

// ── Static Branch Admin & POS Protected Routes (MUST BE BEFORE /:id) ──
router.get('/next-number', protectBranch, enforceBranch, orderController.getNextOrderNumber);
router.get('/sales-summary', protectBranch, enforceBranch, orderController.getSalesSummary);
router.get('/sales-summary/pdf', protectBranch, enforceBranch, orderController.downloadSalesSummaryPdf);
router.get('/reports-summary', protectBranch, enforceBranch, orderController.getReportsSummary);
router.get('/export-report', protectBranch, enforceBranch, orderController.exportReport);
router.get('/item-sales-summary', protectBranch, enforceBranch, orderController.getItemSalesSummary);
router.get('/hourly-sales-summary', protectBranch, enforceBranch, orderController.getHourlySalesSummary);
router.get('/monthly-sales-summary', protectBranch, enforceBranch, orderController.getMonthlySalesSummary);
router.get('/dashboard-metrics', protectBranch, enforceBranch, orderController.getDashboardMetrics);
router.get('/customers', protectBranch, enforceBranch, orderController.getUniqueCustomers);
router.post('/sales-summary/deposit', protectBranch, enforceBranch, orderController.saveDeposit);
router.get('/', protectBranch, enforceBranch, orderController.getAllOrders);

// ── Dynamic Parameterized Routes (/:id) ──
router.get('/:id', orderController.getOrderById);
router.get('/:id/pdf', protectBranch, orderController.downloadReceiptPdf);
router.patch('/:id/status', protectBranch, orderController.updateOrderStatus);
router.patch('/:id/kitchen-clear', protectBranch, orderController.kitchenClear);
router.patch('/:id/due-time', protectBranch, orderController.updateOrderDueTime);
router.patch('/:id/payment', protectBranch, orderController.markOrderPaid);
router.patch('/:id', protectBranch, orderController.updateOrderItems);
router.post('/:id/refund', protectBranch, orderController.refundOrder);
router.post('/:id/cancel', protectBranch, orderController.cancelOrder);
router.delete('/:id', protectBranch, orderController.cancelOrder);

module.exports = router;
