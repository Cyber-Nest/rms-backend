const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET || "rms_super_secret_jwt_key";

/**
 * Middleware: Protect Driver API Routes
 *
 * Verifies the driver's JWT token from the Authorization header.
 * Injects `req.driver` with { _id, driverId, restaurantId } on success.
 * Returns 401 if token is missing/invalid/expired.
 * Returns 403 if driver attempts cross-tenant access.
 */
const protectDriver = (req, res, next) => {
  try {
    let token = null;

    // Extract token from Authorization header, Cookie, or Custom Header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.rms_branch_token) {
      token = req.cookies.rms_branch_token;
    } else if (req.headers["x-branch-token"]) {
      token = req.headers["x-branch-token"];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "DRIVER_AUTH_REQUIRED",
        message: "Authentication required. Please log in to the Driver App or POS.",
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Case 1: Branch Manager / Employee Token (from POS side)
    if (decoded.branchId || decoded.role === "super_admin" || decoded.role === "manager") {
      req.branch = decoded;
      req.activeBranchId = String(decoded.branchId || decoded._id);
      return next();
    }

    // Case 2: Driver App Token
    if (decoded._id && decoded.restaurantId) {
      req.driver = {
        _id: decoded._id,
        driverId: decoded.driverId,
        restaurantId: decoded.restaurantId,
      };

      // Cross-tenant guard: If the request includes a branchId/restaurantId,
      // ensure it matches the token's restaurantId
      const requestBranchId =
        req.query.branchId ||
        req.query.restaurantId ||
        req.body?.branchId ||
        req.body?.restaurantId ||
        req.headers["x-branch-id"];

      if (
        requestBranchId &&
        String(requestBranchId) !== String(decoded.restaurantId)
      ) {
        logger.warn(
          `[Security] Driver ${decoded.driverId} (tenant ${decoded.restaurantId}) attempted cross-tenant access to ${requestBranchId}`
        );
        return res.status(403).json({
          success: false,
          code: "CROSS_TENANT_ACCESS_DENIED",
          message:
            "Access denied. You cannot access data belonging to another restaurant.",
        });
      }

      return next();
    }

    return res.status(401).json({
      success: false,
      code: "INVALID_DRIVER_TOKEN",
      message: "Invalid authentication token.",
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "DRIVER_TOKEN_EXPIRED",
        message: "Session expired. Please log in again.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        code: "INVALID_DRIVER_TOKEN",
        message: "Invalid authentication token.",
      });
    }

    logger.error(`protectDriver middleware error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Authentication service error.",
    });
  }
};

module.exports = protectDriver;
