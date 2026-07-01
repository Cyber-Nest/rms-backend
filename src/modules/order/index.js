const orderRoutes = require('./routes/order.routes');

exports.initOrderModule = (app) => {
  app.use('/api/orders', orderRoutes);
};
