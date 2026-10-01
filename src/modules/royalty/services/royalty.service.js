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
// HELPER — generate monthly chunks for date ranges
function generateChunks(startDate, endDate, periodType) {
  if (periodType === "monthly") {
    return [{ start: startDate, end: endDate, isMonthly: true }];
  }

  const chunks = [];
  let currentStart = new Date(startDate);
  currentStart.setHours(0, 0, 0, 0);

  const finalEnd = new Date(endDate);
  finalEnd.setHours(23, 59, 59, 999);

  while (currentStart <= finalEnd) {
    const year = currentStart.getFullYear();
    const month = currentStart.getMonth();

    const firstOfNextMonth = new Date(year, month + 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const chunkEnd = endOfMonth < finalEnd ? endOfMonth : new Date(finalEnd);

    const isFirstDay = currentStart.getDate() === 1;
    const isLastDay = chunkEnd.getTime() === endOfMonth.getTime();
    const isMonthly = isFirstDay && isLastDay;

    chunks.push({
      start: new Date(currentStart),
      end: new Date(chunkEnd),
      isMonthly,
    });

    currentStart = firstOfNextMonth;
  }

  return chunks;
}

exports.generateRoyaltyRecords = async ({
  periodType,
  periodStart,
  periodEnd,
  branchIds = null, // null = all active branches
  includeTax = false,
}) => {
  const start = new Date(periodStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
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

  const chunks = generateChunks(start, end, periodType);

  for (const branch of branches) {
    let branchCreated = branch.createdAt ? new Date(branch.createdAt) : null;
    if (branchCreated) {
      branchCreated.setHours(0, 0, 0, 0);
    }

    for (const chunk of chunks) {
      try {
        let actualStart = chunk.start;
        if (branchCreated && branchCreated > chunk.start) {
          actualStart = branchCreated;
        }
        const chunkEnd = chunk.end;

        // If branch was created AFTER the period chunk end → skip
        if (actualStart > chunkEnd) {
          results.skipped.push({
            branchId: branch._id,
            branchName: branch.name,
            reason: `Branch created after this period (${branchCreated ? branchCreated.toISOString().slice(0, 10) : ""})`,
          });
          continue;
        }

        // Find existing records overlapping with this chunk
        const existingRecords = await RoyaltyRecord.find({
          branchId: branch._id,
          startDate: { $lte: chunkEnd },
          endDate: { $gte: actualStart },
        }).lean();

        // Check if an EXACT or broader record already covers this entire range
        const exactMatch = existingRecords.find(
          (r) =>
            new Date(r.startDate) <= new Date(actualStart) &&
            new Date(r.endDate) >= new Date(chunkEnd)
        );

        if (exactMatch) {
          const statusText = exactMatch.status === "paid" ? "is PAID" : "already exists";
          results.skipped.push({
            branchId: branch._id,
            branchName: branch.name,
            reason: `Record for ${exactMatch.periodLabel} ${statusText}`,
          });
          continue;
        }

        // Build list of date ranges to exclude from order aggregation (partial paid/generated periods)
        const excludeRanges = existingRecords.map((r) => ({
          start: new Date(r.startDate),
          end: new Date(r.endDate),
        }));

        // Build date filter matching Sales Summary report logic
        const startStr = actualStart.toISOString().slice(0, 10);
        const endStr = chunkEnd.toISOString().slice(0, 10);

        // Prepare Order Match Filter: ONLY PAID, NON-CANCELLED ORDERS
        const matchFilter = {
          $and: [
            {
              $or: [
                { branchId: branch._id },
                { branchId: String(branch._id) },
              ],
            },
            { status: { $nin: ["cancelled", "CANCELLED"] } },
            { paymentStatus: { $in: ["paid", "PAID"] } },
            {
              $or: [
                { createdAt: { $gte: actualStart, $lte: chunkEnd } },
                { businessDate: { $gte: startStr, $lte: endStr } },
              ],
            },
          ],
        };

        // Exclude orders from already billed/paid date ranges
        if (excludeRanges.length > 0) {
          matchFilter.$nor = excludeRanges.map((r) => ({
            createdAt: {
              $gte: r.start,
              $lte: r.end,
            },
          }));
        }

        // Exclude cancelled orders
        const salesAgg = await Order.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: null,
              grossSubtotal: { $sum: "$subtotal" },
              grossDiscount: { $sum: "$discount" },
              grossTax: { $sum: "$tax" },
              totalOrders: { $sum: 1 },
            },
          },
        ]);

        // Helper for accurate 2-decimal currency rounding
        const round2 = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;

        const grossSubtotal = round2(salesAgg[0]?.grossSubtotal || 0);
        const grossDiscount = round2(salesAgg[0]?.grossDiscount || 0);
        const grossTax = round2(salesAgg[0]?.grossTax || 0);
        const totalOrders = salesAgg[0]?.totalOrders || 0;

        const netTotal = round2(Math.max(0, grossSubtotal - grossDiscount));
        const totalSales = round2(includeTax ? netTotal + grossTax : netTotal);

        // Calculate royalty amount
        const royaltyRate = branch.royaltyRate || 0;
        const royaltyAmount = round2((totalSales * royaltyRate) / 100);

        // Calculate advertisement amount
        const advertisementType = branch.advertisementType || "percentage";
        const advertisementRate = branch.advertisementRate || 0;
        let advertisementAmount = 0;

        if (advertisementType === "percentage") {
          advertisementAmount = round2((totalSales * advertisementRate) / 100);
        } else {
          advertisementAmount = round2(advertisementRate);
        }

        const totalDue = round2(royaltyAmount + advertisementAmount);

        // Build period label
        const chunkPeriodType = chunk.isMonthly ? "monthly" : "custom";
        let periodLabel = buildPeriodLabel(
          chunkPeriodType,
          actualStart,
          chunkEnd,
          branchCreated > chunk.start
        );

        if (excludeRanges.length > 0) {
          periodLabel += " (Excl. Billed Dates)";
        }

        // Create record
        const record = await RoyaltyRecord.create({
          branchId: branch._id,
          branchName: branch.name,
          branchCode: branch.code,
          branchCreatedAt: branch.createdAt,
          periodType: chunkPeriodType,
          periodLabel,
          startDate: actualStart,
          endDate: chunkEnd,
          totalSales,
          subtotal: grossSubtotal,
          discount: grossDiscount,
          netTotal,
          tax: grossTax,
          includeTax: Boolean(includeTax),
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
  }

  return results;
};

// GET ALL ROYALTY RECORDS
exports.getRoyaltyRecords = async ({ branchId, status, startDate, endDate, page = 1, limit = 50 }) => {
  const filter = {};

  if (branchId) filter.branchId = branchId;
  if (status && status !== "all") filter.status = status;

  if (startDate || endDate) {
    const dateConds = [];
    if (startDate) {
      const st = new Date(startDate);
      st.setHours(0, 0, 0, 0);
      dateConds.push({ endDate: { $gte: st } });
    }
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      dateConds.push({ startDate: { $lte: ed } });
    }
    if (dateConds.length > 0) {
      filter.$and = dateConds;
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
    const dateConds = [];
    if (startDate) {
      const st = new Date(startDate);
      st.setHours(0, 0, 0, 0);
      dateConds.push({ endDate: { $gte: st } });
    }
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      dateConds.push({ startDate: { $lte: ed } });
    }
    if (dateConds.length > 0) {
      filter.$and = dateConds;
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

  const r = agg[0] || {};
  const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

  return {
    totalSales: round2(r.totalSales),
    totalRoyaltyDue: round2(r.totalRoyaltyDue),
    totalAdsDue: round2(r.totalAdsDue),
    totalDue: round2(r.totalDue),
    totalCollected: round2(r.totalCollected),
    totalPending: round2(r.totalPending),
    paidCount: r.paidCount || 0,
    unpaidCount: r.unpaidCount || 0,
    totalRecords: r.totalRecords || 0,
  };
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
  const startD = new Date(record.startDate);
  const endD = new Date(record.endDate);
  const startStr = startD.toISOString().slice(0, 10);
  const endStr = endD.toISOString().slice(0, 10);

  const detailMatch = {
    $and: [
      {
        $or: [
          { branchId: record.branchId },
          { branchId: String(record.branchId) },
        ],
      },
      { status: { $ne: "cancelled" } },
      {
        $or: [
          { createdAt: { $gte: startD, $lte: endD } },
          { businessDate: { $gte: startStr, $lte: endStr } },
        ],
      },
    ],
  };

  const itemAgg = await Order.aggregate([
    { $match: detailMatch },
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
    { $match: detailMatch },
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
