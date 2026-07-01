const menuRoutes = require('./routes/menu.routes');

const initMenuModule = (app) => {
  // Register all menu routes under '/api/menu'
  app.use('/api/menu', menuRoutes);
  console.log('[Module: Menu] Registered successfully under /api/menu');
};

module.exports = {
  initMenuModule
};
