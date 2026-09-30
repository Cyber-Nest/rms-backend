const royaltyRoutes = require("./routes/royalty.routes");

exports.initRoyaltyModule = (app) => {
  app.use("/api", royaltyRoutes);
};
