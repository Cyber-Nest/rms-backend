const promoRoutes = require('./routes/promo.routes');

exports.initPromoModule = (app) => {
  app.use('/api/promos', promoRoutes);
};
