const Category = require('../models/category.model');
const ModifierGroup = require('../models/modifier.model');
const Product = require('../models/product.model');
const cloudinary = require('../../../config/cloudinary.config');
const logger = require('../../../shared/utils/logger');
// Dynamic import to prevent circular dependency
const getOrderService = () => require('../../order/services/order.service');

let cachedPOSMenuFeed = null;
const clearPOSMenuCache = () => {
  cachedPOSMenuFeed = null;
  try {
    getOrderService().clearProductLookupCache();
  } catch (err) {
    logger.warn(`Could not clear product lookup cache: ${err.message}`);
  }
};



exports.getAllCategories = async () => {
  try {
    return await Category.find().sort({ displayOrder: 1 }).lean();
  } catch (error) {
    logger.error(`Menu Service Error: getAllCategories - ${error.message}`);
    throw error;
  }
};

exports.createCategory = async (categoryData) => {
  try {
    const { slug } = categoryData;
    const existing = await Category.findOne({ slug });
    if (existing) {
      throw new Error('Slug already exists.');
    }
    const category = await Category.create(categoryData);
    clearPOSMenuCache();
    return category;
  } catch (error) {
    logger.error(`Menu Service Error: createCategory - ${error.message}`);
    throw error;
  }
};

exports.updateCategory = async (id, categoryData) => {
  try {
    const category = await Category.findByIdAndUpdate(id, categoryData, { returnDocument: 'after', runValidators: true });
    if (!category) {
      throw new Error('Category not found.');
    }
    clearPOSMenuCache();
    return category;
  } catch (error) {
    logger.error(`Menu Service Error: updateCategory - ${error.message}`);
    throw error;
  }
};

exports.deleteCategory = async (id) => {
  try {
    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    clearPOSMenuCache();
    return category;
  } catch (error) {
    logger.error(`Menu Service Error: deleteCategory - ${error.message}`);
    throw error;
  }
};



exports.getAllModifierGroups = async () => {
  try {
    return await ModifierGroup.find().populate('options.modifierGroups').sort({ createdAt: -1 }).lean();
  } catch (error) {
    logger.error(`Menu Service Error: getAllModifierGroups - ${error.message}`);
    throw error;
  }
};

exports.createModifierGroup = async (groupData) => {
  try {
    const group = await ModifierGroup.create(groupData);
    clearPOSMenuCache();
    return group;
  } catch (error) {
    logger.error(`Menu Service Error: createModifierGroup - ${error.message}`);
    throw error;
  }
};

exports.updateModifierGroup = async (id, groupData) => {
  try {
    const group = await ModifierGroup.findByIdAndUpdate(id, groupData, { returnDocument: 'after', runValidators: true });
    if (!group) {
      throw new Error('Modifier group not found.');
    }
    clearPOSMenuCache();
    return group;
  } catch (error) {
    logger.error(`Menu Service Error: updateModifierGroup - ${error.message}`);
    throw error;
  }
};

exports.deleteModifierGroup = async (id) => {
  try {
    const group = await ModifierGroup.findByIdAndDelete(id);
    if (!group) {
      throw new Error('Modifier group not found.');
    }
    clearPOSMenuCache();
    return group;
  } catch (error) {
    logger.error(`Menu Service Error: deleteModifierGroup - ${error.message}`);
    throw error;
  }
};



exports.getAllProducts = async () => {
  try {
    return await Product.find()
      .populate('categoryId')
      .populate({
        path: 'modifierGroups',
        populate: {
          path: 'options.modifierGroups'
        }
      })
      .sort({ name: 1 })
      .lean();
  } catch (error) {
    logger.error(`Menu Service Error: getAllProducts - ${error.message}`);
    throw error;
  }
};

exports.getBranchProductsList = async (branchId) => {
  try {
    const products = await Product.find()
      .select('_id name price image itemType categoryId productId isActive kitchenLabel isOutOfStock disabledBranches outOfStockBranches')
      .populate('categoryId', 'name')
      .sort({ name: 1 });

    if (branchId) {
      const bIdStr = branchId.toString();
      return products.map(p => {
        const pObj = p.toObject();
        const isDisabledForBranch = p.disabledBranches && p.disabledBranches.some(b => b.toString() === bIdStr);
        const isOutOfStockForBranch = p.outOfStockBranches && p.outOfStockBranches.some(b => b.toString() === bIdStr);
        return {
          ...pObj,
          isActive: isDisabledForBranch ? false : p.isActive,
          isOutOfStock: isOutOfStockForBranch ? true : p.isOutOfStock,
        };
      });
    }

    return products;
  } catch (error) {
    logger.error(`Menu Service Error: getBranchProductsList - ${error.message}`);
    throw error;
  }
};

