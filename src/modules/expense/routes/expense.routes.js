const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense.controller');
const protectBranch = require('../../../shared/middleware/protectBranch');
const enforceBranch = require('../../../shared/middleware/enforceBranch');

router.post('/', protectBranch, enforceBranch, expenseController.createExpense);
router.get('/', protectBranch, enforceBranch, expenseController.getExpenses);

module.exports = router;
