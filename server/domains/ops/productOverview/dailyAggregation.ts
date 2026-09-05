import { normalizeIdentityPart, normalizeMarketplaceCode } from "../../../../shared/marketplaceIdentity";

export type DailySnapshot = {
  reportDate: string; asin: string; parentAsin: string; storeName: string; country: string; sourceType?: string | null;
  salesQty: number; orderQty: number; salesAmount: number | string; orderProfit: number | string;
  adSpend: number | string; adSales: number | string; sessionsTotal: number;
  adOrders?: number; organicOrders?: number; adClicks?: number; adImpressions?: number; returnQty?: number;
  fbaAvailable: number; fbaInTransit: number; sourceLocalAvailable: number;
  title?: string | null; productName?: string | null; sku?: string | null; operator?: string | null;
};

const numberOf = (value: number | string | null | undefined) => Number(value || 0) || 0;
const identityPart = normalizeIdentityPart;
const countryPart = normalizeMarketplaceCode;
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
  const preferredByDayAndAsin = new Map<string, DailySnapshot>();
  for (const record of records) {
    const key = [record.parentAsin, record.storeName, countryPart(record.country), record.asin, record.reportDate].map(identityPart).join("|");
    const existing = preferredByDayAndAsin.get(key);
    const priority = record.sourceType === "lingxing_mcp" ? 2 : 1;
    const existingPriority = existing?.sourceType === "lingxing_mcp" ? 2 : 1;
    if (!existing || priority >= existingPriority) preferredByDayAndAsin.set(key, record);
  }
  records = [...preferredByDayAndAsin.values()];
  const groups = new Map<string, DailySnapshot[]>();
  for (const record of records) {
    const key = [record.parentAsin, record.storeName, countryPart(record.country)].map(identityPart).join("|");
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
      country: countryPart(latest.country),
      title: latest.title || "",
      productName: latest.productName || null,
      operator: latest.operator || null,
      variantCount: latestAsins.size,
      asins: [...latestAsins.keys()].sort(),
      skus: [...latestAsins.values()].map(row => row.sku).filter((sku): sku is string => Boolean(sku)),
      weeks,
    };
  });
}

export function summarizeVariantSales(records: DailySnapshot[], weeks: number) {
  const preferredByDayAndAsin = new Map<string, DailySnapshot>();
  for (const record of records) {
    // 子ASIN在不同店铺或站点可以是不同的业务实体，不能按裸ASIN合并。
    const key = [record.parentAsin, record.storeName, countryPart(record.country), record.asin, record.reportDate].map(identityPart).join("|");
    const existing = preferredByDayAndAsin.get(key);
    const currentIsMcp = record.sourceType === "lingxing_mcp";
    const existingIsMcp = existing?.sourceType === "lingxing_mcp";
    if (!existing || (currentIsMcp && !existingIsMcp)) preferredByDayAndAsin.set(key, record);
  }
  records = [...preferredByDayAndAsin.values()];
  const latestWeeks = [...new Set(records.map(row => mondayOf(row.reportDate)))].sort((a, b) => b.localeCompare(a)).slice(0, weeks);
  const rows = records.filter(row => latestWeeks.includes(mondayOf(row.reportDate)));
  const variants = new Map<string, DailySnapshot[]>();
  for (const row of rows) {
    const key = [row.parentAsin, row.storeName, countryPart(row.country), row.asin].map(identityPart).join("|");
    variants.set(key, [...(variants.get(key) || []), row]);
  }
  return [...variants.values()].map((variantRows) => {
    const latest = variantRows.sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
    const weekly = latestWeeks.map(weekStartDate => {
      const periodRows = variantRows.filter(row => mondayOf(row.reportDate) === weekStartDate);
      const activeDays = new Set(periodRows.map(row => row.reportDate)).size;
      return {
        weekStartDate,
        weekEndDate: sundayOf(weekStartDate),
        salesQty: activeDays > 0 ? periodRows.reduce((sum, row) => sum + numberOf(row.salesQty), 0) : null,
        activeDays,
      };
    });
    const observedDays = new Set(variantRows.map(row => row.reportDate)).size;
    const expectedDays = latestWeeks.length * 7;
    const salesQty = variantRows.reduce((sum, row) => sum + numberOf(row.salesQty), 0);
    const salesAmount = variantRows.reduce((sum, row) => sum + numberOf(row.salesAmount), 0);
    const orderProfit = variantRows.reduce((sum, row) => sum + numberOf(row.orderProfit), 0);
    const adSpend = variantRows.reduce((sum, row) => sum + numberOf(row.adSpend), 0);
    const adSales = variantRows.reduce((sum, row) => sum + numberOf(row.adSales), 0);
    const adOrders = variantRows.reduce((sum, row) => sum + numberOf(row.adOrders), 0);
    const organicOrders = variantRows.reduce((sum, row) => sum + numberOf(row.organicOrders), 0);
    const sessionsTotal = variantRows.reduce((sum, row) => sum + numberOf(row.sessionsTotal), 0);
    const adClicks = variantRows.reduce((sum, row) => sum + numberOf(row.adClicks), 0);
    const adImpressions = variantRows.reduce((sum, row) => sum + numberOf(row.adImpressions), 0);
    return {
      identityKey: [latest.parentAsin, latest.storeName, countryPart(latest.country), latest.asin].map(identityPart).join("|"),
      parentAsin: latest.parentAsin,
      asin: latest.asin,
      storeName: latest.storeName,
      country: countryPart(latest.country),
      sku: latest.sku || null,
      title: latest.title || null,
      latestReportDate: latest.reportDate,
      salesQty,
      // 仅在完整周窗口具有逐日证据时计算“平均日销”；不把缺失日期当作零销量。
      avgDailySales: expectedDays > 0 && observedDays === expectedDays ? salesQty / expectedDays : null,
      observedDays,
      expectedDays,
      salesAmount,
      orderProfit,
      adSpend,
      adSales,
      adOrders,
      organicOrders,
      sessionsTotal,
      adClicks,
      adImpressions,
      acos: adSales > 0 ? adSpend / adSales * 100 : null,
      fbaAvailable: latest.fbaAvailable,
      fbaInTransit: latest.fbaInTransit,
      sourceLocalAvailable: latest.sourceLocalAvailable,
      weekly,
    };
  });
}
