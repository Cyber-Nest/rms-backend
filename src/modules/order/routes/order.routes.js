const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');

router.post('/',              orderController.createOrder);
router.get('/next-number',    orderController.getNextOrderNumber);
router.get('/sales-summary',   orderController.getSalesSummary);
router.get('/dashboard-metrics', orderController.getDashboardMetrics);
router.get('/customers', orderController.getUniqueCustomers);
router.post('/sales-summary/deposit', orderController.saveDeposit);
router.get('/',               orderController.getAllOrders);
router.get('/:id',            orderController.getOrderById);
router.get('/:id/pdf',        orderController.downloadReceiptPdf);
router.patch('/:id/status',   orderController.updateOrderStatus);
router.patch('/:id/due-time', orderController.updateOrderDueTime);
router.patch('/:id/payment',  orderController.markOrderPaid);
router.patch('/:id',          orderController.updateOrderItems);
router.delete('/:id',         orderController.cancelOrder);

module.exports = router;
