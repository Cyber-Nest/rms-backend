const expenseService = require('../services/expense.service');

const getBranchIdFromReq = (req) => {
  return (
    req.query.branchId ||
    req.body.branchId ||
    req.headers["x-branch-id"] ||
    req.headers["branchid"] ||
    req.headers["x-branchid"] ||
    req.activeBranchId ||
    req.branch?.branchId ||
    req.branch?._id
  );
};

exports.createExpense = async (req, res) => {
  try {
    const branchId = getBranchIdFromReq(req);
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
    const branchId = getBranchIdFromReq(req);
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
