const express = require("express");
const router = express.Router();
const deliveryController = require("../controllers/delivery.controller");

// Pusher Auth Route
router.post("/auth", deliveryController.pusherAuth);


//Branch Dashboard 
router.get("/orders", deliveryController.getDeliveryOrders);
router.get("/drivers", deliveryController.getDrivers);
router.get("/vehicles", deliveryController.getVehicles);
router.post("/vehicles", deliveryController.createVehicle);
router.put("/vehicles/:id", deliveryController.updateVehicle);
router.delete("/vehicles/:id", deliveryController.deleteVehicle);
router.post("/assign", deliveryController.assignDriver);
router.post("/unassign", deliveryController.unassignDriver);
router.post("/vehicles/assign", deliveryController.assignVehicle);
router.delete("/vehicles/unassign/:driverId", deliveryController.unassignVehicle);
router.post("/driver/:driverId/complete-active", deliveryController.completeActiveAssignment);

//Driver side
router.post("/driver/login", deliveryController.driverLogin);
router.get("/driver/:id", deliveryController.getDriverById);
router.get("/driver/:id/assignments", deliveryController.getDriverAssignments);
router.patch("/driver/deliver/:assignmentId", deliveryController.markDelivered);
router.patch("/driver/complete/:assignmentId", deliveryController.markCompleted);
router.patch("/driver/:id/status", deliveryController.updateDriverStatus);
router.post("/driver/:id/location", deliveryController.updateDriverLocation);

//User Tracking Route
router.get("/track/:orderId", deliveryController.trackDelivery);

module.exports = router;
