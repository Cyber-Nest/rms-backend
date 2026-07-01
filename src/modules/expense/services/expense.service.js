const Expense = require('../models/expense.model');
const logger = require('../../../shared/utils/logger');

exports.createExpense = async (expenseData) => {
  try {
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
    if (filters.date) {
      const dateStr = String(filters.date).split('T')[0];
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const start = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0));
        const end = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999));
        query.expenseDate = { $gte: start, $lte: end };
      }
    }
    if (filters.employeeName) {
      query.employeeName = { $regex: filters.employeeName, $options: 'i' };
    }
    if (filters.search) {
      query.$or = [
        { category: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
        { employeeName: { $regex: filters.search, $options: 'i' } }
      ];
    }

    const expenses = await Expense.find(query).sort({ expenseDate: -1 }).lean();
    return expenses;
  } catch (error) {
    logger.error(`Error in getExpenses: ${error.message}`);
    throw error;
  }
};
