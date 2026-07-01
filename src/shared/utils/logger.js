const winston = require("winston");

const transports = [
  new winston.transports.Console({
    format:
      process.env.NODE_ENV === "production"
        ? winston.format.json()
        : winston.format.simple(),
  }),
];

if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
  transports.push(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
    })
  );
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports,
});

module.exports = logger;
