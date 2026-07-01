const Promo = require('../models/promo.model');
const logger = require('../../../shared/utils/logger');

// ── Validate & Apply Promo Code ───────────────────────────────
exports.validatePromo = async (code, subtotal) => {
  try {
    const promo = await Promo.findOne({ code: code.toUpperCase(), isActive: true });
    if (!promo) throw new Error('Invalid or expired promo code.');

    // Check expiry
    if (promo.expiresAt && new Date() > promo.expiresAt) {
      throw new Error('This promo code has expired.');
    }

    // Check usage limit
    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      throw new Error('This promo code has reached its usage limit.');
    }

    // Check minimum order amount
    if (subtotal < promo.minOrderAmount) {
      throw new Error(
        `Minimum order of $${promo.minOrderAmount.toFixed(2)} required for this promo.`
      );
    }

    // Calculate discount
    let discountAmount = 0;
    if (promo.discountType === 'percentage') {
      discountAmount = (subtotal * promo.discountValue) / 100;
      if (promo.maxDiscount !== null) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
    } else {
      // flat
      discountAmount = Math.min(promo.discountValue, subtotal);
    }

    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
      code: promo.code,
      description: promo.description,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountAmount,
    };
  } catch (error) {
    logger.error(`Promo Service Error: validatePromo - ${error.message}`);
    throw error;
  }
};

// ── Increment Usage Count ─────────────────────────────────────
exports.incrementUsage = async (code) => {
  await Promo.findOneAndUpdate(
    { code: code.toUpperCase() },
    { $inc: { usedCount: 1 } }
  );
};

// ── Admin CRUD ────────────────────────────────────────────────
exports.createPromo = async (data) => {
  try {
    const promo = new Promo(data);
    await promo.save();
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: createPromo - ${error.message}`);
    throw error;
  }
};

exports.getAllPromos = async () => {
  try {
    return await Promo.find().sort({ createdAt: -1 }).lean();
  } catch (error) {
    logger.error(`Promo Service Error: getAllPromos - ${error.message}`);
    throw error;
  }
};

exports.updatePromo = async (id, data) => {
  try {
    const promo = await Promo.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });
    if (!promo) throw new Error('Promo not found.');
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: updatePromo - ${error.message}`);
    throw error;
  }
};

exports.deletePromo = async (id) => {
  try {
    const promo = await Promo.findByIdAndDelete(id);
    if (!promo) throw new Error('Promo not found.');
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: deletePromo - ${error.message}`);
    throw error;
  }
};
