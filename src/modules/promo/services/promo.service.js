const Promo = require('../models/promo.model');
const logger = require('../../../shared/utils/logger');

exports.validatePromo = async ({ code, channel = 'both', branchId = null, subtotal = 0, items = [], applyCount = 1 }) => {
  try {
    if (!code) throw new Error('Promo code is required.');

    const cleanCode = String(code).toUpperCase().trim();
    const validApplyCount = Math.max(1, Math.floor(Number(applyCount) || 1));

    const promo = await Promo.findOne({ code: cleanCode, isActive: true })
      .select(
        'code description discountType discountValue minOrderAmount maxDiscount applicableChannel applicableScope categoryIds applicableBranchScope branchIds usageLimit usedCount startDate expiresAt isActive'
      )
      .lean();

    if (!promo) {
      throw new Error('Invalid or inactive promo code.');
    }

    // Channel check
    if (promo.applicableChannel !== 'both' && promo.applicableChannel !== channel) {
      const channelLabel =
        promo.applicableChannel === 'online'
          ? 'Online Website orders'
          : 'POS System orders';
      throw new Error(`This promo code is only valid for ${channelLabel}.`);
    }

    //Branch Scope check
    if (
      promo.applicableBranchScope === 'specific_branches' &&
      Array.isArray(promo.branchIds) &&
      promo.branchIds.length > 0
    ) {
      if (branchId) {
        const isBranchAllowed = promo.branchIds.some(
          (b) => String(b).toLowerCase() === String(branchId).toLowerCase()
        );
        if (!isBranchAllowed) {
          throw new Error('This promo code is not valid for this branch location.');
        }
      }
    }

    //Date Range check
    const now = new Date();
    if (promo.startDate && now < new Date(promo.startDate)) {
      throw new Error('This promo code is not active yet.');
    }
    if (promo.expiresAt && now > new Date(promo.expiresAt)) {
      throw new Error('This promo code has expired.');
    }

    //Usage Limit check
    if (promo.usageLimit !== null) {
      if (promo.usedCount >= promo.usageLimit) {
        throw new Error('This promo code has reached its maximum usage limit.');
      }
      if (promo.usedCount + validApplyCount > promo.usageLimit) {
        const remaining = promo.usageLimit - promo.usedCount;
        throw new Error(
          `Only ${remaining} usage(s) remaining for this promo code.`
        );
      }
    }

    //Category-based Cart Subtotal Calculation
    let eligibleSubtotal = Number(subtotal) || 0;

    if (
      promo.applicableScope === 'specific_categories' &&
      Array.isArray(promo.categoryIds) &&
      promo.categoryIds.length > 0
    ) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('This promo requires specific items in cart.');
      }

      let matchedAmount = 0;
      for (const item of items) {
        const itemCatId = String(item.categoryId || '').toLowerCase().trim();
        const itemCatName = String(item.categoryName || item.category || '').toLowerCase().trim();
        const itemName = String(item.name || '').toLowerCase().trim();

        //Direct payload match (category ID, category name, or item name)
        let isEligible = promo.categoryIds.some((cat) => {
          const cStr = String(cat).toLowerCase().trim();
          if (!cStr) return false;
          return (
            (itemCatId && (itemCatId === cStr || itemCatId.includes(cStr) || cStr.includes(itemCatId))) ||
            (itemCatName && (itemCatName === cStr || itemCatName.includes(cStr) || cStr.includes(itemCatName))) ||
            (itemName && itemName.includes(cStr))
          );
        });

        if (!isEligible && (item.menuItemId || item.id)) {
          try {
            const menuItemId = item.menuItemId || item.id;
            const MenuItem = require('../../menu/models/menuItem.model');
            const Category = require('../../menu/models/category.model');
            const dbItem = await MenuItem.findById(menuItemId).select('categoryId').lean();
            if (dbItem && dbItem.categoryId) {
              const dbCat = await Category.findById(dbItem.categoryId).select('name').lean();
              const dbCatIdStr = String(dbItem.categoryId).toLowerCase().trim();
              const dbCatNameStr = dbCat?.name ? String(dbCat.name).toLowerCase().trim() : '';

              isEligible = promo.categoryIds.some((cat) => {
                const cStr = String(cat).toLowerCase().trim();
                return (
                  cStr === dbCatIdStr ||
                  (dbCatNameStr && (dbCatNameStr === cStr || dbCatNameStr.includes(cStr) || cStr.includes(dbCatNameStr)))
                );
              });
            }
          } catch (e) {
          }
        }

        if (isEligible) {
          const itemTotal =
            Number(item.totalPrice) ||
            Number(item.basePrice || 0) * Number(item.quantity || 1);
          matchedAmount += itemTotal;
        }
      }

      if (matchedAmount <= 0) {
        throw new Error(
          'This promo code is not applicable to any items in your cart.'
        );
      }
      eligibleSubtotal = matchedAmount;
    }

    //Min Order Amount check
    if (eligibleSubtotal < (promo.minOrderAmount || 0)) {
      throw new Error(
        `Minimum order amount of $${promo.minOrderAmount.toFixed(
          2
        )} required for this promo.`
      );
    }

    // Calculate final discount with applyCount multiplier
    let singleDiscount = 0;
    if (promo.discountType === 'percentage') {
      singleDiscount = (eligibleSubtotal * promo.discountValue) / 100;
      if (promo.maxDiscount !== null && promo.maxDiscount > 0) {
        singleDiscount = Math.min(singleDiscount, promo.maxDiscount);
      }
    } else {
      singleDiscount = Math.min(promo.discountValue, eligibleSubtotal);
    }

    let discountAmount = Math.min(singleDiscount * validApplyCount, eligibleSubtotal);
    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
      code: promo.code,
      description: promo.description,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      applyCount: validApplyCount,
      discountAmount,
      eligibleSubtotal: Math.round(eligibleSubtotal * 100) / 100,
    };
  } catch (error) {
    logger.error(`Promo Service Error: validatePromo - ${error.message}`);
    throw error;
  }
};

