const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branch.controller");
const protectBranch = require("../../../shared/middleware/protectBranch");

router.get("/branches/me", protectBranch, branchController.getMe);
router.get("/branches/settings", branchController.getBranchSettings);
router.patch("/branches/settings", branchController.updateBranchSettings);
router.post("/branches", branchController.createBranch);
router.get("/branches/public", branchController.getPublicBranches);
router.get("/branches", branchController.getAllBranches);
router.get("/branches/:id", branchController.getBranchById);
router.patch("/branches/:id", branchController.updateBranch);
router.delete("/branches/:id", branchController.deleteBranch);
router.post("/branches/login", branchController.loginBranch);
router.post("/branches/logout", branchController.logoutBranch);
router.patch("/branches/change-password", branchController.changePassword);

module.exports = router;
