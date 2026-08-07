const logger = require("../utils/logger");

/**
 * Middleware: Enforce Multi-Tenant Branch Isolation
 * 
 * Ensures an authenticated branch can ONLY access its own data.
 * Automatically injects the verified branchId into req.query and req.body.
 * Returns HTTP 403 Forbidden if a branch attempts to query a different branch's data.
 */
const enforceBranch = (req, res, next) => {
  try {
    // If request is authenticated as Super Admin, bypass strict branch restriction
    if (req.superAdmin) {
      return next();
    }

    const authenticatedBranchId =
      req.branch?.branchId ||
      req.branch?._id ||
      req.branch?.id ||
      req.query?.branchId ||
      req.query?.restaurantId ||
      req.headers["x-branch-id"];

    if (!authenticatedBranchId) {
      return res.status(401).json({
        success: false,
        message: "Branch authentication context missing.",
      });
    }

    const activeBranchStr = String(authenticatedBranchId);

    // Check query params safely with optional chaining
    const queryBranchId = req.query?.branchId || req.query?.restaurantId;
    if (queryBranchId && String(queryBranchId) !== activeBranchStr) {
      logger.warn(
        `[Security Warning] Branch ${activeBranchStr} attempted to access data for Branch ${queryBranchId}`
      );
      return res.status(403).json({
        success: false,
        message: "Access forbidden: You cannot access data belonging to another restaurant branch.",
      });
    }

    // Check body params safely with optional chaining (handles GET requests where req.body is undefined)
    const bodyBranchId = req.body?.branchId || req.body?.restaurantId;
    if (bodyBranchId && String(bodyBranchId) !== activeBranchStr) {
      logger.warn(
        `[Security Warning] Branch ${activeBranchStr} attempted to mutate data for Branch ${bodyBranchId}`
      );
      return res.status(403).json({
        success: false,
        message: "Access forbidden: You cannot mutate data belonging to another restaurant branch.",
      });
    }

    // Force strict branchId injection into request context
    if (!req.query) req.query = {};
    req.query.branchId = activeBranchStr;
    req.query.restaurantId = activeBranchStr;

    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      req.body.branchId = activeBranchStr;
      req.body.restaurantId = activeBranchStr;
    }

    req.activeBranchId = activeBranchStr;
    next();
  } catch (error) {
    logger.error(`Error in enforceBranch middleware: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal security enforcement error.",
    });
  }
};

module.exports = enforceBranch;