// Increment Usage on Order Place
exports.incrementUsage = async (code, count = 1) => {
  if (!code) return;
  const validCount = Math.max(1, Math.floor(Number(count) || 1));
  try {
    await Promo.findOneAndUpdate(
      { code: String(code).toUpperCase().trim() },
      { $inc: { usedCount: validCount } }
    );
  } catch (err) {
    logger.error(`Error incrementing promo usage for ${code} (count: ${validCount}): ${err.message}`);
  }
};

// CRUD Methods for Super Admin
exports.createPromo = async (data) => {
  try {
    const cleanCode = String(data.code || '')
      .toUpperCase()
      .trim();
    if (!cleanCode) throw new Error('Promo code string is required.');

    const exists = await Promo.findOne({ code: cleanCode })
      .select('_id')
      .lean();
    if (exists) throw new Error(`Promo code '${cleanCode}' already exists.`);

    const promo = new Promo({
      ...data,
      code: cleanCode,
    });
    await promo.save();
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: createPromo - ${error.message}`);
    throw error;
  }
};

exports.getAllPromos = async ({
  search = '',
  channel = '',
  status = '',
  branchId = '',
  fields = '',
  page = 1,
  limit = 50,
} = {}) => {
  try {
    const query = {};
    if (search.trim()) {
      query.$or = [
        { code: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
      ];
    }
    if (channel && channel !== 'all') {
      query.applicableChannel = { $in: [channel, 'both'] };
    }
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    if (branchId) {
      query.$or = [
        { applicableBranchScope: 'all_branches' },
        { applicableBranchScope: 'specific_branches', branchIds: branchId },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const selectProjection = fields ? fields.split(',').join(' ') : null;

    let dbQuery = Promo.find(query).sort({ createdAt: -1 });
    if (selectProjection) {
      dbQuery = dbQuery.select(selectProjection);
    }

    const [promos, total] = await Promise.all([
      dbQuery.skip(skip).limit(Number(limit)).lean(),
      Promo.countDocuments(query),
    ]);

    return {
      promos,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    };
  } catch (error) {
    logger.error(`Promo Service Error: getAllPromos - ${error.message}`);
    throw error;
  }
};

exports.getPromoById = async (id) => {
  try {
    const promo = await Promo.findById(id).lean();
    if (!promo) throw new Error('Promo code not found.');
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: getPromoById - ${error.message}`);
    throw error;
  }
};

exports.updatePromo = async (id, data) => {
  try {
    if (data.code) {
      data.code = String(data.code).toUpperCase().trim();
    }
    const promo = await Promo.findByIdAndUpdate(id, data, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!promo) throw new Error('Promo code not found.');
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: updatePromo - ${error.message}`);
    throw error;
  }
};

exports.toggleStatus = async (id) => {
  try {
    const promo = await Promo.findById(id);
    if (!promo) throw new Error('Promo code not found.');
    promo.isActive = !promo.isActive;
    await promo.save();
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: toggleStatus - ${error.message}`);
    throw error;
  }
};

exports.deletePromo = async (id) => {
  try {
    const promo = await Promo.findByIdAndDelete(id);
    if (!promo) throw new Error('Promo code not found.');
    return promo;
  } catch (error) {
    logger.error(`Promo Service Error: deletePromo - ${error.message}`);
    throw error;
  }
};
