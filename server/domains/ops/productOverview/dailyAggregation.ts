export type DailySnapshot = {
  reportDate: string; asin: string; parentAsin: string; storeName: string; country: string;
  salesQty: number; orderQty: number; salesAmount: number | string; orderProfit: number | string;
  adSpend: number | string; adSales: number | string; sessionsTotal: number;
  adOrders?: number; organicOrders?: number; adClicks?: number; adImpressions?: number; returnQty?: number;
  fbaAvailable: number; fbaInTransit: number; sourceLocalAvailable: number;
  title?: string | null; productName?: string | null; sku?: string | null; operator?: string | null;
};

const numberOf = (value: number | string | null | undefined) => Number(value || 0) || 0;
const mondayOf = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  const shift = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - shift);
  return value.toISOString().slice(0, 10);
};
const sundayOf = (monday: string) => {
  const value = new Date(`${monday}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 6);
  return value.toISOString().slice(0, 10);
};

export function summarizeParentAsinWeeks(records: DailySnapshot[], weeksToShow: number) {
  const groups = new Map<string, DailySnapshot[]>();
  for (const record of records) {
    const key = [record.parentAsin, record.storeName, record.country].join("|");
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.values()].map(group => {
    const byWeek = new Map<string, DailySnapshot[]>();
    for (const record of group) {
      const weekStartDate = mondayOf(record.reportDate);
      byWeek.set(weekStartDate, [...(byWeek.get(weekStartDate) || []), record]);
    }
    const weeks = [...byWeek.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, weeksToShow).map(([weekStartDate, rows]) => {
      const latestByAsin = new Map<string, DailySnapshot>();
      for (const row of rows) {
        if (!latestByAsin.has(row.asin) || latestByAsin.get(row.asin)!.reportDate < row.reportDate) latestByAsin.set(row.asin, row);
      }
      const salesQty = rows.reduce((sum, row) => sum + numberOf(row.salesQty), 0);
      const orderQty = rows.reduce((sum, row) => sum + numberOf(row.orderQty), 0);
      const salesAmount = rows.reduce((sum, row) => sum + numberOf(row.salesAmount), 0);
      const orderProfit = rows.reduce((sum, row) => sum + numberOf(row.orderProfit), 0);
      const adSpend = rows.reduce((sum, row) => sum + numberOf(row.adSpend), 0);
      const adSales = rows.reduce((sum, row) => sum + numberOf(row.adSales), 0);
      const sessionsTotal = rows.reduce((sum, row) => sum + numberOf(row.sessionsTotal), 0);
      const adOrders = rows.reduce((sum, row) => sum + numberOf(row.adOrders), 0);
      const organicOrders = rows.reduce((sum, row) => sum + numberOf(row.organicOrders), 0);
      const adClicks = rows.reduce((sum, row) => sum + numberOf(row.adClicks), 0);
      const adImpressions = rows.reduce((sum, row) => sum + numberOf(row.adImpressions), 0);
      const returnQty = rows.reduce((sum, row) => sum + numberOf(row.returnQty), 0);
      return {
        weekStartDate, weekEndDate: sundayOf(weekStartDate), salesQty, orderQty, salesAmount, orderProfit, adSpend, adSales,
        sessionsTotal, adOrders, organicOrders, adClicks, adImpressions, returnQty,
        totalCvr: sessionsTotal > 0 ? orderQty / sessionsTotal * 100 : null,
        adCvr: adClicks > 0 ? adOrders / adClicks * 100 : null,
        // 日快照未提供自然点击，无法用自然订单推导自然CVR。
        organicCvr: null,
        ctr: adImpressions > 0 ? adClicks / adImpressions * 100 : null,
        cpc: adClicks > 0 ? adSpend / adClicks : null,
        acos: adSales > 0 ? adSpend / adSales * 100 : null,
        profitMargin: salesAmount > 0 ? orderProfit / salesAmount * 100 : null,
        returnRate: salesQty > 0 ? returnQty / salesQty * 100 : null,
        // 领星日快照当前没有评分和评论计数，保持null以驱动前端“数据未提供”。
        rating: null,
        reviewCount: null,
        fbaAvailable: [...latestByAsin.values()].reduce((sum, row) => sum + numberOf(row.fbaAvailable), 0),
        fbaInTransit: [...latestByAsin.values()].reduce((sum, row) => sum + numberOf(row.fbaInTransit), 0),
        sourceLocalAvailable: [...latestByAsin.values()].reduce((sum, row) => sum + numberOf(row.sourceLocalAvailable), 0),
        activeDays: new Set(rows.map(row => row.reportDate)).size,
      };
    });
    const latest = group.sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
    const latestAsins = new Map<string, DailySnapshot>();
    for (const row of group) {
      if (!latestAsins.has(row.asin) || latestAsins.get(row.asin)!.reportDate < row.reportDate) latestAsins.set(row.asin, row);
    }
    return {
      parentAsin: latest.parentAsin,
      storeName: latest.storeName,
      country: latest.country,
      title: latest.title || "",
      productName: latest.productName || null,
      operator: latest.operator || null,
      variantCount: latestAsins.size,
      skus: [...latestAsins.values()].map(row => row.sku).filter((sku): sku is string => Boolean(sku)),
      weeks,
    };
  });
}

export function summarizeVariantSales(records: DailySnapshot[], weeks: number) {
  const latestWeeks = [...new Set(records.map(row => mondayOf(row.reportDate)))].sort((a, b) => b.localeCompare(a)).slice(0, weeks);
  const rows = records.filter(row => latestWeeks.includes(mondayOf(row.reportDate)));
  const variants = new Map<string, DailySnapshot[]>();
  for (const row of rows) variants.set(row.asin, [...(variants.get(row.asin) || []), row]);
  return [...variants.entries()].map(([asin, variantRows]) => {
    const latest = variantRows.sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
    const weekly = latestWeeks.map(weekStartDate => {
      const periodRows = variantRows.filter(row => mondayOf(row.reportDate) === weekStartDate);
      return { weekStartDate, weekEndDate: sundayOf(weekStartDate), salesQty: periodRows.reduce((sum, row) => sum + numberOf(row.salesQty), 0), activeDays: new Set(periodRows.map(row => row.reportDate)).size };
    });
    return { asin, sku: latest.sku || null, title: latest.title || null, fbaAvailable: latest.fbaAvailable, fbaInTransit: latest.fbaInTransit, sourceLocalAvailable: latest.sourceLocalAvailable, weekly };
  });
}
