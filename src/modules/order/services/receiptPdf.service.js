const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");
const Branch = require("../../company/models/branch.model");

exports.generateReceiptPdf = async (order, res) => {
  try {
    let branchInfo = {
      name: order.branchName || "Chicken Delight",
      code: order.branchCode || "DELIGHT",
      address: "231 Edgefield Pl , Strathmore,",
      city: "Alberta, T1P 0E8, Canada",
      phone: "(587) 365-5401",
      gst: "123456789",
    };

    if (order.branchId) {
      try {
        const b =
          typeof order.branchId === "object" && order.branchId.name
            ? order.branchId
            : await Branch.findById(order.branchId).lean();
        if (b) {
          if (b.name) branchInfo.name = b.name;
          if (b.code) branchInfo.code = b.code;
          if (b.address) branchInfo.address = b.address;
          if (b.city) branchInfo.city = b.city;
          if (b.phone) branchInfo.phone = b.phone;
        }
      } catch (err) {
        logger.warn(`Could not fetch branch info for receipt PDF: ${err.message}`);
      }
    }

    // 80mm width 
    const doc = new PDFDocument({
      size: [226, 800],
      margin: 10,
    });

    // Pipe PDF 
    doc.pipe(res);

    const printableWidth = 206; // 226 - 2*10 margin
    const startX = 10;

    // Helper functions for formatting
    const formatDate = (dateStr) => {
      if (!dateStr) return "Mon, Jun 29, 2026 06:52 PM";
      try {
        const d = new Date(dateStr);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];

        const dayName = days[d.getDay()];
        const monthName = months[d.getMonth()];
        const dayNum = String(d.getDate()).padStart(2, "0");
        const year = d.getFullYear();

        let hours = d.getHours();
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        hours = hours ? hours : 12;
        const strHours = String(hours).padStart(2, "0");
        const minutes = String(d.getMinutes()).padStart(2, "0");

        return `${dayName}, ${monthName} ${dayNum}, ${year} ${strHours}:${minutes} ${ampm}`;
      } catch {
        return String(dateStr);
      }
    };

    // 1. Header & Store Info Box
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(branchInfo.name, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(branchInfo.code, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.5);

    // Dashed Store Info Box
    const boxStartY = doc.y;
    doc.font("Helvetica").fontSize(7.5);
    doc.text(branchInfo.address, startX + 5, boxStartY + 4, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(branchInfo.city, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(`Tel # : ${branchInfo.phone}`, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(`GST# : ${branchInfo.gst}`, {
      align: "center",
      width: printableWidth - 10,
    });
    const boxEndY = doc.y + 4;

    doc
      .rect(startX + 2, boxStartY, printableWidth - 4, boxEndY - boxStartY)
      .dash(2, { space: 2 })
      .stroke("#666666")
      .undash();
    doc.y = boxEndY + 8;

    // 2. Order Header
    const orderNumStr = order.orderNumber
      ? order.orderNumber.replace(/^[#A-Za-z\-]+/, "")
      : "104";
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(`ORDER # : ${orderNumStr}`, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(formatDate(order.createdAt), startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        `ORDER SUMMARY (${order.paymentStatus === "paid" ? "PAID" : "UNPAID"})`,
        startX,
        doc.y,
        { align: "center", width: printableWidth },
      );
    let typeStr = order.orderType
      ? order.orderType.replace("-", " ").toUpperCase()
      : "TAKEOUT";
    const platformPrefixMap = {
      doordash: "DOORDASH",
      skip: "SKIP",
      ubereats: "UBER EATS",
      online: "ONLINE",
    };
    if (platformPrefixMap[order.orderSource]) {
      typeStr = `${platformPrefixMap[order.orderSource]} ${typeStr}`;
    }
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(typeStr, startX, doc.y, { align: "center", width: printableWidth });
    doc.moveDown(0.4);

    // 3. Items Table Header
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + printableWidth, doc.y)
      .dash(2, { space: 2 })
      .stroke("#333333")
      .undash();
    doc.moveDown(0.3);
    const headerY = doc.y;
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("ITEMS", startX, headerY, { width: 120 });
    doc.text("QTY", startX + 120, headerY, { width: 30, align: "center" });
    doc.text("AMT", startX + 150, headerY, { width: 56, align: "right" });
    doc.moveDown(0.4);
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + printableWidth, doc.y)
      .dash(2, { space: 2 })
      .stroke("#333333")
      .undash();
    doc.moveDown(0.4);

    // 4. Items Loop
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const itemY = doc.y;
        const itemTotal =
          (item.totalPrice !== undefined
            ? item.totalPrice
            : item.basePrice * item.quantity) || 0;

        doc.font("Helvetica-Bold").fontSize(8.5);
        doc.text(item.name || "Item", startX, itemY, { width: 120 });
        doc.font("Helvetica").fontSize(8.5);
        doc.text(String(item.quantity || 1), startX + 120, itemY, {
          width: 30,
          align: "center",
        });
        doc.text(`$${itemTotal.toFixed(2)}`, startX + 150, itemY, {
          width: 56,
          align: "right",
        });
        doc.moveDown(0.2);

        // Modifiers / Sub-items
        if (
          item.selectedModifiers &&
          Array.isArray(item.selectedModifiers) &&
          item.selectedModifiers.length > 0
        ) {
          doc.font("Helvetica").fontSize(7.5).fillColor("#444444");
          item.selectedModifiers.forEach((mod) => {
            const modPriceStr =
              mod.price > 0 ? ` (+$${mod.price.toFixed(2)})` : "";
            doc.text(`   ${mod.optionName}${modPriceStr}`, startX, doc.y, {
              width: printableWidth - 10,
            });
          });
          doc.fillColor("#000000");
        }
        if (item.note) {
          doc
            .font("Helvetica-Oblique")
            .fontSize(7.5)
            .text(`   Note : ${item.note}`, startX, doc.y, {
              width: printableWidth - 10,
            });
        }
        doc.moveDown(0.3);
      });
    }

    // 5. Totals Section
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + printableWidth, doc.y)
      .dash(2, { space: 2 })
      .stroke("#333333")
      .undash();
    doc.moveDown(0.4);

    const subtotal = order.subtotal || 0;
    const discount = order.discount || 0;
    const tax = order.tax || 0;
    const taxRate = order.taxRate || 0.05;
    const deliveryFee = order.deliveryFee || 0;
    const total = order.total || 0;

    doc.font("Helvetica").fontSize(8.5);
    let rowY = doc.y;
    doc.text("Subtotal :", startX, rowY, { width: 100 });
    doc
      .font("Helvetica-Bold")
      .text(`$${subtotal.toFixed(2)}`, startX + 100, rowY, {
        width: 106,
        align: "right",
      });
    doc.moveDown(0.3);

    if (discount > 0) {
      rowY = doc.y;
      doc.font("Helvetica").text("Discount :", startX, rowY, { width: 100 });
      doc
        .font("Helvetica-Bold")
        .text(`-$${discount.toFixed(2)}`, startX + 100, rowY, {
          width: 106,
          align: "right",
        });
      doc.moveDown(0.3);
    }

    rowY = doc.y;
    doc.font("Helvetica").text(`GST :`, startX, rowY, { width: 100 });
    doc
      .font("Helvetica-Bold")
      .text(
        `$${tax.toFixed(2)} (${(taxRate * 100).toFixed(0)}%)`,
        startX + 100,
        rowY,
        { width: 106, align: "right" },
      );
    doc.moveDown(0.3);

    if (deliveryFee > 0) {
      rowY = doc.y;
      doc.font("Helvetica").text("Delivery Fee :", startX, rowY, { width: 100 });
      doc
        .font("Helvetica-Bold")
        .text(`$${deliveryFee.toFixed(2)}`, startX + 100, rowY, {
          width: 106,
          align: "right",
        });
      doc.moveDown(0.4);
    }

    rowY = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Total :", startX, rowY, { width: 100 });
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`$${total.toFixed(2)}`, startX + 100, rowY, {
        width: 106,
        align: "right",
      });
    doc.moveDown(0.5);

    // 6. Transaction Record (Conditional for Card vs Cash)
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + printableWidth, doc.y)
      .dash(2, { space: 2 })
      .stroke("#333333")
      .undash();
    doc.moveDown(0.4);

    // Check payment history or payment method
    let isAccountPay = ["doordash", "skip", "ubereats"].includes(order.orderSource);
    let isCardPayment = false;
    let cardInfo = {
      acct: "CARD",
      cardNum: "N/A",
      type: "CARD",
      transNum: order.paymentIntentId || "N/A",
      aid: "N/A",
    };
    let cashInfo = { cashGiven: total, changeGiven: 0 };

    if (!isAccountPay && (order.orderSource === "online" || order.paymentMethod === "stripe")) {
      isCardPayment = true;
      cardInfo.acct = "STRIPE CARD";
      cardInfo.aid = "ONLINE_STRIPE";
    }

    if (
      order.payments &&
      Array.isArray(order.payments) &&
      order.payments.length > 0
    ) {
      const p = order.payments[0];
      if (
        !isAccountPay && ["card", "interac", "debit", "credit"].includes(p.method?.toLowerCase())
      ) {
        isCardPayment = true;
        cardInfo.acct = p.cardBrand ? p.cardBrand.toUpperCase() : (order.orderSource === "online" ? "STRIPE CARD" : "INTERAC");
        cardInfo.cardNum = p.cardLast4 ? `************${p.cardLast4}` : "N/A";
        cardInfo.type = p.cardFunding ? p.cardFunding.toUpperCase() : "CARD";
        cardInfo.transNum = p.transactionId ? p.transactionId : (order.paymentIntentId || "N/A");
        cardInfo.aid = order.orderSource === "online" ? "ONLINE_STRIPE" : (p.cardBrand ? "CARD_PAYMENT" : "0THB2O87P7ZOBIK");
      } else if (p.method?.toLowerCase() === "cash") {
        isCardPayment = false;
        cashInfo.cashGiven = p.cashGiven || total;
        cashInfo.changeGiven = p.changeGiven || 0;
      }
    } else if (
      !isAccountPay &&
      order.paymentType &&
      ["card", "interac", "debit", "credit"].includes(
        order.paymentType.toLowerCase(),
      )
    ) {
      isCardPayment = true;
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text("TRANSACTION RECORD", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(8);

    if (isAccountPay) {
      rowY = doc.y;
      doc.text("TYPE :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text("ACCOUNT PAY", startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("PLATFORM :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(order.orderSource === "online" ? "WEBSITE" : order.orderSource.toUpperCase(), startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
    } else if (isCardPayment) {
      rowY = doc.y;
      doc.text("ACCT :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(cardInfo.acct, startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("CARD NUMBER :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(cardInfo.cardNum, startX + 80, rowY, {
          width: 126,
          align: "right",
        });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("Type :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(cardInfo.type, startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("TRANS # :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(cardInfo.transNum, startX + 80, rowY, {
          width: 126,
          align: "right",
        });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("AID :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(cardInfo.aid, startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
    } else {
      // Cash payment details - omitted card number & trans #
      rowY = doc.y;
      doc.text("TYPE :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text("CASH", startX + 80, rowY, { width: 126, align: "right" });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("CASH GIVEN :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(`$${cashInfo.cashGiven.toFixed(2)}`, startX + 80, rowY, {
          width: 126,
          align: "right",
        });
      doc.font("Helvetica").moveDown(0.2);
      rowY = doc.y;
      doc.text("CHANGE :", startX, rowY);
      doc
        .font("Helvetica-Bold")
        .text(`$${cashInfo.changeGiven.toFixed(2)}`, startX + 80, rowY, {
          width: 126,
          align: "right",
        });
      doc.font("Helvetica").moveDown(0.2);
    }
    doc.moveDown(0.3);

    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + printableWidth, doc.y)
      .dash(2, { space: 2 })
      .stroke("#333333")
      .undash();
    doc.moveDown(0.5);

    // 7. Footer Slogans
    doc
      .font("Helvetica-BoldOblique")
      .fontSize(8)
      .text('"Don\'t Cook Tonight, Call Chicken Delight!"', startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .text("Have a nice day, Visit us again!", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor("#555555")
      .text(
        "We are implementing new POS systems. If you see any discrepancy in the invoice, please email the invoice to accounting@chickendelight.com",
        startX,
        doc.y,
        { align: "center", width: printableWidth },
      );

    // End PDF generation
    doc.end();
  } catch (error) {
    logger.error(`Error generating receipt PDF: ${error.message}`);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, message: "Failed to generate receipt PDF" });
    }
  }
};

exports.generateSalesSummaryReceiptPdf = async (summary, dateStr, res, branchId = null) => {
  try {
    let branchInfo = {
      name: summary.branchName || "Chicken Delight",
      code: summary.branchCode || "DELIGHT",
      address: "231 Edgefield Pl , Strathmore,",
      city: "Alberta, T1P 0E8, Canada",
      phone: "(587) 365-5401",
      gst: "123456789",
    };

    const targetBranchId = branchId || summary.branchId;
    if (targetBranchId) {
      try {
        const b =
          typeof targetBranchId === "object" && targetBranchId.name
            ? targetBranchId
            : await Branch.findById(targetBranchId).lean();
        if (b) {
          if (b.name) branchInfo.name = b.name;
          if (b.code) branchInfo.code = b.code;
          if (b.address) branchInfo.address = b.address;
          if (b.city) branchInfo.city = b.city;
          if (b.phone) branchInfo.phone = b.phone;
        }
      } catch (err) {
        logger.warn(`Could not fetch branch info for sales summary receipt: ${err.message}`);
      }
    }

    // 80mm width. Since a daily summary has category lists, payment summaries, order types and expenses,
    // we set height to 1200. This is standard for receipt print outputs.
    const doc = new PDFDocument({
      size: [226, 1200],
      margin: 10,
    });

    doc.pipe(res);

    const printableWidth = 206; // 226 - 2*10 margin
    const startX = 10;

    // Helper functions for formatting
    const formatDate = (dateVal) => {
      if (!dateVal) return "";
      try {
        const d = new Date(dateVal);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${days[d.getDay()]}, ${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`;
      } catch {
        return dateVal;
      }
    };

    // 1. Header & Store Info Box (strictly Black & White)
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#000000")
      .text(branchInfo.name, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#000000")
      .text(branchInfo.code, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.5);

    // Dashed Store Info Box
    const boxStartY = doc.y;
    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    doc.text(branchInfo.address, startX + 5, boxStartY + 4, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(branchInfo.city, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(`Tel # : ${branchInfo.phone}`, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text(`GST# : ${branchInfo.gst}`, {
      align: "center",
      width: printableWidth - 10,
    });
    const boxEndY = doc.y + 4;

    doc
      .rect(startX + 2, boxStartY, printableWidth - 4, boxEndY - boxStartY)
      .dash(2, { space: 2 })
      .stroke("#000000")
      .undash();
    doc.y = boxEndY + 8;

    // 2. Report Header
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("DAILY SALES SUMMARY", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(`Date Filter: ${formatDate(dateStr)}`, startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.5);

    // Helper to draw dashed divider
    const drawDivider = () => {
      doc
        .moveTo(startX, doc.y)
        .lineTo(startX + printableWidth, doc.y)
        .dash(2, { space: 2 })
        .stroke("#000000")
        .undash();
      doc.moveDown(0.3);
    };

    // Helper for currency
    const fmt = (num) => `$${(num || 0).toFixed(2)}`;

    // Helper for key-value row (B&W)
    const drawRow = (left, right, isBold = false, indent = 0) => {
      const rowY = doc.y;
      doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      doc.text(left, startX + indent, rowY, { width: printableWidth - 60 - indent });
      doc.text(right, startX + printableWidth - 60, rowY, { width: 60, align: "right" });
      doc.moveDown(0.2);
    };

    // Section 1: Sales By Category
    drawDivider();
    doc.font("Helvetica-Bold").fontSize(8.5).text("SALES BY CATEGORY", startX, doc.y);
    doc.moveDown(0.2);
    drawDivider();

    if (summary.categorySales && Array.isArray(summary.categorySales)) {
      summary.categorySales.forEach((cat) => {
        drawRow(cat.name || "Uncategorized", fmt(cat.total));
      });
      doc.moveDown(0.2);
      drawRow("ALL CATEGORY TOTAL", fmt(summary.financials?.allCategoryTotal || 0), true);
    }
    doc.moveDown(0.4);

    // Section 2: Sales Summary Accounting
    drawDivider();
    doc.font("Helvetica-Bold").fontSize(8.5).text("SALES ACCOUNTING", startX, doc.y);
    doc.moveDown(0.2);
    drawDivider();

    const accounting = summary.financials || {};
    drawRow("Sub Total :", fmt(accounting.subTotal));
    drawRow("Delivery Charges :", fmt(accounting.deliveryCharges));
    drawRow("Debit Card Charges :", fmt(accounting.debitCardCharges));
    drawRow("Discount :", `(${fmt(accounting.discount)})`);
    drawRow("Tax (GST) :", fmt(accounting.tax));
    doc.moveDown(0.2);
    drawRow("GRAND TOTAL :", fmt(accounting.grandTotal), true);
    drawRow("Tips :", fmt(accounting.tips));
    doc.moveDown(0.2);
    drawRow("FINAL AMOUNT :", fmt(accounting.finalAmount), true);
    doc.moveDown(0.4);

    // Section 3: Sales Received (Payment Type)
    drawDivider();
    doc.font("Helvetica-Bold").fontSize(8.5).text("SALES RECEIVED", startX, doc.y);
    doc.moveDown(0.2);
    drawDivider();

    const payments = summary.salesReceived || {};
    drawRow("Cash :", fmt(payments.cash));
    drawRow("Account Pay :", fmt(payments.accountPay));
    drawRow("Credit Card - Sales :", fmt(payments.creditCardSales));
    drawRow("Debit Card - Sales :", fmt(payments.debitCardSales));
    doc.moveDown(0.2);
    drawRow("GRAND TOTAL :", fmt(payments.grandTotal), true);
    drawRow("Credit Card - Tips :", fmt(payments.tips));
    drawRow("Debit Card - Tips :", fmt(payments.tips));
    doc.moveDown(0.2);
    drawRow("FINAL AMOUNT :", fmt(payments.finalAmount), true);
    doc.moveDown(0.4);

    // Section 4: Order Type
    drawDivider();
    doc.font("Helvetica-Bold").fontSize(8.5).text("ORDER TYPE", startX, doc.y);
    doc.moveDown(0.2);
    drawDivider();

    const orderType = summary.orderTypeSummary || {};
    drawRow("Take-Out :", fmt(orderType.takeout));
    drawRow("Dine-In :", fmt(orderType.dineIn));
    drawRow("Drive Through :", fmt(orderType.driveThrough));
    if (orderType.delivery !== undefined && orderType.delivery > 0) {
      drawRow("Delivery :", fmt(orderType.delivery));
    }
    doc.moveDown(0.2);
    drawRow("TOTAL :", fmt(orderType.total), true);
    doc.moveDown(0.4);

    // Section 5: Expenses
    if (summary.expense && Array.isArray(summary.expense) && summary.expense.length > 0) {
      drawDivider();
      doc.font("Helvetica-Bold").fontSize(8.5).text("EXPENSES", startX, doc.y);
      doc.moveDown(0.2);
      drawDivider();

      summary.expense.forEach((exp) => {
        const emp = exp.employee || "Manager";
        const mode = exp.paymentMode || "cash";
        drawRow(`${emp} (${mode})`, fmt(exp.total));
        if (exp.pst || exp.gst || exp.hst) {
          doc.font("Helvetica").fontSize(7).fillColor("#444444");
          doc.text(`   PST: ${fmt(exp.pst)} | GST: ${fmt(exp.gst)} | HST: ${fmt(exp.hst)}`, startX, doc.y);
          doc.fillColor("#000000");
          doc.moveDown(0.15);
        }
      });
      doc.moveDown(0.2);
      const expenseTotal = summary.expense.reduce((sum, e) => sum + (e.total || 0), 0);
      drawRow("TOTAL EXPENSES :", fmt(expenseTotal), true);
      doc.moveDown(0.4);
    }

    // 6. Footer Slogans
    drawDivider();
    doc
      .font("Helvetica-BoldOblique")
      .fontSize(8)
      .text('"Don\'t Cook Tonight, Call Chicken Delight!"', startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .text("Have a nice day, Visit us again!", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });

    doc.end();
  } catch (error) {
    logger.error(`Error generating sales summary PDF receipt: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Failed to generate sales summary PDF" });
    }
  }
};
