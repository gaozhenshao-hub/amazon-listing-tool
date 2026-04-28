/**
 * Ad Report Parsers - Parse uploaded Excel/CSV files into structured data
 * Supports: Lingxing search term, campaign, placement reports (Excel)
 *           Amazon hourly report (CSV)
 *           Lingxing SC order export (Excel)
 */
import ExcelJS from "exceljs";

// ─── Helper: parse percentage string like "12.34%" → 0.1234
function pctToDecimal(val: any): number | null {
  if (val == null || val === "" || val === "-") return null;
  const s = String(val).replace("%", "").trim();
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // If already in decimal form (e.g. 0.12), return as-is
  // If in percentage form (e.g. 12.34), divide by 100
  return Math.abs(n) > 1 ? n / 100 : n;
}

// ─── Helper: parse number, handle "-", "N/A", commas
function toNum(val: any): number | null {
  if (val == null || val === "" || val === "-" || val === "N/A") return null;
  const s = String(val).replace(/,/g, "").replace("$", "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function toInt(val: any): number {
  const n = toNum(val);
  return n == null ? 0 : Math.round(n);
}

// ─── Helper: read Excel rows as array of objects
async function readExcelRows(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, any>[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || "").trim();
  });

  const rows: Record<string, any>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj: Record<string, any> = {};
    let hasData = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (key) {
        obj[key] = cell.value;
        if (cell.value != null && cell.value !== "") hasData = true;
      }
    });
    if (hasData) rows.push(obj);
  }
  return { headers, rows };
}

