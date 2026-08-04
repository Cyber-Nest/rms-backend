const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branch.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");
const protectSuperAdmin = require("../../../shared/middleware/protectSuperAdmin");

// ── Super Admin Auth Routes ──
router.post("/branches/admin/login", branchController.loginSuperAdmin);
router.get("/branches/admin/me", protectSuperAdmin, branchController.getSuperAdminMe);
router.post("/branches/admin/logout", protectSuperAdmin, branchController.logoutSuperAdmin);
router.put("/branches/admin/profile", protectSuperAdmin, branchController.updateSuperAdminProfile);
router.put("/branches/admin/password", protectSuperAdmin, branchController.updateSuperAdminPassword);

// ── Super Admin Impersonation Routes ──
router.post("/branches/impersonate/:id", protectSuperAdmin, branchController.generateImpersonationToken);
router.get("/branches/verify-impersonation", branchController.verifyImpersonationToken);

// ── Public & Branch POS Static Routes──
router.get("/branches/public", branchController.getPublicBranches);
router.post("/branches/login", branchController.loginBranch);
router.post("/branches/logout", branchController.logoutBranch);
router.get("/branches/me", protectBranch, branchController.getMe);
router.get("/branches/check-session", protectBranch, branchController.checkSession);
router.get("/branches/settings", branchController.getBranchSettings);
router.patch("/branches/settings", branchController.updateBranchSettings);
router.put("/branches/profile", branchController.updateBranchProfile);
router.patch("/branches/change-password", branchController.changePassword);

// ── Super Admin Branch Management Routes ──
router.post("/branches", protectSuperAdmin, branchController.createBranch);
router.get("/branches", protectSuperAdmin, branchController.getAllBranches);

router.get("/branches/:id", protectSuperAdmin, branchController.getBranchById);
router.patch("/branches/:id", protectSuperAdmin, branchController.updateBranch);
router.delete("/branches/:id", protectSuperAdmin, branchController.deleteBranch);

module.exports = router;
