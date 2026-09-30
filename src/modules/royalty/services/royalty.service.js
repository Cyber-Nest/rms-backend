const RoyaltyRecord = require("../models/royaltyRecord.model");
const Branch = require("../../company/models/branch.model");
const Order = require("../../order/models/order.model");

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE ROYALTY RECORDS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate royalty records for all (or specific) branches for a given period.
 * actualStart = MAX(branch.createdAt, selectedPeriodStart)
 * Only completed/paid orders are counted. Cancelled orders are excluded.
 * Duplicate records (same branchId + startDate + endDate) are skipped.
 */
exports.generateRoyaltyRecords = async ({
  periodType,
  periodStart,
  periodEnd,
  branchIds = null, // null = all active branches
}) => {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  // Set end to end of that day
  end.setHours(23, 59, 59, 999);

  // Fetch branches
  const branchFilter = { isActive: true };
  if (branchIds && branchIds.length > 0) {
    branchFilter._id = { $in: branchIds };
  }

  const branches = await Branch.find(branchFilter)
    .select("_id name code createdAt royaltyRate advertisementRate advertisementType")
    .lean();

  if (branches.length === 0) {
    throw new Error("No active branches found to generate records for.");
  }

  const results = {
    generated: [],
    skipped: [],
    errors: [],
  };

  for (const branch of branches) {
    try {
      const branchCreated = new Date(branch.createdAt);
      const actualStart = branchCreated > start ? branchCreated : start;

      // If branch was created AFTER the period end → skip
      if (actualStart > end) {
        results.skipped.push({
          branchId: branch._id,
          branchName: branch.name,
          reason: "Branch did not exist in this period",
        });
        continue;
      }

      // Check for duplicate record
      const existing = await RoyaltyRecord.findOne({
        branchId: branch._id,
        startDate: actualStart,
        endDate: end,
      });

      if (existing) {
        results.skipped.push({
          branchId: branch._id,
          branchName: branch.name,
          reason: "Record already exists for this period",
        });
        continue;
      }

      // Exclude cancelled orders
      const salesAgg = await Order.aggregate([
        {
          $match: {
            branchId: branch._id,
            status: { $ne: "cancelled" },
            paymentStatus: "paid",
            createdAt: {
              $gte: actualStart,
              $lte: end,
            },
          },
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: "$total" },
            totalOrders: { $sum: 1 },
          },
        },
      ]);

      const totalSales = salesAgg[0]?.totalSales || 0;
      const totalOrders = salesAgg[0]?.totalOrders || 0;

      // Calculate royalty amount
      const royaltyRate = branch.royaltyRate || 0;
      const royaltyAmount = parseFloat(
        ((totalSales * royaltyRate) / 100).toFixed(2)
      );

      // Calculate advertisement amount
      const advertisementType = branch.advertisementType || "percentage";
      const advertisementRate = branch.advertisementRate || 0;
      let advertisementAmount = 0;

      if (advertisementType === "percentage") {
        advertisementAmount = parseFloat(
          ((totalSales * advertisementRate) / 100).toFixed(2)
        );
      } else {
        // fixed — flat amount regardless of sales
        advertisementAmount = parseFloat(advertisementRate.toFixed(2));
      }

      const totalDue = parseFloat(
        (royaltyAmount + advertisementAmount).toFixed(2)
      );

      // Build period label
      const periodLabel = buildPeriodLabel(
        periodType,
        actualStart,
        end,
        branchCreated > start
      );

      // Create record
      const record = await RoyaltyRecord.create({
        branchId: branch._id,
        branchName: branch.name,
        branchCode: branch.code,
        branchCreatedAt: branch.createdAt,
        periodType,
        periodLabel,
        startDate: actualStart,
        endDate: end,
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalOrders,
        royaltyRate,
        royaltyAmount,
        advertisementType,
        advertisementRate,
        advertisementAmount,
        totalDue,
        status: "unpaid",
        generatedAt: new Date(),
      });

      results.generated.push({
        branchId: branch._id,
        branchName: branch.name,
        periodLabel,
        totalSales,
        totalDue,
      });
    } catch (err) {
      // Duplicate key error (race condition) — treat as skip
      if (err.code === 11000) {
        results.skipped.push({
          branchId: branch._id,
          branchName: branch.name,
          reason: "Record already exists for this period",
        });
      } else {
        results.errors.push({
          branchId: branch._id,
          branchName: branch.name,
          error: err.message,
        });
      }
    }
  }

  return results;
};

