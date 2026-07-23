const branchRoutes = require("./routes/branch.routes");

exports.initCompanyModule = (app) => {
  app.use("/api", branchRoutes);
};
