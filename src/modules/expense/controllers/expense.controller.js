const expenseService = require('../services/expense.service');

exports.createExpense = async (req, res) => {
  try {
    const branchId = req.activeBranchId || req.body.branchId || req.branch?.branchId || req.branch?._id;
    const expenseData = { ...req.body, ...(branchId ? { branchId } : {}) };
    const expense = await expenseService.createExpense(expenseData);
    return res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: expense
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const branchId = req.activeBranchId || req.query.branchId || req.branch?.branchId || req.branch?._id;
    const filters = { ...req.query, ...(branchId ? { branchId } : {}) };
    const expenses = await expenseService.getExpenses(filters);
    return res.status(200).json({
      success: true,
      data: expenses
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};
