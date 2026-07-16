const deliveryRoutes = require("./routes/delivery.routes");

exports.initDeliveryModule = (app) => {
  app.use("/api/delivery", deliveryRoutes);
};
