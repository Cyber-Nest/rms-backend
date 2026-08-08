const mongoose = require("mongoose");
require("dotenv").config();
const Expense = require("../modules/expense/models/expense.model");
const Order = require("../modules/order/models/order.model");

async function runMigration() {
  const dbUri = process.env.MONGODB_URI;
  console.log("Connecting to MongoDB for one-time legacy migration...");
  await mongoose.connect(dbUri);
  console.log("Connected successfully.");

  // 1. Fix Legacy UTC Midnight Expenses
  console.log("Migrating legacy UTC midnight expenses...");
  const legacyExpenses = await Expense.find({
    expenseDate: { $type: "date" },
  }).lean();

  let expMigrated = 0;
  for (const exp of legacyExpenses) {
    const dt = new Date(exp.expenseDate);
    if (
      dt.getUTCHours() === 0 &&
      dt.getUTCMinutes() === 0 &&
      dt.getUTCSeconds() === 0
    ) {
      const updatedDate = new Date(dt.getTime() + 12 * 3600 * 1000);
      await Expense.updateOne(
        { _id: exp._id },
        { $set: { expenseDate: updatedDate } }
      );
      expMigrated++;
    }
  }
  console.log(`Migrated ${expMigrated} legacy expenses.`);

  // 2. Backfill businessDate for existing Orders
  console.log("Backfilling businessDate for existing Orders...");
  const orders = await Order.find({
    $or: [
      { businessDate: { $exists: false } },
      { businessDate: null },
    ],
  }).lean();

  let ordersMigrated = 0;
  for (const order of orders) {
    let bDate;
    if (order.orderTiming === "later" && order.scheduledAt) {
      bDate = new Date(order.scheduledAt);
    } else if (order.createdAt) {
      bDate = new Date(order.createdAt);
    } else {
      bDate = new Date();
    }

    await Order.updateOne(
      { _id: order._id },
      { $set: { businessDate: bDate } }
    );
    ordersMigrated++;
  }
  console.log(`Backfilled businessDate for ${ordersMigrated} existing orders.`);

  await mongoose.disconnect();
  console.log("Migration complete. DB disconnected.");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