exports.toggleProductActive = async (id, isActive, branchId) => {
  try {
    let updateQuery = {};
    if (branchId) {
      updateQuery = isActive === false
        ? { $addToSet: { disabledBranches: branchId } }
        : { $pull: { disabledBranches: branchId } };
    } else {
      updateQuery = { isActive };
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateQuery,
      { returnDocument: 'after', runValidators: true }
    )
      .select('_id name price image itemType categoryId productId isActive kitchenLabel isOutOfStock disabledBranches outOfStockBranches')
      .populate('categoryId', 'name');
    
    if (!product) {
      throw new Error('Product not found.');
    }
    clearPOSMenuCache();

    if (branchId) {
      const bIdStr = branchId.toString();
      const pObj = product.toObject();
      const isDisabledForBranch = product.disabledBranches && product.disabledBranches.some(b => b.toString() === bIdStr);
      const isOutOfStockForBranch = product.outOfStockBranches && product.outOfStockBranches.some(b => b.toString() === bIdStr);
      return {
        ...pObj,
        isActive: isDisabledForBranch ? false : product.isActive,
        isOutOfStock: isOutOfStockForBranch ? true : product.isOutOfStock,
      };
    }

    return product;
  } catch (error) {
    logger.error(`Menu Service Error: toggleProductActive - ${error.message}`);
    throw error;
  }
};

exports.toggleProductStock = async (id, isOutOfStock, branchId) => {
  try {
    let updateQuery = {};
    if (branchId) {
      updateQuery = isOutOfStock === true
        ? { $addToSet: { outOfStockBranches: branchId } }
        : { $pull: { outOfStockBranches: branchId } };
    } else {
      updateQuery = { isOutOfStock };
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateQuery,
      { returnDocument: 'after', runValidators: true }
    )
      .select('_id name price image itemType categoryId productId isActive kitchenLabel isOutOfStock disabledBranches outOfStockBranches')
      .populate('categoryId', 'name');
    
    if (!product) {
      throw new Error('Product not found.');
    }
    clearPOSMenuCache();

    if (branchId) {
      const bIdStr = branchId.toString();
      const pObj = product.toObject();
      const isDisabledForBranch = product.disabledBranches && product.disabledBranches.some(b => b.toString() === bIdStr);
      const isOutOfStockForBranch = product.outOfStockBranches && product.outOfStockBranches.some(b => b.toString() === bIdStr);
      return {
        ...pObj,
        isActive: isDisabledForBranch ? false : product.isActive,
        isOutOfStock: isOutOfStockForBranch ? true : product.isOutOfStock,
      };
    }

    return product;
  } catch (error) {
    logger.error(`Menu Service Error: toggleProductStock - ${error.message}`);
    throw error;
  }
};

exports.createProduct = async (productData) => {
  try {
    const product = await Product.create(productData);
    clearPOSMenuCache();
    return await Product.findById(product._id)
      .populate('categoryId')
      .populate({
        path: 'modifierGroups',
        populate: {
          path: 'options.modifierGroups'
        }
      });
  } catch (error) {
    logger.error(`Menu Service Error: createProduct - ${error.message}`);
    throw error;
  }
};

exports.updateProduct = async (id, productData) => {
  try {
    const product = await Product.findByIdAndUpdate(id, productData, { returnDocument: 'after', runValidators: true })
      .populate('categoryId')
      .populate({
        path: 'modifierGroups',
        populate: {
          path: 'options.modifierGroups'
        }
      });
    if (!product) {
      throw new Error('Product not found.');
    }
    clearPOSMenuCache();
    return product;
  } catch (error) {
    logger.error(`Menu Service Error: updateProduct - ${error.message}`);
    throw error;
  }
};

exports.deleteProduct = async (id) => {
  try {
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      throw new Error('Product not found.');
    }
    clearPOSMenuCache();
    return product;
  } catch (error) {
    logger.error(`Menu Service Error: deleteProduct - ${error.message}`);
    throw error;
  }
};



exports.toggleCategoryBranchVisibility = async (categoryId, branchId, isHidden) => {
  try {
    const update = isHidden
      ? { $addToSet: { disabledBranches: branchId } }
      : { $pull: { disabledBranches: branchId } };

    const category = await Category.findByIdAndUpdate(categoryId, update, { returnDocument: 'after' });
    if (!category) {
      throw new Error('Category not found.');
    }
    clearPOSMenuCache();
    return category;
  } catch (error) {
    logger.error(`Menu Service Error: toggleCategoryBranchVisibility - ${error.message}`);
    throw error;
  }
};

