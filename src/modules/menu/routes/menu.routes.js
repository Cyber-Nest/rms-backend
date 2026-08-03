const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menu.controller');
const { uploadSingleImage } = require('../../../shared/utils/multer');
const protectSuperAdmin = require('../../../shared/middleware/protectSuperAdmin');

// Image Upload with size limit (Super Admin)
router.post('/upload', protectSuperAdmin, uploadSingleImage('image'), menuController.uploadImage);

// Delete Image from Cloudinary (Super Admin)
router.post('/upload/delete', protectSuperAdmin, menuController.deleteImage);

// Public POS & Customer feed
router.get('/pos-feed', menuController.getPOSMenu);

// Category Routes
router.get('/categories', menuController.getCategories);
router.post('/categories', protectSuperAdmin, menuController.createCategory);
router.put('/categories/:id', protectSuperAdmin, menuController.updateCategory);
router.delete('/categories/:id', protectSuperAdmin, menuController.deleteCategory);

// Modifier Group Routes
router.get('/modifiers', menuController.getModifierGroups);
router.post('/modifiers', protectSuperAdmin, menuController.createModifierGroup);
router.put('/modifiers/:id', protectSuperAdmin, menuController.updateModifierGroup);
router.delete('/modifiers/:id', protectSuperAdmin, menuController.deleteModifierGroup);

// Product Routes
router.get('/products/branch-list', menuController.getBranchProductsList);
router.patch('/products/:id/toggle-active', protectSuperAdmin, menuController.toggleProductActive);
router.patch('/products/:id/toggle-stock', protectSuperAdmin, menuController.toggleProductStock);
router.patch('/products/:id/toggle-branch', protectSuperAdmin, menuController.toggleProductBranch);
router.patch('/categories/:id/toggle-branch', protectSuperAdmin, menuController.toggleCategoryBranch);
router.get('/products', menuController.getProducts);
router.post('/products', protectSuperAdmin, menuController.createProduct);
router.put('/products/:id', protectSuperAdmin, menuController.updateProduct);
router.delete('/products/:id', protectSuperAdmin, menuController.deleteProduct);

module.exports = router;
