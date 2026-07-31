const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");

const fmt = (val) => (typeof val === "number" && !isNaN(val) ? val.toFixed(2) : "0.00");

exports.generateDriverDropPdf = async ({ driver, date, type = "both", settlement, orders, branchId }, res) => {
  try {
    const driverCode = driver.driverId || "EMP-003";
    const driverName = driver.name || "DRIVER";

    const formattedDate = new Date(date).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const formattedTime = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    // Calculations
    const totalOrders = settlement ? settlement.totalOrders : orders.length;
    const totalCancels = 0;
    const totalSales = settlement ? settlement.totalSales : orders.reduce((s, o) => s + (o.total || 0), 0);
    const prepaidSales = settlement ? settlement.prepaidSales : orders.filter((o) => o.pd === "PP").reduce((s, o) => s + (o.total || 0), 0);
    const prepaidTips = settlement ? settlement.prepaidTips : orders.reduce((s, o) => s + (o.prepaidTip || 0), 0);
    const totalNewSales = settlement ? settlement.totalNewSales : Math.max(0, totalSales - prepaidSales - prepaidTips);
    const terminalSales = settlement ? settlement.terminalSales : 0;
    const terminalTips = settlement ? settlement.terminalTips : 0;
    const cashSales = settlement ? settlement.cashSales : 0;
    const saleDue = settlement ? settlement.saleDue : (totalNewSales - terminalSales - terminalTips - cashSales);

    const driverBaseCommission = settlement ? settlement.driverBaseCommission : totalOrders * 6.0;
    const additionalCommission = settlement ? settlement.additionalCommission : 0;
    const additionalReason = settlement ? settlement.additionalReason || "" : "";
    const driverTotalCommission = settlement ? settlement.driverTotalCommission : driverBaseCommission + additionalCommission;
    const totalTipsEarned = settlement ? settlement.totalTipsEarned : prepaidTips + terminalTips;
    const totalDriverEarning = settlement ? settlement.totalDriverEarning : driverTotalCommission + totalTipsEarned;
    const totalCommissionDue = settlement ? settlement.totalCommissionDue : driverTotalCommission;

    // Height based on type
    const docHeight = type === "both" ? 1000 : 550;
    const doc = new PDFDocument({
      size: [226, docHeight],
      margin: 8,
    });

    doc.pipe(res);

    const printableWidth = 210;
    const startX = 8;

    const drawDashedLine = () => {
      const lineStr = "----------------------------------------";
      doc.font("Courier").fontSize(8).text(lineStr, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);
    };

    const drawAsteriskLine = () => {
      const lineStr = "****************************************";
      doc.font("Courier").fontSize(8).text(lineStr, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);
    };

    const drawDoubleLine = () => {
      const y1 = doc.y;
      doc.moveTo(startX, y1).lineTo(startX + printableWidth, y1).strokeColor("#000000").lineWidth(1.5).stroke();
      doc.moveDown(0.2);
    };

    const drawRow = (left, right, isBold = false) => {
      const rowY = doc.y;
      doc.font(isBold ? "Courier-Bold" : "Courier").fontSize(8);
      doc.text(left, startX, rowY, { width: 140 });
      doc.text(right, startX + 140, rowY, { width: 70, align: "right" });
      doc.moveDown(0.25);
    };

    // ── SLIP 1: EMPLOYEE SALES REPORT SLIP ──
    if (type === "sales" || type === "both") {
      // Header Logo & Title
      doc.font("Courier-Bold").fontSize(12).text("Chicken", startX, doc.y, { align: "center", width: printableWidth });
      doc.font("Courier-Bold").fontSize(9).text("DELIGHT", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.3);
      drawDashedLine();

      doc.font("Courier-Bold").fontSize(8.5).text("------- Employee Sales Report -------", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier").fontSize(8);
      doc.text(`Employee: ${driverCode} - ${driverName}`, startX, doc.y);
      const timeRowY = doc.y;
      doc.text(formattedDate, startX, timeRowY);
      doc.text(formattedTime, startX + 130, timeRowY, { width: 80, align: "right" });
      doc.moveDown(0.3);
      drawDashedLine();

      // Order Details Section
      doc.font("Courier-Bold").fontSize(8.5).text("------- Order Details -------", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      const headerY = doc.y;
      doc.font("Courier-Bold").fontSize(7.5);
      doc.text("TICKET NAME", startX, headerY, { width: 95 });
      doc.text("TOTAL", startX + 95, headerY, { width: 40, align: "right" });
      doc.text("DC", startX + 135, headerY, { width: 35, align: "right" });
      doc.text("PD", startX + 170, headerY, { width: 40, align: "right" });
      doc.moveDown(0.3);
      drawDashedLine();

      if (orders && orders.length > 0) {
        orders.forEach((o) => {
          const rowY = doc.y;
          const tName = (o.ticketName || `${o.orderNumber || ""} ${o.customerName || ""}`).trim().slice(0, 16);
          doc.font("Courier").fontSize(7.5);
          doc.text(tName, startX, rowY, { width: 95 });
          doc.text(fmt(o.total), startX + 95, rowY, { width: 40, align: "right" });
          doc.text(fmt(o.dc || 6.0), startX + 135, rowY, { width: 35, align: "right" });
          doc.text(o.pd || "PP", startX + 170, rowY, { width: 40, align: "right" });
          doc.moveDown(0.25);
        });
      } else {
        doc.font("Courier-Oblique").fontSize(7.5).text("No orders delivered", startX, doc.y, { align: "center", width: printableWidth });
        doc.moveDown(0.3);
      }
      drawDashedLine();

      // Employee Sales Summary
      doc.font("Courier-Bold").fontSize(8.5).text("------- Employee Sales Summary -------", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.3);

      drawRow("Total Orders.....:", String(totalOrders));
      drawRow("Total Cancels....:", String(totalCancels));
      doc.moveDown(0.3);

      drawRow("Total Sales......:", fmt(totalSales), true);
      drawRow("- Prepaid Sales..:", fmt(prepaidSales));
      drawRow("- Prepaid Tips...:", fmt(prepaidTips));
      drawDashedLine();

      drawRow("= Total New Sales:", fmt(totalNewSales), true);
      doc.moveDown(0.2);

      drawRow("- Terminal Sales.:", fmt(terminalSales));
      drawRow("- Terminal Tips..:", fmt(terminalTips));
      drawRow("- Cash Sales.....:", fmt(cashSales));
      drawDoubleLine();

      drawRow("= Sale Due.......:", fmt(saleDue), true);
      drawDashedLine();

      drawRow("Total Prepaid Tips......:", fmt(prepaidTips));
      drawRow("Total Terminal Tips.....:", fmt(terminalTips));
      drawDashedLine();

      drawRow("(Total Tips Due:", `${fmt(prepaidTips + terminalTips)})`, true);
      drawRow("(Total Commission Due:", `${fmt(totalCommissionDue)})`, true);
      doc.moveDown(0.5);

      doc.font("Courier").fontSize(7.5).text("Printed for Driver Drop Reconciliation", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(1.5);
    }

    // ── SLIP 2: DRIVER COMMISSION SETTLEMENT SLIP ──
    if (type === "commission" || type === "both") {
      if (type === "both") {
        doc.moveDown(1);
      }

      drawAsteriskLine();
      doc.font("Courier-Bold").fontSize(8.5);
      doc.text(`**      Driver Earning Report         **`, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier-Bold").fontSize(8.5);
      doc.text(`**               ${driverName.toUpperCase()}                  **`, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier").fontSize(8);
      doc.text(`**        ${formattedDate} ${formattedTime}         **`, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);
      drawAsteriskLine();
      doc.moveDown(0.4);

      // TIPS SECTION
      drawRow("Prepaid Tips", fmt(prepaidTips));
      drawRow("Terminal Tips", fmt(terminalTips));
      drawDashedLine();
      drawRow("Total Tips", fmt(prepaidTips + terminalTips), true);
      doc.moveDown(0.4);

      // COMMISSION SECTION
      drawRow("Driver Base commission", fmt(driverBaseCommission));
      if (additionalCommission > 0) {
        drawRow("Driver Additional commission", fmt(additionalCommission));
      }
      drawRow("Driver Total Commission", fmt(driverTotalCommission), true);
      drawDoubleLine();

      // GRAND TOTAL
      doc.moveDown(0.2);
      const totalRowY = doc.y;
      doc.font("Courier-Bold").fontSize(9.5);
      doc.text("Total Driver Earning", startX, totalRowY);
      doc.text(`$${fmt(totalDriverEarning)}`, startX + 130, totalRowY, { width: 80, align: "right" });
      doc.moveDown(0.3);
      drawDoubleLine();
      doc.moveDown(0.6);

      doc.font("Courier").fontSize(8).text("I have received the above amount in cash.", startX, doc.y);
      doc.moveDown(1.2);
      doc.font("Courier").fontSize(8).text("Signature: __________________________", startX, doc.y);
      doc.moveDown(0.8);
      drawAsteriskLine();
    }

    doc.end();
  } catch (error) {
    logger.error(`Error generating driver drop PDF: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Failed to generate driver drop PDF" });
    }
  }
};
