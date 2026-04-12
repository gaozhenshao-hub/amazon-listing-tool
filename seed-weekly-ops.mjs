import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const PRODUCT_ID = 30001;
const USER_ID = 1;

// Generate 12 weeks of realistic data for a pool pump motor product
// Simulate seasonal pattern: sales peak in spring/summer, dip in winter
const weeks = [
  // 2025 Sept (off-season, lower sales)
  { start: '2025-09-05', end: '2025-09-11', trend: 'stable', salesQty: 7, orderQty: 7, salesAmt: 1943.88, orderProfit: 1093.80, profitMargin: 56.27, session: 91, totalCvr: 7.69, adCvr: 6, organicCvr: 11, adOrders: 4, organicOrders: 3, adClicks: 63, organicClicks: 28, ctr: 0.0079, adImpressions: 7953, cpc: 4.99, adSpend: 314.44, acos: 28.33, rating: 3.5, reviews: 0, returnRate: 0 },
  { start: '2025-09-12', end: '2025-09-18', trend: 'up', salesQty: 12, orderQty: 12, salesAmt: 3103.56, orderProfit: 2494.28, profitMargin: 80.37, session: 91, totalCvr: 13.19, adCvr: 9, organicCvr: 21, adOrders: 5, organicOrders: 7, adClicks: 58, organicClicks: 33, ctr: 0.0077, adImpressions: 7564, cpc: 4.37, adSpend: 253.44, acos: 19.06, rating: 3.5, reviews: 0, returnRate: 16.67 },
  { start: '2025-09-19', end: '2025-09-25', trend: 'up', salesQty: 26, orderQty: 25, salesAmt: 6256.19, orderProfit: 4452.66, profitMargin: 71.17, session: 134, totalCvr: 18.66, adCvr: 15, organicCvr: 24, adOrders: 11, organicOrders: 14, adClicks: 75, organicClicks: 59, ctr: 0.0092, adImpressions: 8194, cpc: 4.57, adSpend: 342.76, acos: 11.92, rating: 3.5, reviews: 5, returnRate: 7.69 },
  { start: '2025-09-26', end: '2025-10-02', trend: 'down', salesQty: 22, orderQty: 22, salesAmt: 5097.40, orderProfit: 3488.42, profitMargin: 68.44, session: 118, totalCvr: 18.64, adCvr: 17, organicCvr: 20, adOrders: 10, organicOrders: 12, adClicks: 59, organicClicks: 59, ctr: 0.0082, adImpressions: 7239, cpc: 4.67, adSpend: 275.78, acos: 12.08, rating: 3.5, reviews: 5, returnRate: 9.09 },

  // 2025 Oct (transition)
  { start: '2025-10-03', end: '2025-10-09', trend: 'stable', salesQty: 28, orderQty: 28, salesAmt: 8096.76, orderProfit: 4394.84, profitMargin: 72.08, session: 117, totalCvr: 23.93, adCvr: 18, organicCvr: 31, adOrders: 12, organicOrders: 16, adClicks: 65, organicClicks: 52, ctr: 0.0121, adImpressions: 5356, cpc: 5.22, adSpend: 339.36, acos: 13.01, rating: 3.5, reviews: 2, returnRate: 14.29 },
  { start: '2025-10-10', end: '2025-10-16', trend: 'down', salesQty: 6, orderQty: 6, salesAmt: 1296.52, orderProfit: 559.66, profitMargin: 43.17, session: 88, totalCvr: 6.82, adCvr: 6, organicCvr: 7, adOrders: 2, organicOrders: 4, adClicks: 34, organicClicks: 54, ctr: 0.0114, adImpressions: 2973, cpc: 5.37, adSpend: 182.43, acos: 42.44, rating: 3.5, reviews: 3, returnRate: 16.67 },
  { start: '2025-10-17', end: '2025-10-23', trend: 'up', salesQty: 27, orderQty: 27, salesAmt: 5671.34, orderProfit: 4064.61, profitMargin: 71.67, session: 128, totalCvr: 1.19, adCvr: 21, organicCvr: 80, adOrders: 15, organicOrders: 12, adClicks: 113, organicClicks: 15, ctr: 0.0119, adImpressions: 9506, cpc: 4.77, adSpend: 539.09, acos: 17.13, rating: 3.8, reviews: 4, returnRate: 3.70 },
  { start: '2025-10-24', end: '2025-10-30', trend: 'up', salesQty: 51, orderQty: 49, salesAmt: 10691.56, orderProfit: 7773.25, profitMargin: 72.70, session: 196, totalCvr: 25.00, adCvr: 18, organicCvr: 38, adOrders: 24, organicOrders: 25, adClicks: 131, organicClicks: 65, ctr: 0.0159, adImpressions: 8219, cpc: 5.47, adSpend: 716.99, acos: 14.26, rating: 3.8, reviews: 4, returnRate: 0 },
  { start: '2025-10-31', end: '2025-11-06', trend: 'down', salesQty: 27, orderQty: 26, salesAmt: 5175.34, orderProfit: 3144.51, profitMargin: 60.76, session: 117, totalCvr: 22.22, adCvr: 20, organicCvr: 28, adOrders: 18, organicOrders: 8, adClicks: 88, organicClicks: 29, ctr: 0.0151, adImpressions: 3822, cpc: 5.18, adSpend: 456.16, acos: 12.93, rating: 3.7, reviews: 7, returnRate: 7.41 },

  // 2025 Nov (cooling off)
  { start: '2025-11-07', end: '2025-11-13', trend: 'down', salesQty: 0, orderQty: 0, salesAmt: 0, orderProfit: -805.25, profitMargin: 0, session: 7, totalCvr: 0, adCvr: 0, organicCvr: 0, adOrders: 0, organicOrders: 0, adClicks: 7, organicClicks: 0, ctr: 0, adImpressions: 0, cpc: 0, adSpend: 0, acos: 0, rating: 3.4, reviews: 8, returnRate: 100 },
  { start: '2025-11-14', end: '2025-11-20', trend: 'down', salesQty: 0, orderQty: 0, salesAmt: 0, orderProfit: -6.79, profitMargin: 0, session: 32, totalCvr: 0, adCvr: 0, organicCvr: 0, adOrders: 0, organicOrders: 0, adClicks: 32, organicClicks: 0, ctr: 0, adImpressions: 0, cpc: 0, adSpend: 0, acos: 0, rating: 3.7, reviews: 7, returnRate: 0 },
  { start: '2025-11-21', end: '2025-11-27', trend: 'up', salesQty: 8, orderQty: 8, salesAmt: 1659.36, orderProfit: 1048.04, profitMargin: 63.16, session: 86, totalCvr: 9.30, adCvr: 15, organicCvr: 8, adOrders: 3, organicOrders: 5, adClicks: 20, organicClicks: 66, ctr: 0.016, adImpressions: 1249, cpc: 5.53, adSpend: 110.68, acos: 17.79, rating: 3.7, reviews: 7, returnRate: 25 },
];

