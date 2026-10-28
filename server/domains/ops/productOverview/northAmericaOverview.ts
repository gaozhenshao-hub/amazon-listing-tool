import { normalizeMarketplaceCode } from '../../../../shared/marketplaceIdentity';
import { addReportDays } from '../../../../shared/productReportingWeek';
import { aggregateSaihuRows, latestSaihuSnapshots, selectSaihuFacts } from './saihuDaily';

// Sellfox acquisition requests USD. Never apply a second exchange rate here.
// Keep source countries through deduplication; their distinct sales are additive.
export function buildNorthAmericaOverview(source: Record<string, any>[], weeksToShow: number, currentUs: Record<string, any>[] = []) {
  const rows = selectSaihuFacts(source).filter(row => ['US', 'CA', 'MX'].includes(normalizeMarketplaceCode(row.site)));
  if (rows.some(row => String(row.currency || '').toUpperCase() !== 'USD')) throw new Error('美加墨汇总需要 USD 数据，请按美元重新同步');
  const bindings = new Map<string, typeof rows[number]>();
  const newer = (a: typeof rows[number], b: typeof rows[number]) => String(a.reportDate || a.weekEndDate).localeCompare(String(b.reportDate || b.weekEndDate)) || Number(a.importId) - Number(b.importId) || Number(a.id) - Number(b.id);
  for (const row of rows) {
    if (normalizeMarketplaceCode(row.site) !== 'US' || row.reportLevel === 'parent' || !row.asin) continue;
    const previous = bindings.get(row.asin);
    if (!previous || newer(row, previous) > 0) bindings.set(row.asin, row);
  }
  for (const row of currentUs) bindings.set(row.asin, row);
  const groups = new Map<string, typeof rows>();
  for (const original of rows) {
    const binding = bindings.get(original.asin);
    const row = { ...original, parentAsin: binding?.parentAsin || original.parentAsin || original.asin };
    if (!row.parentAsin) throw new Error('产品缺少 ASIN，无法合并');
    const group = groups.get(row.parentAsin) || []; group.push(row); groups.set(row.parentAsin, group);
  }
  const change = (value: number, previous: number) => ({ value, pct: previous === 0 ? null : Math.round((value - previous) / Math.abs(previous) * 10000) / 100 });
  return [...groups].map(([parentAsin, members]) => {
    const latest = [...members].sort((a,b) => Number(normalizeMarketplaceCode(b.site) === 'US') - Number(normalizeMarketplaceCode(a.site) === 'US') || newer(b,a))[0];
    const binding = bindings.get(latest.asin);
    const info: Record<string, any> = { ...latest, ...(binding ? { storeName: binding.storeName, operator: binding.operator ?? latest.operator } : {}) };
    const byWeek = new Map<string, typeof rows>();
    for (const row of members) { const list = byWeek.get(row.weekStartDate) || []; list.push(row); byWeek.set(row.weekStartDate, list); }
    const totals = new Map([...byWeek].map(([week, list]) => {
      const total = aggregateSaihuRows(list, week), us = list.filter(row => normalizeMarketplaceCode(row.site) === 'US');
      const ratings = aggregateSaihuRows(us.length ? us : list, week);
      return [week, { ...total, rating: ratings.rating, ratingCount: ratings.ratingCount }];
    }));
    const weekKeys = [...byWeek.keys()].sort().reverse();
    const weeks = weekKeys.slice(0, weeksToShow).map(week => {
      const a = totals.get(week)!, p = totals.get(addReportDays(week, -7));
      return { id: 0, weekStartDate: week, weekEndDate: a.weekEndDate, activeDays: a.activeDays,
        salesTrend: p ? a.salesQty > p.salesQty ? 'up' : a.salesQty < p.salesQty ? 'down' : 'flat' : null,
        salesQty: a.salesQty, orderQty: a.orderQty, salesAmount: a.salesAmount, orderProfit: a.grossProfit, profitMargin: a.grossMargin,
        sessionTotal: a.sessionsTotal, totalCvr: a.cvr, adCvr: a.adCvr, organicCvr: a.organicCvr, adOrders: a.adOrders,
        organicOrders: a.organicOrders, adClicks: a.adClicks, ctr: a.adClickRate, adImpressions: a.adImpressions, cpc: a.cpc,
        adSpend: a.adSpend, adSales: a.adSalesAmount, acos: a.acos, rating: a.rating, reviewCount: a.ratingCount, returnRate: a.returnRate,
        wow: p ? { salesQty: change(a.salesQty,p.salesQty), salesAmount: change(a.salesAmount,p.salesAmount), orderProfit: change(a.grossProfit,p.grossProfit),
          sessionTotal: change(a.sessionsTotal,p.sessionsTotal), adSpend: change(a.adSpend,p.adSpend), acos: change(a.acos,p.acos) } : null };
    });
    const snapshots = latestSaihuSnapshots(members);
    return { id: 0, parentAsin, title: info.title || '', chineseName: info.productName || null, brand: info.brand || null,
      category: info.category || null, marketplace: 'US', currency: 'USD', imageUrl: info.imageUrl || null, status: 'active',
      operator: info.operator || null, storeName: String(info.storeName || '').replace(/-(CA|MX)$/iu, '-US'),
      variantCount: new Set(snapshots.flatMap(row => String(row.asin || '').split(',').filter(Boolean))).size,
      skus: [...new Set(snapshots.flatMap(row => String(row.sku || '').split(',').filter(Boolean)))],
      basicInfo: null, weeks, monthlySummaries: [], dailyDerived: true, erpSource: 'saihu' as const };
  }).sort((a,b) => (b.weeks[0]?.salesAmount || 0) - (a.weeks[0]?.salesAmount || 0));
}
