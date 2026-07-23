const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branch.controller");

router.post("/branches", branchController.createBranch);
router.get("/branches", branchController.getAllBranches);
router.get("/branches/:id", branchController.getBranchById);
router.patch("/branches/:id", branchController.updateBranch);
router.delete("/branches/:id", branchController.deleteBranch);
router.post("/branches/login", branchController.loginBranch);
router.post("/branches/logout", branchController.logoutBranch);
router.patch("/branches/change-password", branchController.changePassword);

module.exports = router;
