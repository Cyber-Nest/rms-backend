const Terminal = require("../models/terminal.model");
const monerisService = require("../services/moneris.service");
const logger = require("../../../shared/utils/logger");

// ── GET /api/terminals?branchId=xxx ─────────────────────────────────────────
exports.getTerminals = async (req, res) => {
  try {
    const { branchId } = req.query;
    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }
    const terminals = await Terminal.find({ branchId, isActive: true })
      .select("_id terminalName terminalId storeId isRealDevice createdAt")
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: terminals });
  } catch (error) {
    logger.error(`[Terminal] getTerminals error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/terminals/:id ───────────────────────────────────────────────────
exports.getTerminalById = async (req, res) => {
  try {
    const terminal = await Terminal.findById(req.params.id).lean();
    if (!terminal) {
      return res.status(404).json({ success: false, message: "Terminal not found" });
    }
    // Return full data (including token) for single fetch — used by purchase flow
    res.status(200).json({ success: true, data: terminal });
  } catch (error) {
    logger.error(`[Terminal] getTerminalById error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/terminals ──────────────────────────────────────────────────────
exports.createTerminal = async (req, res) => {
  try {
    const { branchId, terminalName, terminalId, apiToken, storeId, isRealDevice, createdBy } = req.body;

    if (!branchId || !terminalName || !terminalId || !apiToken || !storeId) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const terminal = new Terminal({
      branchId,
      terminalName: terminalName.trim(),
      terminalId: terminalId.trim(),
      apiToken,
      storeId: storeId.trim(),
      isRealDevice: Boolean(isRealDevice),
      createdBy: createdBy || "Manager",
    });

    await terminal.save();
    logger.info(`[Terminal] Created terminal: ${terminalName} for branch: ${branchId}`);

    // Return without apiToken
    const { apiToken: _, ...safeTerminal } = terminal.toObject();
    res.status(201).json({ success: true, data: safeTerminal });
  } catch (error) {
    logger.error(`[Terminal] createTerminal error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT /api/terminals/:id ───────────────────────────────────────────────────
exports.updateTerminal = async (req, res) => {
  try {
    const { terminalName, terminalId, apiToken, storeId, isRealDevice } = req.body;

    const updateFields = {};
    if (terminalName) updateFields.terminalName = terminalName.trim();
    if (terminalId)   updateFields.terminalId   = terminalId.trim();
    if (apiToken)     updateFields.apiToken      = apiToken;
    if (storeId)      updateFields.storeId       = storeId.trim();
    if (isRealDevice !== undefined) updateFields.isRealDevice = Boolean(isRealDevice);

    const terminal = await Terminal.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    ).select("-apiToken");

    if (!terminal) {
      return res.status(404).json({ success: false, message: "Terminal not found" });
    }

    logger.info(`[Terminal] Updated terminal: ${req.params.id}`);
    res.status(200).json({ success: true, data: terminal });
  } catch (error) {
    logger.error(`[Terminal] updateTerminal error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── DELETE /api/terminals/:id ────────────────────────────────────────────────
exports.deleteTerminal = async (req, res) => {
  try {
    const terminal = await Terminal.findByIdAndDelete(req.params.id);
    if (!terminal) {
      return res.status(404).json({ success: false, message: "Terminal not found" });
    }
    logger.info(`[Terminal] Deleted terminal: ${req.params.id}`);
    res.status(200).json({ success: true, message: "Terminal deleted successfully" });
  } catch (error) {
    logger.error(`[Terminal] deleteTerminal error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/terminals/purchase ─────────────────────────────────────────────
// KEY ENDPOINT: Send payment request to Moneris terminal
// Body: { terminalDbId, amount, orderReference }
exports.sendPurchase = async (req, res) => {
  try {
    const { terminalDbId, amount, orderReference } = req.body;

    if (!terminalDbId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "terminalDbId and a positive amount are required",
      });
    }

    // Fetch full terminal config (including apiToken)
    const terminal = await Terminal.findById(terminalDbId).lean();
    if (!terminal) {
      return res.status(404).json({ success: false, message: "Terminal not found" });
    }

    const result = await monerisService.sendPurchaseToTerminal({
      storeId:      terminal.storeId,
      apiToken:     terminal.apiToken,
      terminalId:   terminal.terminalId,
      amount:       Number(amount),
      orderId:      orderReference || `order_${Date.now()}`,
      isRealDevice: terminal.isRealDevice,
    });

    if (!result.approved) {
      logger.warn(
        `[Terminal] Payment DECLINED — Terminal: ${terminal.terminalId} | Code: ${result.responseCode}`
      );
      return res.status(402).json({
        success: false,
        message: "Payment declined by terminal",
        responseCode: result.responseCode,
        receiptId:    result.receiptId,
      });
    }

    logger.info(
      `[Terminal] Payment APPROVED — Terminal: ${terminal.terminalId} | ReceiptId: ${result.receiptId}`
    );
    return res.status(200).json({
      success:      true,
      approved:     true,
      responseCode: result.responseCode,
      receiptId:    result.receiptId,
      authCode:     result.authCode,
      cardType:     result.cardType,
      cardLast4:    result.cardLast4,
      terminalId:   terminal.terminalId,
      terminalName: terminal.terminalName,
      rawResponse:  result.rawResponse,
    });
  } catch (error) {
    const isTimeout = error.code === "MONERIS_TIMEOUT";
    logger.error(`[Terminal] sendPurchase error: ${error.message}`);
    return res.status(isTimeout ? 408 : 500).json({
      success: false,
      message: error.message,
      code:    error.code || "MONERIS_ERROR",
    });
  }
};
