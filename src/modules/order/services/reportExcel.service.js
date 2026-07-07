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

    
    let csvContent = "\uFEFF";

    
    csvContent += formatRow(["Chicken Delight"]);
    csvContent += formatRow([reportTitle]);
    csvContent += formatRow([`Period: ${dateRangeStr}`]);
    csvContent += formatRow([]); 

    if (type === "item_sales") {
      csvContent += formatRow(["Item Name", "Product ID", "# Sold", "Sales", "% Sales"]);
      
      data.forEach((group) => {
        
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

        
        csvContent += formatRow([
          `Subtotal (${group.categoryName})`,
          "",
          group.subtotalSold,
          group.subtotalSales.toFixed(2),
          "",
        ]);
        csvContent += formatRow([]); 
      });

    } else if (type === "hourly_sales") {
      csvContent += formatRow(["Time Slot", "# Orders", "Total Sales"]);

      const activeSlots = data.filter((slot) => slot.startHour >= 10 && slot.startHour <= 21);
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
      
      csvContent += formatRow([
        "Date",
        "Sub Total",
        "Delivery Charges",
        "Debit Card Charges",
        "Discount",
        "Tax (GST)",
        "Grand Total",
        "Tips",
        "Final Amount",
        "Cash",
        "Account Pay",
        "Credit Card Sales",
        "Debit Card Sales",
        "Expense",
        "Deposit Cash",
        "Deposit Card",
        "Shortage Cash",
        "Money to be Collected Cash",
        "Money to be Collected Card",
      ]);

      const grand = {
        subtotal: 0, delivery: 0, debitCharges: 0, discount: 0, tax: 0, grand: 0, tips: 0, final: 0,
        cash: 0, accountPay: 0, creditSales: 0, debitSales: 0, expense: 0,
        depCash: 0, depCard: 0, shortCash: 0, collCash: 0, collCard: 0
      };

      data.forEach((row) => {
        grand.subtotal += row.salesSummary.subtotal;
        grand.delivery += row.salesSummary.deliveryCharges;
        grand.debitCharges += row.salesSummary.debitCharges;
        grand.discount += row.salesSummary.discount;
        grand.tax += row.salesSummary.tax;
        grand.grand += row.salesSummary.grandTotal;
        grand.tips += row.salesSummary.tips;
        grand.final += row.salesSummary.finalAmount;
        grand.cash += row.paymentType.cash;
        grand.accountPay += row.paymentType.accountPay;
        grand.creditSales += row.paymentType.creditCardSales;
        grand.debitSales += row.paymentType.debitCardSales;
        grand.expense += row.expense.amount;
        grand.depCash += row.deposit.cash;
        grand.depCard += row.deposit.card;
        grand.shortCash += row.shortage.cash;
        grand.collCash += row.moneyToBeCollected.cash;
        grand.collCard += row.moneyToBeCollected.card;

        csvContent += formatRow([
          row.date,
          row.salesSummary.subtotal.toFixed(2),
          row.salesSummary.deliveryCharges.toFixed(2),
          row.salesSummary.debitCharges.toFixed(2),
          `(${row.salesSummary.discount.toFixed(2)})`,
          row.salesSummary.tax.toFixed(2),
          row.salesSummary.grandTotal.toFixed(2),
          row.salesSummary.tips.toFixed(2),
          row.salesSummary.finalAmount.toFixed(2),
          row.paymentType.cash.toFixed(2),
          row.paymentType.accountPay.toFixed(2),
          row.paymentType.creditCardSales.toFixed(2),
          row.paymentType.debitCardSales.toFixed(2),
          row.expense.amount.toFixed(2),
          row.deposit.cash.toFixed(2),
          row.deposit.card.toFixed(2),
          row.shortage.cash.toFixed(2),
          row.moneyToBeCollected.cash.toFixed(2),
          row.moneyToBeCollected.card.toFixed(2),
        ]);
      });

      csvContent += formatRow([]);
      csvContent += formatRow([
        "TOTAL",
        grand.subtotal.toFixed(2),
        grand.delivery.toFixed(2),
        grand.debitCharges.toFixed(2),
        `(${grand.discount.toFixed(2)})`,
        grand.tax.toFixed(2),
        grand.grand.toFixed(2),
        grand.tips.toFixed(2),
        grand.final.toFixed(2),
        grand.cash.toFixed(2),
        grand.accountPay.toFixed(2),
        grand.creditSales.toFixed(2),
        grand.debitSales.toFixed(2),
        grand.expense.toFixed(2),
        grand.depCash.toFixed(2),
        grand.depCard.toFixed(2),
        grand.shortCash.toFixed(2),
        grand.collCash.toFixed(2),
        grand.collCard.toFixed(2),
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
