const crypto = require("crypto");
const logger = require("./logger");

const QR_SIGNING_SECRET =
  process.env.QR_SIGNING_SECRET || process.env.JWT_SECRET || "rms_qr_signing_secret_key";

/**
 * Generate a signed QR payload using HMAC-SHA256.
 * No expiration — token is permanently valid until secret key rotation.
 
 */
const generateSignedQrPayload = ({ branchId, branchName, branchCode, apiUrl }) => {
  if (!branchId) {
    throw new Error("branchId is required to generate signed QR payload");
  }

  const payload = {
    type: "BRANCH_PAIRING_QR",
    branchId: String(branchId),
    branchName: branchName || "Restaurant Store",
    branchCode: branchCode || "STORE",
    apiUrl: apiUrl || "",
    signedAt: new Date().toISOString(),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", QR_SIGNING_SECRET)
    .update(payloadBase64)
    .digest("hex");

  return `${payloadBase64}.${signature}`;
};

/**
 * Verify a signed QR token and extract the payload.
 *
 */
const verifyQrPayload = (signedToken) => {
  if (!signedToken || typeof signedToken !== "string") {
    throw new Error("QR token is required");
  }

  const parts = signedToken.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid QR token format");
  }

  const [payloadBase64, providedSignature] = parts;

  // Recompute HMAC to verify integrity
  const expectedSignature = crypto
    .createHmac("sha256", QR_SIGNING_SECRET)
    .update(payloadBase64)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(providedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    )
  ) {
    throw new Error("QR token signature verification failed — possible tampering detected");
  }

  // Decode and parse payload
  try {
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    if (!payload.branchId) {
      throw new Error("Invalid QR payload — missing branchId");
    }

    return {
      branchId: payload.branchId,
      branchName: payload.branchName || "Restaurant Store",
      branchCode: payload.branchCode || "STORE",
      apiUrl: payload.apiUrl || "",
      signedAt: payload.signedAt || null,
    };
  } catch (parseError) {
    logger.error(`QR payload decode error: ${parseError.message}`);
    throw new Error("Invalid QR token payload");
  }
};

module.exports = {
  generateSignedQrPayload,
  verifyQrPayload,
};
