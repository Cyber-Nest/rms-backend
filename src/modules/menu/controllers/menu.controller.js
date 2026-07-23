const menuService = require('../services/menu.service');
const logger = require('../../../shared/utils/logger');


const handleError = (res, error, status = 400) => {
  logger.error(`Menu Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};


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


exports.deleteModifierGroup = async (req, res) => {
  try {
    const { id } = req.params;
    await menuService.deleteModifierGroup(id);
    res.status(200).json({ success: true, message: 'Modifier group deleted successfully.' });
  } catch (error) {
    handleError(res, error, 400);
  }
};


exports.getProducts = async (req, res) => {
  try {
    const products = await menuService.getAllProducts();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.getBranchProductsList = async (req, res) => {
  try {
    const products = await menuService.getBranchProductsList();
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.toggleProductActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive status is required.' });
    }
    const product = await menuService.toggleProductActive(id, isActive);
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.toggleProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { isOutOfStock } = req.body;
    if (isOutOfStock === undefined) {
      return res.status(400).json({ success: false, message: 'isOutOfStock status is required.' });
    }
    const product = await menuService.toggleProductStock(id, isOutOfStock);
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    handleError(res, error, 400);
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


exports.getPOSMenu = async (req, res) => {
  try {
    const { branchId } = req.query;
    const feedData = await menuService.getPOSMenuFeed(branchId || null);
    res.status(200).json({ success: true, data: feedData });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.toggleCategoryBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { branchId, isHidden } = req.body;
    if (!branchId || isHidden === undefined) {
      return res.status(400).json({ success: false, message: 'branchId and isHidden flag are required.' });
    }
    const category = await menuService.toggleCategoryBranchVisibility(id, branchId, isHidden);
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.toggleProductBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { branchId, isHidden } = req.body;
    if (!branchId || isHidden === undefined) {
      return res.status(400).json({ success: false, message: 'branchId and isHidden flag are required.' });
    }
    const product = await menuService.toggleProductBranchVisibility(id, branchId, isHidden);
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    handleError(res, error, 400);
  }
};


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
