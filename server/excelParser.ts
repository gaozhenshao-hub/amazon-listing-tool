/**
 * Excel Parser for Data Import Center
 * Supports: 领星产品表现 (Lingxing) and 赛狐产品分析 (Saihu)
 * Auto-detects source type by column names
 * Parses date range from filename
 */
import * as XLSX from "xlsx";

// ─── Column Mapping: Lingxing Chinese Header → DB field ───
const LINGXING_COLUMN_MAP: Record<string, string> = {
  "ASIN": "asin",
  "父ASIN": "parentAsin",
  "MSKU": "msku",
  "店铺": "storeName",
  "国家": "country",
  "标题": "title",
  "售价(总价)": "price",
  "负责人": "operator",
  "品名": "productName",
  "SKU": "sku",
  "品牌": "brand",
  "一级分类": "category1",
  "二级分类": "category2",
  "三级分类": "category3",
  "自动标签": "autoTag",
  "listing标签": "listingTag",
  "创建时间": "createdTime",
  // Sales
  "销量": "salesQty",
  "销售额": "salesAmount",
  "订单量": "orderQty",
  "净销售额": "netSalesAmount",
  "销量环比": "salesQtyMom",
  "销售额环比": "salesAmountMom",
  "订单量环比": "orderQtyMom",
  "销量同比": "salesQtyYoy",
  "销售额同比": "salesAmountYoy",
  "订单量同比": "orderQtyYoy",
  "平均销量": "avgSalesQty",
  "销售均价": "avgPrice",
  "B2B 销量": "b2bSalesQty",
  "B2B 销售额": "b2bSalesAmount",
  "B2B 订单量": "b2bOrderQty",
  "促销销量": "promoSalesQty",
  "促销销售额": "promoSalesAmount",
  "促销订单量": "promoOrderQty",
  "促销折扣": "promoDiscount",
  "FBM买家运费": "fbmBuyerShipping",
  // Ranking
  "大类排名": "bsrMain",
  "小类排名": "bsrSub",
  // Profit
  "结算毛利润": "settlementProfit",
  "订单毛利润": "orderProfit",
  "结算毛利率": "settlementProfitMargin",
  "订单毛利率": "orderProfitMargin",
  "ROI": "roi",
  // Returns
  "退款量": "refundQty",
  "退款金额": "refundAmount",
  "退款率": "refundRate",
  "退货量": "returnQty",
  "退货率": "returnRate",
  // Reviews
  "评分": "rating",
  "评论数": "reviewCount",
  "留评率": "reviewRate",
  // Inventory
  "FBM可售": "fbmAvailable",
  "FBA-可售": "fbaAvailable",
  "FBA-待调仓": "fbaTransferPending",
  "FBA-调仓中": "fbaTransferring",
  "FBA-入库中": "fbaInbound",
  "FBA库存": "fbaTotal",
  "FBA-待发货": "fbaPendingShip",
  "FBA-在途": "fbaInTransit",
  "FBA-计划入库": "fbaPlanInbound",
  "FBA-不可售": "fbaUnavailable",
  "可用库存": "availableStock",
  "FBA可售天数预估": "fbaDaysOfSupply",
  "FBM可售天数预估": "fbmDaysOfSupply",
  "AWD在库": "awdInStock",
  "AWD可用量": "awdAvailable",
  "AWD待发货量": "awdPendingShip",
  "AWD标发在途": "awdInTransit",
  "海外仓可用": "overseasAvailable",
  "本地可用": "localAvailable",
  "采购量": "purchaseQty",
  "月库销比": "monthlyStockSalesRatio",
  "断货时间": "stockoutDate",
  // Traffic
  "Sessions-Browser": "sessionsBrowser",
  "Sessions-Browser-Percentage": "sessionsBrowserPct",
  "Sessions-Mobile": "sessionsMobile",
  "Sessions-Mobile-Percentage": "sessionsMobilePct",
  "Sessions-Total": "sessionsTotal",
  "Sessions-Percentage": "sessionsPct",
  "Unit-Sessions-Percentage": "unitSessionsPct",
  "PV-Browser": "pvBrowser",
  "PV-Browser-Percentage": "pvBrowserPct",
  "PV-Mobile": "pvMobile",
  "PV-Mobile-Percentage": "pvMobilePct",
  "PV-Total": "pvTotal",
  "PV-Percentage": "pvPct",
  "CVR": "cvr",
  "销量CVR": "salesCvr",
  "Buybox赢得率": "buyboxRate",
  // Ads
  "展示": "adImpressions",
  "点击": "adClicks",
  "广告花费": "adSpend",
  "SP广告费": "spAdSpend",
  "SB广告费": "sbAdSpend",
  "SBV广告费": "sbvAdSpend",
  "SD广告费": "sdAdSpend",
  "ST广告费": "stAdSpend",
  "Live广告费": "liveAdSpend",
  "广告销售额": "adSales",
  "SP广告销售额": "spAdSales",
  "SB广告销售额": "sbAdSales",
  "SBV广告销售额": "sbvAdSales",
  "SD广告销售额": "sdAdSales",
  "广告订单量": "adOrders",
  "SP广告订单量": "spAdOrders",
  "SB广告订单量": "sbAdOrders",
  "SBV广告订单量": "sbvAdOrders",
  "SD广告订单量": "sdAdOrders",
  "广告订单占比": "adOrderPct",
  "直接成交销售额": "directSales",
  "直接成交订单量": "directOrders",
  "CTR": "ctr",
  "广告CVR": "adCvr",
  "CPC": "cpc",
  "CPM": "cpm",
  "ROAS": "roas",
  "ACOS": "acos",
  "TACOS": "tacos",
  "ACoAS": "acoas",
  "ASoAS": "asoas",
  "CPO": "cpo",
  "CPU": "cpu",
  // Organic
  "自然点击量": "organicClicks",
  "自然订单量": "organicOrders",
  "自然CVR": "organicCvr",
};

