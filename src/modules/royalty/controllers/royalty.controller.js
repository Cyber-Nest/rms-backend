const royaltyService = require("../services/royalty.service");
const logger = require("../../../shared/utils/logger");

// ── Generate Royalty Records ──
exports.generateRoyaltyRecords = async (req, res) => {
  try {
    const { periodType, periodStart, periodEnd, branchIds, includeTax } = req.body;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        message: "periodStart and periodEnd are required",
      });
    }

    if (new Date(periodStart) > new Date(periodEnd)) {
      return res.status(400).json({
        success: false,
        message: "periodStart cannot be after periodEnd",
      });
    }

    const results = await royaltyService.generateRoyaltyRecords({
      periodType: periodType || "custom",
      periodStart,
      periodEnd,
      branchIds: branchIds || null,
      includeTax: Boolean(includeTax),
    });

    res.status(200).json({
      success: true,
      message: `Generated ${results.generated.length} record(s), skipped ${results.skipped.length}`,
      data: results,
    });
  } catch (error) {
    logger.error(`Error generating royalty records: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── Get All Records (with filters) ──
exports.getRoyaltyRecords = async (req, res) => {
  try {
    const { branchId, status, startDate, endDate, page, limit } = req.query;

    const result = await royaltyService.getRoyaltyRecords({
      branchId,
      status,
      startDate,
      endDate,
      page: page || 1,
      limit: limit || 50,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error(`Error fetching royalty records: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Get Stats (summary cards) ──
exports.getRoyaltyStats = async (req, res) => {
  try {
    const { branchId, status, startDate, endDate } = req.query;

    const stats = await royaltyService.getRoyaltyStats({
      branchId,
      status,
      startDate,
      endDate,
    });

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    logger.error(`Error fetching royalty stats: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Get In-Depth Record Detail ──
exports.getRoyaltyRecordDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const detail = await royaltyService.getRoyaltyRecordDetail(id);
    res.status(200).json({ success: true, data: detail });
  } catch (error) {
    logger.error(`Error fetching royalty record detail: ${error.message}`);
    res.status(404).json({ success: false, message: error.message });
  }
};

// ── Mark Paid / Unpaid ──
exports.updateRoyaltyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paidAt, paidNote } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required ('paid' or 'unpaid')",
      });
    }

    const record = await royaltyService.updateRoyaltyStatus(id, {
      status,
      paidAt,
      paidNote,
    });

    res.status(200).json({
      success: true,
      message: `Record marked as ${status}`,
      data: record,
    });
  } catch (error) {
    logger.error(`Error updating royalty status: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── Delete Record ──
exports.deleteRoyaltyRecord = async (req, res) => {
  try {
    const { id } = req.params;
    await royaltyService.deleteRoyaltyRecord(id);
    res.status(200).json({
      success: true,
      message: "Royalty record deleted successfully",
    });
  } catch (error) {
    logger.error(`Error deleting royalty record: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};
