const Expense = require("../models/expense.model");
const mongoose = require("mongoose");
const logger = require("../../../shared/utils/logger");
const { DateTime } = require("luxon");
const {
  getLocalStartOfDay,
  getLocalEndOfDay,
  getLocalDateStr,
  TIMEZONE,
} = require("../../../shared/utils/timezone");

exports.createExpense = async (expenseData) => {
  try {
    if (
      expenseData.branchId &&
      mongoose.Types.ObjectId.isValid(expenseData.branchId)
    ) {
      expenseData.branchId = new mongoose.Types.ObjectId(expenseData.branchId);
    }

    if (expenseData.expenseDate) {
      const dateOnlyStr = String(expenseData.expenseDate).split("T")[0];
      const todayLocal = getLocalDateStr();
      if (dateOnlyStr === todayLocal) {
        expenseData.expenseDate = new Date();
      } else {
        expenseData.expenseDate = DateTime.fromISO(dateOnlyStr, { zone: TIMEZONE })
          .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
          .toJSDate();
      }
    } else {
      expenseData.expenseDate = new Date();
    }

    const expense = new Expense(expenseData);
    await expense.save();
    return expense;
  } catch (error) {
    logger.error(`Error in createExpense: ${error.message}`);
    throw error;
  }
};

exports.getExpenses = async (filters = {}) => {
  try {
    const query = {};
    if (filters.branchId) {
      if (mongoose.Types.ObjectId.isValid(filters.branchId)) {
        query.branchId = new mongoose.Types.ObjectId(filters.branchId);
      } else {
        query.branchId = filters.branchId;
      }
    }
    if (filters.date) {
      const dateStr = String(filters.date).split("T")[0];
      const start = getLocalStartOfDay(dateStr);
      const end = getLocalEndOfDay(dateStr);
      query.expenseDate = { $gte: start, $lte: end };
    }
    if (filters.employeeName) {
      query.employeeName = { $regex: filters.employeeName, $options: "i" };
    }
    if (filters.search) {
      query.$or = [
        { category: { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } },
        { employeeName: { $regex: filters.search, $options: "i" } },
      ];
    }

    const expenses = await Expense.find(query).sort({ expenseDate: -1 }).lean();
    return expenses;
  } catch (error) {
    logger.error(`Error in getExpenses: ${error.message}`);
    throw error;
  }
};
