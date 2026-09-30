const express = require("express");
const router = express.Router();
const royaltyController = require("../controllers/royalty.controller");
const protectSuperAdmin = require("../../../shared/middleware/protectSuperAdmin");

// All royalty routes are Super Admin protected

// ── Stats (summary cards) — must be BEFORE /:id ──
router.get("/royalty/stats", protectSuperAdmin, royaltyController.getRoyaltyStats);

// ── Generate records for a period ──
router.post("/royalty/generate", protectSuperAdmin, royaltyController.generateRoyaltyRecords);

// ── List all records (with filters) ──
router.get("/royalty", protectSuperAdmin, royaltyController.getRoyaltyRecords);

// ── In-depth detail for a single record ──
router.get("/royalty/:id/detail", protectSuperAdmin, royaltyController.getRoyaltyRecordDetail);

// ── Mark paid / unpaid ──
router.patch("/royalty/:id/status", protectSuperAdmin, royaltyController.updateRoyaltyStatus);

// ── Delete a record ──
router.delete("/royalty/:id", protectSuperAdmin, royaltyController.deleteRoyaltyRecord);

module.exports = router;
