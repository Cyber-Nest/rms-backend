const paymentRoutes  = require("./routes/payment.routes");
const terminalRoutes = require("./routes/terminal.routes");

exports.initPaymentModule = (app) => {
  app.use("/api/payments",  paymentRoutes);
  app.use("/api/terminals", terminalRoutes);
};

