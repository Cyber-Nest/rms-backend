const logger = require("../../../shared/utils/logger");

const escapeCSVCell = (val) => {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

const formatRow = (cells) => {
  return cells.map(escapeCSVCell).join(",") + "\r\n";
};

exports.generateReportCsv = (type, data, dateRangeStr, res) => {
  try {
    const titleMap = {
      item_sales: "Item Sales Report",
      hourly_sales: "Hourly Sales Report",
      cash_out_summary: "Cash Out By Employee Summary",
      monthly_sales_summary: "Monthly Sales Summary (Accounting)",
      failed_transaction: "Failed Transactions Report",
      refund_orders: "Refund Orders Report",
    };

    const reportTitle = titleMap[type] || "Sales Report";

    // BOM for UTF-8 Excel compatibility
    let csvContent = "\uFEFF";

    // Header info
    csvContent += formatRow(["Chicken Delight"]);
    csvContent += formatRow([reportTitle]);
    csvContent += formatRow([`Period: ${dateRangeStr}`]);
    csvContent += formatRow([]); // Empty row

    if (type === "item_sales") {
      csvContent += formatRow(["Item Name", "Product ID", "# Sold", "Sales", "% Sales"]);
      
      data.forEach((group) => {
        // Category Header
        csvContent += formatRow([group.categoryName.toUpperCase()]);
        
        group.items.forEach((item) => {
          csvContent += formatRow([
            item.name,
            item.productId || "M----",
            item.quantitySold,
            item.totalSales.toFixed(2),
            `${item.percentageSales.toFixed(2)}%`,
          ]);
        });

        // Subtotal row
        csvContent += formatRow([
          `Subtotal (${group.categoryName})`,
          "",
          group.subtotalSold,
          group.subtotalSales.toFixed(2),
          "",
        ]);
        csvContent += formatRow([]); // Empty space between categories
      });

    } else if (type === "hourly_sales") {
      csvContent += formatRow(["Time Slot", "# Orders", "Total Sales"]);

      const activeSlots = data.filter((slot) => slot.orderCount > 0 || (slot.startHour >= 10 && slot.startHour <= 21));
      let grandOrders = 0;
      let grandSales = 0;

      activeSlots.forEach((slot) => {
        grandOrders += slot.orderCount;
        grandSales += slot.totalSales;
        csvContent += formatRow([slot.label, slot.orderCount, slot.totalSales.toFixed(2)]);
      });

      csvContent += formatRow([]);
      csvContent += formatRow(["TOTAL", grandOrders, grandSales.toFixed(2)]);

    } else if (type === "cash_out_summary") {
      csvContent += formatRow(["Employee Name", "# of Orders", "Last Cash Out Date", "Total Cash Out Amount"]);

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
        csvContent += formatRow([
          item.employeeName,
          item.orderCount,
          formatDate(item.lastCashOut),
          item.totalAmount.toFixed(2),
        ]);
      });

      csvContent += formatRow([]);
      csvContent += formatRow(["TOTAL", grandOrders, "", grandTotal.toFixed(2)]);

    } else if (type === "monthly_sales_summary") {
      // Row 1: Super Category Header Row
      csvContent += formatRow([
        "",
        "SALES SUMMARY", "", "", "", "", "", "",
        "PAYMENT TYPE", "", "", "", "", "", "", "",
        "ORDER TYPE", "", "", "", "",
        "ORDERS COUNT", "", "", "", "",
        "TAX BREAKDOWN", "", "", "",
        "CARD TYPE BREAKDOWN", "", "", "",
        "ONLINE CHANNELS", "", "", "", "",
        "POS", "",
        "STORE EXPENSES",
        "SHORTAGE / OVERAGE", "",
        "DEPOSITS", "", ""
      ]);

      // Row 2: Sub Category Header Row
      csvContent += formatRow([
        "Date",
        "Sub Total", "Delivery Charges", "Discount", "Tax (GST)", "Grand Total", "Tips", "Final Amount",
        "Cash Sales", "Account Pay", "Credit Card Sales", "Debit Card Sales", "Grand Total", "Debit Card Tips", "Credit Card Tips", "Final Amount",
        "Take-Out", "Dine-in", "Delivery", "Drive Through", "Total Order Type",
        "Completed", "Paid Cancelled", "Unpaid Cancelled", "Refund Orders", "Refund Amount",
        "PST", "GST", "HST", "Total Tax",
        "INTERAC / DEBIT", "VISA", "MASTERCARD", "GIFT CARD",
        "Website", "Uber Eats", "Skip The Dishes", "DoorDash", "Total Online",
        "POS Sales", "Total POS",
        "Expense",
        "Shortage", "Overage",
        "Cash", "Card", "Account Pay"
      ]);

      // Helper function to aggregate an array of row objects into a single summary row object
      const aggregateRows = (rowList, labelName) => {
        const combined = {
          date: labelName,
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

      let excelRowsData = [];

      if (data.length >= 15 && data.length <= 31) {
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
          excelRowsData.push(aggregateRows(w1, label1));
        }
        if (w2.length > 0) {
          const s2 = getDayNum(w2[0], 8);
          const e2 = getDayNum(w2[w2.length - 1], 7 + w2.length);
          const label2 = w2.length === 7 ? `Week 2 (${s2}-${e2})` : s2 === e2 ? `Day ${s2}` : `Days ${s2}-${e2}`;
          excelRowsData.push(aggregateRows(w2, label2));
        }
        if (w3.length > 0) {
          const s3 = getDayNum(w3[0], 15);
          const e3 = getDayNum(w3[w3.length - 1], 14 + w3.length);
          const label3 = w3.length === 7 ? `Week 3 (${s3}-${e3})` : s3 === e3 ? `Day ${s3}` : `Days ${s3}-${e3}`;
          excelRowsData.push(aggregateRows(w3, label3));
        }
        if (w4.length > 0) {
          const s4 = getDayNum(w4[0], 22);
          const e4 = getDayNum(w4[w4.length - 1], 21 + w4.length);
          const label4 = w4.length === 7 ? `Week 4 (${s4}-${e4})` : s4 === e4 ? `Day ${s4}` : `Days ${s4}-${e4}`;
          excelRowsData.push(aggregateRows(w4, label4));
        }
        if (remaining.length > 0) {
          const sRem = getDayNum(remaining[0], 29);
          const eRem = getDayNum(remaining[remaining.length - 1], 28 + remaining.length);
          const labelRem = sRem === eRem ? `Day ${sRem}` : `Days ${sRem}-${eRem}`;
          excelRowsData.push(aggregateRows(remaining, labelRem));
        }
      } else if (data.length > 31) {
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
          excelRowsData.push(aggregateRows(monthGroups[mKey], mKey));
        });
      } else {
        excelRowsData = data;
      }

      const grand = {
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
      };

      excelRowsData.forEach((row) => {
        grand.subtotal += row.salesSummary.subtotal;
        grand.deliveryCharges += row.salesSummary.deliveryCharges;
        grand.discount += row.salesSummary.discount;
        grand.tax += row.salesSummary.tax;
        grand.grandTotal += row.salesSummary.grandTotal;
        grand.tips += row.salesSummary.tips;
        grand.finalAmount += row.salesSummary.finalAmount;

        grand.cash += row.paymentType.cash;
        grand.accountPay += row.paymentType.accountPay;
        grand.creditSales += row.paymentType.creditCardSales;
        grand.debitSales += row.paymentType.debitCardSales;
        grand.paymentGrand += row.paymentType.grandTotal;
        grand.debitTips += row.paymentType.debitTips;
        grand.creditTips += row.paymentType.creditTips;
        grand.paymentFinal += row.paymentType.finalAmount;

        grand.takeout += row.orderType.takeout;
        grand.dineIn += row.orderType.dineIn;
        grand.delivery += row.orderType.delivery;
        grand.driveThrough += row.orderType.driveThrough;
        grand.orderTypeTotal += row.orderType.total;

        grand.completed += row.orders.completed;
        grand.paidCancelled += row.orders.paidCancelled;
        grand.unpaidCancelled += row.orders.unpaidCancelled;
        grand.refund += row.orders.refund;
        grand.refundAmount += row.orders.refundAmount;

        grand.pst += row.taxBreakdown.pst;
        grand.gst += row.taxBreakdown.gst;
        grand.hst += row.taxBreakdown.hst;
        grand.taxTotal += row.taxBreakdown.total;

        grand.interac += row.cardType.interac;
        grand.visa += row.cardType.visa;
        grand.mastercard += row.cardType.mastercard;
        grand.giftCard += row.cardType.giftCard || 0;

        grand.website += row.online.website;
        grand.uber += row.online.uber;
        grand.skip += row.online.skip;
        grand.doordash += row.online.doordash;
        grand.onlineTotal += row.online.total;

        grand.posSales += row.pos.posSales;
        grand.posTotal += row.pos.total;

        grand.expense += row.expense.amount;
        grand.shortage += row.shortage?.shortage || 0;
        grand.overage += row.shortage?.overage || 0;

        grand.depCash += row.deposit.cash;
        grand.depCard += row.deposit.card;
        grand.depAccountPay += row.deposit.accountPay;

        csvContent += formatRow([
          "\t" + row.date,
          // 1. Sales Summary (7)
          row.salesSummary.subtotal.toFixed(2),
          row.salesSummary.deliveryCharges.toFixed(2),
          `(${row.salesSummary.discount.toFixed(2)})`,
          row.salesSummary.tax.toFixed(2),
          row.salesSummary.grandTotal.toFixed(2),
          row.salesSummary.tips.toFixed(2),
          row.salesSummary.finalAmount.toFixed(2),
          // 2. Payment Type (8)
          row.paymentType.cash.toFixed(2),
          row.paymentType.accountPay.toFixed(2),
          row.paymentType.creditCardSales.toFixed(2),
          row.paymentType.debitCardSales.toFixed(2),
          row.paymentType.grandTotal.toFixed(2),
          row.paymentType.debitTips.toFixed(2),
          row.paymentType.creditTips.toFixed(2),
          row.paymentType.finalAmount.toFixed(2),
          // 3. Order Type (5)
          row.orderType.takeout.toFixed(2),
          row.orderType.dineIn.toFixed(2),
          row.orderType.delivery.toFixed(2),
          row.orderType.driveThrough.toFixed(2),
          row.orderType.total.toFixed(2),
          // 4. Orders Count (5)
          row.orders.completed,
          row.orders.paidCancelled,
          row.orders.unpaidCancelled,
          row.orders.refund,
          row.orders.refundAmount.toFixed(2),
          // 5. Tax Breakdown (4)
          row.taxBreakdown.pst.toFixed(2),
          row.taxBreakdown.gst.toFixed(2),
          row.taxBreakdown.hst.toFixed(2),
          row.taxBreakdown.total.toFixed(2),
          // 6. Card Type Breakdown (4)
          row.cardType.interac.toFixed(2),
          row.cardType.visa.toFixed(2),
          row.cardType.mastercard.toFixed(2),
          (row.cardType.giftCard || 0).toFixed(2),
          // 7. Online Channels (5)
          row.online.website.toFixed(2),
          row.online.uber.toFixed(2),
          row.online.skip.toFixed(2),
          row.online.doordash.toFixed(2),
          row.online.total.toFixed(2),
          // 8. POS (2)
          row.pos.posSales.toFixed(2),
          row.pos.total.toFixed(2),
          // 9. Store Expenses (1)
          row.expense.amount.toFixed(2),
          // 10. Shortage / Overage (2)
          (row.shortage?.shortage || 0).toFixed(2),
          (row.shortage?.overage || 0).toFixed(2),
          // 11. Deposits (3)
          row.deposit.cash.toFixed(2),
          row.deposit.card.toFixed(2),
          row.deposit.accountPay.toFixed(2),
        ]);
      });

      csvContent += formatRow([]);
      csvContent += formatRow([
        "TOTAL",
        grand.subtotal.toFixed(2),
        grand.deliveryCharges.toFixed(2),
        `(${grand.discount.toFixed(2)})`,
        grand.tax.toFixed(2),
        grand.grandTotal.toFixed(2),
        grand.tips.toFixed(2),
        grand.finalAmount.toFixed(2),

        grand.cash.toFixed(2),
        grand.accountPay.toFixed(2),
        grand.creditSales.toFixed(2),
        grand.debitSales.toFixed(2),
        grand.paymentGrand.toFixed(2),
        grand.debitTips.toFixed(2),
        grand.creditTips.toFixed(2),
        grand.paymentFinal.toFixed(2),

        grand.takeout.toFixed(2),
        grand.dineIn.toFixed(2),
        grand.delivery.toFixed(2),
        grand.driveThrough.toFixed(2),
        grand.orderTypeTotal.toFixed(2),

        grand.completed,
        grand.paidCancelled,
        grand.unpaidCancelled,
        grand.refund,
        grand.refundAmount.toFixed(2),

        grand.pst.toFixed(2),
        grand.gst.toFixed(2),
        grand.hst.toFixed(2),
        grand.taxTotal.toFixed(2),

        grand.interac.toFixed(2),
        grand.visa.toFixed(2),
        grand.mastercard.toFixed(2),
        grand.giftCard.toFixed(2),

        grand.website.toFixed(2),
        grand.uber.toFixed(2),
        grand.skip.toFixed(2),
        grand.doordash.toFixed(2),
        grand.onlineTotal.toFixed(2),

        grand.posSales.toFixed(2),
        grand.posTotal.toFixed(2),

        grand.expense.toFixed(2),
        grand.shortage.toFixed(2),
        grand.overage.toFixed(2),

        grand.depCash.toFixed(2),
        grand.depCard.toFixed(2),
        grand.depAccountPay.toFixed(2),
      ]);

    } else if (type === "failed_transaction" || type === "refund_orders") {
      csvContent += formatRow(["Order #", "Customer Name", "Subtotal", "Grand Total", "Type", "Payment Status", "Order Status"]);

      let grandTotal = 0;

      data.forEach((order) => {
        grandTotal += order.total;
        csvContent += formatRow([
          order.orderNumber,
          order.customer?.name || "No Name",
          order.subtotal.toFixed(2),
          order.total.toFixed(2),
          order.orderType,
          order.paymentStatus,
          order.status,
        ]);
      });

      csvContent += formatRow([]);
      csvContent += formatRow(["TOTAL", "", "", grandTotal.toFixed(2), "", "", ""]);
    }

    res.write(Buffer.from(csvContent, "utf-8"));
    res.end();
  } catch (error) {
    logger.error(`Error generating report Excel/CSV: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Failed to generate report Excel" });
    }
  }
};
