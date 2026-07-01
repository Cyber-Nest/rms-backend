const expenseService = require('../services/expense.service');

exports.createExpense = async (req, res) => {
  try {
    const expense = await expenseService.createExpense(req.body);
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
    const expenses = await expenseService.getExpenses(req.query);
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
