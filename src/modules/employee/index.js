const employeeRoutes = require("./routes/employee.routes");

exports.initEmployeeModule = (app) => {
  app.use("/api", employeeRoutes);
};