// ─── Helper: read CSV rows
function readCsvRows(text: string): { headers: string[]; rows: Record<string, any>[] } {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Handle BOM
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xfeff) headerLine = headerLine.slice(1);

  const headers = parseCsvLine(headerLine);
  const rows: Record<string, any>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const obj: Record<string, any> = {};
    let hasData = false;
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || "";
      if (values[idx] && values[idx].trim()) hasData = true;
    });
    if (hasData) rows.push(obj);
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 1. Search Term Report Parser (领星用户搜索词报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedSearchTermRow {
  storeName: string;
  country: string;
  adType: string;
  portfolioName: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
  targeting: string;
  searchTerm: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  sales: number | null;
  directSales: number | null;
  indirectSales: number | null;
  acos: number | null;
  roas: number | null;
  orders: number;
  directOrders: number;
  indirectOrders: number;
  indirectOrderRatio: number | null;
  cpa: number | null;
  cvr: number | null;
  avgOrderValue: number | null;
  directAvgOrderValue: number | null;
  indirectAvgOrderValue: number | null;
}

export async function parseSearchTermReport(buffer: Buffer): Promise<ParsedSearchTermRow[]> {
  const { rows } = await readExcelRows(buffer);
  return rows.map((r) => ({
    storeName: String(r["店铺名称"] || ""),
    country: String(r["国家"] || ""),
    adType: String(r["类型"] || "SP"),
    portfolioName: String(r["广告组合"] || ""),
    campaignName: String(r["广告活动"] || ""),
    adGroupName: String(r["广告组"] || ""),
    keyword: String(r["关键词"] || ""),
    matchType: String(r["匹配方式"] || ""),
    targeting: String(r["投放"] || ""),
    searchTerm: String(r["用户搜索词"] || ""),
    impressions: toInt(r["曝光量"]),
    clicks: toInt(r["点击"]),
    ctr: pctToDecimal(r["CTR"]),
    cpc: toNum(r["CPC-本币"]),
    spend: toNum(r["花费-本币"]),
    sales: toNum(r["广告销售额-本币"]),
    directSales: toNum(r["直接销售额-本币"]),
    indirectSales: toNum(r["间接销售额-本币"]),
    acos: pctToDecimal(r["ACoS"]),
    roas: toNum(r["ROAS"]),
    orders: toInt(r["广告订单"]),
    directOrders: toInt(r["直接订单"]),
    indirectOrders: toInt(r["间接订单"]),
    indirectOrderRatio: pctToDecimal(r["间接订单占比"]),
    cpa: toNum(r["CPA-本币"]),
    cvr: pctToDecimal(r["CVR"]),
    avgOrderValue: toNum(r["广告笔单价-本币"]),
    directAvgOrderValue: toNum(r["直接笔单价-本币"]),
    indirectAvgOrderValue: toNum(r["间接笔单价-本币"]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 2. Campaign Report Parser (领星广告活动报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedCampaignRow {
  storeName: string;
  country: string;
  adType: string;
  portfolioName: string;
  campaignName: string;
  effectiveStatus: string;
  budget: number | null;
  impressions: number;
  impressionShare: string;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  sales: number | null;
  directSales: number | null;
  indirectSales: number | null;
  acos: number | null;
  roas: number | null;
  orders: number;
  directOrders: number;
  indirectOrders: number;
  indirectOrderRatio: number | null;
  cpa: number | null;
  cvr: number | null;
  avgOrderValue: number | null;
  directAvgOrderValue: number | null;
  indirectAvgOrderValue: number | null;
  brandNewOrders: number;
  brandNewCvr: number | null;
  brandNewSales: number | null;
  brandNewSalesQty: number;
  adSalesQty: number;
  directSalesQty: number;
  indirectSalesQty: number;
  vcpm: number | null;
  viewableImpressions: number;
  dpv: number;
  fiveSecViews: number;
  fiveSecViewRate: number | null;
  videoQuarter: number;
  videoHalf: number;
  videoThreeQuarter: number;
  videoComplete: number;
  videoUnmute: number;
  vtr: number | null;
  vctr: number | null;
  brandSearchCount: number;
  avgReach: number | null;
  cumulativeReach: number;
  tags: string;
}

export async function parseCampaignReport(buffer: Buffer): Promise<ParsedCampaignRow[]> {
  const { rows } = await readExcelRows(buffer);
  return rows.map((r) => ({
    storeName: String(r["店铺名称"] || ""),
    country: String(r["国家"] || ""),
    adType: String(r["类型"] || "SP"),
    portfolioName: String(r["广告组合"] || ""),
    campaignName: String(r["广告活动"] || ""),
    effectiveStatus: String(r["有效状态"] || ""),
    budget: toNum(r["预算"]),
    impressions: toInt(r["曝光量"]),
    impressionShare: String(r["IS"] || ""),
    clicks: toInt(r["点击"]),
    ctr: pctToDecimal(r["CTR"]),
    cpc: toNum(r["CPC-本币"]),
    spend: toNum(r["花费-本币"]),
    sales: toNum(r["广告销售额-本币"]),
    directSales: toNum(r["直接销售额-本币"]),
    indirectSales: toNum(r["间接销售额-本币"]),
    acos: pctToDecimal(r["ACoS"]),
    roas: toNum(r["ROAS"]),
    orders: toInt(r["广告订单"]),
    directOrders: toInt(r["直接订单"]),
    indirectOrders: toInt(r["间接订单"]),
    indirectOrderRatio: pctToDecimal(r["间接订单占比"]),
    cpa: toNum(r["CPA-本币"]),
    cvr: pctToDecimal(r["CVR"]),
    avgOrderValue: toNum(r["广告笔单价-本币"]),
    directAvgOrderValue: toNum(r["直接笔单价-本币"]),
    indirectAvgOrderValue: toNum(r["间接笔单价-本币"]),
    brandNewOrders: toInt(r["品牌新客订单"]),
    brandNewCvr: pctToDecimal(r["品牌新客CVR"]),
    brandNewSales: toNum(r["品牌新客销售额-本币"]),
    brandNewSalesQty: toInt(r["品牌新客销量"]),
    adSalesQty: toInt(r["广告销量"]),
    directSalesQty: toInt(r["直接销量"]),
    indirectSalesQty: toInt(r["间接销量"]),
    vcpm: toNum(r["vCPM"]),
    viewableImpressions: toInt(r["可见次数"]),
    dpv: toInt(r["DPV"]),
    fiveSecViews: toInt(r["5秒观看次数"]),
    fiveSecViewRate: pctToDecimal(r["5秒观看率"]),
    videoQuarter: toInt(r["视频播1/4的次数"]),
    videoHalf: toInt(r["视频播一半的次数"]),
    videoThreeQuarter: toInt(r["视频播3/4的次数"]),
    videoComplete: toInt(r["视频完播的次数"]),
    videoUnmute: toInt(r["视频取消静音的次数"]),
    vtr: pctToDecimal(r["VTR"]),
    vctr: pctToDecimal(r["vCTR"]),
    brandSearchCount: toInt(r["品牌搜索次数"]),
    avgReach: toNum(r["平均触达次数"]),
    cumulativeReach: toInt(r["累计触达用户"]),
    tags: String(r["标签"] || ""),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 3. Placement Report Parser (领星广告位报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedPlacementRow {
  storeName: string;
  country: string;
  adType: string;
  portfolioName: string;
  campaignName: string;
  placement: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  sales: number | null;
  directSales: number | null;
  indirectSales: number | null;
  acos: number | null;
  roas: number | null;
  orders: number;
  directOrders: number;
  indirectOrders: number;
  indirectOrderRatio: number | null;
  cpa: number | null;
  cvr: number | null;
  avgOrderValue: number | null;
  directAvgOrderValue: number | null;
  indirectAvgOrderValue: number | null;
  brandNewOrders: number;
  brandNewCvr: number | null;
  brandNewSales: number | null;
  brandNewSalesQty: number;
  adSalesQty: number;
  directSalesQty: number;
  indirectSalesQty: number;
  viewableImpressions: number;
  dpv: number;
  fiveSecViews: number;
  fiveSecViewRate: number | null;
  videoQuarter: number;
  videoHalf: number;
  videoThreeQuarter: number;
  videoComplete: number;
  videoUnmute: number;
  vtr: number | null;
  vctr: number | null;
  brandSearchCount: number;
}

export async function parsePlacementReport(buffer: Buffer): Promise<ParsedPlacementRow[]> {
  const { rows } = await readExcelRows(buffer);
  return rows.map((r) => ({
    storeName: String(r["店铺名称"] || ""),
    country: String(r["国家"] || ""),
    adType: String(r["类型"] || "SP"),
    portfolioName: String(r["广告组合"] || ""),
    campaignName: String(r["广告活动"] || ""),
    placement: String(r["广告位"] || ""),
    impressions: toInt(r["曝光量"]),
    clicks: toInt(r["点击"]),
    ctr: pctToDecimal(r["CTR"]),
    cpc: toNum(r["CPC-本币"]),
    spend: toNum(r["花费-本币"]),
    sales: toNum(r["广告销售额-本币"]),
    directSales: toNum(r["直接销售额-本币"]),
    indirectSales: toNum(r["间接销售额-本币"]),
    acos: pctToDecimal(r["ACoS"]),
    roas: toNum(r["ROAS"]),
    orders: toInt(r["广告订单"]),
    directOrders: toInt(r["直接订单"]),
    indirectOrders: toInt(r["间接订单"]),
    indirectOrderRatio: pctToDecimal(r["间接订单占比"]),
    cpa: toNum(r["CPA-本币"]),
    cvr: pctToDecimal(r["CVR"]),
    avgOrderValue: toNum(r["广告笔单价-本币"]),
    directAvgOrderValue: toNum(r["直接笔单价-本币"]),
    indirectAvgOrderValue: toNum(r["间接笔单价-本币"]),
    brandNewOrders: toInt(r["品牌新客订单"]),
    brandNewCvr: pctToDecimal(r["品牌新客CVR"]),
    brandNewSales: toNum(r["品牌新客销售额-本币"]),
    brandNewSalesQty: toInt(r["品牌新客销量"]),
    adSalesQty: toInt(r["广告销量"]),
    directSalesQty: toInt(r["直接销量"]),
    indirectSalesQty: toInt(r["间接销量"]),
    viewableImpressions: toInt(r["可见次数"]),
    dpv: toInt(r["DPV"]),
    fiveSecViews: toInt(r["5秒观看次数"]),
    fiveSecViewRate: pctToDecimal(r["5秒观看率"]),
    videoQuarter: toInt(r["视频播1/4的次数"]),
    videoHalf: toInt(r["视频播一半的次数"]),
    videoThreeQuarter: toInt(r["视频播3/4的次数"]),
    videoComplete: toInt(r["视频完播的次数"]),
    videoUnmute: toInt(r["视频取消静音的次数"]),
    vtr: pctToDecimal(r["VTR"]),
    vctr: pctToDecimal(r["vCTR"]),
    brandSearchCount: toInt(r["品牌搜索次数"]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 4. Hourly Report Parser (亚马逊广告小时报告 CSV)
// ═══════════════════════════════════════════════════════════════
export interface ParsedHourlyRow {
  hour: number;
  currency: string;
  accountName: string;
  portfolioName: string;
  campaignName: string;
  campaignId: string;
  adGroupName: string;
  adGroupId: string;
  targetingValue: string;
  searchTerm: string;
  promotedSku: string;
  promotedAsin: string;
  placementName: string;
  placementClassification: string;
  impressions: number;
  invalidImpressions: number;
  clicks: number;
  invalidClicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  vcpm: number | null;
  vctr: number | null;
  spend: number | null;
  purchases: number;
  sales: number | null;
  costPerPurchase: number | null;
  purchaseRate: number | null;
  roas: number | null;
  clickPurchases: number;
  clickRoas: number | null;
}

export function parseHourlyReport(csvText: string): ParsedHourlyRow[] {
  const { rows } = readCsvRows(csvText);
  return rows.map((r) => {
    const clicks = toInt(r["点击量"]);
    const cpc = toNum(r["CPC"]);
    return {
      hour: toInt(r["小时"]),
      currency: String(r["预算货币"] || ""),
      accountName: String(r["广告主账户名称"] || ""),
      portfolioName: String(r["广告组合名称"] || ""),
      campaignName: String(r["广告活动名称"] || ""),
      campaignId: String(r["广告活动编号"] || ""),
      adGroupName: String(r["广告组名称"] || ""),
      adGroupId: String(r["广告组编号"] || ""),
      targetingValue: String(r["投放值"] || ""),
      searchTerm: String(r["搜索词"] || ""),
      promotedSku: String(r["推广的商品 SKU"] || r["推广的商品SKU"] || ""),
      promotedAsin: String(r["推广的商品编号"] || ""),
      placementName: String(r["广告位名称"] || ""),
      placementClassification: String(r["广告位分类"] || ""),
      impressions: toInt(r["展示量"]),
      invalidImpressions: toInt(r["无效展示量"]),
      clicks,
      invalidClicks: toInt(r["无效点击"]),
      ctr: pctToDecimal(r["点击率"]),
      cpc,
      cpm: toNum(r["CPM"]),
      vcpm: toNum(r["每千次可见展示成本 (vCPM)"] || r["每千次可见展示成本(vCPM)"]),
      vctr: pctToDecimal(r["浏览点击率 (vCTR)"] || r["浏览点击率(vCTR)"]),
      spend: clicks && cpc ? parseFloat((clicks * cpc).toFixed(2)) : toNum(r["花费"]),
      purchases: toInt(r["购买量"]),
      sales: toNum(r["销售额"]),
      costPerPurchase: toNum(r["单次购买成本"]),
      purchaseRate: pctToDecimal(r["点击转化率"]),
      roas: toNum(r["ROAS"]),
      clickPurchases: toInt(r["归因于点击的购买量"]),
      clickRoas: toNum(r["归因于点击的 ROAS"] || r["归因于点击的ROAS"]),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. Order Report Parser (领星SC订单导出)
// ═══════════════════════════════════════════════════════════════
export interface ParsedOrderRow {
  orderId: string;
  orderStatus: string;
  orderType: string;
  orderDate: Date;
  orderHour: number; // PST hour 0-23
  orderDayOfWeek: number; // 0=Sunday
  orderDateStr: string; // YYYY-MM-DD PST
  storeName: string;
  country: string;
  asin: string;
  sku: string;
  msku: string;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  salesRevenue: number | null;
  itemPrice: number | null;
  currency: string;
}

export async function parseOrderReport(buffer: Buffer, timezoneOffset: number = -7): Promise<ParsedOrderRow[]> {
  // timezoneOffset: -7 for PST, -4 for EST
  const { rows } = await readExcelRows(buffer);
  return rows
    .filter((r) => r["订单号"] && r["订购日期"])
    .map((r) => {
      // Parse order date - Lingxing format: "2026-04-26 05:03:00" (UTC+8)
      let orderDate: Date;
      const dateVal = r["订购日期"];
      if (dateVal instanceof Date) {
        orderDate = dateVal;
      } else {
        orderDate = new Date(String(dateVal));
      }

      // Convert from UTC+8 (Lingxing) to target timezone
      // UTC+8 → UTC: subtract 8 hours
      // UTC → PST (UTC-7): subtract 7 hours
      // Total: subtract 15 hours from Lingxing time
      const utcTime = orderDate.getTime() - 8 * 60 * 60 * 1000;
      const targetTime = utcTime + timezoneOffset * 60 * 60 * 1000;
      const targetDate = new Date(targetTime);

      const orderHour = targetDate.getUTCHours();
      const orderDayOfWeek = targetDate.getUTCDay();
      const orderDateStr = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, "0")}-${String(targetDate.getUTCDate()).padStart(2, "0")}`;

      return {
        orderId: String(r["订单号"] || ""),
        orderStatus: String(r["订单状态"] || ""),
        orderType: String(r["订单类型"] || ""),
        orderDate: new Date(utcTime), // store as UTC
        orderHour,
        orderDayOfWeek,
        orderDateStr,
        storeName: String(r["店铺"] || ""),
        country: String(r["国家"] || ""),
        asin: String(r["ASIN"] || ""),
        sku: String(r["SKU"] || ""),
        msku: String(r["MSKU"] || ""),
        productName: String(r["品名"] || r["标题"] || ""),
        quantity: toInt(r["数量"]) || 1,
        unitPrice: toNum(r["单价"]),
        salesRevenue: toNum(r["销售收益"]),
        itemPrice: toNum(r["销售额(Item Price)"]),
        currency: String(r["订单币种"] || "USD"),
      };
    });
}
