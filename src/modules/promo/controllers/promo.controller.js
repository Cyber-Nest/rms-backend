const promoService = require('../services/promo.service');
const logger = require('../../../shared/utils/logger');

const handleError = (res, error, status = 400) => {
  logger.error(`Promo Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};

// POST /api/promos/validate
exports.validatePromo = async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Promo code is required.' });
    if (subtotal === undefined) return res.status(400).json({ success: false, message: 'Subtotal is required.' });

    const result = await promoService.validatePromo(code, Number(subtotal));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// POST /api/promos  (Admin)
exports.createPromo = async (req, res) => {
  try {
    const promo = await promoService.createPromo(req.body);
    res.status(201).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// GET /api/promos  (Admin)
exports.getAllPromos = async (req, res) => {
  try {
    const promos = await promoService.getAllPromos();
    res.status(200).json({ success: true, data: promos });
  } catch (error) {
    handleError(res, error, 500);
  }
};

// PATCH /api/promos/:id  (Admin)
exports.updatePromo = async (req, res) => {
  try {
    const promo = await promoService.updatePromo(req.params.id, req.body);
    res.status(200).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 400);
  }
};

// DELETE /api/promos/:id  (Admin)
exports.deletePromo = async (req, res) => {
  try {
    await promoService.deletePromo(req.params.id);
    res.status(200).json({ success: true, message: 'Promo deleted successfully.' });
  } catch (error) {
    handleError(res, error, 400);
  }
};
