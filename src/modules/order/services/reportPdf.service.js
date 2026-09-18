const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");
const Branch = require("../../company/models/branch.model");

exports.generateReportPdf = async (type, data, dateRangeStr, res, branchId = null) => {
  try {
    let branchName = "Chicken Delight";
    let branchCode = "";

    if (branchId) {
      try {
        const b = await Branch.findById(branchId).lean();
        if (b) {
          if (b.name) branchName = b.name;
          if (b.code) branchCode = `[${b.code}] `;
        }
      } catch (err) {
        logger.warn(`Could not fetch branch info for report PDF: ${err.message}`);
      }
    }

    const isLandscape = type === "monthly_sales_summary";
    const doc = new PDFDocument({
      size: "LETTER",
      layout: isLandscape ? "landscape" : "portrait",
      margin: 40,
    });

    doc.pipe(res);

    const titleMap = {
      item_sales: "Item Sales Report",
      hourly_sales: "Hourly Sales Report",
      cash_out_summary: "Cash Out By Employee Summary",
      monthly_sales_summary: "Monthly Sales Summary (Accounting)",
      failed_transaction: "Failed Transactions Report",
      refund_orders: "Refund Orders Report",
    };

    const reportTitle = titleMap[type] || "Sales Report";
    const pageWidth = isLandscape ? 792 : 612;
    const printableWidth = pageWidth - 80; // margins 40 on each side

    // 1. Header Section (For standard reports)
    if (type !== "monthly_sales_summary") {
      doc
        .font("Helvetica-Bold")
        .fontSize(20)
        .fillColor("#8a1538") // Brand primary color
        .text(`${branchCode}${branchName}`, 40, doc.y, { align: "center", width: printableWidth });

      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor("#1C1917")
        .text(reportTitle, 40, doc.y + 6, { align: "center", width: printableWidth });

      doc
        .font("Helvetica-Oblique")
        .fontSize(9.5)
        .fillColor("#57534E")
        .text(`Period: ${dateRangeStr}`, 40, doc.y + 4, { align: "center", width: printableWidth });

      doc.moveDown(1.5);
    }

    // 2. Table Generator Helpers
    const drawTableHeader = (headers, columnWidths, startX) => {
      const headerY = doc.y;
      doc.rect(startX, headerY - 4, printableWidth, 18).fill("#1C1917"); // Dark background
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);

      let currentX = startX;
      headers.forEach((h, i) => {
        const align = h.align || "left";
        const label = h.label;
        doc.text(label, currentX + 5, headerY, {
          width: columnWidths[i] - 10,
          align: align,
        });
        currentX += columnWidths[i];
      });
      doc.y = headerY + 18;
      doc.fillColor("#1C1917"); // reset text color
    };

    const drawTableRow = (cells, columnWidths, startX, isBold = false, bgColor = null) => {
      const rowY = doc.y;
      if (bgColor) {
        doc.rect(startX, rowY - 3, printableWidth, 15).fill(bgColor);
      }
      doc.fillColor(bgColor === "#8a1538" ? "#FFFFFF" : "#1C1917");
      doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);

      let currentX = startX;
      cells.forEach((cell, i) => {
        const align = cell.align || "left";
        const val = cell.value;
        doc.text(String(val), currentX + 5, rowY, {
          width: columnWidths[i] - 10,
          align: align,
        });
        currentX += columnWidths[i];
      });

      // Draw thin bottom divider
      doc
        .moveTo(startX, rowY + 12)
        .lineTo(startX + printableWidth, rowY + 12)
        .strokeColor("#E7E5E4")
        .lineWidth(0.5)
        .stroke();

      doc.y = rowY + 16;
    };

    // Helper for currency
    const fmt = (num) => `$${(num || 0).toFixed(2)}`;

    // 3. Render specific report structures
    const startX = 40;

    if (type === "item_sales") {
      const headers = [
        { label: "Item Name", align: "left" },
        { label: "Product ID", align: "center" },
        { label: "# Sold", align: "center" },
        { label: "Sales", align: "right" },
        { label: "% Sales", align: "right" },
      ];
      const widths = [
        printableWidth * 0.4,
        printableWidth * 0.15,
        printableWidth * 0.15,
        printableWidth * 0.15,
        printableWidth * 0.15,
      ];

      drawTableHeader(headers, widths, startX);

      // Grouped Category Sales Data structure
      data.forEach((group) => {
        // Category header row
        const catRowY = doc.y;
        doc.rect(startX, catRowY - 3, printableWidth, 15).fill("#8a1538");
        doc
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .fillColor("#FFFFFF")
          .text(group.categoryName.toUpperCase(), startX + 5, catRowY, { width: printableWidth - 10 });
        doc.y = catRowY + 16;

        // Items inside category
        group.items.forEach((item) => {
          drawTableRow(
            [
              { value: item.name, align: "left" },
              { value: item.productId || "M----", align: "center" },
              { value: item.quantitySold, align: "center" },
              { value: fmt(item.totalSales), align: "right" },
              { value: `${item.percentageSales.toFixed(2)}%`, align: "right" },
            ],
            widths,
            startX
          );
        });

        // Subtotal row
        drawTableRow(
          [
            { value: `Subtotal (${group.categoryName})`, align: "left" },
            { value: "", align: "center" },
            { value: group.subtotalSold, align: "center" },
            { value: fmt(group.subtotalSales), align: "right" },
            { value: "", align: "right" },
          ],
          widths,
          startX,
          true,
          "#F5F5F4"
        );
        doc.moveDown(0.3);
      });

    } else if (type === "hourly_sales") {
      const headers = [
        { label: "Time Slot", align: "left" },
        { label: "# Orders", align: "center" },
        { label: "Total Sales", align: "right" },
      ];
      const widths = [printableWidth * 0.4, printableWidth * 0.25, printableWidth * 0.35];

      drawTableHeader(headers, widths, startX);

      const activeSlots = data.filter((slot) => slot.orderCount > 0 || (slot.startHour >= 10 && slot.startHour <= 21));
      let grandOrders = 0;
      let grandSales = 0;

      activeSlots.forEach((slot) => {
        grandOrders += slot.orderCount;
        grandSales += slot.totalSales;
        drawTableRow(
          [
            { value: slot.label, align: "left" },
            { value: slot.orderCount, align: "center" },
            { value: fmt(slot.totalSales), align: "right" },
          ],
          widths,
          startX
        );
      });

      doc.moveDown(0.3);
      drawTableRow(
        [
          { value: "GRAND TOTAL", align: "left" },
          { value: grandOrders, align: "center" },
          { value: fmt(grandSales), align: "right" },
        ],
        widths,
        startX,
        true,
        "#f7cbd4"
      );

    } else if (type === "cash_out_summary") {
      const headers = [
        { label: "Employee Name", align: "left" },
        { label: "# of Orders", align: "center" },
        { label: "Last Cash Out Date", align: "center" },
        { label: "Total Cash Out Amount", align: "right" },
      ];
      const widths = [
        printableWidth * 0.3,
        printableWidth * 0.2,
        printableWidth * 0.25,
        printableWidth * 0.25,
      ];

      drawTableHeader(headers, widths, startX);

      let grandTotal = 0;
      let grandOrders = 0;

      const formatDate = (dateStr) => {
        try {
          const d = new Date(dateStr);
          return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        } catch {
          return dateStr;
        }
      };

      data.forEach((item) => {
        grandOrders += item.orderCount;
        grandTotal += item.totalAmount;
        drawTableRow(
          [
            { value: item.employeeName, align: "left" },
            { value: item.orderCount, align: "center" },
            { value: formatDate(item.lastCashOut), align: "center" },
            { value: fmt(item.totalAmount), align: "right" },
          ],
          widths,
          startX
        );
      });

      doc.moveDown(0.3);
      drawTableRow(
        [
          { value: "TOTAL", align: "left" },
          { value: grandOrders, align: "center" },
          { value: "", align: "center" },
          { value: fmt(grandTotal), align: "right" },
        ],
        widths,
        startX,
        true,
        "#f7cbd4"
      );

    } else if (type === "monthly_sales_summary") {
      // ── SMART AGGREGATION & TRANSPOSED MATRIX PDF LAYOUT ──

      // Helper function to aggregate an array of row objects into a single summary column object
      const aggregateRows = (rowList, labelName) => {
        const combined = {
          date: labelName,
          label: labelName,
          salesSummary: { subtotal: 0, deliveryCharges: 0, discount: 0, tax: 0, grandTotal: 0, tips: 0, finalAmount: 0 },
          paymentType: { cash: 0, accountPay: 0, creditCardSales: 0, debitCardSales: 0, grandTotal: 0, debitTips: 0, creditTips: 0, finalAmount: 0 },
          orderType: { takeout: 0, dineIn: 0, delivery: 0, driveThrough: 0, total: 0 },
          orders: { completed: 0, paidCancelled: 0, unpaidCancelled: 0, refund: 0, refundAmount: 0 },
          taxBreakdown: { pst: 0, gst: 0, hst: 0, total: 0 },
          cardType: { interac: 0, visa: 0, mastercard: 0, giftCard: 0 },
          online: { website: 0, uber: 0, skip: 0, doordash: 0, total: 0 },
          pos: { posSales: 0, total: 0 },
          expense: { amount: 0 },
          shortage: { shortage: 0, overage: 0 },
          deposit: { cash: 0, card: 0, accountPay: 0 },
        };

        rowList.forEach((r) => {
          combined.salesSummary.subtotal += r.salesSummary?.subtotal || 0;
          combined.salesSummary.deliveryCharges += r.salesSummary?.deliveryCharges || 0;
          combined.salesSummary.discount += r.salesSummary?.discount || 0;
          combined.salesSummary.tax += r.salesSummary?.tax || 0;
          combined.salesSummary.grandTotal += r.salesSummary?.grandTotal || 0;
          combined.salesSummary.tips += r.salesSummary?.tips || 0;
          combined.salesSummary.finalAmount += r.salesSummary?.finalAmount || 0;

          combined.paymentType.cash += r.paymentType?.cash || 0;
          combined.paymentType.accountPay += r.paymentType?.accountPay || 0;
          combined.paymentType.creditCardSales += r.paymentType?.creditCardSales || 0;
          combined.paymentType.debitCardSales += r.paymentType?.debitCardSales || 0;
          combined.paymentType.grandTotal += r.paymentType?.grandTotal || 0;
          combined.paymentType.debitTips += r.paymentType?.debitTips || 0;
          combined.paymentType.creditTips += r.paymentType?.creditTips || 0;
          combined.paymentType.finalAmount += r.paymentType?.finalAmount || 0;

          combined.orderType.takeout += r.orderType?.takeout || 0;
          combined.orderType.dineIn += r.orderType?.dineIn || 0;
          combined.orderType.delivery += r.orderType?.delivery || 0;
          combined.orderType.driveThrough += r.orderType?.driveThrough || 0;
          combined.orderType.total += r.orderType?.total || 0;

          combined.orders.completed += r.orders?.completed || 0;
          combined.orders.paidCancelled += r.orders?.paidCancelled || 0;
          combined.orders.unpaidCancelled += r.orders?.unpaidCancelled || 0;
          combined.orders.refund += r.orders?.refund || 0;
          combined.orders.refundAmount += r.orders?.refundAmount || 0;

          combined.taxBreakdown.pst += r.taxBreakdown?.pst || 0;
          combined.taxBreakdown.gst += r.taxBreakdown?.gst || 0;
          combined.taxBreakdown.hst += r.taxBreakdown?.hst || 0;
          combined.taxBreakdown.total += r.taxBreakdown?.total || 0;

          combined.cardType.interac += r.cardType?.interac || 0;
          combined.cardType.visa += r.cardType?.visa || 0;
          combined.cardType.mastercard += r.cardType?.mastercard || 0;
          combined.cardType.giftCard += r.cardType?.giftCard || 0;

          combined.online.website += r.online?.website || 0;
          combined.online.uber += r.online?.uber || 0;
          combined.online.skip += r.online?.skip || 0;
          combined.online.doordash += r.online?.doordash || 0;
          combined.online.total += r.online?.total || 0;

          combined.pos.posSales += r.pos?.posSales || 0;
          combined.pos.total += r.pos?.total || 0;

          combined.expense.amount += r.expense?.amount || 0;
          combined.shortage.shortage += r.shortage?.shortage || 0;
          combined.shortage.overage += r.shortage?.overage || 0;

          combined.deposit.cash += r.deposit?.cash || 0;
          combined.deposit.card += r.deposit?.card || 0;
          combined.deposit.accountPay += r.deposit?.accountPay || 0;
        });

        return combined;
      };

      // Determine smart grouping based on total days count & date patterns
      let processedColumnsData = [];

      if (data.length >= 15 && data.length <= 31) {
        // ── SINGLE MONTH OR CUSTOM MONTHLY RANGE (15-31 Days) ──
        // Group into 7-day weeks + remaining days with accurate day labels
        const getDayNum = (r, defaultNum) => {
          if (!r || !r.date) return defaultNum;
          if (r.date.includes("-")) {
            const p = r.date.split("-");
            if (p.length >= 3) return parseInt(p[2], 10) || defaultNum;
          } else if (r.date.includes("/")) {
            const p = r.date.split("/");
            if (p.length >= 2) return parseInt(p[1], 10) || defaultNum;
          }
          return defaultNum;
        };

        const w1 = data.slice(0, 7);
        const w2 = data.slice(7, 14);
        const w3 = data.slice(14, 21);
        const w4 = data.slice(21, 28);
        const remaining = data.slice(28);

        if (w1.length > 0) {
          const s1 = getDayNum(w1[0], 1);
          const e1 = getDayNum(w1[w1.length - 1], w1.length);
          const label1 = w1.length === 7 ? `Week 1 (${s1}-${e1})` : s1 === e1 ? `Day ${s1}` : `Days ${s1}-${e1}`;
          processedColumnsData.push(aggregateRows(w1, label1));
        }

        if (w2.length > 0) {
          const s2 = getDayNum(w2[0], 8);
          const e2 = getDayNum(w2[w2.length - 1], 7 + w2.length);
          const label2 = w2.length === 7 ? `Week 2 (${s2}-${e2})` : s2 === e2 ? `Day ${s2}` : `Days ${s2}-${e2}`;
          processedColumnsData.push(aggregateRows(w2, label2));
        }

        if (w3.length > 0) {
          const s3 = getDayNum(w3[0], 15);
          const e3 = getDayNum(w3[w3.length - 1], 14 + w3.length);
          const label3 = w3.length === 7 ? `Week 3 (${s3}-${e3})` : s3 === e3 ? `Day ${s3}` : `Days ${s3}-${e3}`;
          processedColumnsData.push(aggregateRows(w3, label3));
        }

        if (w4.length > 0) {
          const s4 = getDayNum(w4[0], 22);
          const e4 = getDayNum(w4[w4.length - 1], 21 + w4.length);
          const label4 = w4.length === 7 ? `Week 4 (${s4}-${e4})` : s4 === e4 ? `Day ${s4}` : `Days ${s4}-${e4}`;
          processedColumnsData.push(aggregateRows(w4, label4));
        }

        if (remaining.length > 0) {
          const sRem = getDayNum(remaining[0], 29);
          const eRem = getDayNum(remaining[remaining.length - 1], 28 + remaining.length);
          const labelRem = sRem === eRem ? `Day ${sRem}` : `Days ${sRem}-${eRem}`;
          processedColumnsData.push(aggregateRows(remaining, labelRem));
        }
      } else if (data.length > 31) {
        // ── MULTI-MONTH OR YEARLY VIEW (32+ Days) ──
        // Group by Month (e.g. "Aug 2026" or "2026-08")
        const monthGroups = {};
        const monthOrder = [];

        data.forEach((r) => {
          let monthKey = "Month";
          if (r.date) {
            if (r.date.includes("-")) {
              const parts = r.date.split("-");
              if (parts.length >= 2) {
                const year = parts[0];
                const monthNum = parseInt(parts[1], 10);
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                monthKey = `${monthNames[monthNum - 1] || parts[1]} ${year}`;
              }
            } else if (r.date.includes("/")) {
              const parts = r.date.split("/");
              if (parts.length >= 3) {
                const monthNum = parseInt(parts[0], 10);
                const year = parts[2];
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                monthKey = `${monthNames[monthNum - 1] || parts[0]} ${year}`;
              }
            }
          }
          if (!monthGroups[monthKey]) {
            monthGroups[monthKey] = [];
            monthOrder.push(monthKey);
          }
          monthGroups[monthKey].push(r);
        });

        monthOrder.forEach((mKey) => {
          processedColumnsData.push(aggregateRows(monthGroups[mKey], mKey));
        });
      } else {
        // ── SHORT RANGE VIEW (<= 14 Days) ──
        processedColumnsData = data.map((r) => ({ ...r, label: r.date }));
      }

      // Chunk into batches of up to 7 columns so each chunk fits cleanly on 1 landscape page
      const chunkSize = 7;
      const chunks = [];
      for (let i = 0; i < processedColumnsData.length; i += chunkSize) {
        chunks.push(processedColumnsData.slice(i, i + chunkSize));
      }

      // Calculate period grand totals
      const grandAccum = data.reduce(
        (acc, r) => {
          acc.subtotal += r.salesSummary.subtotal;
          acc.deliveryCharges += r.salesSummary.deliveryCharges;
          acc.discount += r.salesSummary.discount;
          acc.tax += r.salesSummary.tax;
          acc.grandTotal += r.salesSummary.grandTotal;
          acc.tips += r.salesSummary.tips;
          acc.finalAmount += r.salesSummary.finalAmount;

          acc.cash += r.paymentType.cash;
          acc.accountPay += r.paymentType.accountPay;
          acc.creditSales += r.paymentType.creditCardSales;
          acc.debitSales += r.paymentType.debitCardSales;
          acc.paymentGrand += r.paymentType.grandTotal;
          acc.debitTips += r.paymentType.debitTips;
          acc.creditTips += r.paymentType.creditTips;
          acc.paymentFinal += r.paymentType.finalAmount;

          acc.takeout += r.orderType.takeout;
          acc.dineIn += r.orderType.dineIn;
          acc.delivery += r.orderType.delivery;
          acc.driveThrough += r.orderType.driveThrough;
          acc.orderTypeTotal += r.orderType.total;

          acc.completed += r.orders.completed;
          acc.paidCancelled += r.orders.paidCancelled;
          acc.unpaidCancelled += r.orders.unpaidCancelled;
          acc.refund += r.orders.refund;
          acc.refundAmount += r.orders.refundAmount;

          acc.pst += r.taxBreakdown.pst;
          acc.gst += r.taxBreakdown.gst;
          acc.hst += r.taxBreakdown.hst;
          acc.taxTotal += r.taxBreakdown.total;

          acc.interac += r.cardType.interac;
          acc.visa += r.cardType.visa;
          acc.mastercard += r.cardType.mastercard;
          acc.giftCard += r.cardType.giftCard || 0;

          acc.website += r.online.website;
          acc.uber += r.online.uber;
          acc.skip += r.online.skip;
          acc.doordash += r.online.doordash;
          acc.onlineTotal += r.online.total;

          acc.posSales += r.pos.posSales;
          acc.posTotal += r.pos.total;

          acc.expense += r.expense.amount;
          acc.shortage += r.shortage?.shortage || 0;
          acc.overage += r.shortage?.overage || 0;

          acc.depCash += r.deposit.cash;
          acc.depCard += r.deposit.card;
          acc.depAccountPay += r.deposit.accountPay;

          return acc;
        },
        {
          subtotal: 0, deliveryCharges: 0, discount: 0, tax: 0, grandTotal: 0, tips: 0, finalAmount: 0,
          cash: 0, accountPay: 0, creditSales: 0, debitSales: 0, paymentGrand: 0, debitTips: 0, creditTips: 0, paymentFinal: 0,
          takeout: 0, dineIn: 0, delivery: 0, driveThrough: 0, orderTypeTotal: 0,
          completed: 0, paidCancelled: 0, unpaidCancelled: 0, refund: 0, refundAmount: 0,
          pst: 0, gst: 0, hst: 0, taxTotal: 0,
          interac: 0, visa: 0, mastercard: 0, giftCard: 0,
          website: 0, uber: 0, skip: 0, doordash: 0, onlineTotal: 0,
          posSales: 0, posTotal: 0,
          expense: 0, shortage: 0, overage: 0,
          depCash: 0, depCard: 0, depAccountPay: 0,
        }
      );

      // Render each 7-day chunk
      chunks.forEach((chunk, chunkIdx) => {
        if (chunkIdx > 0) {
          doc.addPage({ size: "LETTER", layout: "landscape", margin: 30 });
        }

        const margin = 30;
        const pageW = 792;
        const printW = pageW - margin * 2; // 732pt

        // Title Header (Single clean header)
        doc.font("Helvetica-Bold").fontSize(15).fillColor("#8a1538")
           .text(`${branchCode}${branchName}`, margin, 18, { align: "center", width: printW });
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1917")
           .text(`Monthly Sales Summary (Accounting)${chunks.length > 1 ? ` — Part ${chunkIdx + 1} of ${chunks.length}` : ""}`, margin, 36, { align: "center", width: printW });
        doc.font("Helvetica-Oblique").fontSize(8).fillColor("#57534E")
           .text(`Period: ${dateRangeStr}`, margin, 50, { align: "center", width: printW });

        // Dynamic Column Width Calculation across full 732pt width
        const colLabelW = 180;
        const colTotalW = 85;
        const numDays = chunk.length;
        const colDayW = Math.floor((printW - colLabelW - colTotalW) / numDays);
        const startY = 64;
        doc.y = startY;

        // Draw Table Header Bar
        const drawHeaderBar = (yPos) => {
          doc.rect(margin, yPos, printW, 17).fill("#1C1917");
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF");
          doc.text("METRIC / CATEGORY", margin + 6, yPos + 3.5, { width: colLabelW - 10, align: "left" });

          chunk.forEach((row, dIdx) => {
            const x = margin + colLabelW + dIdx * colDayW;
            const headerLabel = row.label || row.date || "";
            doc.text(headerLabel, x, yPos + 3.5, { width: colDayW - 4, align: "right" });
          });
          const totalX = margin + colLabelW + numDays * colDayW;
          doc.text(chunkIdx === chunks.length - 1 ? "PERIOD TOTAL" : "CHUNK TOTAL", totalX, yPos + 3.5, { width: colTotalW - 4, align: "right" });
        };

        drawHeaderBar(startY);
        doc.y = startY + 20;

        // Calculate chunk totals
        const chunkTot = chunk.reduce((acc, r) => {
          acc.subtotal += r.salesSummary.subtotal;
          acc.deliveryCharges += r.salesSummary.deliveryCharges;
          acc.discount += r.salesSummary.discount;
          acc.tax += r.salesSummary.tax;
          acc.grandTotal += r.salesSummary.grandTotal;
          acc.tips += r.salesSummary.tips;
          acc.finalAmount += r.salesSummary.finalAmount;

          acc.cash += r.paymentType.cash;
          acc.accountPay += r.paymentType.accountPay;
          acc.creditSales += r.paymentType.creditCardSales;
          acc.debitSales += r.paymentType.debitCardSales;
          acc.paymentGrand += r.paymentType.grandTotal;
          acc.debitTips += r.paymentType.debitTips;
          acc.creditTips += r.paymentType.creditTips;
          acc.paymentFinal += r.paymentType.finalAmount;

          acc.takeout += r.orderType.takeout;
          acc.dineIn += r.orderType.dineIn;
          acc.delivery += r.orderType.delivery;
          acc.driveThrough += r.orderType.driveThrough;
          acc.orderTypeTotal += r.orderType.total;

          acc.completed += r.orders.completed;
          acc.paidCancelled += r.orders.paidCancelled;
          acc.unpaidCancelled += r.orders.unpaidCancelled;
          acc.refund += r.orders.refund;
          acc.refundAmount += r.orders.refundAmount;

          acc.pst += r.taxBreakdown.pst;
          acc.gst += r.taxBreakdown.gst;
          acc.hst += r.taxBreakdown.hst;
          acc.taxTotal += r.taxBreakdown.total;

          acc.interac += r.cardType.interac;
          acc.visa += r.cardType.visa;
          acc.mastercard += r.cardType.mastercard;
          acc.giftCard += r.cardType.giftCard || 0;

          acc.website += r.online.website;
          acc.uber += r.online.uber;
          acc.skip += r.online.skip;
          acc.doordash += r.online.doordash;
          acc.onlineTotal += r.online.total;

          acc.posSales += r.pos.posSales;
          acc.posTotal += r.pos.total;

          acc.expense += r.expense.amount;
          acc.shortage += r.shortage?.shortage || 0;
          acc.overage += r.shortage?.overage || 0;

          acc.depCash += r.deposit.cash;
          acc.depCard += r.deposit.card;
          acc.depAccountPay += r.deposit.accountPay;

          return acc;
        }, {
          subtotal: 0, deliveryCharges: 0, discount: 0, tax: 0, grandTotal: 0, tips: 0, finalAmount: 0,
          cash: 0, accountPay: 0, creditSales: 0, debitSales: 0, paymentGrand: 0, debitTips: 0, creditTips: 0, paymentFinal: 0,
          takeout: 0, dineIn: 0, delivery: 0, driveThrough: 0, orderTypeTotal: 0,
          completed: 0, paidCancelled: 0, unpaidCancelled: 0, refund: 0, refundAmount: 0,
          pst: 0, gst: 0, hst: 0, taxTotal: 0,
          interac: 0, visa: 0, mastercard: 0, giftCard: 0,
          website: 0, uber: 0, skip: 0, doordash: 0, onlineTotal: 0,
          posSales: 0, posTotal: 0, expense: 0, shortage: 0, overage: 0,
          depCash: 0, depCard: 0, depAccountPay: 0
        });

        // Use period grand total if it's the last chunk, else chunk total
        const effTot = chunkIdx === chunks.length - 1 ? grandAccum : chunkTot;

        // Row Helper with Overflow Protection
        const renderRow = (label, getVal, getTotVal, isSection = false, isBold = false, isHighlight = false) => {
          let currentY = doc.y;

          // If row would exceed printable page height (515pt), spawn continuous page cleanly
          if (currentY > 515) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 30 });
            doc.font("Helvetica-Bold").fontSize(10).fillColor("#8a1538")
               .text(`${branchCode}${branchName} — Monthly Sales Summary (Continued)`, margin, 18, { align: "center", width: printW });
            currentY = 34;
            drawHeaderBar(currentY);
            currentY += 20;
            doc.y = currentY;
          }

          if (isSection) {
            doc.rect(margin, currentY - 1, printW, 14).fill("#8a1538");
            doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF");
            doc.text(label.toUpperCase(), margin + 6, currentY + 1.5, { width: printW - 10 });
            doc.y = currentY + 15;
            return;
          }

          if (isHighlight) {
            doc.rect(margin, currentY - 1, printW, 13).fill("#FEF2F2");
          }

          doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(9.0).fillColor("#1C1917");
          doc.text(label, margin + 8, currentY + 0.5, { width: colLabelW - 12, align: "left" });

          chunk.forEach((row, dIdx) => {
            const x = margin + colLabelW + dIdx * colDayW;
            const val = getVal(row);
            doc.text(String(val), x, currentY + 0.5, { width: colDayW - 4, align: "right" });
          });

          const totalX = margin + colLabelW + numDays * colDayW;
          const totVal = getTotVal();
          doc.font("Helvetica-Bold");
          doc.text(String(totVal), totalX, currentY + 0.5, { width: colTotalW - 4, align: "right" });

          doc.moveTo(margin, currentY + 12).lineTo(margin + printW, currentY + 12).strokeColor("#E7E5E4").lineWidth(0.25).stroke();
          doc.y = currentY + 13.5;
        };

        // ── 1. SALES SUMMARY ──
        renderRow("1. SALES SUMMARY", null, null, true);
        renderRow("Sub Total", (r) => fmt(r.salesSummary.subtotal), () => fmt(effTot.subtotal));
        renderRow("Delivery Charges", (r) => fmt(r.salesSummary.deliveryCharges), () => fmt(effTot.deliveryCharges));
        renderRow("Discount", (r) => `(${fmt(r.salesSummary.discount)})`, () => `(${fmt(effTot.discount)})`);
        renderRow("Tax (GST)", (r) => fmt(r.salesSummary.tax), () => fmt(effTot.tax));
        renderRow("Grand Total", (r) => fmt(r.salesSummary.grandTotal), () => fmt(effTot.grandTotal), false, true);
        renderRow("Tips", (r) => fmt(r.salesSummary.tips), () => fmt(effTot.tips));
        renderRow("Final Amount", (r) => fmt(r.salesSummary.finalAmount), () => fmt(effTot.finalAmount), false, true, true);

        // ── 2. PAYMENT TYPE ──
        renderRow("2. PAYMENT TYPE", null, null, true);
        renderRow("Cash Sales", (r) => fmt(r.paymentType.cash), () => fmt(effTot.cash));
        renderRow("Account Pay", (r) => fmt(r.paymentType.accountPay), () => fmt(effTot.accountPay));
        renderRow("Credit Card Sales", (r) => fmt(r.paymentType.creditCardSales), () => fmt(effTot.creditSales));
        renderRow("Debit Card Sales", (r) => fmt(r.paymentType.debitCardSales), () => fmt(effTot.debitSales));
        renderRow("Grand Total", (r) => fmt(r.paymentType.grandTotal), () => fmt(effTot.paymentGrand), false, true);
        renderRow("Debit Card Tips", (r) => fmt(r.paymentType.debitTips), () => fmt(effTot.debitTips));
        renderRow("Credit Card Tips", (r) => fmt(r.paymentType.creditTips), () => fmt(effTot.creditTips));
        renderRow("Final Amount", (r) => fmt(r.paymentType.finalAmount), () => fmt(effTot.paymentFinal), false, true, true);

        // ── 3. ORDER TYPE ──
        renderRow("3. ORDER TYPE", null, null, true);
        renderRow("Take-Out", (r) => fmt(r.orderType.takeout), () => fmt(effTot.takeout));
        renderRow("Dine-in", (r) => fmt(r.orderType.dineIn), () => fmt(effTot.dineIn));
        renderRow("Delivery", (r) => fmt(r.orderType.delivery), () => fmt(effTot.delivery));
        renderRow("Drive-Through", (r) => fmt(r.orderType.driveThrough), () => fmt(effTot.driveThrough));
        renderRow("Total Order Type", (r) => fmt(r.orderType.total), () => fmt(effTot.orderTypeTotal), false, true);

        // ── 4. ORDERS COUNT ──
        renderRow("4. ORDERS COUNT", null, null, true);
        renderRow("Completed", (r) => r.orders.completed, () => effTot.completed, false, true);
        renderRow("Paid Cancelled", (r) => r.orders.paidCancelled, () => effTot.paidCancelled);
        renderRow("Unpaid Cancelled", (r) => r.orders.unpaidCancelled, () => effTot.unpaidCancelled);
        renderRow("Refund Orders", (r) => r.orders.refund, () => effTot.refund);
        renderRow("Refund Amount", (r) => fmt(r.orders.refundAmount), () => fmt(effTot.refundAmount));

        // ── 5. TAX BREAKDOWN ──
        renderRow("5. TAX BREAKDOWN", null, null, true);
        renderRow("PST", (r) => fmt(r.taxBreakdown.pst), () => fmt(effTot.pst));
        renderRow("GST", (r) => fmt(r.taxBreakdown.gst), () => fmt(effTot.gst));
        renderRow("HST", (r) => fmt(r.taxBreakdown.hst), () => fmt(effTot.hst));
        renderRow("Total Tax", (r) => fmt(r.taxBreakdown.total), () => fmt(effTot.taxTotal), false, true);

        // ── 6. CARD TYPE BREAKDOWN ──
        renderRow("6. CARD TYPE BREAKDOWN", null, null, true);
        renderRow("INTERAC / DEBIT", (r) => fmt(r.cardType.interac), () => fmt(effTot.interac));
        renderRow("VISA", (r) => fmt(r.cardType.visa), () => fmt(effTot.visa));
        renderRow("MASTERCARD", (r) => fmt(r.cardType.mastercard), () => fmt(effTot.mastercard));
        renderRow("GIFT CARD", (r) => fmt(r.cardType.giftCard || 0), () => fmt(effTot.giftCard));

        // ── 7. ONLINE CHANNELS ──
        renderRow("7. ONLINE CHANNELS", null, null, true);
        renderRow("Website", (r) => fmt(r.online.website), () => fmt(effTot.website));
        renderRow("Uber Eats", (r) => fmt(r.online.uber), () => fmt(effTot.uber));
        renderRow("Skip The Dishes", (r) => fmt(r.online.skip), () => fmt(effTot.skip));
        renderRow("DoorDash", (r) => fmt(r.online.doordash), () => fmt(effTot.doordash));
        renderRow("Total Online", (r) => fmt(r.online.total), () => fmt(effTot.onlineTotal), false, true);

        // ── 8. POS ──
        renderRow("8. POS", null, null, true);
        renderRow("POS Sales", (r) => fmt(r.pos.posSales), () => fmt(effTot.posSales));
        renderRow("Total POS", (r) => fmt(r.pos.total), () => fmt(effTot.posTotal), false, true);

        // ── 9. STORE EXPENSES ──
        renderRow("9. STORE EXPENSES", null, null, true);
        renderRow("Cash Expense Amount", (r) => fmt(r.expense.amount), () => fmt(effTot.expense), false, true);

        // ── 10. SHORTAGE / OVERAGE ──
        renderRow("10. SHORTAGE / OVERAGE", null, null, true);
        renderRow("Shortage Amount", (r) => fmt(r.shortage?.shortage || 0), () => fmt(effTot.shortage));
        renderRow("Overage Amount", (r) => fmt(r.shortage?.overage || 0), () => fmt(effTot.overage));

        // ── 11. DEPOSITS ──
        renderRow("11. DEPOSITS", null, null, true);
        renderRow("Cash Deposit", (r) => fmt(r.deposit.cash), () => fmt(effTot.depCash));
        renderRow("Card Deposit", (r) => fmt(r.deposit.card), () => fmt(effTot.depCard));
        renderRow("Account Pay Deposit", (r) => fmt(r.deposit.accountPay), () => fmt(effTot.depAccountPay));
      });

    } else if (type === "failed_transaction" || type === "refund_orders") {
      const headers = [
        { label: "Order #", align: "left" },
        { label: "Customer Name", align: "left" },
        { label: "Subtotal", align: "right" },
        { label: "Grand Total", align: "right" },
        { label: "Type", align: "center" },
        { label: "Payment Status", align: "center" },
        { label: "Order Status", align: "center" },
      ];
      const widths = [
        printableWidth * 0.12,
        printableWidth * 0.23,
        printableWidth * 0.12,
        printableWidth * 0.13,
        printableWidth * 0.12,
        printableWidth * 0.14,
        printableWidth * 0.14,
      ];

      drawTableHeader(headers, widths, startX);

      let grandTotal = 0;

      data.forEach((order) => {
        grandTotal += order.total;
        drawTableRow(
          [
            { value: order.orderNumber, align: "left" },
            { value: order.customer?.name || "No Name", align: "left" },
            { value: fmt(order.subtotal), align: "right" },
            { value: fmt(order.total), align: "right" },
            { value: order.orderType.toUpperCase(), align: "center" },
            { value: order.paymentStatus.toUpperCase(), align: "center" },
            { value: order.status.toUpperCase(), align: "center" },
          ],
          widths,
          startX
        );
      });

      doc.moveDown(0.3);
      drawTableRow(
        [
          { value: "TOTAL", align: "left" },
          { value: "", align: "left" },
          { value: "", align: "right" },
          { value: fmt(grandTotal), align: "right" },
          { value: "", align: "center" },
          { value: "", align: "center" },
          { value: "", align: "center" },
        ],
        widths,
        startX,
        true,
        "#f7cbd4"
      );
    }

    // 4. Footer info
    doc.moveDown(2);
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#A8A29E")
      .text('"Don\'t Cook Tonight, Call Chicken Delight!"', 40, doc.y, {
        align: "center",
        width: printableWidth,
      });

    doc.end();
  } catch (error) {
    logger.error(`Error generating report PDF: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Failed to generate report PDF" });
    }
  }
};