// ─── Column Mapping: Saihu Chinese Header → DB field ───
const SAIHU_COLUMN_MAP: Record<string, string> = {
  "币种": "currency",
  "图片链接": "imageUrl",
  "ASIN": "asin",
  "标题": "title",
  "父ASIN": "parentAsin",
  "MSKU": "msku",
  "品名": "productName",
  "SKU": "sku",
  "店铺": "storeName",
  "站点": "site",
  "分类": "category",
  "商品品牌": "brand",
  "业务员": "operator",
  "开发员": "developer",
  "产品标签": "productTag",
  "上架时间": "listingDate",
  // Multi-period sales
  "3天销量": "sales3d",
  "7天销量": "sales7d",
  "14天销量": "sales14d",
  "30天销量": "sales30d",
  "60天销量": "sales60d",
  "90天销量": "sales90d",
  // Profit
  "毛利润": "grossProfit",
  "毛利率": "grossMargin",
  "平均毛利润": "avgGrossProfit",
  // Sales
  "销量": "salesQty",
  "FBA销量": "fbaSalesQty",
  "FBM销量": "fbmSalesQty",
  "平均销量": "avgSalesQty",
  "促销销量": "promoSalesQty",
  "销量-B2B": "b2bSalesQty",
  "订单量-B2B": "b2bOrderQty",
  "VINE销量": "vineSalesQty",
  "多渠道销量": "multiChannelSalesQty",
  "订单量": "orderQty",
  "促销订单量": "promoOrderQty",
  "取消订单量": "cancelOrderQty",
  "取消订单量占比": "cancelOrderPct",
  "销售额": "salesAmount",
  "净销售额": "netSalesAmount",
  "促销销售额": "promoSalesAmount",
  "销售收益": "salesRevenue",
  "平均售价": "avgPrice",
  "商品折扣": "productDiscount",
  "FBM买家运费": "fbmBuyerShipping",
  "销售额-B2B": "b2bSalesAmount",
  // Returns
  "退款": "refundAmount",
  "退款量": "refundQty",
  "退款率": "refundRate",
  "退货量": "returnQty",
  "FBA退货量": "fbaReturnQty",
  "FBM退货量": "fbmReturnQty",
  "退货率": "returnRate",
  "FBA退货率": "fbaReturnRate",
  "FBM退货率": "fbmReturnRate",
  "换货量": "exchangeQty",
  "换货率": "exchangeRate",
  "测评销售额": "testSalesAmount",
  // Inventory
  "FBA可售": "fbaAvailable",
  "预留转运": "reservedTransfer",
  "预留处理中": "reservedProcessing",
  "入库正在接收": "inboundReceiving",
  "预留订单": "reservedOrder",
  "入库处理中": "inboundProcessing",
  "入库已发货": "inboundShipped",
  "FBA不可售": "fbaUnavailable",
  "调查中": "investigating",
  "FBA可用": "fbaUsable",
  "FBA在途": "fbaInTransit",
  "FBA可售天数": "fbaDaysOfSupply",
  "FBM可售": "fbmAvailable",
  "FBM可售天数": "fbmDaysOfSupply",
  "AWD库存": "awdStock",
  "AWD可售": "awdAvailable",
  "AWD预留": "awdReserved",
  "AWD在途": "awdInTransit",
  "AWD发FBA在途": "awdToFbaInTransit",
  "建议补货量": "suggestedReplenishQty",
  "本地仓可用": "localWarehouseAvailable",
  "海外仓可用": "overseasWarehouseAvailable",
  // Inventory age
  "0-30天库龄": "age0to30",
  "31-60天库龄": "age31to60",
  "61-90天库龄": "age61to90",
  "91-180天库龄": "age91to180",
  "181-270天库龄": "age181to270",
  "271-365天库龄": "age271to365",
  "365+天库龄": "age365plus",
  // Traffic
  "Sessions-移动端": "sessionsMobile",
  "Sessions-浏览器": "sessionsBrowser",
  "Sessions": "sessionsTotal",
  "PV-移动端": "pvMobile",
  "PV-浏览器": "pvBrowser",
  "PV": "pvTotal",
  "BuyBox价格": "buyboxPrice",
  "BuyBox赢得率": "buyboxRate",
  "转化率": "cvr",
  "订单转化率": "orderCvr",
  // Rankings
  "小类目排名": "bsrSub",
  "大类目排名": "bsrMain",
  // Reviews
  "星级评分": "rating",
  "评分数": "ratingCount",
  "Review中差评数": "negativeReviewCount",
  "有效Review数": "effectiveReviewCount",
  "留评率": "reviewRate",
  // Organic
  "自然点击量": "organicClicks",
  "自然订单量": "organicOrders",
  "自然转化率": "organicCvr",
  "自然订单量占比": "organicOrderPct",
  // Ads
  "广告曝光量": "adImpressions",
  "广告点击量": "adClicks",
  "广告点击率": "adClickRate",
  "广告转化率": "adCvr",
  "CPC_广告转化率": "cpcAdCvr",
  "VCPM_广告转化率": "vcpmAdCvr",
  "广告花费": "adSpend",
  "SP广告花费": "spAdSpend",
  "SB商品集广告花费": "sbCollectionAdSpend",
  "SB旗舰店广告花费": "sbStoreAdSpend",
  "SB视频广告花费": "sbVideoAdSpend",
  "SD广告花费": "sdAdSpend",
  "CPC": "cpc",
  "CPA": "cpa",
  "CPO": "cpo",
  "CPU": "cpu",
  "ACoS": "acos",
  "SP_ACoS": "spAcos",
  "SB商品集ACoS": "sbCollectionAcos",
  "SB旗舰店ACoS": "sbStoreAcos",
  "SB视频ACoS": "sbVideoAcos",
  "SD_ACoS": "sdAcos",
  "ACoAS": "acoas",
  "ASoAS": "asoas",
  "广告销量": "adSalesQty",
  "广告订单量": "adOrders",
  "SP广告订单量": "spAdOrders",
  "SB商品集广告订单量": "sbCollectionAdOrders",
  "SB旗舰店广告订单量": "sbStoreAdOrders",
  "SB视频广告订单量": "sbVideoAdOrders",
  "SD广告订单量": "sdAdOrders",
  "广告订单量占比": "adOrderPct",
  "广告销售额": "adSalesAmount",
  "SP广告销售额": "spAdSales",
  "SB商品集广告销售额": "sbCollectionAdSales",
  "SB旗舰店广告销售额": "sbStoreAdSales",
  "SB视频广告销售额": "sbVideoAdSales",
  "SD广告销售额": "sdAdSales",
  // Self-product ads
  "本产品广告销售额": "selfAdSales",
  "SP本产品广告销售额": "spSelfAdSales",
  "SB商品集本产品广告销售额": "sbCollectionSelfAdSales",
  "SB旗舰店本产品广告销售额": "sbStoreSelfAdSales",
  "SB视频本产品广告销售额": "sbVideoSelfAdSales",
  "SD本产品广告销售额": "sdSelfAdSales",
  "本产品广告订单量": "selfAdOrders",
  "SP本产品广告订单量": "spSelfAdOrders",
  "SB商品集本产品广告订单量": "sbCollectionSelfAdOrders",
  "SB旗舰店本产品广告订单量": "sbStoreSelfAdOrders",
  "SB视频本产品广告订单量": "sbVideoSelfAdOrders",
  "SD本产品广告订单量": "sdSelfAdOrders",
};

