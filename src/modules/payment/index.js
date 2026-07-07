const paymentRoutes = require("./routes/payment.routes");

exports.initPaymentModule = (app) => {
  app.use("/api/payments", paymentRoutes);
};