// Insert weekly ops
for (const w of weeks) {
  await conn.execute(
    `INSERT INTO product_weekly_ops (product_id, user_id, week_start_date, week_end_date, sales_trend, sales_qty, order_qty, sales_amount, order_profit, order_profit_margin, session_total, total_cvr, ad_cvr, organic_cvr, ad_orders, organic_orders, ad_clicks, organic_clicks, ctr, ad_impressions, cpc, ad_spend, acos, rating, review_count, return_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [PRODUCT_ID, USER_ID, w.start, w.end, w.trend, w.salesQty, w.orderQty, w.salesAmt, w.orderProfit, w.profitMargin, w.session, w.totalCvr, w.adCvr, w.organicCvr, w.adOrders, w.organicOrders, w.adClicks, w.organicClicks, w.ctr, w.adImpressions, w.cpc, w.adSpend, w.acos, w.rating, w.reviews, w.returnRate]
  );
}
console.log(`Inserted ${weeks.length} weekly records for product ${PRODUCT_ID}`);

// Insert monthly summaries
const monthlySummaries = [
  { ym: '2025-09', financialProfit: 5641.06, orderProfitTotal: 19936.87, totalSalesQty: 67, totalOrderQty: 66, totalSalesAmt: 16401.03, totalAdSpend: 1186.42, avgAcos: 17.85, avgRating: 3.5 },
  { ym: '2025-10', financialProfit: -471.40, orderProfitTotal: 923.05, totalSalesQty: 139, totalOrderQty: 136, totalSalesAmt: 30931.52, totalAdSpend: 2234.03, avgAcos: 19.95, avgRating: 3.66 },
  { ym: '2025-11', financialProfit: 1706.98, orderProfitTotal: 3942.74, totalSalesQty: 15, totalOrderQty: 15, totalSalesAmt: 2504.30, totalAdSpend: 221.36, avgAcos: 11.86, avgRating: 3.6 },
];

for (const m of monthlySummaries) {
  await conn.execute(
    `INSERT INTO product_monthly_summary (product_id, user_id, \`year_month\`, financial_profit, order_profit_total, total_sales_qty, total_order_qty, total_sales_amount, total_ad_spend, avg_acos, avg_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [PRODUCT_ID, USER_ID, m.ym, m.financialProfit, m.orderProfitTotal, m.totalSalesQty, m.totalOrderQty, m.totalSalesAmt, m.totalAdSpend, m.avgAcos, m.avgRating]
  );
}
console.log(`Inserted ${monthlySummaries.length} monthly summaries for product ${PRODUCT_ID}`);

// Also insert basic info for the product
await conn.execute(
  `INSERT INTO product_basic_info (product_id, user_id, selling_price, break_even_price, gross_profit, gross_margin, return_rate, rating, listing_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE selling_price=VALUES(selling_price), break_even_price=VALUES(break_even_price), gross_profit=VALUES(gross_profit), gross_margin=VALUES(gross_margin), return_rate=VALUES(return_rate), rating=VALUES(rating)`,
  [PRODUCT_ID, USER_ID, 199.99, 141.08, 58.91, 29.46, 0, 3.5, '2025/8/11']
);
console.log('Inserted basic info for product', PRODUCT_ID);

await conn.end();
console.log('Done!');
