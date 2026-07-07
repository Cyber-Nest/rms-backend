const app = require("./app");

const logger = require("./shared/utils/logger");
const chalk = require("chalk");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(
    chalk.cyan.bold(`Server is running on port ${PORT}`)
  );
});
