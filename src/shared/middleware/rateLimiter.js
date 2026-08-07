const logger = require("../utils/logger");

const requestsMap = new Map();
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestsMap.entries()) {
    if (now > record.resetTime) {
      requestsMap.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Custom Rate Limiter Factory
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 min)
 * @param {number} options.max - Maximum requests per IP per window (default: 60)
 * @param {string} options.message - Error message returned when rate limit exceeded
 */
const createRateLimiter = (options = {}) => {
  const windowMs = options.windowMs || 60 * 1000;
  const maxRequests = options.max || 60;
  const message = options.message || "Too many requests. Please try again later.";

  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    const key = `${req.path}_${ip}`;
    const now = Date.now();

    let record = requestsMap.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      requestsMap.set(key, record);
      return next();
    }

    record.count += 1;

    if (record.count > maxRequests) {
      logger.warn(`[RateLimit Exceeded] IP ${ip} exceeded limit on ${req.path}`);
      return res.status(429).json({
        success: false,
        message,
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    next();
  };
};

module.exports = {
  createRateLimiter,
  publicOrderLimiter: createRateLimiter({ windowMs: 60 * 1000, max: 30, message: "Order rate limit exceeded. Please wait a minute." }),
  authLimiter: createRateLimiter({ windowMs: 60 * 1000, max: 15, message: "Login rate limit exceeded. Please wait a minute." }),
  generalLimiter: createRateLimiter({ windowMs: 60 * 1000, max: 200 }),
};
