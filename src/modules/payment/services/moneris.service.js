const axios  = require("axios");
const crypto = require("crypto");
const logger = require("../../../shared/utils/logger");

// Moneris Go Cloud 3.0 API endpoints
// Official Docs: https://developer.moneris.com/moneris-go/docs/cloud-integration.md
const CLOUD_PRODUCTION_URL = "https://ippos.moneris.com/v3/Terminal/";

/**
 * Send a purchase request to a Moneris Go Cloud terminal.
 *
 * Uses Moneris Go Cloud 3.0 API:
 *  - POST to ippos.moneris.com/v3/Terminal/ → validation response + receiptUrl
 *  - Poll receiptUrl every 2s until completed === "true"
 *
 * @param {string}  params.storeId        Moneris Store ID
 * @param {string}  params.apiToken       Moneris API Token
 * @param {string}  params.istConfigCode  Moneris IST Config Code (required for Cloud API)
 * @param {string}  params.terminalId     Physical Terminal ID (e.g. A2080515)
 * @param {number}  params.amount         Amount in dollars (e.g. 25.50)
 * @param {string}  params.orderId        Unique order reference string
 * @param {boolean} params.isRealDevice   false = sandbox sim, true = real terminal
 */
exports.sendPurchaseToTerminal = async ({
  storeId,
  apiToken,
  istConfigCode,
  terminalId,
  amount,
  orderId,
  isRealDevice,
}) => {
  // ── 1. SANDBOX MODE (Software Simulation — no real device needed) ───────────
  if (!isRealDevice) {
    logger.info(
      `[Moneris Sandbox] Simulating purchase → Terminal: ${terminalId} | Amount: $${amount}`
    );

    await new Promise((r) => setTimeout(r, 1200));

    const mockReceiptId = "MOCK-" + Math.floor(100000 + Math.random() * 900000);
    const mockAuthCode  = "AUTH" + Math.floor(1000 + Math.random() * 9000);
    const mockCardType  = ["VISA", "MASTERCARD", "AMEX", "INTERAC"][Math.floor(Math.random() * 4)];
    const mockCardLast4 = String(Math.floor(1000 + Math.random() * 9000));

    logger.info(
      `[Moneris Sandbox] Approved → Receipt: ${mockReceiptId} | ${mockCardType} ****${mockCardLast4}`
    );

    return {
      approved:     true,
      responseCode: "00",
      receiptId:    mockReceiptId,
      authCode:     mockAuthCode,
      cardType:     mockCardType,
      cardLast4:    mockCardLast4,
      rawResponse:  { simulated: true, mode: "SANDBOX" },
    };
  }

  // ── 2. PRODUCTION MODE — Moneris Go Cloud 3.0 API ──────────────────────────
  // Step 1: POST purchase → get validation response + receiptUrl
  // Step 2: Poll receiptUrl every 2s until completed === "true"
  const idempotencyKey = crypto.randomUUID();
  const dataId         = `${Date.now()}-001`;
  const dataTimestamp  = new Date().toISOString().replace("T", " ").substring(0, 19);

  // Moneris requires amount in CENTS as a string (e.g. $1.00 → "100")
  const totalAmountCents = String(Math.round(parseFloat(amount) * 100));

  // Build request body — istConfigCode is optional (only include if provided)
  const requestBody = {
    apiVersion:    "3.0",
    apiToken:      apiToken,
    storeId:       storeId,
    ...(istConfigCode ? { istConfigCode } : {}), // include only if set
    polling:       "true",
    dataId:        dataId,
    dataTimestamp: dataTimestamp,
    data: {
      request: [
        {
          orderId:        String(orderId),
          idempotencyKey: idempotencyKey,
          terminalId:     terminalId,
          action:         "purchase",
          totalAmount:    totalAmountCents,
        },
      ],
    },
  };

  try {
    logger.info(
      `[Moneris Live] POST ${CLOUD_PRODUCTION_URL} → Terminal: ${terminalId} | Store: ${storeId} | $${amount} (${totalAmountCents} cents)`
    );

    // ── Step 1: Initiate purchase ─────────────────────────────────────────────
    const initRes = await axios.post(CLOUD_PRODUCTION_URL, requestBody, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    const initData          = initRes.data?.receipt || initRes.data;
    const initResponseArray = initData?.data?.response || [];
    const initResponse      = initResponseArray[0] || {};

    logger.info(
      `[Moneris Live] Validation → statusCode: ${initData?.statusCode} | cloudTicket: ${initResponse?.cloudTicket || "N/A"}`
    );

    // Immediate error (e.g. wrong credentials, terminal offline, invalid params)
    if (initData?.statusCode && String(initData.statusCode).startsWith("5")) {
      logger.error(
        `[Moneris Live] Validation failed → statusCode: ${initData.statusCode} | status: ${initData.status}`
      );
      throw Object.assign(
        new Error(`Moneris validation failed: ${initData.status || initData.statusCode}`),
        { code: "MONERIS_ERROR" }
      );
    }

    const receiptUrl = initResponse?.receiptUrl;
    if (!receiptUrl) {
      throw Object.assign(
        new Error("Moneris did not return a receiptUrl for polling"),
        { code: "MONERIS_ERROR" }
      );
    }

    logger.info(`[Moneris Live] Polling → ${receiptUrl}`);

    // ── Step 2: Poll receiptUrl until transaction completes ───────────────────
    // Moneris recommends ≥2s polling interval. Max 90s wait for customer.
    const MAX_WAIT_MS   = 90000;
    const POLL_INTERVAL = 2000;
    const startTime     = Date.now();

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const pollRes           = await axios.get(receiptUrl, { timeout: 10000 });
      const pollData          = pollRes.data?.receipt || pollRes.data;
      const pollResponseArray = pollData?.data?.response || [];
      const pollResponse      = pollResponseArray[0] || {};

      logger.info(
        `[Moneris Live] Poll result → completed: ${pollResponse?.completed} | statusCode: ${pollData?.statusCode}`
      );

      if (pollResponse?.completed === "true") {
        const responseCode = String(pollResponse?.responseCode || "999");
        // responseCode "00" = Approved; numeric < 50 = Approved per Moneris docs
        const approved = responseCode === "00" ||
          (!isNaN(parseInt(responseCode)) && parseInt(responseCode) < 50);

        const maskedPan = pollResponse?.maskedPan || "";
        const cardLast4 = maskedPan ? maskedPan.slice(-4) : "";

        logger.info(
          `[Moneris Live]  Done → responseCode: ${responseCode} | approved: ${approved} | authCode: ${pollResponse?.authCode || "N/A"}`
        );

        return {
          approved,
          responseCode,
          receiptId:   pollResponse?.transactionId || pollResponse?.orderId || dataId,
          authCode:    pollResponse?.authCode  || "",
          cardType:    pollResponse?.cardName  || pollResponse?.cardType || "",
          cardLast4,
          rawResponse: pollData,
        };
      }

      // Mid-poll error (e.g. terminal disconnected)
      if (pollData?.statusCode && String(pollData.statusCode).startsWith("5")) {
        throw Object.assign(
          new Error(`Moneris terminal error: ${pollData.status || pollData.statusCode}`),
          { code: "MONERIS_ERROR" }
        );
      }
    }

    // Customer didn't respond within 90 seconds
    logger.warn(`[Moneris Live] Polling timed out for terminal ${terminalId}`);
    throw Object.assign(
      new Error("Terminal request timed out. Customer may not have responded."),
      { code: "MONERIS_TIMEOUT" }
    );

  } catch (error) {
    const isTimeout =
      error.code === "MONERIS_TIMEOUT" ||
      error.code === "ECONNABORTED"    ||
      error.message?.includes("timeout");

    if (isTimeout && error.code === "MONERIS_TIMEOUT") {
      throw error; // re-throw as-is
    }

    if (isTimeout) {
      logger.warn(`[Moneris Live] Connection timeout for terminal ${terminalId}`);
      throw Object.assign(
        new Error("Terminal request timed out. Customer may not have responded."),
        { code: "MONERIS_TIMEOUT" }
      );
    }

    if (error.response) {
      logger.error(
        `[Moneris Live] HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      );
    }

    logger.error(`[Moneris Live] Error: ${error.message}`);
    throw Object.assign(
      new Error(`Moneris terminal error: ${error.message}`),
      { code: error.code || "MONERIS_ERROR" }
    );
  }
};
