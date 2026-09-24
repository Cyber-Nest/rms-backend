const express = require("express");
const router = express.Router();
const terminalController = require("../controllers/terminal.controller");

// CRUD routes
router.get("/",         terminalController.getTerminals);
router.get("/:id",      terminalController.getTerminalById);
router.post("/",        terminalController.createTerminal);
router.put("/:id",      terminalController.updateTerminal);
router.delete("/:id",   terminalController.deleteTerminal);

// Key action: send payment to physical/sandbox terminal
router.post("/purchase", terminalController.sendPurchase);

module.exports = router;
