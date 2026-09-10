const express = require("express");
const router = express.Router();
const deliveryController = require("../controllers/delivery.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");
const enforceBranch = require("../../../shared/middleware/enforceBranch");
const protectDriver = require("../../../shared/middleware/protectDriver");
const { driverLoginLimiter } = require("../../../shared/middleware/rateLimiter");

/**
 * Open CORS middleware for public driver endpoints.
 * These routes are called cross-origin by the driver-web app
 * from ANY restaurant backend (verify-qr, login, assignments, status).
 */
const openCors = (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-branch-token, x-branch-id");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
};

// ── Public Routes (Pusher auth, Customer tracking, Driver App) ──
router.post("/auth", deliveryController.pusherAuth);
router.get("/track/:orderId", deliveryController.trackDelivery);

// Driver App Routes — openCors applied so driver-web can call ANY restaurant's backend
router.options("/driver/verify-qr", openCors);
router.options("/driver/login", openCors);
router.options("/driver/:id", openCors);
router.options("/driver/:id/assignments", openCors);
router.options("/driver/deliver/:assignmentId", openCors);
router.options("/driver/complete/:assignmentId", openCors);
router.options("/driver/:id/status", openCors);

router.post("/driver/login", openCors, driverLoginLimiter, deliveryController.driverLogin);
router.get("/driver/:id", openCors, protectDriver, deliveryController.getDriverById);
router.get("/driver/:id/assignments", openCors, protectDriver, deliveryController.getDriverAssignments);
router.patch("/driver/deliver/:assignmentId", openCors, protectDriver, deliveryController.markDelivered);
router.patch("/driver/complete/:assignmentId", openCors, protectDriver, deliveryController.markCompleted);
router.patch("/driver/:id/status", openCors, protectDriver, deliveryController.updateDriverStatus);

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
router.post("/driver/verify-qr", openCors, deliveryController.verifyStoreQr);
router.get("/qr-token/:branchId", protectBranch, enforceBranch, deliveryController.generateBranchQrToken);

module.exports = router;
