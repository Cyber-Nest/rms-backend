const axios = require("axios");
const logger = require("../../../shared/utils/logger");

const SANDBOX_HOST = "https://api.sb.moneris.io";
const PRODUCTION_HOST = "https://api.moneris.io";

/**
 * Send a purchase request to a Moneris Cloud terminal.
 *
 * @param {Object}  params
 * @param {string}  params.storeId       - Moneris Store ID
 * @param {string}  params.apiToken      - Moneris API Token
 * @param {string}  params.terminalId    - Physical/Sandbox Terminal ID
 * @param {number}  params.amount        - Amount in dollars (e.g. 25.50)
 * @param {string}  params.orderId       - Unique order reference string
 * @param {boolean} params.isRealDevice  - false = sandbox, true = production
 *
 * @returns {Promise<{
 *   approved: boolean,
 *   responseCode: string,
 *   receiptId: string,
 *   authCode: string,
 *   cardType: string,
 *   cardLast4: string,
 *   rawResponse: object
 * }>}
 */
exports.sendPurchaseToTerminal = async ({
  storeId,
  apiToken,
  terminalId,
  amount,
  orderId,
  isRealDevice,
}) => {
  // ── 1. SANDBOX MODE (Dev Testing / Simulator) ───────────────────────────────
  // When isRealDevice is false, simulate a terminal response so developers can test
  // POS order creation, receipts, and UI flows without needing physical hardware.
  if (!isRealDevice) {
    logger.info(
      `[Moneris Sandbox Simulation] Sending purchase → Terminal: ${terminalId} | Amount: $${amount} | Store: ${storeId}`,
    );

    // Simulate customer card tap / dip wait time (1.2 seconds)
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const mockReceiptId = "MOCK-" + Math.floor(100000 + Math.random() * 900000);
    const mockAuthCode = "AUTH" + Math.floor(1000 + Math.random() * 9000);
    const cardTypes = ["VISA", "MASTERCARD", "AMEX", "INTERAC"];
    const mockCardType =
      cardTypes[Math.floor(Math.random() * cardTypes.length)];
    const mockCardLast4 = String(Math.floor(1000 + Math.random() * 9000));

    logger.info(
      `[Moneris Sandbox Simulation] Approved ✅ → Receipt: ${mockReceiptId} | Card: ${mockCardType} ****${mockCardLast4}`,
    );

    return {
      approved: true,
      responseCode: "00",
      receiptId: mockReceiptId,
      authCode: mockAuthCode,
      cardType: mockCardType,
      cardLast4: mockCardLast4,
      rawResponse: {
        receipt: {
          ReceiptId: mockReceiptId,
          ResponseCode: "00",
          AuthCode: mockAuthCode,
          CardType: mockCardType,
          Pan: `************${mockCardLast4}`,
          TransTime: new Date().toISOString(),
          Mode: "SANDBOX_SIMULATION",
        },
      },
    };
  }

  // ── 2. PRODUCTION MODE (Real Physical Moneris Hardware) ──────────────────────
  // Uses Moneris Cloud Terminal REST API with proper Bearer token authentication.
  // Authorization: Bearer base64(storeId:apiToken)
  try {
    logger.info(
      `[Moneris Live] Sending purchase → Terminal: ${terminalId} | Store: ${storeId} | Amount: $${amount}`
    );

    // Moneris Cloud Terminal REST API endpoint
    const terminalUrl = `${PRODUCTION_HOST}/v1/terminal/purchase`;

    // Moneris auth = Base64 of "storeId:apiToken"
    const credentials = Buffer.from(`${storeId}:${apiToken}`).toString("base64");

    const payload = {
      store_id:    storeId,
      api_token:   apiToken,
      terminal_id: terminalId,
      order_id:    String(orderId),
      amount:      parseFloat(amount).toFixed(2),
      dynamic_descriptor: "Restaurant POS",
    };

    logger.info(`[Moneris Live] POST ${terminalUrl} | TerminalId: ${terminalId}`);

    const response = await axios.post(terminalUrl, payload, {
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${credentials}`,
        "Api-Version":   "2024-09-01",
      },
      timeout: 90000, // 90s — terminal needs time for customer to tap/insert card
    });

    const responseData = response.data;

    // ── Parse Response ────────────────────────────────────────────────────────
    let responseCode = "999";
    let receiptId    = "";
    let authCode     = "";
    let cardType     = "";
    let cardLast4    = "";

    if (responseData && typeof responseData === "object") {
      const receipt = responseData?.receipt || responseData?.response || responseData || {};
      responseCode  = String(receipt?.ResponseCode ?? receipt?.response_code ?? receipt?.code ?? "999");
      receiptId     = receipt?.ReceiptId    || receipt?.receipt_id    || "";
      authCode      = receipt?.AuthCode     || receipt?.auth_code     || "";
      cardType      = receipt?.CardType     || receipt?.card_type     || "";
      const pan     = receipt?.Pan          || receipt?.pan           || "";
      cardLast4     = pan ? String(pan).slice(-4) : "";
    }

    // Moneris: ResponseCode < 50 → Approved (00 = Standard Approved)
    const approved = !isNaN(parseInt(responseCode)) && parseInt(responseCode) < 50;

    logger.info(
      `[Moneris Live] Response → ResponseCode: ${responseCode} | Approved: ${approved} | ReceiptId: ${receiptId || "N/A"}`
    );

    return {
      approved,
      responseCode: String(responseCode),
      receiptId,
      authCode,
      cardType,
      cardLast4,
      rawResponse: responseData,
    };
  } catch (error) {
    const isTimeout =
      error.code === "ECONNABORTED" || error.message?.includes("timeout");

    if (isTimeout) {
      logger.warn(`[Moneris Live] Request timed out for terminal ${terminalId}`);
      throw Object.assign(
        new Error("Terminal request timed out. Customer may not have responded."),
        { code: "MONERIS_TIMEOUT" }
      );
    }

    // Log full error response for debugging
    if (error.response) {
      logger.error(
        `[Moneris Live] HTTP ${error.response.status} from Moneris: ${JSON.stringify(error.response.data)}`
      );
    }

    logger.error(`[Moneris Live] Terminal request failed: ${error.message}`);
    throw Object.assign(new Error(`Moneris terminal error: ${error.message}`), {
      code: "MONERIS_ERROR",
    });
  }
};