// GET ALL ROYALTY RECORDS
exports.getRoyaltyRecords = async ({ branchId, status, startDate, endDate, page = 1, limit = 50 }) => {
  const filter = {};

  if (branchId) filter.branchId = branchId;
  if (status && status !== "all") filter.status = status;

  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      filter.endDate = { $lte: ed };
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [records, total] = await Promise.all([
    RoyaltyRecord.find(filter)
      .sort({ startDate: -1, branchName: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    RoyaltyRecord.countDocuments(filter),
  ]);

  return { records, total, page: Number(page), limit: Number(limit) };
};

// GET STATS (summary cards)
exports.getRoyaltyStats = async ({ branchId, status, startDate, endDate }) => {
  const filter = {};
  if (branchId) filter.branchId = branchId;
  if (status && status !== "all") filter.status = status;
  if (startDate || endDate) {
    if (startDate) filter.startDate = { ...filter.startDate, $gte: new Date(startDate) };
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      filter.endDate = { ...filter.endDate, $lte: ed };
    }
  }

  const agg = await RoyaltyRecord.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalSales: { $sum: "$totalSales" },
        totalRoyaltyDue: { $sum: "$royaltyAmount" },
        totalAdsDue: { $sum: "$advertisementAmount" },
        totalDue: { $sum: "$totalDue" },
        totalCollected: {
          $sum: {
            $cond: [{ $eq: ["$status", "paid"] }, "$totalDue", 0],
          },
        },
        totalPending: {
          $sum: {
            $cond: [{ $eq: ["$status", "unpaid"] }, "$totalDue", 0],
          },
        },
        paidCount: {
          $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
        },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$status", "unpaid"] }, 1, 0] },
        },
        totalRecords: { $sum: 1 },
      },
    },
  ]);

  return (
    agg[0] || {
      totalSales: 0,
      totalRoyaltyDue: 0,
      totalAdsDue: 0,
      totalDue: 0,
      totalCollected: 0,
      totalPending: 0,
      paidCount: 0,
      unpaidCount: 0,
      totalRecords: 0,
    }
  );
};

// GET RECORD BY ID
exports.getRoyaltyRecordById = async (id) => {
  const record = await RoyaltyRecord.findById(id).lean();
  if (!record) throw new Error("Royalty record not found");
  return record;
};

// GET IN-DEPTH DETAIL (sales + item breakdown for a record's period+branch)
exports.getRoyaltyRecordDetail = async (id) => {
  const record = await RoyaltyRecord.findById(id).lean();
  if (!record) throw new Error("Royalty record not found");

  // Item-wise sales breakdown
  const itemAgg = await Order.aggregate([
    {
      $match: {
        branchId: record.branchId,
        status: { $ne: "cancelled" },
        paymentStatus: "paid",
        createdAt: {
          $gte: new Date(record.startDate),
          $lte: new Date(record.endDate),
        },
      },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.name",
        totalQuantity: { $sum: "$items.quantity" },
        totalRevenue: { $sum: "$items.totalPrice" },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 50 },
    {
      $project: {
        _id: 0,
        name: "$_id",
        totalQuantity: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
      },
    },
  ]);

  // Order type breakdown
  const orderTypeAgg = await Order.aggregate([
    {
      $match: {
        branchId: record.branchId,
        status: { $ne: "cancelled" },
        paymentStatus: "paid",
        createdAt: {
          $gte: new Date(record.startDate),
          $lte: new Date(record.endDate),
        },
      },
    },
    {
      $group: {
        _id: "$orderType",
        count: { $sum: 1 },
        revenue: { $sum: "$total" },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  return {
    record,
    itemBreakdown: itemAgg,
    orderTypeBreakdown: orderTypeAgg,
  };
};

// MARK PAID / UNPAID
exports.updateRoyaltyStatus = async (id, { status, paidAt, paidNote }) => {
  const record = await RoyaltyRecord.findById(id);
  if (!record) throw new Error("Royalty record not found");

  if (!["paid", "unpaid"].includes(status)) {
    throw new Error("Status must be 'paid' or 'unpaid'");
  }

  record.status = status;

  if (status === "paid") {
    record.paidAt = paidAt ? new Date(paidAt) : new Date();
    record.paidNote = paidNote || "";
  } else {
    // Marking unpaid — clear payment info
    record.paidAt = null;
    record.paidNote = "";
  }

  await record.save();
  return record;
};


// DELETE RECORD
exports.deleteRoyaltyRecord = async (id) => {
  const record = await RoyaltyRecord.findByIdAndDelete(id);
  if (!record) throw new Error("Royalty record not found");
  return record;
};

// HELPER — period label
function buildPeriodLabel(periodType, actualStart, end, wasAdjusted) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  if (periodType === "monthly" && !wasAdjusted) {
    // Full month — e.g. "October 2026"
    return `${monthNames[actualStart.getMonth()]} ${actualStart.getFullYear()}`;
  }

  // Partial or custom — e.g. "Oct 13 – Oct 31, 2026"
  const fmt = (d) =>
    `${monthNames[d.getMonth()].slice(0, 3)} ${d.getDate()}`;

  return `${fmt(actualStart)} – ${fmt(end)}, ${end.getFullYear()}`;
}
