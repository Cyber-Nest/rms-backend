const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");
const Branch = require("../../company/models/branch.model");

const fmt = (val) => (typeof val === "number" && !isNaN(val) ? val.toFixed(2) : "0.00");

exports.generateDriverDropPdf = async ({ driver, date, type = "both", shiftNumber = 1, settlement, orders = [], branchId }, outputStream) => {
  try {
    const driverCode = driver?.driverId || driver?._id?.toString().slice(-4) || "EMP-001";
    const driverName = driver?.name || "DRIVER";

    let branchName = "PIZZA HUT";
    if (branchId) {
      try {
        const b = await Branch.findById(branchId).select("name code").lean();
        if (b && b.name) branchName = b.name.toUpperCase();
      } catch (e) {
        logger.warn(`Failed to fetch branch name for driver drop PDF: ${e.message}`);
      }
    }

    const formattedDate = new Date(date).toLocaleDateString("en-US", { timeZone: "America/Edmonton", month: "2-digit", day: "2-digit", year: "numeric" });
    const formattedTime = new Date().toLocaleTimeString("en-US", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    // Calculations (use settlement record if present, otherwise compute dynamically from orders list)
    const totalOrders = settlement?.totalOrders ?? orders.length;
    const totalCancels = settlement?.totalCancels ?? 0;
    const totalSales = settlement?.totalSales ?? orders.reduce((s, o) => s + (o.total || 0), 0);

    const calcPrepaidSales = orders.filter((o) => o.pd === "PP").reduce((s, o) => s + (o.total || 0), 0);
    const calcPrepaidTips = orders.reduce((s, o) => s + (o.prepaidTip || 0), 0);
    const calcTerminalSales = orders.filter((o) => o.pd === "TM").reduce((s, o) => s + (o.total || 0), 0);
    const calcTerminalTips = orders.reduce((s, o) => s + (o.terminalTip || 0), 0);
    const calcCashSales = orders.filter((o) => o.pd === "CS").reduce((s, o) => s + (o.total || 0), 0);

    const prepaidSales = settlement?.prepaidSales ?? calcPrepaidSales;
    const prepaidTips = settlement?.prepaidTips ?? calcPrepaidTips;
    const totalNewSales = settlement?.totalNewSales ?? Math.max(0, totalSales - prepaidSales - prepaidTips);

    const terminalSales = settlement?.terminalSales ?? calcTerminalSales;
    const terminalTips = settlement?.terminalTips ?? calcTerminalTips;
    const cashSales = settlement?.cashSales ?? calcCashSales;
    const saleDue = settlement?.saleDue ?? Math.max(0, totalNewSales - terminalSales - terminalTips - cashSales);

    const driverBaseCommission = settlement?.driverBaseCommission ?? (totalOrders * 6.0);
    const additionalCommission = settlement?.additionalCommission ?? 0;
    const driverTotalCommission = settlement?.driverTotalCommission ?? (driverBaseCommission + additionalCommission);
    const totalTipsEarned = settlement?.totalTipsEarned ?? (prepaidTips + terminalTips);
    const totalDriverEarning = settlement?.totalDriverEarning ?? (driverTotalCommission + totalTipsEarned);
    const totalCommissionDue = settlement?.totalCommissionDue ?? driverTotalCommission;

    // Height based on type
    const docHeight = type === "both" ? 1080 : 600;
    const doc = new PDFDocument({
      size: [226, docHeight],
      margin: 8,
    });

    doc.pipe(outputStream);

    const printableWidth = 210;
    const startX = 8;

    const drawDashedLine = () => {
      const lineStr = "----------------------------------------";
      doc.font("Courier").fontSize(8.5).text(lineStr, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);
    };

    const drawAsteriskLine = () => {
      const lineStr = "****************************************";
      doc.font("Courier").fontSize(8.5).text(lineStr, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);
    };

    const drawDoubleLine = () => {
      const y1 = doc.y;
      doc.moveTo(startX, y1).lineTo(startX + printableWidth, y1).strokeColor("#000000").lineWidth(1.5).stroke();
      doc.moveDown(0.2);
    };

    const drawRow = (left, right, isBold = false) => {
      const rowY = doc.y;
      doc.font(isBold ? "Courier-Bold" : "Courier").fontSize(8.5);
      doc.text(left, startX, rowY, { width: 135 });
      doc.text(right, startX + 135, rowY, { width: 75, align: "right" });
      doc.moveDown(0.25);
    };

    // ── SLIP 1: EMPLOYEE SALES REPORT SLIP ──
    if (type === "sales" || type === "both") {
      // Header Logo & Title
      doc.font("Courier-Bold").fontSize(13).text(branchName, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.3);
      drawDashedLine();

      doc.font("Courier-Bold").fontSize(9.5).text("------- Employee Sales Report -------", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier").fontSize(8.5);
      doc.text(`Employee: ${driverCode} - ${driverName}`, startX, doc.y);
      doc.text(`Shift: SHIFT ${shiftNumber}`, startX, doc.y);
      const timeRowY = doc.y;
      doc.text(formattedDate, startX, timeRowY);
      doc.text(formattedTime, startX + 120, timeRowY, { width: 90, align: "right" });
      doc.moveDown(0.3);
      drawDashedLine();

      // Order Details Section
      doc.font("Courier-Bold").fontSize(9.5).text("------- Order Details -------", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      const headerY = doc.y;
      doc.font("Courier-Bold").fontSize(8);
      doc.text("TICKET NAME", startX, headerY, { width: 90 });
      doc.text("TOTAL", startX + 90, headerY, { width: 42, align: "right" });
      doc.text("DC", startX + 132, headerY, { width: 35, align: "right" });
      doc.text("PD", startX + 167, headerY, { width: 43, align: "right" });
      doc.moveDown(0.3);
      drawDashedLine();

      if (orders && orders.length > 0) {
        orders.forEach((o) => {
          const rowY = doc.y;
          const tName = (o.ticketName || `${o.orderNumber || ""} ${o.customerName || ""}`).trim().slice(0, 15);
          doc.font("Courier").fontSize(8);
          doc.text(tName, startX, rowY, { width: 90 });
          doc.text(fmt(o.total), startX + 90, rowY, { width: 42, align: "right" });
          doc.text(fmt(o.dc || 6.0), startX + 132, rowY, { width: 35, align: "right" });
          doc.text(o.pd || "PP", startX + 167, rowY, { width: 43, align: "right" });
          doc.moveDown(0.25);
        });
      } else {
        doc.font("Courier-Oblique").fontSize(8).text("No orders delivered in this shift", startX, doc.y, { align: "center", width: printableWidth });
        doc.moveDown(0.3);
      }
      drawDashedLine();

      // Employee Sales Summary
      doc.font("Courier-Bold").fontSize(9.5).text("------- Employee Sales Summary -------", startX, doc.y, { align: "center", width: printableWidth });
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

      doc.font("Courier").fontSize(8).text("Printed for Driver Drop Reconciliation", startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(1.5);
    }

    // ── SLIP 2: DRIVER COMMISSION SETTLEMENT SLIP ──
    if (type === "commission" || type === "both") {
      if (type === "both") {
        doc.moveDown(1);
      }

      drawAsteriskLine();
      doc.font("Courier-Bold").fontSize(9.5);
      doc.text(`**      Driver Earning Report         **`, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier-Bold").fontSize(9.5);
      doc.text(`**               ${driverName.toUpperCase()}                  **`, startX, doc.y, { align: "center", width: printableWidth });
      doc.moveDown(0.2);

      doc.font("Courier").fontSize(8.5);
      doc.text(`**    SHIFT ${shiftNumber} - ${formattedDate} ${formattedTime}    **`, startX, doc.y, { align: "center", width: printableWidth });
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
      doc.font("Courier-Bold").fontSize(10.5);
      doc.text("Total Driver Earning", startX, totalRowY);
      doc.text(`$${fmt(totalDriverEarning)}`, startX + 120, totalRowY, { width: 90, align: "right" });
      doc.moveDown(0.3);
      drawDoubleLine();
      doc.moveDown(0.6);

      doc.font("Courier").fontSize(8.5).text("I have received the above amount in cash.", startX, doc.y);
      doc.moveDown(1.2);
      doc.font("Courier").fontSize(8.5).text("Signature: __________________________", startX, doc.y);
      doc.moveDown(0.8);
      drawAsteriskLine();
    }

    doc.end();
  } catch (error) {
    logger.error(`Error generating driver drop PDF: ${error.message}`);
    if (outputStream && typeof outputStream.headersSent !== "undefined" && !outputStream.headersSent) {
      outputStream.status(500).json({ success: false, message: "Failed to generate driver drop PDF" });
    }
  }
};

