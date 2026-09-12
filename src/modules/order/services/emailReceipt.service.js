const nodemailer = require("nodemailer");
const logger = require("../../../shared/utils/logger");

const createTransporter = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    logger.warn("Email credentials (EMAIL_USER / EMAIL_PASS) missing in env; falling back to JSON transport.");
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
};

/**
 * Send Order Receipt PDF & HTML via Email
 */
exports.sendReceiptEmail = async ({ to, customerName, order, pdfBuffer }) => {
  const transporter = createTransporter();
  const restaurantName = process.env.RESTAURANT_NAME || "Chicken Delight";
  const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || "noreply@chickendelight.com";

  if (!to || !to.trim()) {
    throw new Error("Recipient email address is required.");
  }

  const recipientEmail = to.trim();
  const orderNumberStr = (order.orderNumber || "#").replace("#", "");
  const orderTotalStr = `$${(order.total || 0).toFixed(2)}`;

  // Format Order Date
  let orderDateFormatted = "N/A";
  if (order.createdAt) {
    try {
      const d = new Date(order.createdAt);
      orderDateFormatted = d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      orderDateFormatted = String(order.createdAt);
    }
  }

  // Resolve Customer Name
  const rawName = customerName || order.customer?.name || "";
  const resolvedCustomerName =
    rawName.trim() && rawName.trim().toLowerCase() !== "no name"
      ? rawName.trim()
      : "Valued Customer";

  // Build Items HTML Table
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b;">
          <strong style="font-size: 13px;">${item.name}</strong>
          ${
            item.selectedModifiers && item.selectedModifiers.length > 0
              ? `<div style="font-size: 11px; color: #64748b; margin-top: 3px;">${item.selectedModifiers
                  .map((m) => `${m.groupName ? m.groupName + ": " : ""}${m.optionName}`)
                  .join(", ")}</div>`
              : ""
          }
          ${item.note ? `<div style="font-size: 10px; color: #d97706; font-style: italic; margin-top: 2px;">Note: "${item.note}"</div>` : ""}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; font-size: 13px; font-weight: 700; color: #334155;">
          ${item.quantity}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 13px; font-weight: 700; color: #0f172a; font-family: monospace;">
          $${(item.totalPrice ?? (item.basePrice * item.quantity)).toFixed(2)}
        </td>
      </tr>`
    )
    .join("");

  const subtotalStr = (order.subtotal || 0).toFixed(2);
  const taxStr = (order.tax || 0).toFixed(2);
  const discountStr = (order.discount || 0).toFixed(2);

  //Email Template
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06);">
      <!-- Header Banner -->
      <div style="background-color: #be123c; padding: 28px 20px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">${restaurantName}</h1>
        <div style="display: inline-block; margin-top: 8px; background-color: rgba(255,255,255,0.2); color: #ffffff; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
          Order Receipt
        </div>
      </div>
      
      <!-- Body Content -->
      <div style="padding: 28px 24px; background-color: #ffffff;">
        <h2 style="color: #111827; margin: 0 0 12px 0; font-size: 19px; font-weight: 700;">Hello ${resolvedCustomerName},</h2>
        
        <p style="color: #4b5563; line-height: 1.6; font-size: 14px; margin: 0 0 24px 0;">
          Thank you for ordering with <strong style="color: #111827;">${restaurantName}</strong>! Your detailed receipt is attached to this email as a PDF file for your records.
        </p>
        
        <!-- Receipt Details Card -->
        <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed;">
            <tbody>
              <tr>
                <td style="color: #6b7280; padding: 10px 0; font-weight: 600; white-space: nowrap; width: 42%; border-bottom: 1px solid #e5e7eb;">Order Number</td>
                <td style="color: #111827; padding: 10px 0; font-weight: 800; text-align: right; width: 58%; border-bottom: 1px solid #e5e7eb; font-size: 15px;">#${orderNumberStr}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; padding: 10px 0; font-weight: 600; white-space: nowrap; width: 42%; border-bottom: 1px solid #e5e7eb;">Order Date</td>
                <td style="color: #111827; padding: 10px 0; font-weight: 700; text-align: right; width: 58%; border-bottom: 1px solid #e5e7eb; font-size: 13.5px;">${orderDateFormatted}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; padding: 10px 0; font-weight: 600; white-space: nowrap; width: 42%; border-bottom: 1px solid #e5e7eb;">Order Type</td>
                <td style="color: #111827; padding: 10px 0; font-weight: 700; text-align: right; width: 58%; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; font-size: 13.5px;">${(order.orderType || "takeout").replace("-", " ")}</td>
              </tr>
              <tr>
                <td style="color: #111827; padding: 14px 0 4px 0; font-weight: 800; white-space: nowrap; width: 42%; font-size: 15px;">Total Amount</td>
                <td style="color: #be123c; padding: 14px 0 4px 0; font-weight: 900; text-align: right; width: 58%; font-size: 21px;">${orderTotalStr}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Items Table -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr style="background-color: #f8fafc; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase;">
              <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Item</th>
              <th style="padding: 10px 12px; text-align: center; border-bottom: 2px solid #e2e8f0;">Qty</th>
              <th style="padding: 10px 12px; text-align: right; border-bottom: 2px solid #e2e8f0;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <!-- Financial Totals -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 2px solid #e2e8f0; padding-top: 12px; margin-bottom: 24px;">
          <tr>
            <td style="font-size: 12px; color: #64748b; padding: 4px 0;">Subtotal:</td>
            <td style="font-size: 12px; color: #1e293b; font-weight: 700; text-align: right; font-family: monospace;">$${subtotalStr}</td>
          </tr>
          ${
            Number(discountStr) > 0
              ? `<tr>
                  <td style="font-size: 12px; color: #16a34a; padding: 4px 0; font-weight: 700;">Discount:</td>
                  <td style="font-size: 12px; color: #16a34a; font-weight: 700; text-align: right; font-family: monospace;">-$${discountStr}</td>
                 </tr>`
              : ""
          }
          <tr>
            <td style="font-size: 12px; color: #64748b; padding: 4px 0;">GST (5%):</td>
            <td style="font-size: 12px; color: #1e293b; font-weight: 700; text-align: right; font-family: monospace;">$${taxStr}</td>
          </tr>
          <tr>
            <td style="font-size: 15px; color: #0f172a; font-weight: 900; padding: 10px 0 0 0;">Grand Total:</td>
            <td style="font-size: 17px; color: #be123c; font-weight: 900; text-align: right; padding: 10px 0 0 0; font-family: monospace;">${orderTotalStr}</td>
          </tr>
        </table>
        
        <!-- Footer Note -->
        <p style="color: #6b7280; font-size: 13.5px; line-height: 1.6; margin: 0 0 20px 0; text-align: center;">
          If you have any questions, feel free to contact us at <strong>${restaurantName}</strong>.
        </p>
        
        <div style="border-top: 1px solid #f3f4f6; padding-top: 18px; text-align: center;">
          <p style="color: #9ca3af; font-size: 12.5px; font-weight: 500; margin: 0;">
            Don't Cook Tonight, Call Chicken Delight! 🍗
          </p>
        </div>
      </div>
    </div>
  `;

  // Generate PDF receipt buffer if not provided
  let finalPdfBuffer = pdfBuffer;
  if (!finalPdfBuffer) {
    try {
      const receiptPdfService = require("./receiptPdf.service");
      finalPdfBuffer = await receiptPdfService.generateReceiptBuffer(order);
    } catch (pdfErr) {
      logger.warn(`Could not generate PDF buffer attachment: ${pdfErr.message}`);
    }
  }

  const mailOptions = {
    from: `"${restaurantName}" <${senderEmail}>`,
    to: recipientEmail,
    subject: `Order Receipt #${orderNumberStr} - ${restaurantName}`,
    html: htmlContent,
  };

  if (finalPdfBuffer) {
    mailOptions.attachments = [
      {
        filename: `Receipt-#${orderNumberStr}.pdf`,
        content: finalPdfBuffer,
        contentType: "application/pdf",
      },
    ];
  }

  logger.info(`Sending email receipt to ${recipientEmail} for order #${orderNumberStr}...`);
  const info = await transporter.sendMail(mailOptions);
  logger.info(`Email receipt sent successfully. MessageID: ${info.messageId || "success"}`);
  return info;
};

