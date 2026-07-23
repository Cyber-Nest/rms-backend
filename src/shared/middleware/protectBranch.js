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

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Authentication token missing.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.branch = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
};

module.exports = protectBranch;
