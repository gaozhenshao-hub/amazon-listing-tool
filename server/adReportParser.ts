/**
 * Ad Report Excel Parser
 * Parses 领星 (Lingxing) ad report exports (55 columns)
 * Supports SP, SB, SD ad types with keyword and product targeting
 */
import * as XLSX from "xlsx";

// ─── Column Mapping: Chinese Header → DB field ───
const AD_REPORT_COLUMN_MAP: Record<string, string> = {
  "店铺名称": "storeName",
  "国家": "country",
  "类型": "adType",           // SP, SB, SD
  "广告组合": "portfolioName",
  "广告活动": "campaignName",
  "广告组": "adGroupName",
  "投放": "keyword",           // keyword text or product ASIN
  "匹配方式": "matchType",     // 精准, 广泛, 词组, --
  "有效状态": "status",
  "竞价-本币": "bid",
  "默认竞价-本币": "defaultBid",
  "曝光量": "impressions",
  "IS": "impressionShare",
  "点击": "clicks",
  "CTR": "ctr",
  "CPC-本币": "cpc",
  "花费-本币": "spend",
  "广告销售额-本币": "sales",
  "直接销售额-本币": "directSales",
  "间接销售额-本币": "indirectSales",
  "ACoS": "acos",
  "ROAS": "roas",
  "广告订单": "orders",
  "直接订单": "directOrders",
  "间接订单": "indirectOrders",
  "CVR": "cvr",
  "广告销量": "adSalesQty",
  "直接销量": "directSalesQty",
  "间接销量": "indirectSalesQty",
  "品牌新客订单": "brandNewOrders",
  "品牌新客销售额-本币": "brandNewSales",
  "品牌搜索次数": "brandSearchCount",
};

// Match type mapping: Chinese → English
const MATCH_TYPE_MAP: Record<string, string> = {
  "精准": "exact",
  "广泛": "broad",
  "词组": "phrase",
  "--": "auto",
};

export interface AdReportRow {
  storeName: string;
  country: string;
  adType: string;
  portfolioName: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
  targetingType: "keyword" | "product";
  status: string;
  bid: number | null;
  defaultBid: number | null;
  impressions: number;
  impressionShare: string | null;
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
  adSalesQty: number;
  directSalesQty: number;
  indirectSalesQty: number;
  brandNewOrders: number;
  brandNewSales: number | null;
  brandSearchCount: number;
}

export interface AdReportParseResult {
  rows: AdReportRow[];
  totalRows: number;
  keywordRows: number;
  productTargetRows: number;
  uniquePortfolios: string[];
  uniqueAdTypes: string[];
  uniqueStores: string[];
  errors: string[];
}