// ─── Source Type Detection ───
export type SourceType = "lingxing" | "saihu";

export function detectSourceType(headers: string[]): SourceType | null {
  // Lingxing unique markers
  const lingxingMarkers = ["父ASIN", "国家", "结算毛利润", "Sessions-Browser", "SBV广告费"];
  // Saihu unique markers
  const saihuMarkers = ["站点", "3天销量", "毛利润", "Sessions-浏览器", "SB商品集广告花费"];

  const lingxingScore = lingxingMarkers.filter(m => headers.includes(m)).length;
  const saihuScore = saihuMarkers.filter(m => headers.includes(m)).length;

  if (lingxingScore >= 2) return "lingxing";
  if (saihuScore >= 2) return "saihu";
  return null;
}

// ─── Date Range Parsing from Filename ───
export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export function parseDateRangeFromFilename(filename: string): DateRange | null {
  // Pattern 1: Lingxing "产品表现父ASIN（2026-03-30~2026-04-19，全部广告）"
  const pattern1 = /(\d{4}-\d{2}-\d{2})[~～](\d{4}-\d{2}-\d{2})/;
  const match1 = filename.match(pattern1);
  if (match1) {
    return { startDate: match1[1], endDate: match1[2] };
  }

  // Pattern 2: Saihu "产品分析-ASIN-列表-汇总-20260415-20260421(0)"
  const pattern2 = /(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/;
  const match2 = filename.match(pattern2);
  if (match2) {
    return {
      startDate: `${match2[1]}-${match2[2]}-${match2[3]}`,
      endDate: `${match2[4]}-${match2[5]}-${match2[6]}`,
    };
  }

  return null;
}

// ─── Value Parsing Helpers ───

/** Remove $ sign and parse as number */
function parseCurrency(val: any): number {
  if (val == null || val === "" || val === "None") return 0;
  const str = String(val).replace(/[$,￥¥]/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/** Remove % sign and parse as number (returns raw number, e.g. "25.5%" → 25.5) */
function parsePercent(val: any): string {
  if (val == null || val === "" || val === "None") return "0";
  const str = String(val).replace(/%/g, "").trim();
  return str || "0";
}

/** Parse integer value */
function parseIntVal(val: any): number {
  if (val == null || val === "" || val === "None") return 0;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? 0 : num;
}

/** Parse decimal value */
function parseDecimal(val: any): string {
  if (val == null || val === "" || val === "None") return "0";
  const num = parseFloat(String(val));
  return isNaN(num) ? "0" : String(num);
}

/** Keep as string (for mixed format fields like ranking with category name) */
function keepString(val: any): string | null {
  if (val == null || val === "" || val === "None") return null;
  return String(val).trim();
}

// ─── Field Type Definitions ───
type FieldType = "int" | "decimal" | "percent" | "currency" | "string";

// Lingxing field types
const LINGXING_FIELD_TYPES: Record<string, FieldType> = {
  // String fields
  asin: "string", parentAsin: "string", msku: "string", storeName: "string",
  country: "string", title: "string", price: "string", operator: "string",
  productName: "string", sku: "string", brand: "string",
  category1: "string", category2: "string", category3: "string",
  autoTag: "string", listingTag: "string", createdTime: "string",
  bsrMain: "string", bsrSub: "string",
  avgPrice: "string", monthlyStockSalesRatio: "string", stockoutDate: "string",
  rating: "string", reviewRate: "string",
  // Percent fields (stored as varchar with %)
  salesQtyMom: "percent", salesAmountMom: "percent", orderQtyMom: "percent",
  salesQtyYoy: "percent", salesAmountYoy: "percent", orderQtyYoy: "percent",
  settlementProfitMargin: "percent", orderProfitMargin: "percent", roi: "percent",
  refundRate: "percent", returnRate: "percent",
  sessionsBrowserPct: "percent", sessionsMobilePct: "percent",
  sessionsPct: "percent", unitSessionsPct: "percent",
  pvBrowserPct: "percent", pvMobilePct: "percent", pvPct: "percent",
  cvr: "percent", salesCvr: "percent", buyboxRate: "percent",
  adOrderPct: "percent", ctr: "percent", adCvr: "percent",
  acos: "percent", tacos: "percent", acoas: "percent", asoas: "percent",
  organicCvr: "percent",
  // Currency/decimal fields
  salesAmount: "currency", netSalesAmount: "currency",
  b2bSalesAmount: "currency", promoSalesAmount: "currency",
  promoDiscount: "currency", fbmBuyerShipping: "currency",
  settlementProfit: "currency", orderProfit: "currency",
  refundAmount: "currency",
  adSpend: "currency", spAdSpend: "currency", sbAdSpend: "currency",
  sbvAdSpend: "currency", sdAdSpend: "currency", stAdSpend: "currency",
  liveAdSpend: "currency",
  adSales: "currency", spAdSales: "currency", sbAdSales: "currency",
  sbvAdSales: "currency", sdAdSales: "currency",
  directSales: "currency",
  cpc: "string", cpm: "string", roas: "string", cpo: "string", cpu: "string",
  // Integer fields
  salesQty: "int", orderQty: "int", avgSalesQty: "decimal",
  b2bSalesQty: "int", b2bOrderQty: "int",
  promoSalesQty: "int", promoOrderQty: "int",
  refundQty: "int", returnQty: "int", reviewCount: "int",
  fbmAvailable: "int", fbaAvailable: "int",
  fbaTransferPending: "int", fbaTransferring: "int", fbaInbound: "int",
  fbaTotal: "int", fbaPendingShip: "int", fbaInTransit: "int",
  fbaPlanInbound: "int", fbaUnavailable: "int", availableStock: "int",
  fbaDaysOfSupply: "int", fbmDaysOfSupply: "int",
  awdInStock: "int", awdAvailable: "int", awdPendingShip: "int", awdInTransit: "int",
  overseasAvailable: "int", localAvailable: "int", purchaseQty: "int",
  sessionsBrowser: "int", sessionsMobile: "int", sessionsTotal: "int",
  pvBrowser: "int", pvMobile: "int", pvTotal: "int",
  adImpressions: "int", adClicks: "int",
  adOrders: "int", spAdOrders: "int", sbAdOrders: "int",
  sbvAdOrders: "int", sdAdOrders: "int",
  directOrders: "int",
  organicClicks: "int", organicOrders: "int",
};

// Saihu field types (most numeric fields are already pure numbers, not formatted)
const SAIHU_FIELD_TYPES: Record<string, FieldType> = {
  // String fields
  currency: "string", imageUrl: "string", asin: "string", title: "string",
  parentAsin: "string", msku: "string", productName: "string", sku: "string",
  storeName: "string", site: "string", category: "string", brand: "string",
  operator: "string", developer: "string", productTag: "string", listingDate: "string",
  bsrSub: "string", bsrMain: "string", buyboxPrice: "string",
  // Decimal fields (Saihu uses raw decimals for percentages like 0.2591)
  grossProfit: "decimal", grossMargin: "decimal", avgGrossProfit: "decimal",
  avgSalesQty: "decimal", cancelOrderPct: "decimal",
  salesAmount: "decimal", netSalesAmount: "decimal", promoSalesAmount: "decimal",
  salesRevenue: "decimal", avgPrice: "decimal", productDiscount: "decimal",
  fbmBuyerShipping: "decimal", b2bSalesAmount: "decimal",
  refundAmount: "decimal", refundRate: "decimal",
  returnRate: "decimal", fbaReturnRate: "decimal", fbmReturnRate: "decimal",
  exchangeRate: "decimal", testSalesAmount: "decimal",
  fbaDaysOfSupply: "decimal", fbmDaysOfSupply: "decimal",
  buyboxRate: "decimal", cvr: "decimal", orderCvr: "decimal",
  rating: "decimal", reviewRate: "decimal",
  organicCvr: "decimal", organicOrderPct: "decimal",
  adClickRate: "decimal", adCvr: "decimal", cpcAdCvr: "decimal", vcpmAdCvr: "decimal",
  adSpend: "decimal", spAdSpend: "decimal",
  sbCollectionAdSpend: "decimal", sbStoreAdSpend: "decimal",
  sbVideoAdSpend: "decimal", sdAdSpend: "decimal",
  cpc: "decimal", cpa: "decimal", cpo: "decimal", cpu: "decimal",
  acos: "decimal", spAcos: "decimal",
  sbCollectionAcos: "decimal", sbStoreAcos: "decimal",
  sbVideoAcos: "decimal", sdAcos: "decimal",
  acoas: "decimal", asoas: "decimal",
  adOrderPct: "decimal",
  adSalesAmount: "decimal", spAdSales: "decimal",
  sbCollectionAdSales: "decimal", sbStoreAdSales: "decimal",
  sbVideoAdSales: "decimal", sdAdSales: "decimal",
  selfAdSales: "decimal", spSelfAdSales: "decimal",
  sbCollectionSelfAdSales: "decimal", sbStoreSelfAdSales: "decimal",
  sbVideoSelfAdSales: "decimal", sdSelfAdSales: "decimal",
  // Integer fields
  sales3d: "int", sales7d: "int", sales14d: "int",
  sales30d: "int", sales60d: "int", sales90d: "int",
  salesQty: "int", fbaSalesQty: "int", fbmSalesQty: "int",
  promoSalesQty: "int", b2bSalesQty: "int", b2bOrderQty: "int",
  vineSalesQty: "int", multiChannelSalesQty: "int",
  orderQty: "int", promoOrderQty: "int", cancelOrderQty: "int",
  refundQty: "int", returnQty: "int", fbaReturnQty: "int", fbmReturnQty: "int",
  exchangeQty: "int",
  fbaAvailable: "int", reservedTransfer: "int", reservedProcessing: "int",
  inboundReceiving: "int", reservedOrder: "int",
  inboundProcessing: "int", inboundShipped: "int",
  fbaUnavailable: "int", investigating: "int", fbaUsable: "int", fbaInTransit: "int",
  fbmAvailable: "int",
  awdStock: "int", awdAvailable: "int", awdReserved: "int",
  awdInTransit: "int", awdToFbaInTransit: "int",
  suggestedReplenishQty: "int", localWarehouseAvailable: "int",
  overseasWarehouseAvailable: "int",
  age0to30: "int", age31to60: "int", age61to90: "int",
  age91to180: "int", age181to270: "int", age271to365: "int", age365plus: "int",
  sessionsMobile: "int", sessionsBrowser: "int", sessionsTotal: "int",
  pvMobile: "int", pvBrowser: "int", pvTotal: "int",
  ratingCount: "int", negativeReviewCount: "int", effectiveReviewCount: "int",
  organicClicks: "int", organicOrders: "int",
  adImpressions: "int", adClicks: "int",
  adSalesQty: "int", adOrders: "int", spAdOrders: "int",
  sbCollectionAdOrders: "int", sbStoreAdOrders: "int",
  sbVideoAdOrders: "int", sdAdOrders: "int",
  selfAdOrders: "int", spSelfAdOrders: "int",
  sbCollectionSelfAdOrders: "int", sbStoreSelfAdOrders: "int",
  sbVideoSelfAdOrders: "int", sdSelfAdOrders: "int",
};

function convertValue(val: any, fieldType: FieldType): any {
  switch (fieldType) {
    case "int": return parseIntVal(val);
    case "decimal": return parseDecimal(val);
    case "percent": return parsePercent(val);
    case "currency": return parseCurrency(val);
    case "string": return keepString(val);
    default: return keepString(val);
  }
}

// ─── Main Parse Function ───
export interface ParseResult {
  sourceType: SourceType;
  dateRange: DateRange;
  headers: string[];
  totalRows: number;
  previewRows: Record<string, any>[];  // First 5 rows for preview
  allRows: Record<string, any>[];      // All mapped rows
  unmappedColumns: string[];            // Columns not in our mapping
}

export function parseExcelBuffer(buffer: Buffer, filename: string): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Get all data as array of arrays
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (rawData.length < 2) {
    throw new Error("表格至少需要包含表头行和一行数据");
  }

  const headers: string[] = rawData[0].map((h: any) => String(h || "").trim());

  // Detect source type
  const sourceType = detectSourceType(headers);
  if (!sourceType) {
    throw new Error("无法识别表格格式。请上传领星产品表现或赛狐产品分析的导出表格。");
  }

  // Parse date range from filename
  const dateRange = parseDateRangeFromFilename(filename);
  if (!dateRange) {
    throw new Error("无法从文件名解析日期范围。文件名应包含日期，如：产品表现父ASIN（2026-03-30~2026-04-19）或 产品分析-ASIN-列表-汇总-20260415-20260421");
  }

  const columnMap = sourceType === "lingxing" ? LINGXING_COLUMN_MAP : SAIHU_COLUMN_MAP;
  const fieldTypes = sourceType === "lingxing" ? LINGXING_FIELD_TYPES : SAIHU_FIELD_TYPES;

  // Build header index → field name mapping
  const headerMapping: { colIndex: number; fieldName: string }[] = [];
  const unmappedColumns: string[] = [];

  headers.forEach((header, idx) => {
    if (!header) return;
    const fieldName = columnMap[header];
    if (fieldName) {
      headerMapping.push({ colIndex: idx, fieldName });
    } else {
      unmappedColumns.push(header);
    }
  });

  // Parse all data rows
  const allRows: Record<string, any>[] = [];
  for (let rowIdx = 1; rowIdx < rawData.length; rowIdx++) {
    const row = rawData[rowIdx];
    if (!row || row.every((cell: any) => cell == null || cell === "")) continue;

    const mapped: Record<string, any> = {};
    for (const { colIndex, fieldName } of headerMapping) {
      const rawVal = row[colIndex];
      const fieldType = fieldTypes[fieldName] || "string";
      mapped[fieldName] = convertValue(rawVal, fieldType);
    }
    allRows.push(mapped);
  }

  return {
    sourceType,
    dateRange,
    headers,
    totalRows: allRows.length,
    previewRows: allRows.slice(0, 5),
    allRows,
    unmappedColumns,
  };
}

// ─── Convenience: Convert camelCase to snake_case for DB insertion ───
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function convertRowToDbFormat(row: Record<string, any>): Record<string, any> {
  const dbRow: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    dbRow[camelToSnake(key)] = value;
  }
  return dbRow;
}
