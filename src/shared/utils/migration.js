const Product = require('../../modules/menu/models/product.model');
const logger = require('./logger');

const runProductMigration = async () => {
  try {
    // Find all products
    const products = await Product.find({});
    logger.info(`Migration: Found ${products.length} products to check.`);

    const existingIds = [];
    const productsToUpdate = [];

    // Separate products that already have a valid MXXXX productId from those that don't
    for (const product of products) {
      if (product.productId && /^M\d+$/.test(product.productId)) {
        const num = parseInt(product.productId.substring(1), 10);
        existingIds.push(num);
      } else {
        productsToUpdate.push(product);
      }
    }

    // Determine the starting sequential number
    let nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 2000;

    let updatedCount = 0;
    // Process products that need a new productId
    for (const product of productsToUpdate) {
      product.productId = `M${nextNum}`;
      nextNum++;
      if (product.isActive === undefined || product.isActive === null) {
        product.isActive = true;
      }
      await product.save();
      updatedCount++;
    }

    // Double check if any product already has productId but isActive is missing/null/undefined
    for (const product of products) {
      if (product.productId && /^M\d+$/.test(product.productId)) {
        if (product.isActive === undefined || product.isActive === null) {
          product.isActive = true;
          await product.save();
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      logger.info(`Migration: Updated ${updatedCount} products with product IDs / active status.`);
    } else {
      logger.info('Migration: All products already have product IDs and active status.');
    }
  } catch (error) {
    logger.error(`Migration Error in runProductMigration: ${error.message}`);
  }
};

module.exports = {
  runProductMigration
};