function parseNumeric(val: any): number | null {
  if (val == null || val === "" || val === "--" || val === "0%") return null;
  const str = String(val).replace(/[,%$]/g, "").trim();
  if (str === "" || str === "--" || str === "有花费无销售额") return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function parseInteger(val: any): number {
  const n = parseNumeric(val);
  return n != null ? Math.round(n) : 0;
}

function parsePercentage(val: any): number | null {
  if (val == null || val === "" || val === "--") return null;
  const str = String(val).replace(/%/g, "").trim();
  if (str === "" || str === "--" || str === "有花费无销售额") return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Parse an ad report Excel buffer into structured rows
 */
export function parseAdReportBuffer(buffer: Buffer): AdReportParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], totalRows: 0, keywordRows: 0, productTargetRows: 0, uniquePortfolios: [], uniqueAdTypes: [], uniqueStores: [], errors: ["Excel文件中没有工作表"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

  if (rawData.length === 0) {
    return { rows: [], totalRows: 0, keywordRows: 0, productTargetRows: 0, uniquePortfolios: [], uniqueAdTypes: [], uniqueStores: [], errors: ["工作表中没有数据"] };
  }

  // Detect columns by matching header names
  const firstRow = rawData[0];
  const headerKeys = Object.keys(firstRow);
  const columnMapping: Record<string, string> = {};
  for (const header of headerKeys) {
    const trimmedHeader = header.trim();
    if (AD_REPORT_COLUMN_MAP[trimmedHeader]) {
      columnMapping[header] = AD_REPORT_COLUMN_MAP[trimmedHeader];
    }
  }

  const errors: string[] = [];
  const requiredFields = ["adType", "portfolioName", "keyword"];
  const mappedFields = Object.values(columnMapping);
  for (const field of requiredFields) {
    if (!mappedFields.includes(field)) {
      errors.push(`缺少必需列: ${field}`);
    }
  }
  if (errors.length > 0) {
    return { rows: [], totalRows: rawData.length, keywordRows: 0, productTargetRows: 0, uniquePortfolios: [], uniqueAdTypes: [], uniqueStores: [], errors };
  }

  const rows: AdReportRow[] = [];
  const portfolios = new Set<string>();
  const adTypes = new Set<string>();
  const stores = new Set<string>();
  let keywordRows = 0;
  let productTargetRows = 0;

  for (const raw of rawData) {
    // Map raw columns to structured fields
    const mapped: Record<string, any> = {};
    for (const [header, field] of Object.entries(columnMapping)) {
      mapped[field] = raw[header];
    }

    const keywordVal = String(mapped.keyword || "").trim();
    if (!keywordVal) continue;

    // Determine targeting type
    const isProductTarget = keywordVal.startsWith("商品:") || keywordVal.startsWith('商品:"');
    if (isProductTarget) {
      productTargetRows++;
    } else {
      keywordRows++;
    }

    const portfolioName = String(mapped.portfolioName || "").trim();
    const adType = String(mapped.adType || "").trim().toUpperCase();
    const store = String(mapped.storeName || "").trim();

    if (portfolioName) portfolios.add(portfolioName);
    if (adType) adTypes.add(adType);
    if (store) stores.add(store);

    // Map match type
    const rawMatchType = String(mapped.matchType || "--").trim();
    const matchType = MATCH_TYPE_MAP[rawMatchType] || rawMatchType;

    rows.push({
      storeName: store,
      country: String(mapped.country || "").trim(),
      adType,
      portfolioName,
      campaignName: String(mapped.campaignName || "").trim(),
      adGroupName: String(mapped.adGroupName || "").trim(),
      keyword: keywordVal,
      matchType,
      targetingType: isProductTarget ? "product" : "keyword",
      status: String(mapped.status || "").trim(),
      bid: parseNumeric(mapped.bid),
      defaultBid: parseNumeric(mapped.defaultBid),
      impressions: parseInteger(mapped.impressions),
      impressionShare: mapped.impressionShare ? String(mapped.impressionShare).trim() : null,
      clicks: parseInteger(mapped.clicks),
      ctr: parsePercentage(mapped.ctr),
      cpc: parseNumeric(mapped.cpc),
      spend: parseNumeric(mapped.spend),
      sales: parseNumeric(mapped.sales),
      directSales: parseNumeric(mapped.directSales),
      indirectSales: parseNumeric(mapped.indirectSales),
      acos: parsePercentage(mapped.acos),
      roas: parseNumeric(mapped.roas),
      orders: parseInteger(mapped.orders),
      directOrders: parseInteger(mapped.directOrders),
      indirectOrders: parseInteger(mapped.indirectOrders),
      cvr: parsePercentage(mapped.cvr),
      adSalesQty: parseInteger(mapped.adSalesQty),
      directSalesQty: parseInteger(mapped.directSalesQty),
      indirectSalesQty: parseInteger(mapped.indirectSalesQty),
      brandNewOrders: parseInteger(mapped.brandNewOrders),
      brandNewSales: parseNumeric(mapped.brandNewSales),
      brandSearchCount: parseInteger(mapped.brandSearchCount),
    });
  }

  return {
    rows,
    totalRows: rawData.length,
    keywordRows,
    productTargetRows,
    uniquePortfolios: [...portfolios].sort(),
    uniqueAdTypes: [...adTypes].sort(),
    uniqueStores: [...stores].sort(),
    errors,
  };
}
