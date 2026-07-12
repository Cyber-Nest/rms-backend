const PDFDocument = require("pdfkit");
const logger = require("../../../shared/utils/logger");

exports.generateReportPdf = (type, data, dateRangeStr, res) => {
  try {
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

    // 1. Header Section
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#8a1538") // Brand primary color
      .text("Chicken Delight", 40, doc.y, { align: "center", width: printableWidth });

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
      // 10 key accounting columns for Monthly Landscape View
      const headers = [
        { label: "Date", align: "left" },
        { label: "Sub Total", align: "right" },
        { label: "Discount", align: "right" },
        { label: "Tax (GST)", align: "right" },
        { label: "Grand Total", align: "right" },
        { label: "Cash Sales", align: "right" },
        { label: "Card Sales", align: "right" },
        { label: "Expense", align: "right" },
        { label: "Deposited", align: "right" },
        { label: "To Be Coll.", align: "right" },
      ];
      const widths = [
        printableWidth * 0.11, // Date
        printableWidth * 0.1,  // Sub Total
        printableWidth * 0.09,  // Discount
        printableWidth * 0.09,  // Tax
        printableWidth * 0.11, // Grand Total
        printableWidth * 0.1,  // Cash Sales
        printableWidth * 0.1,  // Card Sales
        printableWidth * 0.09,  // Expense
        printableWidth * 0.11, // Deposited
        printableWidth * 0.1,  // To Be Collected
      ];

      drawTableHeader(headers, widths, startX);

      // Summaries accumulator
      const grandAccum = {
        subtotal: 0, discount: 0, tax: 0, grand: 0,
        cash: 0, card: 0, expense: 0, deposit: 0, collect: 0
      };

      data.forEach((row) => {
        grandAccum.subtotal += row.salesSummary.subtotal;
        grandAccum.discount += row.salesSummary.discount;
        grandAccum.tax += row.salesSummary.tax;
        grandAccum.grand += row.salesSummary.grandTotal;
        grandAccum.cash += row.paymentType.cash;
        // card = creditCardSales + debitCardSales
        const cardSales = row.paymentType.creditCardSales + row.paymentType.debitCardSales;
        grandAccum.card += cardSales;
        grandAccum.expense += row.expense.amount;
        // cash deposit + card deposit
        const deposited = row.deposit.cash + row.deposit.card;
        grandAccum.deposit += deposited;
        // cash collect + card collect
        const collect = row.moneyToBeCollected.cash + row.moneyToBeCollected.card;
        grandAccum.collect += collect;

        drawTableRow(
          [
            { value: row.date, align: "left" },
            { value: fmt(row.salesSummary.subtotal), align: "right" },
            { value: fmt(row.salesSummary.discount), align: "right" },
            { value: fmt(row.salesSummary.tax), align: "right" },
            { value: fmt(row.salesSummary.grandTotal), align: "right" },
            { value: fmt(row.paymentType.cash), align: "right" },
            { value: fmt(cardSales), align: "right" },
            { value: fmt(row.expense.amount), align: "right" },
            { value: fmt(deposited), align: "right" },
            { value: fmt(collect), align: "right" },
          ],
          widths,
          startX
        );
      });

      doc.moveDown(0.3);
      drawTableRow(
        [
          { value: "TOTAL", align: "left" },
          { value: fmt(grandAccum.subtotal), align: "right" },
          { value: fmt(grandAccum.discount), align: "right" },
          { value: fmt(grandAccum.tax), align: "right" },
          { value: fmt(grandAccum.grand), align: "right" },
          { value: fmt(grandAccum.cash), align: "right" },
          { value: fmt(grandAccum.card), align: "right" },
          { value: fmt(grandAccum.expense), align: "right" },
          { value: fmt(grandAccum.deposit), align: "right" },
          { value: fmt(grandAccum.collect), align: "right" },
        ],
        widths,
        startX,
        true,
        "#f7cbd4"
      );

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
