const express = require("express");
const router = express.Router();
const deliveryController = require("../controllers/delivery.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");
const enforceBranch = require("../../../shared/middleware/enforceBranch");
const protectDriver = require("../../../shared/middleware/protectDriver");
const { driverLoginLimiter } = require("../../../shared/middleware/rateLimiter");

// ── Public Routes (Pusher auth, Customer tracking, Driver App) ──
router.post("/auth", deliveryController.pusherAuth);
router.get("/track/:orderId", deliveryController.trackDelivery);

// Driver App Routes
router.post("/driver/login", driverLoginLimiter, deliveryController.driverLogin);
router.get("/driver/:id", protectDriver, deliveryController.getDriverById);
router.get("/driver/:id/assignments", protectDriver, deliveryController.getDriverAssignments);
router.patch("/driver/deliver/:assignmentId", protectDriver, deliveryController.markDelivered);
router.patch("/driver/complete/:assignmentId", protectDriver, deliveryController.markCompleted);
router.patch("/driver/:id/status", protectDriver, deliveryController.updateDriverStatus);

// ── Branch Dashboard Protected Routes (protectBranch + enforceBranch) ──
router.get("/orders", protectBranch, enforceBranch, deliveryController.getDeliveryOrders);
router.get("/drivers", protectBranch, enforceBranch, deliveryController.getDrivers);
router.get("/vehicles", protectBranch, enforceBranch, deliveryController.getVehicles);
router.post("/vehicles", protectBranch, enforceBranch, deliveryController.createVehicle);
router.put("/vehicles/:id", protectBranch, enforceBranch, deliveryController.updateVehicle);
router.delete("/vehicles/:id", protectBranch, enforceBranch, deliveryController.deleteVehicle);
router.post("/assign", protectBranch, enforceBranch, deliveryController.assignDriver);
router.post("/unassign", protectBranch, enforceBranch, deliveryController.unassignDriver);
router.post("/vehicles/assign", protectBranch, enforceBranch, deliveryController.assignVehicle);
router.delete("/vehicles/unassign/:driverId", protectBranch, enforceBranch, deliveryController.unassignVehicle);
router.post("/driver/:driverId/complete-active", protectBranch, enforceBranch, deliveryController.completeActiveAssignment);

// Driver Drop Routes
router.get("/driver-drop/drivers", protectBranch, enforceBranch, deliveryController.getDriverDropDrivers);
router.get("/driver-drop/summary", protectBranch, enforceBranch, deliveryController.getDriverDropSummary);
router.post("/driver-drop/settle", protectBranch, enforceBranch, deliveryController.settleDriverDrop);
router.get("/driver-drop/receipt/pdf", protectBranch, enforceBranch, deliveryController.downloadDriverDropPdf);

// ── QR Code Routes ──
router.post("/driver/verify-qr", deliveryController.verifyStoreQr);
router.get("/qr-token/:branchId", protectBranch, enforceBranch, deliveryController.generateBranchQrToken);

module.exports = router;
