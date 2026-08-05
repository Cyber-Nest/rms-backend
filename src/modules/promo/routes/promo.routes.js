const express = require('express');
const router = express.Router();
const promoController = require('../controllers/promo.controller');

// Public / Checkout Validation
router.post('/validate', promoController.validatePromo);

// Admin CRUD
router.post('/', promoController.createPromo);
router.get('/', promoController.getAllPromos);
router.get('/:id', promoController.getPromoById);
router.patch('/:id', promoController.updatePromo);
router.patch('/:id/toggle-status', promoController.toggleStatus);
router.delete('/:id', promoController.deletePromo);

module.exports = router;
