const menuService = require('../services/menu.service');
const logger = require('../../../shared/utils/logger');

// Unified Error Handler for Controller
const handleError = (res, error, status = 400) => {
  logger.error(`Menu Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};

// category controllers
exports.getCategories = async (req, res) => {
  try {
    const categories = await menuService.getAllCategories();
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.createCategory = async (req, res) => {
  try {
    const category = await menuService.createCategory(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await menuService.updateCategory(id, req.body);
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    await menuService.deleteCategory(id);
    res.status(200).json({ success: true, message: 'Category deleted successfully.' });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// modifier controllers
exports.getModifierGroups = async (req, res) => {
  try {
    const groups = await menuService.getAllModifierGroups();
    res.status(200).json({ success: true, data: groups });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.createModifierGroup = async (req, res) => {
  try {
    const group = await menuService.createModifierGroup(req.body);
    res.status(201).json({ success: true, data: group });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.updateModifierGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await menuService.updateModifierGroup(id, req.body);
    res.status(200).json({ success: true, data: group });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// DELETE MODIFIER GROUP
exports.deleteModifierGroup = async (req, res) => {
  try {
    const { id } = req.params;
    await menuService.deleteModifierGroup(id);
    res.status(200).json({ success: true, message: 'Modifier group deleted successfully.' });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// product menu item controllers
exports.getProducts = async (req, res) => {
  try {
    const products = await menuService.getAllProducts();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.createProduct = async (req, res) => {
  try {
    const product = await menuService.createProduct(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await menuService.updateProduct(id, req.body);
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    await menuService.deleteProduct(id);
    res.status(200).json({ success: true, message: 'Product deleted successfully.' });
  } catch (error) {
    handleError(res, error, 400);
  }
};

//pos public feed controllers
exports.getPOSMenu = async (req, res) => {
  try {
    const feedData = await menuService.getPOSMenuFeed();
    res.status(200).json({ success: true, data: feedData });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// image upload controller
exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const result = await menuService.uploadImageToCloudinary(req.file.buffer);
    res.status(200).json({
      success: true,
      url: result.url,
      public_id: result.public_id,
    });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// DELETE IMAGE FROM CLOUDINARY
exports.deleteImage = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'Image URL is required.' });
    }

    const result = await menuService.deleteImageFromCloudinary(url);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 500);
  }
};
