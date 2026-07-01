const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");

exports.generateReceiptPdf = (order, res) => {
  try {
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
      .fontSize(14)
      .text("Chicken Delight", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("DELIGHT", startX, doc.y, {
        align: "center",
        width: printableWidth,
      });
    doc.moveDown(0.5);

    // Dashed Store Info Box
    const boxStartY = doc.y;
    doc.font("Helvetica").fontSize(7.5);
    doc.text("231 Edgefield Pl , Strathmore,", startX + 5, boxStartY + 4, {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text("Alberta, T1P 0E8, Canada", {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text("Tel # : (587) 365-5401", {
      align: "center",
      width: printableWidth - 10,
    });
    doc.text("GST# : 123456789", {
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
    const typeStr = order.orderType
      ? order.orderType.replace("-", " ").toUpperCase()
      : "TAKEOUT";
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
    doc.moveDown(0.4);

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
    let isCardPayment = false;
    let cardInfo = {
      acct: "INTERAC",
      cardNum: "************5762",
      type: "CARD",
      transNum: "1027-0_649",
      aid: "0THB2O87P7ZOBIK",
    };
    let cashInfo = { cashGiven: total, changeGiven: 0 };

    if (
      order.payments &&
      Array.isArray(order.payments) &&
      order.payments.length > 0
    ) {
      const p = order.payments[0];
      if (
        ["card", "interac", "debit", "credit"].includes(p.method?.toLowerCase())
      ) {
        isCardPayment = true;
      } else if (p.method?.toLowerCase() === "cash") {
        isCardPayment = false;
        cashInfo.cashGiven = p.cashGiven || total;
        cashInfo.changeGiven = p.changeGiven || 0;
      }
    } else if (
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

    if (isCardPayment) {
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
