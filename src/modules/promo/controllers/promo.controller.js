const promoService = require('../services/promo.service');
const logger = require('../../../shared/utils/logger');

const handleError = (res, error, status = 400) => {
  logger.error(`Promo Controller Error: ${error.message}`);
  return res.status(status).json({ success: false, message: error.message });
};

exports.validatePromo = async (req, res) => {
  try {
    const { code, channel, branchId, subtotal, items } = req.body || {};
    const result = await promoService.validatePromo({
      code,
      channel: channel || 'both',
      branchId: branchId || null,
      subtotal: Number(subtotal) || 0,
      items: items || [],
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.createPromo = async (req, res) => {
  try {
    const promo = await promoService.createPromo(req.body);
    res.status(201).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.getAllPromos = async (req, res) => {
  try {
    const { search, channel, status, page, limit } = req.query;
    const result = await promoService.getAllPromos({
      search,
      channel,
      status,
      page,
      limit,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.getPromoById = async (req, res) => {
  try {
    const promo = await promoService.getPromoById(req.params.id);
    res.status(200).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 404);
  }
};

exports.updatePromo = async (req, res) => {
  try {
    const promo = await promoService.updatePromo(req.params.id, req.body);
    res.status(200).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    const promo = await promoService.toggleStatus(req.params.id);
    res.status(200).json({ success: true, data: promo });
  } catch (error) {
    handleError(res, error, 400);
  }
};

exports.deletePromo = async (req, res) => {
  try {
    await promoService.deletePromo(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Promo code deleted successfully.',
    });
  } catch (error) {
    handleError(res, error, 400);
  }
};
