/**
 * Migration Script: Update Driver Model Index
 *
 * Drops the old global unique index on `driverId` and creates
 * a compound unique index on `(restaurantId, driverId)`.
 *
 
 */

require("dotenv").config();
const mongoose = require("mongoose");
const chalk = require("chalk");

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error(chalk.red.bold("ERROR: MONGODB_URI not set in .env"));
  process.exit(1);
}

async function migrate() {
  try {
    console.log(chalk.cyan("Connecting to MongoDB..."));
    await mongoose.connect(MONGODB_URI);
    console.log(chalk.green("Connected successfully."));

    const db = mongoose.connection.db;
    const collection = db.collection("drivers");

    const currentIndexes = await collection.indexes();
    console.log(chalk.cyan("\nCurrent indexes:"));
    currentIndexes.forEach((idx) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} ${idx.unique ? "(UNIQUE)" : ""}`);
    });

    const oldIndex = currentIndexes.find(
      (idx) =>
        idx.key &&
        idx.key.driverId === 1 &&
        Object.keys(idx.key).length === 1 &&
        idx.unique
    );

    if (oldIndex) {
      console.log(chalk.yellow(`\nDropping old global unique index: ${oldIndex.name}`));
      await collection.dropIndex(oldIndex.name);
      console.log(chalk.green("Old index dropped successfully."));
    } else {
      console.log(chalk.gray("\nNo old global unique driverId index found. Skipping drop."));
    }

    //Check for duplicate (restaurantId, driverId) combinations
    const duplicates = await collection
      .aggregate([
        {
          $group: {
            _id: { restaurantId: "$restaurantId", driverId: "$driverId" },
            count: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    if (duplicates.length > 0) {
      console.log(
        chalk.red.bold(
          `\n⚠️  WARNING: Found ${duplicates.length} duplicate (restaurantId, driverId) combinations!`
        )
      );
      duplicates.forEach((dup) => {
        console.log(
          chalk.red(
            `  - restaurantId: ${dup._id.restaurantId}, driverId: ${dup._id.driverId}, count: ${dup.count}, ids: ${dup.ids.join(", ")}`
          )
        );
      });
      console.log(
        chalk.red.bold(
          "Please resolve these duplicates manually before creating the new compound index."
        )
      );
      process.exit(1);
    }

    console.log(chalk.green("\nNo duplicates found. Safe to create compound index."));

    //Create the new compound unique index
    const compoundExists = currentIndexes.find(
      (idx) =>
        idx.key &&
        idx.key.restaurantId === 1 &&
        idx.key.driverId === 1 &&
        idx.unique
    );

    if (compoundExists) {
      console.log(chalk.gray("Compound unique index already exists. Skipping creation."));
    } else {
      console.log(chalk.cyan("Creating new compound unique index: (restaurantId, driverId)..."));
      await collection.createIndex(
        { restaurantId: 1, driverId: 1 },
        { unique: true, name: "restaurantId_1_driverId_1" }
      );
      console.log(chalk.green.bold("Compound unique index created successfully!"));
    }

    //Verify final indexes
    const finalIndexes = await collection.indexes();
    console.log(chalk.cyan("\nFinal indexes:"));
    finalIndexes.forEach((idx) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} ${idx.unique ? "(UNIQUE)" : ""}`);
    });

    console.log(chalk.green.bold("\n✅ Migration completed successfully!"));
  } catch (error) {
    console.error(chalk.red.bold(`Migration failed: ${error.message}`));
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log(chalk.gray("Disconnected from MongoDB."));
  }
}

migrate();
