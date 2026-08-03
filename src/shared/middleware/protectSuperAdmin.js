const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "rms_super_secret_jwt_key";

const protectSuperAdmin = (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header (Bearer token)
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    //Check HTTP-Only Cookie
    else if (req.cookies && req.cookies.rms_superadmin_token) {
      token = req.cookies.rms_superadmin_token;
    }
    //Check custom header
    else if (req.headers["x-superadmin-token"]) {
      token = req.headers["x-superadmin-token"];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Super Admin authentication token missing.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Access forbidden. Super Admin authorization required.",
      });
    }

    req.superAdmin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired Super Admin session.",
    });
  }
};

module.exports = protectSuperAdmin;
