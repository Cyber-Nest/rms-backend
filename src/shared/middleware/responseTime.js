const logger = require("../utils/logger");
const chalk = require("chalk");

/**
 * Response Time & SLA Monitoring Middleware
 * 
 * Measures HTTP request duration, attaches `X-Response-Time` header,
 * and logs colorized warnings for any endpoint exceeding the 500ms SLA target.
 */
const responseTimeMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();

  const originalWriteHead = res.writeHead;
  res.writeHead = function (...args) {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const roundedMs = Math.round(durationMs * 100) / 100;

    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${roundedMs}ms`);
    }

    if (durationMs > 500) {
      const isExtreme = durationMs > 1500;
      const tag = isExtreme
        ? chalk.bgRed.white.bold(" [SLA-CRITICAL] ")
        : chalk.bgYellow.black.bold(" [SLA-VIOLATION] ");

      const methodStr = chalk.bold(req.method);
      const urlStr = chalk.cyan(req.originalUrl);
      const timeStr = isExtreme
        ? chalk.red.bold(`${roundedMs}ms`)
        : chalk.yellow.bold(`${roundedMs}ms`);

      logger.warn(
        `${tag} ${methodStr} ${urlStr} took ${timeStr} (>500ms target)`
      );
    }

    return originalWriteHead.apply(this, args);
  };

  next();
};

module.exports = responseTimeMiddleware;
