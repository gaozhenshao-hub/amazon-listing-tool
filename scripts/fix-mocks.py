import re

filepath = 'server/lingxingAdapter.ts'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Replace the ASIN360 mock reference
content = content.replace(
    '"/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour": () => mockProfitDetail(body),',
    '"/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour": () => mockAsin360PerformanceTrend(body),'
)

# 2. Replace spProductAdReports mock reference
content = content.replace(
    '"/pb/openapi/newad/spProductAdReports": () => mockProductAdReports(body),',
    '"/pb/openapi/newad/spProductAdReports": () => mockSpProductAdReportsDaily(body),'
)

# 3. Add new mock functions before the export statement
new_functions = '''
function _pctStr(num: number, denom: number): string {
  return denom > 0 ? ((num / denom) * 100).toFixed(2) : '0';
}

function mockAsin360PerformanceTrend(body: Record<string, any>) {
  const startDate = body.date_start || body.startDate || '2026-03-01';
  const endDate = body.date_end || body.endDate || '2026-03-31';
  const start = new Date(startDate);
  const end = new Date(endDate);
  const list: any[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const sessions = Math.floor(Math.random() * 200 + 50);
    const pageViews = Math.floor(sessions * (1.2 + Math.random() * 0.5));
    const orders = Math.floor(Math.random() * 15 + 1);
    const volume = orders + Math.floor(Math.random() * 5);
    const unitPrice = +(Math.random() * 50 + 20).toFixed(2);
    list.push({
      r_date: d.toISOString().split('T')[0],
      volume,
      order_items: orders,
      amount: (volume * unitPrice).toFixed(2),
      price: unitPrice.toFixed(2),
      sales_rank: String(Math.floor(Math.random() * 50000 + 1000)),
      sessions,
      page_views: pageViews,
      unit_session_percentage: _pctStr(orders, sessions),
      buy_box_percentage: +(90 + Math.random() * 10).toFixed(1),
    });
  }
  const totalVolume = list.reduce((s: number, i: any) => s + i.volume, 0);
  const totalOrders = list.reduce((s: number, i: any) => s + i.order_items, 0);
  const totalSessions = list.reduce((s: number, i: any) => s + i.sessions, 0);
  const totalPageViews = list.reduce((s: number, i: any) => s + i.page_views, 0);
  const totalAmount = list.reduce((s: number, i: any) => s + Number(i.amount), 0);
  return {
    list,
    total: {
      r_date: 'Total',
      volume: totalVolume,
      order_items: totalOrders,
      amount: totalAmount.toFixed(2),
      sessions: totalSessions,
      page_views: totalPageViews,
      unit_session_percentage: _pctStr(totalOrders, totalSessions),
      price: null,
      sales_rank: null,
    },
    currency_icon: '$',
  };
}

function mockSpProductAdReportsDaily(body: Record<string, any>) {
  const startDate = body.start_date || body.startDate || '2026-03-01';
  const endDate = body.end_date || body.endDate || '2026-03-31';
  const asin = body.asin || body.advertised_asin || 'B0UNKNOWN';
  const start = new Date(startDate);
  const end = new Date(endDate);
  const records: any[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const impressions = Math.floor(Math.random() * 2000 + 200);
    const clicks = Math.floor(Math.random() * 50 + 5);
    const spend = +(Math.random() * 30 + 2).toFixed(2);
    const sales = +(Math.random() * 150 + 10).toFixed(2);
    const orders = Math.floor(Math.random() * 5);
    records.push({
      report_date: d.toISOString().split('T')[0],
      asin,
      advertised_asin: asin,
      sku: `SKU-${asin}`,
      impressions,
      clicks,
      cost: spend,
      spend,
      sales,
      attributed_sales: sales,
      orders,
      attributed_orders: orders,
      acos: sales > 0 ? +(spend / sales * 100).toFixed(1) : 0,
      roas: spend > 0 ? +(sales / spend).toFixed(2) : 0,
      ctr: impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0,
      cvr: clicks > 0 ? +(orders / clicks * 100).toFixed(1) : 0,
    });
  }
  return records;
}

'''

content = content.replace(
    'export { LingxingAdapter };',
    new_functions + 'export { LingxingAdapter };'
)

with open(filepath, 'w') as f:
    f.write(content)

print('Done. File updated successfully.')
