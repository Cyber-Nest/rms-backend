const os = require("os");
const path = require("path");
const fs = require("fs");
const logger = require("../../../shared/utils/logger");

// Safely require pdf-to-printer (Windows thermal printer binary wrapper)
let ptp = null;
try {
  ptp = require("pdf-to-printer");
} catch (e) {
  logger.warn("[silentPrint] pdf-to-printer module not available on this platform/environment.");
}

/**
 * Silently sends a PDF to a physical Windows printer using pdf-to-printer.
 * Safe for cloud deployments (Vercel/Linux) — gracefully bypasses physical print if not running on Windows.
 *
 * @param {string} pdfFilePath - Absolute path to the PDF file
 * @param {string} [printerName] - Exact Windows printer name (from Printers & Scanners). Defaults to system default.
 */
exports.printPdfSilently = async (pdfFilePath, printerName = null) => {
  if (!fs.existsSync(pdfFilePath)) {
    throw new Error(`PDF file not found: ${pdfFilePath}`);
  }

  // If deployed to Vercel/Linux cloud container, skip physical Windows spooler call
  if (process.platform !== "win32" || !ptp) {
    logger.info("[silentPrint] Cloud/Non-Windows environment detected. Skipping physical spooler call.");
    return { success: true, printer: "Cloud Bypassed" };
  }

  const options = {};
  if (printerName && printerName.trim() !== "") {
    options.printer = printerName.trim();
  }

  logger.info(
    `[silentPrint] Sending ${pdfFilePath} → printer: "${options.printer || "Default"}"`
  );

  try {
    await ptp.print(pdfFilePath, options);
    logger.info(`[silentPrint] Job sent to Windows Print Spooler successfully.`);
    return { success: true, printer: options.printer || "Default Printer" };
  } catch (err) {
    logger.error(`[silentPrint] Print failed: ${err.message}`);
    throw err;
  }
};

/**
 * Returns the temp directory path for generated receipt PDFs.
 */
exports.getTempReceiptPath = (filename) => {
  const tempDir = path.join(os.tmpdir(), "chicken-delight-rms-receipts");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return path.join(tempDir, filename);
};
