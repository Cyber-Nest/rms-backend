const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "rms_super_secret_jwt_key";

const protectBranch = (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header (Bearer token)
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    // Check HTTP-Only Cookie
    else if (req.cookies && req.cookies.rms_branch_token) {
      token = req.cookies.rms_branch_token;
    }
    // Check custom headers
    else if (req.headers["x-branch-token"]) {
      token = req.headers["x-branch-token"];
    }
    else if (req.headers["rms_branch_token"]) {
      token = req.headers["rms_branch_token"];
    }

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.branch = decoded;
      req.activeBranchId = decoded.branchId || decoded._id || decoded.id;
    } else {
      // Fallback: extract branchId from query/body/headers for branch POS requests
      const fallbackBranchId =
        req.query.branchId ||
        req.query.restaurantId ||
        req.body?.branchId ||
        req.body?.restaurantId ||
        req.headers["x-branch-id"];

      if (fallbackBranchId) {
        req.branch = { branchId: String(fallbackBranchId) };
        req.activeBranchId = String(fallbackBranchId);
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
};

module.exports = protectBranch;
