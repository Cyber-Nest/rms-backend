const expenseRoutes = require('./routes/expense.routes');
const logger = require('../../shared/utils/logger');

exports.initExpenseModule = (app) => {
  app.use('/api/expenses', expenseRoutes);
  logger.info('Expense module initialized successfully');
};
