import { normalizeMarketplaceCode } from "../../../../shared/marketplaceIdentity";
import { addReportDays, productReportingWeek } from "../../../../shared/productReportingWeek";

export function saihuProductKey(row: any) {
  return JSON.stringify([row.parentAsin || row.asin, row.storeName || "", normalizeMarketplaceCode(row.site)]);
}

// A child's identity survives a parent change; stores and marketplaces stay isolated.
const childKey = (row: any) => JSON.stringify([row.workspaceId ?? null, row.asin, row.storeName || "", normalizeMarketplaceCode(row.site)]);
const parentKey = (row: any) => JSON.stringify([row.workspaceId ?? null, saihuProductKey(row)]);
const newer = (a: any, b: any) =>
  Number(a.importId || 0) > Number(b.importId || 0) ||
  (Number(a.importId || 0) === Number(b.importId || 0) &&
    (String(a.reportDate || a.weekEndDate || "") > String(b.reportDate || b.weekEndDate || "") ||
      (String(a.reportDate || a.weekEndDate || "") === String(b.reportDate || b.weekEndDate || "") && Number(a.id || 0) > Number(b.id || 0))));

// Newer uploads replace the same business day, even if child ASIN order changes.
// Parent report totals are never multiplied by the number of child ASINs.
export function selectSaihuFacts<T extends Record<string, any>>(rows: T[]): T[] {
  const relationships = new Map<string, T>();
  for (const row of rows) {
    if (row.reportLevel === "parent" || !row.asin || String(row.asin).includes(",")) continue;
    const previous = relationships.get(childKey(row));
    if (!previous || newer(row, previous)) relationships.set(childKey(row), row);
  }
  const currentParent = (row: T): T => {
    const latest = row.reportLevel === "parent" ? undefined : relationships.get(childKey(row));
    return latest ? { ...row, parentAsin: latest.parentAsin || latest.asin } : row;
  };
  const daily = new Map<string, T>();
  const weekly: T[] = [];
  for (const sourceRow of rows) {
    if (!sourceRow.reportDate) { weekly.push(sourceRow); continue; }
    // Re-bin historical uploads as well as new ones without rewriting source facts.
    const row = { ...sourceRow, ...productReportingWeek(sourceRow.reportDate) };
    const key = JSON.stringify([row.reportLevel === "parent" ? parentKey(row) : childKey(row), row.reportDate, row.reportLevel === "parent" ? "parent" : "asin"]);
    const existing = daily.get(key);
    if (!existing || newer(row, existing)) daily.set(key, row);
  }
  const parentDays = new Set([...daily.values()].filter(r => r.reportLevel === "parent").map(r => JSON.stringify([parentKey(r), r.reportDate])));
  // Suppress children already included in source parent totals before applying current ownership.
  const facts = [...daily.values()].filter(r => r.reportLevel === "parent" || !parentDays.has(JSON.stringify([parentKey(r), r.reportDate]))).map(currentParent);
  const coveredDays = new Set<string>();
  const coveredWeeks = new Set<string>();
  for (const row of facts) {
    const weekKey = JSON.stringify([parentKey(row), row.weekStartDate]);
    if (coveredWeeks.has(weekKey)) continue;
    coveredWeeks.add(weekKey);
    for (let day = 0; day < 7; day++) coveredDays.add(JSON.stringify([parentKey(row), addReportDays(row.weekStartDate, day)]));
  }
  // A legacy weekly total cannot be split across the new Saturday boundary.
  // Never combine it with overlapping daily-derived weeks and double-count activity.
  return [...facts, ...weekly.map(currentParent).filter(row => {
    if (!row.weekStartDate || !row.weekEndDate) return true;
    for (let day = row.weekStartDate; day <= row.weekEndDate; day = addReportDays(day, 1)) {
      if (coveredDays.has(JSON.stringify([parentKey(row), day]))) return false;
    }
    return true;
  })];
}

// Reviews and inventory describe a point in time, not additive daily activity.
export function latestSaihuSnapshots(rows: any[]) {
  const latest = new Map<string, any>();
  for (const row of rows) {
    const key = JSON.stringify([saihuProductKey(row), row.reportLevel === "parent" ? "parent" : row.asin]);
    const current = latest.get(key);
    if (!current || String(row.reportDate || "") > String(current.reportDate || "")) latest.set(key, row);
  }
  return [...latest.values()];
}

const pf = (value: any) => Number.parseFloat(String(value || 0)) || 0;

export function aggregateSaihuRows(rows: any[], weekKey: string) {
  // Sum integer/currency fields, weighted-average rate fields
  let salesQty = 0, orderQty = 0, salesAmount = 0, grossProfit = 0;
  let sessionsTotal = 0, adOrders = 0, organicOrders = 0;
  let adClicks = 0, adImpressions = 0, adSpend = 0, adSalesAmount = 0;
  let ratingCount = 0, refundQty = 0, returnQty = 0;
  let organicClicks = 0;
  let ratingSum = 0, ratingWeightSum = 0;
  let weekEndDate = "";

  for (const r of rows) {
    salesQty += r.salesQty || 0;
    orderQty += r.orderQty || 0;
    salesAmount += pf(r.salesAmount);
    grossProfit += pf(r.grossProfit);
    sessionsTotal += r.sessionsTotal || 0;
    adOrders += r.adOrders || 0;
    organicOrders += r.organicOrders || 0;
    adClicks += r.adClicks || 0;
    adImpressions += r.adImpressions || 0;
    adSpend += pf(r.adSpend);
    adSalesAmount += pf(r.adSalesAmount);

    refundQty += r.refundQty || 0;
    returnQty += r.returnQty || 0;
    organicClicks += r.organicClicks || 0;

    if (r.weekEndDate) weekEndDate = r.weekEndDate;
  }

  for (const r of latestSaihuSnapshots(rows)) {
    const rc = Number(r.ratingCount) || 0;
    const rt = pf(r.rating);
    ratingCount += rc;
    if (rc > 0 && rt > 0) { ratingSum += rt * rc; ratingWeightSum += rc; }
  }

  // Derived rates
  const grossMargin = salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0;
  const cvr = sessionsTotal > 0 ? (orderQty / sessionsTotal) * 100 : 0;
  const adCvr = adClicks > 0 ? (adOrders / adClicks) * 100 : 0;
  const organicCvr = organicClicks > 0 ? (organicOrders / organicClicks) * 100 : 0;
  const adClickRate = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
  const cpc = adClicks > 0 ? adSpend / adClicks : 0;
  const acos = adSalesAmount > 0 ? (adSpend / adSalesAmount) * 100 : 0;
  const rating = ratingWeightSum > 0 ? ratingSum / ratingWeightSum : 0;
  const returnRate = salesQty > 0 ? (returnQty / salesQty) * 100 : 0;

  return {
    weekEndDate,
    activeDays: rows.some(r => r.reportDate) ? new Set(rows.filter(r => r.reportDate).map(r => r.reportDate)).size : null,
    salesQty, orderQty, salesAmount, grossProfit, grossMargin,
    sessionsTotal, cvr, adCvr, organicCvr,
    adOrders, organicOrders,
    adClicks, adClickRate, adImpressions, cpc, adSpend, adSalesAmount, acos,
    rating: Math.round(rating * 10) / 10,
    ratingCount, returnRate,
  };
}

