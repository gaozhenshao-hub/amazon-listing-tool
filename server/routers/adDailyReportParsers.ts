/**
 * Ad Daily Report Parsers - Parse uploaded Excel/CSV files for 5 daily report types
 * Supports: Daily Placement, Daily Search Term, Daily Impression Share,
 *           Daily SB Benchmark, Daily Business Report
 */
import ExcelJS from "exceljs";

// ─── Helper: parse percentage string like "12.34%" → 0.1234
function pctToDecimal(val: any): number | null {
  if (val == null || val === "" || val === "-" || val === "N/A") return null;
  const s = String(val).replace("%", "").replace(/,/g, "").trim();
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.abs(n) > 1 ? n / 100 : n;
}

// ─── Helper: parse number, handle "-", "N/A", commas, currency symbols
function toNum(val: any): number | null {
  if (val == null || val === "" || val === "-" || val === "N/A") return null;
  const s = String(val).replace(/[,$¥€£]/g, "").replace(/,/g, "").trim();
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
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Helper: detect date from row (supports multiple date column names)
function detectDate(row: Record<string, any>): string {
  const dateKeys = ["Date", "日期", "date", "报告日期", "Report Date", "Start Date", "开始日期"];
  for (const key of dateKeys) {
    if (row[key]) {
      const val = String(row[key]).trim();
      // Handle Excel date serial number
      if (/^\d{5}$/.test(val)) {
        const d = new Date((parseInt(val) - 25569) * 86400000);
        return d.toISOString().split("T")[0];
      }
      // Handle YYYY-MM-DD or YYYY/MM/DD
      const match = val.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      // Handle MM/DD/YYYY
      const match2 = val.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match2) return `${match2[3]}-${match2[1].padStart(2, "0")}-${match2[2].padStart(2, "0")}`;
      return val;
    }
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════
// 1. Daily Placement Report Parser (每日广告位报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedDailyPlacementRow {
  reportDate: string;
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
  cvr: number | null;
  cpa: number | null;
  brandNewOrders: number;
  brandNewSales: number | null;
  viewableImpressions: number;
  vtr: number | null;
  vctr: number | null;
}

export async function parseDailyPlacementReport(buffer: Buffer, isCSV = false): Promise<ParsedDailyPlacementRow[]> {
  let rows: Record<string, any>[];
  if (isCSV) {
    const text = buffer.toString("utf8");
    ({ rows } = readCsvRows(text));
  } else {
    ({ rows } = await readExcelRows(buffer));
  }

  return rows.map((r) => ({
    reportDate: detectDate(r),
    storeName: String(r["店铺名称"] || r["Store Name"] || ""),
    country: String(r["国家"] || r["Country"] || ""),
    adType: String(r["类型"] || r["Ad Type"] || r["Campaign Type"] || "SP"),
    portfolioName: String(r["广告组合"] || r["Portfolio"] || r["Portfolio name"] || ""),
    campaignName: String(r["广告活动"] || r["Campaign Name"] || r["Campaign name"] || ""),
    placement: String(r["广告位"] || r["Placement"] || r["Placement Type"] || ""),
    impressions: toInt(r["曝光量"] || r["Impressions"]),
    clicks: toInt(r["点击"] || r["Clicks"]),
    ctr: pctToDecimal(r["CTR"] || r["Click-Through Rate"]),
    cpc: toNum(r["CPC-本币"] || r["CPC"] || r["Cost Per Click"]),
    spend: toNum(r["花费-本币"] || r["Spend"] || r["Cost"]),
    sales: toNum(r["广告销售额-本币"] || r["Sales"] || r["7 Day Total Sales"]),
    directSales: toNum(r["直接销售额-本币"] || r["Direct Sales"]),
    indirectSales: toNum(r["间接销售额-本币"] || r["Indirect Sales"]),
    acos: pctToDecimal(r["ACoS"] || r["ACOS"]),
    roas: toNum(r["ROAS"] || r["RoAS"]),
    orders: toInt(r["广告订单"] || r["Orders"] || r["7 Day Total Orders"]),
    directOrders: toInt(r["直接订单"] || r["Direct Orders"]),
    indirectOrders: toInt(r["间接订单"] || r["Indirect Orders"]),
    cvr: pctToDecimal(r["CVR"] || r["Conversion Rate"]),
    cpa: toNum(r["CPA-本币"] || r["CPA"]),
    brandNewOrders: toInt(r["品牌新客订单"] || r["New-to-brand orders"]),
    brandNewSales: toNum(r["品牌新客销售额"] || r["New-to-brand sales"]),
    viewableImpressions: toInt(r["可见曝光"] || r["Viewable Impressions"]),
    vtr: pctToDecimal(r["VTR"]),
    vctr: pctToDecimal(r["vCTR"]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 2. Daily Search Term Report Parser (每日搜索词报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedDailySearchTermRow {
  reportDate: string;
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
  cvr: number | null;
  cpa: number | null;
  avgOrderValue: number | null;
}

export async function parseDailySearchTermReport(buffer: Buffer, isCSV = false): Promise<ParsedDailySearchTermRow[]> {
  let rows: Record<string, any>[];
  if (isCSV) {
    const text = buffer.toString("utf8");
    ({ rows } = readCsvRows(text));
  } else {
    ({ rows } = await readExcelRows(buffer));
  }

  return rows.map((r) => ({
    reportDate: detectDate(r),
    storeName: String(r["店铺名称"] || r["Store Name"] || ""),
    country: String(r["国家"] || r["Country"] || ""),
    adType: String(r["类型"] || r["Ad Type"] || r["Campaign Type"] || "SP"),
    portfolioName: String(r["广告组合"] || r["Portfolio"] || r["Portfolio name"] || ""),
    campaignName: String(r["广告活动"] || r["Campaign Name"] || r["Campaign name"] || ""),
    adGroupName: String(r["广告组"] || r["Ad Group Name"] || r["Ad Group name"] || ""),
    keyword: String(r["关键词"] || r["Keyword"] || r["Targeting"] || ""),
    matchType: String(r["匹配方式"] || r["Match Type"] || r["Match type"] || ""),
    targeting: String(r["投放"] || r["Targeting Expression"] || ""),
    searchTerm: String(r["用户搜索词"] || r["Customer Search Term"] || r["Search Term"] || r["Query"] || ""),
    impressions: toInt(r["曝光量"] || r["Impressions"]),
    clicks: toInt(r["点击"] || r["Clicks"]),
    ctr: pctToDecimal(r["CTR"] || r["Click-Through Rate"]),
    cpc: toNum(r["CPC-本币"] || r["CPC"] || r["Cost Per Click"]),
    spend: toNum(r["花费-本币"] || r["Spend"] || r["Cost"]),
    sales: toNum(r["广告销售额-本币"] || r["Sales"] || r["7 Day Total Sales"]),
    directSales: toNum(r["直接销售额-本币"] || r["Direct Sales"]),
    indirectSales: toNum(r["间接销售额-本币"] || r["Indirect Sales"]),
    acos: pctToDecimal(r["ACoS"] || r["ACOS"]),
    roas: toNum(r["ROAS"] || r["RoAS"]),
    orders: toInt(r["广告订单"] || r["Orders"] || r["7 Day Total Orders"]),
    directOrders: toInt(r["直接订单"] || r["Direct Orders"]),
    indirectOrders: toInt(r["间接订单"] || r["Indirect Orders"]),
    cvr: pctToDecimal(r["CVR"] || r["Conversion Rate"]),
    cpa: toNum(r["CPA-本币"] || r["CPA"]),
    avgOrderValue: toNum(r["广告笔单价-本币"] || r["Average Order Value"]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 3. Daily Impression Share Report Parser (每日搜索词展示量份额报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedDailyImpressionShareRow {
  reportDate: string;
  storeName: string;
  country: string;
  adType: string;
  portfolioName: string;
  campaignName: string;
  adGroupName: string;
  targeting: string;
  searchTerm: string;
  impressionShare: number | null;
  impressionRank: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  spend: number | null;
  sales: number | null;
  acos: number | null;
  orders: number;
  topCompetitorShare: number | null;
  topCompetitorAsin: string;
}

export async function parseDailyImpressionShareReport(buffer: Buffer, isCSV = false): Promise<ParsedDailyImpressionShareRow[]> {
  let rows: Record<string, any>[];
  if (isCSV) {
    const text = buffer.toString("utf8");
    ({ rows } = readCsvRows(text));
  } else {
    ({ rows } = await readExcelRows(buffer));
  }

  return rows.map((r) => ({
    reportDate: detectDate(r),
    storeName: String(r["店铺名称"] || r["Store Name"] || ""),
    country: String(r["国家"] || r["Country"] || ""),
    adType: String(r["类型"] || r["Ad Type"] || "SP"),
    portfolioName: String(r["广告组合"] || r["Portfolio"] || r["Portfolio name"] || ""),
    campaignName: String(r["广告活动"] || r["Campaign Name"] || r["Campaign name"] || ""),
    adGroupName: String(r["广告组"] || r["Ad Group Name"] || ""),
    targeting: String(r["投放"] || r["Targeting"] || r["Targeting Expression"] || ""),
    searchTerm: String(r["搜索词"] || r["Search Term"] || r["Query"] || r["用户搜索词"] || ""),
    impressionShare: pctToDecimal(r["展示份额"] || r["Impression Share"] || r["Search term impression share"]),
    impressionRank: toInt(r["展示排名"] || r["Impression Rank"] || r["Search term impression rank"]) || null,
    impressions: toInt(r["曝光量"] || r["Impressions"]),
    clicks: toInt(r["点击"] || r["Clicks"]),
    ctr: pctToDecimal(r["CTR"] || r["Click-Through Rate"]),
    spend: toNum(r["花费-本币"] || r["Spend"] || r["Cost"]),
    sales: toNum(r["广告销售额-本币"] || r["Sales"] || r["7 Day Total Sales"]),
    acos: pctToDecimal(r["ACoS"] || r["ACOS"]),
    orders: toInt(r["广告订单"] || r["Orders"]),
    topCompetitorShare: pctToDecimal(r["竞品份额"] || r["Top Competitor Share"]),
    topCompetitorAsin: String(r["竞品ASIN"] || r["Top Competitor ASIN"] || ""),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 4. Daily SB Benchmark Report Parser (每日SB Benchmark广告报告)
// ═══════════════════════════════════════════════════════════════
export interface ParsedDailySbBenchmarkRow {
  reportDate: string;
  storeName: string;
  country: string;
  campaignName: string;
  adFormat: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  sales: number | null;
  acos: number | null;
  roas: number | null;
  orders: number;
  dpv: number;
  newToBrandOrders: number;
  newToBrandSales: number | null;
  newToBrandRate: number | null;
  benchmarkCtr: number | null;
  benchmarkCpc: number | null;
  benchmarkAcos: number | null;
  benchmarkRoas: number | null;
  benchmarkCvr: number | null;
  benchmarkDpvRate: number | null;
  benchmarkNewToBrandRate: number | null;
  ctrVsBenchmark: string;
  cpcVsBenchmark: string;
  acosVsBenchmark: string;
}

export async function parseDailySbBenchmarkReport(buffer: Buffer, isCSV = false): Promise<ParsedDailySbBenchmarkRow[]> {
  let rows: Record<string, any>[];
  if (isCSV) {
    const text = buffer.toString("utf8");
    ({ rows } = readCsvRows(text));
  } else {
    ({ rows } = await readExcelRows(buffer));
  }

  return rows.map((r) => ({
    reportDate: detectDate(r),
    storeName: String(r["店铺名称"] || r["Store Name"] || ""),
    country: String(r["国家"] || r["Country"] || ""),
    campaignName: String(r["广告活动"] || r["Campaign Name"] || r["Campaign name"] || ""),
    adFormat: String(r["广告格式"] || r["Ad Format"] || r["Ad format"] || r["Creative Type"] || ""),
    impressions: toInt(r["曝光量"] || r["Impressions"]),
    clicks: toInt(r["点击"] || r["Clicks"]),
    ctr: pctToDecimal(r["CTR"] || r["Click-Through Rate"]),
    cpc: toNum(r["CPC-本币"] || r["CPC"] || r["Cost Per Click"]),
    spend: toNum(r["花费-本币"] || r["Spend"] || r["Cost"]),
    sales: toNum(r["广告销售额-本币"] || r["Sales"] || r["14 Day Total Sales"]),
    acos: pctToDecimal(r["ACoS"] || r["ACOS"]),
    roas: toNum(r["ROAS"] || r["RoAS"]),
    orders: toInt(r["广告订单"] || r["Orders"] || r["14 Day Total Orders"]),
    dpv: toInt(r["DPV"] || r["Detail Page Views"] || r["14 Day Detail Page Views"]),
    newToBrandOrders: toInt(r["品牌新客订单"] || r["New-to-brand orders"] || r["14 Day New-to-brand Orders"]),
    newToBrandSales: toNum(r["品牌新客销售额"] || r["New-to-brand sales"] || r["14 Day New-to-brand Sales"]),
    newToBrandRate: pctToDecimal(r["品牌新客率"] || r["New-to-brand rate"] || r["% of Orders New-to-brand"]),
    benchmarkCtr: pctToDecimal(r["基准CTR"] || r["Benchmark CTR"] || r["Category benchmark - click-through rate"]),
    benchmarkCpc: toNum(r["基准CPC"] || r["Benchmark CPC"] || r["Category benchmark - cost-per-click"]),
    benchmarkAcos: pctToDecimal(r["基准ACoS"] || r["Benchmark ACoS"] || r["Category benchmark - ACOS"]),
    benchmarkRoas: toNum(r["基准ROAS"] || r["Benchmark ROAS"] || r["Category benchmark - return on ad spend"]),
    benchmarkCvr: pctToDecimal(r["基准CVR"] || r["Benchmark CVR"] || r["Category benchmark - conversion rate"]),
    benchmarkDpvRate: pctToDecimal(r["基准DPV率"] || r["Benchmark DPV Rate"] || r["Category benchmark - detail page view rate"]),
    benchmarkNewToBrandRate: pctToDecimal(r["基准新客率"] || r["Benchmark NTB Rate"] || r["Category benchmark - % of orders new-to-brand"]),
    ctrVsBenchmark: String(r["CTR对比基准"] || r["CTR vs Benchmark"] || ""),
    cpcVsBenchmark: String(r["CPC对比基准"] || r["CPC vs Benchmark"] || ""),
    acosVsBenchmark: String(r["ACoS对比基准"] || r["ACoS vs Benchmark"] || ""),
  }));
}

// ═══════════════════════════════════════════════════════════════
// 5. Daily Business Report Parser (每日业务报告 - Business Report)
// ═══════════════════════════════════════════════════════════════
export interface ParsedDailyBusinessRow {
  reportDate: string;
  storeName: string;
  country: string;
  childAsin: string;
  parentAsin: string;
  sku: string;
  productName: string;
  sessions: number;
  sessionPercentage: number | null;
  pageViews: number;
  pageViewsPercentage: number | null;
  buyBoxPercentage: number | null;
  unitsOrdered: number;
  unitsOrderedB2b: number;
  unitSessionPercentage: number | null;
  unitSessionPercentageB2b: number | null;
  orderedProductSales: number | null;
  orderedProductSalesB2b: number | null;
  totalOrderItems: number;
  totalOrderItemsB2b: number;
}

export async function parseDailyBusinessReport(buffer: Buffer, isCSV = false): Promise<ParsedDailyBusinessRow[]> {
  let rows: Record<string, any>[];
  if (isCSV) {
    const text = buffer.toString("utf8");
    ({ rows } = readCsvRows(text));
  } else {
    ({ rows } = await readExcelRows(buffer));
  }

  return rows.map((r) => ({
    reportDate: detectDate(r),
    storeName: String(r["店铺名称"] || r["Store Name"] || ""),
    country: String(r["国家"] || r["Country"] || ""),
    childAsin: String(r["(子)ASIN"] || r["Child ASIN"] || r["(Child) ASIN"] || r["ASIN"] || ""),
    parentAsin: String(r["(父)ASIN"] || r["Parent ASIN"] || r["(Parent) ASIN"] || ""),
    sku: String(r["SKU"] || r["sku"] || ""),
    productName: String(r["商品名称"] || r["Title"] || r["Product Name"] || ""),
    sessions: toInt(r["买家访问次数"] || r["Sessions"] || r["sessions"]),
    sessionPercentage: pctToDecimal(r["买家访问次数百分比"] || r["Session Percentage"] || r["Session %"]),
    pageViews: toInt(r["页面浏览次数"] || r["Page Views"] || r["Page views"]),
    pageViewsPercentage: pctToDecimal(r["页面浏览次数百分比"] || r["Page Views Percentage"] || r["Page Views %"]),
    buyBoxPercentage: pctToDecimal(r["购买按钮赢得率"] || r["Buy Box Percentage"] || r["Featured Offer (Buy Box) Percentage"]),
    unitsOrdered: toInt(r["已订购商品数量"] || r["Units Ordered"] || r["Units ordered"]),
    unitsOrderedB2b: toInt(r["已订购商品数量-B2B"] || r["Units Ordered - B2B"]),
    unitSessionPercentage: pctToDecimal(r["订单商品数量转化率"] || r["Unit Session Percentage"] || r["Unit session percentage"]),
    unitSessionPercentageB2b: pctToDecimal(r["订单商品数量转化率-B2B"] || r["Unit Session Percentage - B2B"]),
    orderedProductSales: toNum(r["已订购商品销售额"] || r["Ordered Product Sales"] || r["Ordered product sales"]),
    orderedProductSalesB2b: toNum(r["已订购商品销售额-B2B"] || r["Ordered Product Sales - B2B"]),
    totalOrderItems: toInt(r["订单商品数量"] || r["Total Order Items"] || r["Total order items"]),
    totalOrderItemsB2b: toInt(r["订单商品数量-B2B"] || r["Total Order Items - B2B"]),
  }));
}
