const Category = require('../models/category.model');
const ModifierGroup = require('../models/modifier.model');
const Product = require('../models/product.model');
const cloudinary = require('../../../config/cloudinary.config');
const logger = require('../../../shared/utils/logger');

let cachedPOSMenuFeed = null;
const clearPOSMenuCache = () => {
  cachedPOSMenuFeed = null;
};

// category services

exports.getAllCategories = async () => {
  try {
    return await Category.find().sort({ displayOrder: 1 });
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

// modifier services

exports.getAllModifierGroups = async () => {
  try {
    return await ModifierGroup.find().populate('options.modifierGroups').sort({ createdAt: -1 });
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
    const group = await ModifierGroup.deleteModifierGroup || await ModifierGroup.findByIdAndDelete(id);
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

// product services

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
      .sort({ name: 1 });
  } catch (error) {
    logger.error(`Menu Service Error: getAllProducts - ${error.message}`);
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

// pos public feed service

exports.getPOSMenuFeed = async () => {
  try {
    if (cachedPOSMenuFeed) {
      return cachedPOSMenuFeed;
    }

    const categories = await Category.find({ isActive: true }).sort({ displayOrder: 1 });
    const products = await Product.find({ isActive: true })
      .populate({
        path: 'modifierGroups',
        populate: {
          path: 'options.modifierGroups'
        }
      });
    
    const feed = {
      categories: categories.map(cat => ({
        id: cat._id.toHexString(),
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image: cat.image,
      })),
      menuItems: products.map(prod => ({
        id: prod._id.toHexString(),
        categoryId: prod.categoryId.toString(),
        name: prod.name,
        description: prod.description,
        image: prod.image,
        price: prod.price,
        badge: prod.badge,
        isPopular: prod.isPopular,
        itemType: prod.itemType,
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
      }))
    };

    cachedPOSMenuFeed = feed;
    return feed;
  } catch (error) {
    logger.error(`Menu Service Error: getPOSMenuFeed - ${error.message}`);
    throw error;
  }
};

// image upload & deletion services

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

// HELPER TO EXTRACT PUBLIC_ID FROM CLOUDINARY URL
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
