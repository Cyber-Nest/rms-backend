const express = require('express');
const router = express.Router();
const promoController = require('../controllers/promo.controller');

// Branch POS — validate promo code
router.post('/validate', promoController.validatePromo);

// Admin CRUD
router.post('/',      promoController.createPromo);
router.get('/',       promoController.getAllPromos);
router.patch('/:id',  promoController.updatePromo);
router.delete('/:id', promoController.deletePromo);

module.exports = router;