exports.toggleProductBranchVisibility = async (productId, branchId, isHidden) => {
  try {
    const update = isHidden
      ? { $addToSet: { disabledBranches: branchId } }
      : { $pull: { disabledBranches: branchId } };

    const product = await Product.findByIdAndUpdate(productId, update, { returnDocument: 'after' });
    if (!product) {
      throw new Error('Product not found.');
    }
    clearPOSMenuCache();
    return product;
  } catch (error) {
    logger.error(`Menu Service Error: toggleProductBranchVisibility - ${error.message}`);
    throw error;
  }
};

exports.getPOSMenuFeed = async (branchId = null) => {
  try {
    if (cachedPOSMenuFeed && !branchId) {
      return cachedPOSMenuFeed;
    }

    const categoryFilter = { isActive: true };
    if (branchId) {
      categoryFilter.disabledBranches = { $ne: branchId };
    }

    const categories = await Category.find(categoryFilter).sort({ displayOrder: 1 }).lean();
    const activeCategoryIds = categories.map(cat => cat._id);

    const productFilter = { isActive: true, categoryId: { $in: activeCategoryIds } };
    if (branchId) {
      productFilter.disabledBranches = { $ne: branchId };
    }

    const products = await Product.find(productFilter)
      .populate({
        path: 'modifierGroups',
        populate: {
          path: 'options.modifierGroups'
        }
      })
      .lean();
    
    const bIdStr = branchId ? branchId.toString() : null;

    const feed = {
      categories: categories.map(cat => ({
        id: cat._id.toHexString(),
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image: cat.image,
        disabledBranches: cat.disabledBranches || [],
      })),
      menuItems: products.map(prod => {
        const isOutOfStockForBranch = bIdStr && prod.outOfStockBranches
          ? prod.outOfStockBranches.some(b => b.toString() === bIdStr) || prod.isOutOfStock
          : prod.isOutOfStock;

        return {
          id: prod._id.toHexString(),
          productId: prod.productId || "",
          categoryId: prod.categoryId.toString(),
          name: prod.name,
          description: prod.description,
          image: prod.image,
          price: prod.price,
          badge: prod.badge,
          isPopular: prod.isPopular,
          kitchenLabel: prod.kitchenLabel || 'chicken',
          itemType: prod.itemType,
          isOutOfStock: !!isOutOfStockForBranch,
          disabledBranches: prod.disabledBranches || [],
          outOfStockBranches: prod.outOfStockBranches || [],
        modifierGroups: prod.modifierGroups.map(g => ({
          id: g._id.toHexString(),
          name: g.name,
          required: g.required,
          minSelection: g.minSelection,
          maxSelection: g.maxSelection,
          displayType: g.displayType,
          options: g.options.map(opt => ({
            id: opt._id.toHexString(),
            name: opt.name,
            image: opt.image,
            price: opt.price,
            isDefault: opt.isDefault,
            modifierGroups: opt.modifierGroups ? opt.modifierGroups.map(subG => ({
              id: subG._id.toHexString(),
              name: subG.name,
              required: subG.required,
              minSelection: subG.minSelection,
              maxSelection: subG.maxSelection,
              displayType: subG.displayType,
              options: subG.options.map(subOpt => ({
                id: subOpt._id.toHexString(),
                name: subOpt.name,
                image: subOpt.image,
                price: subOpt.price,
                isDefault: subOpt.isDefault
              }))
            })) : []
          }))
        }))
        };
      })
    };

    if (!branchId) {
      cachedPOSMenuFeed = feed;
    }
    return feed;
  } catch (error) {
    logger.error(`Menu Service Error: getPOSMenuFeed - ${error.message}`);
    throw error;
  }
};



exports.uploadImageToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'rms-menu',
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload service error:', error);
          return reject(new Error('Cloudinary upload failed.'));
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    uploadStream.end(fileBuffer);
  });
};


const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split('/image/upload/');
    if (parts.length < 2) return null;
    const pathAfterUpload = parts[1];
    
    const segments = pathAfterUpload.split('/');
    if (segments[0].startsWith('v') && /^\d+$/.test(segments[0].substring(1))) {
      segments.shift();
    }
    
    const fullPath = segments.join('/');
    const dotIndex = fullPath.lastIndexOf('.');
    if (dotIndex !== -1) {
      return fullPath.substring(0, dotIndex);
    }
    return fullPath;
  } catch (e) {
    logger.error('Error parsing public ID from URL:', e);
    return null;
  }
};

exports.deleteImageFromCloudinary = async (imageUrl) => {
  try {
    const publicId = getPublicIdFromUrl(imageUrl);
    if (!publicId) {
      throw new Error('Invalid Cloudinary URL.');
    }

    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    logger.error(`Cloudinary destroy service error: ${error.message}`);
    throw error;
  }
};
