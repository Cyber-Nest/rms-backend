const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menu.controller');
const { uploadSingleImage } = require('../../../shared/utils/multer');

// Image Upload with size limit 
router.post('/upload', uploadSingleImage('image'), menuController.uploadImage);

// Delete Image from Cloudinary
router.post('/upload/delete', menuController.deleteImage);

// POS Combined feed
router.get('/pos-feed', menuController.getPOSMenu);

// Category Routes
router.get('/categories', menuController.getCategories);
router.post('/categories', menuController.createCategory);
router.put('/categories/:id', menuController.updateCategory);
router.delete('/categories/:id', menuController.deleteCategory);

// Modifier Group Routes
router.get('/modifiers', menuController.getModifierGroups);
router.post('/modifiers', menuController.createModifierGroup);
router.put('/modifiers/:id', menuController.updateModifierGroup);
router.delete('/modifiers/:id', menuController.deleteModifierGroup);

// Product Routes
router.get('/products', menuController.getProducts);
router.post('/products', menuController.createProduct);
router.put('/products/:id', menuController.updateProduct);
router.delete('/products/:id', menuController.deleteProduct);

module.exports = router;
