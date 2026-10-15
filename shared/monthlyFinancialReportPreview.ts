import * as XLSX from "xlsx";

/** Read-only, in-memory projection of the friend's two-level monthly export.
 * No import/confirmation API, storage, model, exchange rate or ownership inference.
 * Exact decimal strings describe supplied cells, not accuracy of the ERP source.
 */
export const MONTHLY_PREVIEW_LIMITS = Object.freeze({
  bytes: 5 * 1024 * 1024, zipEntries: 256, expandedEntryBytes: 16 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024, sheets: 8, rows: 10000, columns: 256,
  cells: 100000, cellCharacters: 4096, decimalDigits: 30, decimalPlaces: 12,
});
export class MonthlyPreviewError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "MonthlyPreviewError"; }
}
function fail(code: string, message: string): never { throw new MonthlyPreviewError(code, message); }
export type PreviewWarning = { code: string; message: string; sheet?: string; row?: number; columns?: string[] };
type Primitive = string | number | boolean | null;
export type PreviewCell = { address: string; value: Primitive; formula: string | null; format: string | null; error: boolean };
export type PreviewColumn = { column: string; group: string; detail: string; rawGroup: string; rawDetail: string };
export type PreviewMetric = { value: string | null; sources: string[]; unknownSources: string[]; absent: boolean };
export const MONTHLY_PREVIEW_METRICS = ["financialProfit", "salesQty", "salesAmount", "otherIncome", "discount", "purchaseCost", "freight", "fbaFee", "commission", "advertising", "promotion", "storage", "otherFees", "refundAmount", "refundQty", "returnQty", "adOrders", "adSales", "ld", "coupon", "vine"] as const;
export type PreviewMetricName = typeof MONTHLY_PREVIEW_METRICS[number];
const quantityMetrics = new Set<PreviewMetricName>(["salesQty", "refundQty", "returnQty", "adOrders"]);
export type PreviewRatio = { numerator: string | null; denominator: string | null; fraction: string | null; reason: string | null };
export type MonthlyPreviewRow = {
  sheet: string; rowNumber: number; kind: "data" | "summary";
  yearMonth: string | null; asin: string | null; parentAsin: string | null; parentCandidates: string[];
  sku: string | null; title: string | null; storeName: string | null; site: string | null;
  currency: string | null; currencySource: "column" | "amount-code" | "unknown";
  allocation: "asin" | "parent-only" | "unallocated" | "ambiguous";
  metrics: Record<PreviewMetricName, PreviewMetric>;
  ratios: { profitMargin: PreviewRatio; refundRate: PreviewRatio; returnRate: PreviewRatio };
  cells: PreviewCell[];
};
export type MonthlyPreviewSummary = {
  scope: { yearMonth: string; storeName: string; site: string; currency: string };
  allocation: "report-scope-only-no-product-allocation";
  sourceRows: Array<{ sheet: string; rowNumber: number }>;
  metrics: Record<PreviewMetricName, PreviewMetric>; ratios: MonthlyPreviewRow["ratios"];
};
export type MonthlyFinancialReportPreview = {
  mode: "memory-preview-only"; format: "xlsx" | "csv"; byteLength: number;
  amountConvention: "source-signed-no-conversion";
  sheets: Array<{ name: string; range: string; headerRows: number[]; columns: PreviewColumn[] }>;
  rows: MonthlyPreviewRow[]; summaries: MonthlyPreviewSummary[]; warnings: PreviewWarning[];
  excludedFromSummaries: Array<{ sheet: string; rowNumber: number; reason: string }>;
};
type Decimal = { units: bigint; scale: number };
function decimal(value: string): Decimal {
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return { units: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}
function decimalText({ units, scale }: Decimal): string {
  const sign = units < 0n ? "-" : "", padded = (units < 0n ? -units : units).toString().padStart(scale + 1, "0");
  const value = scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, "") : padded;
  return units === 0n ? "0" : sign + value;
}
function sumDecimals(values: string[]): string {
  const parsed = values.map(decimal), scale = Math.max(0, ...parsed.map(item => item.scale));
  return decimalText({ units: parsed.reduce((sum, item) => sum + item.units * 10n ** BigInt(scale - item.scale), 0n), scale });
}
function exactRatio(numerator: string | null, denominator: string | null, currencyKnown = true): PreviewRatio {
  const result = { numerator, denominator, fraction: null as string | null, reason: null as string | null };
  if (!currencyKnown) return { ...result, reason: "币种未知或冲突，不计算金额比例" };
  if (numerator === null || denominator === null) return { ...result, reason: "分子或分母未知" };
  const n = decimal(numerator), d = decimal(denominator);
  if (d.units <= 0n) return { ...result, reason: "分母必须为正，零或负分母保留但不相除" };
  let a = n.units * 10n ** BigInt(d.scale), b = d.units * 10n ** BigInt(n.scale);
  let x = a < 0n ? -a : a, y = b;
  while (y) { const remainder = x % y; x = y; y = remainder; }
  a /= x; b /= x;
  return { ...result, fraction: `${a}/${b}` };
}
function ratios(metrics: Record<PreviewMetricName, PreviewMetric>, currencyKnown: boolean): MonthlyPreviewRow["ratios"] {
  return {
    profitMargin: exactRatio(metrics.financialProfit.value, metrics.salesAmount.value, currencyKnown),
    refundRate: exactRatio(metrics.refundQty.value, metrics.salesQty.value),
    returnRate: exactRatio(metrics.returnQty.value, metrics.salesQty.value),
  };
}
const clean = (value: Primitive) => String(value ?? "").replace(/\s+/g, "");
const text = (value: Primitive) => String(value ?? "").trim();
const missing = (value: Primitive) => value === null || typeof value === "string" && ["", "-", "--", "—"].includes(value.trim());
const safeCellText = (cell: PreviewCell | undefined) => cell && !cell.formula && !cell.error && !missing(cell.value) ? text(cell.value) : null;
const identityLabels = new Set(["时间", "月份", "ASIN", "父ASIN", "店铺", "站点", "币种", "货币", "SKU", "品名", "业务员", "汇率(人民币)"]);
const summaryLabels = new Set(["汇总", "合计", "总计", "小计", "累计", "总销量", "总销售额"]);
const isSummaryLabel = (value: string) => summaryLabels.has(clean(value)) || /^(?:total|subtotal|grandtotal)$/i.test(clean(value));
const isTotalDetail = (value: string) => isSummaryLabel(value) || /总计|合计|小计|累计|汇总|^总/.test(value);

/** Accept decimal syntax only. Blank/dash/formula/error never becomes a zero. */
function amount(cell: PreviewCell): { value: string | null; currency: string | null; reason: string | null } {
  const unknown = (reason: string) => ({ value: null, currency: null, reason });
  if (cell.formula) return unknown("公式或公式缓存未重新计算，金额未知");
  if (cell.error) return unknown("Excel 错误单元格");
  if (missing(cell.value)) return unknown("空白或缺失标记，不补零");
  if (typeof cell.value === "boolean") return unknown("布尔值不是金额");
  if (typeof cell.value === "number" && (!Number.isFinite(cell.value) || Math.abs(cell.value) > Number.MAX_SAFE_INTEGER)) return unknown("不安全数值精度");
  let raw = text(cell.value), currency: string | null = null;
  if (typeof cell.value === "number" && /e/i.test(raw)) {
    const [coefficient, exponent] = raw.toLowerCase().split("e"), d = decimal(coefficient);
    const shift = Number(exponent), scale = d.scale - shift;
    raw = decimalText(scale < 0 ? { units: d.units * 10n ** BigInt(-scale), scale: 0 } : { units: d.units, scale });
  }
  let negativeParentheses = false;
  if (raw.startsWith("(") && raw.endsWith(")")) { negativeParentheses = true; raw = raw.slice(1, -1).trim(); }
  const code = raw.match(/^([A-Z]{3})\s+/) || raw.match(/\s+([A-Z]{3})$/);
  if (code) { currency = code[1]; raw = raw.replace(code[0], "").trim(); }
  // A symbol is retained in cells; $ or ¥ alone never chooses a currency/site.
  raw = raw.replace(/^([+-]?)\s*[$￥¥€£]\s*/, "$1");
  if (negativeParentheses) { if (/^[+-]/.test(raw)) return unknown("括号金额与正负号冲突"); raw = "-" + raw; }
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?$/.test(raw)) return unknown("不是受支持的十进制金额（不猜小数分隔符）");
  raw = raw.replace(/[,，]/g, "");
  if (raw.replace(/\D/g, "").length > MONTHLY_PREVIEW_LIMITS.decimalDigits || (raw.split(".")[1]?.length || 0) > MONTHLY_PREVIEW_LIMITS.decimalPlaces) return unknown("金额位数超过预览精度上限");
  return { value: decimalText(decimal(raw)), currency, reason: null };
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); return c >>> 0;
});
function crcChunk(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return crc >>> 0;
}
/** SheetJS can omit empty/data-table/shared formula markers and expose only a
 * numeric cache. This deliberately limited XML admission rejects such files
 * before parsing; it is not a formula evaluator or a general XML parser.
 */
function inspectFormulaXml(xml: string): void {
  if (xml.includes("\0") || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XLSX_XML_UNSUPPORTED", "不支持此 Excel XML 编码或实体定义");
  function unsupported(): never { fail("XLSX_FORMULA_UNSUPPORTED", "Excel 含无法忠实保留的公式类型（空公式、共享、数组或数据表公式），请核对原表并另存值副本"); }
  const marker = /<(?:[\w.-]+:)?f(?=[\s/>])/g;
  for (let found = marker.exec(xml); found; found = marker.exec(xml)) {
    const opening = /^<f((?:\s+[\w:.-]+\s*=\s*(?:"[^"<>&]*"|'[^'<>&]*'))*)\s*>/.exec(xml.slice(found.index));
    if (!opening) unsupported();
    const attributes = new Set<string>();
    for (const attribute of opening[1].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const name = attribute[1], value = attribute[2] ?? attribute[3];
      if (attributes.has(name)) unsupported(); attributes.add(name);
      if (name === "t" ? value !== "normal" : name === "xml:space" ? value !== "preserve" : !["ca", "aca", "bx"].includes(name) || !["0", "1", "true", "false"].includes(value)) unsupported();
    }
    const start = found.index + opening[0].length, end = xml.indexOf("</f>", start);
    if (end < 0 || !xml.slice(start, end).trim() || xml.slice(start, end).includes("<")) unsupported();
    marker.lastIndex = end + 4;
  }
}
/** Validate ZIP metadata AND actual streamed expansion before XLSX.read allocates a workbook.
 * This is an input/output budget, not an OS memory sandbox or a wall-clock guarantee.
 */
async function inspectXlsxZip(bytes: Uint8Array): Promise<void> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u16 = (p: number) => view.getUint16(p, true), u32 = (p: number) => view.getUint32(p, true);
  if (bytes.length < 22 || u32(0) !== 0x04034b50) fail("XLSX_ZIP", "仅支持未加密的标准 .xlsx ZIP 文件");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  if (end < Math.max(0, bytes.length - 65557)) fail("XLSX_ZIP", "ZIP 目录损坏或缺失");
  const count = u16(end + 10), size = u32(end + 12), offset = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535 || size === 0xffffffff || offset === 0xffffffff || offset + size !== end) fail("XLSX_ZIP", "不支持分卷、ZIP64 或异常 ZIP 目录");
  if (!count || count > MONTHLY_PREVIEW_LIMITS.zipEntries) fail("XLSX_LIMIT", "Excel ZIP 成员数量超限");
  const names = new Set<string>(), spans: Array<[number, number]> = [];
  const checkExtra = (start: number, length: number) => {
    const endExtra = start + length;
    if (endExtra > bytes.length) fail("XLSX_ZIP", "ZIP 扩展越界");
    for (let e = start; e < endExtra;) {
      if (e + 4 > endExtra || u16(e) === 1) fail("XLSX_ZIP", "不支持 ZIP64 或不完整扩展");
      e += 4 + u16(e + 2); if (e > endExtra) fail("XLSX_ZIP", "ZIP 扩展损坏");
    }
  };
  let at = offset, total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail("XLSX_ZIP", "ZIP 成员目录损坏");
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), expanded = u32(at + 24);
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || nameLength > 256 || u16(at + 34) || (flags & ~0x080e) || ![0, 8].includes(method)) fail("XLSX_ZIP", "不支持加密或异常 ZIP 成员");
    // SheetJS also reads local sizes. Reject descriptor-style archives instead
    // of trusting their possibly different local allocation hints on reparse.
    if (flags & 8) fail("XLSX_UNSUPPORTED", "不支持带 ZIP 数据描述符的 Excel，请另存为普通 XLSX 或 UTF-8 CSV");
    if ([compressed, expanded, local].includes(0xffffffff) || expanded > MONTHLY_PREVIEW_LIMITS.expandedEntryBytes || (total += expanded) > MONTHLY_PREVIEW_LIMITS.expandedBytes) fail("XLSX_LIMIT", "Excel 解压大小超限");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name.includes("\\") || name.startsWith("/") || name.includes("\0") || name.split("/").some(part => part === ".." || part === ".") || names.has(name)) fail("XLSX_ZIP", "ZIP 路径无效或重复");
    names.add(name);
    const directory = name.endsWith("/");
    if (directory ? expanded !== 0 : !/\.(?:xml|rels)$/i.test(name)) fail("XLSX_UNSUPPORTED", "本批预览仅支持 XML/关系文本部件和空目录；含图片、非空目录或未知部件的 Excel 请另存受限值副本或 UTF-8 CSV");
    if (/vbaProject|externalLinks|\.bin$/i.test(name)) fail("XLSX_UNSUPPORTED", "不支持宏、外部链接或二进制 Excel 内容");
    checkExtra(at + 46 + nameLength, extraLength);
    if (local + 30 > offset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail("XLSX_ZIP", "ZIP 本地头与目录不一致");
    const ln = u16(local + 26), le = u16(local + 28), start = local + 30 + ln + le, finish = start + compressed;
    if (finish > offset || start > offset || ln !== nameLength || !bytes.subarray(local + 30, local + 30 + ln).every((byte, i) => byte === bytes[at + 46 + i])) fail("XLSX_ZIP", "ZIP 成员越界或名称不一致");
    checkExtra(local + 30 + ln, le);
    if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== expanded) fail("XLSX_ZIP", "ZIP 本地长度与目录不一致");
    if (spans.some(([a, b]) => local < b && finish > a)) fail("XLSX_ZIP", "ZIP 成员重叠");
    spans.push([local, finish]);
    let seen = 0, actualCrc = 0xffffffff, xml = "";
    // OPC relationships, not filename suffixes, select worksheets. Every
    // admitted non-directory part is text and receives the same formula gate.
    const decoder = !directory ? new TextDecoder("utf-8", { fatal: true }) : null;
    if (method === 0) {
      seen = compressed; actualCrc = crcChunk(actualCrc, bytes.subarray(start, finish));
      if (decoder) xml = decoder.decode(bytes.subarray(start, finish));
    }
    else {
      if (typeof DecompressionStream === "undefined") fail("XLSX_PLATFORM", "当前浏览器不支持有界 Excel 解压，请改用 UTF-8 CSV");
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try { reader = new Blob([bytes.slice(start, finish)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(); }
      catch { fail("XLSX_PLATFORM", "当前浏览器不支持有界 Excel 解压，请改用 UTF-8 CSV"); }
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          seen += chunk.value.length;
          if (seen > expanded || seen > MONTHLY_PREVIEW_LIMITS.expandedEntryBytes) { await reader.cancel(); fail("XLSX_LIMIT", "Excel 实际解压大小与目录不符或超限"); }
          actualCrc = crcChunk(actualCrc, chunk.value);
          if (decoder) xml += decoder.decode(chunk.value, { stream: true });
        }
      } catch (error) { if (error instanceof MonthlyPreviewError) throw error; fail("XLSX_ZIP", "Excel 压缩数据损坏"); }
      finally { reader.releaseLock(); }
      if (decoder) xml += decoder.decode();
    }
    if (seen !== expanded || ((actualCrc ^ 0xffffffff) >>> 0) !== crc) fail("XLSX_ZIP", "Excel 成员长度或 CRC 不符");
    if (decoder) inspectFormulaXml(xml);
    at = next;
  }
  if (at !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) fail("XLSX_ZIP", "不是受支持的 XLSX 工作簿");
}

function csvSheet(bytes: Uint8Array): XLSX.WorkSheet {
  let input: string;
  try { input = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { fail("CSV_ENCODING", "CSV 必须为 UTF-8 编码"); }
  const sheet: XLSX.WorkSheet = {}; let row = 0, column = 0, field = "", quoted = false, afterQuote = false, started = false, count = 0;
  const save = () => {
    if (row >= MONTHLY_PREVIEW_LIMITS.rows || column >= MONTHLY_PREVIEW_LIMITS.columns || ++count > MONTHLY_PREVIEW_LIMITS.cells) fail("SHEET_LIMIT", "CSV 行、列或单元格数量超限");
    if (field.length > MONTHLY_PREVIEW_LIMITS.cellCharacters) fail("CELL_LIMIT", "单元格文本过长");
    if (field) sheet[XLSX.utils.encode_cell({ r: row, c: column })] = { t: "s", v: field };
    field = ""; afterQuote = false; started = false;
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else field += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      save(); if (char === ",") column++; else { row++; column = 0; if (char === "\r" && input[i + 1] === "\n") i++; }
    } else if (afterQuote) fail("CSV_QUOTES", "CSV 引号结束后只能跟逗号或换行");
    else if (char === '"') { if (started) fail("CSV_QUOTES", "CSV 引号位置无效"); quoted = true; started = true; }
    else { field += char; started = true; }
    if (field.length > MONTHLY_PREVIEW_LIMITS.cellCharacters) fail("CELL_LIMIT", "单元格文本过长");
  }
  if (quoted) fail("CSV_QUOTES", "CSV 引号未闭合");
  if (started || afterQuote || field || column) save();
  return sheet;
}

function candidateMetricColumns(column: PreviewColumn): PreviewMetricName[] {
  const g = column.group, d = column.detail;
  if (/占比|比例|比率|平均|汇率/.test(g + d)) return [];
  if (g === "毛利润") return ["financialProfit"];
  if (g === "销量") return ["salesQty"];
  if (g === "销售额" || g === "订单收入" && ["FBA销售额", "FBM销售额"].includes(d)) return ["salesAmount"];
  if (g === "其他收入" || g === "订单收入" && ["FBA买家运费", "FBM买家运费", "礼品包装费", "COD收费", "监管费"].includes(d)) return ["otherIncome"];
  if (g === "订单收入" && d === "促销折扣" || g === "促销折扣") return ["discount"];
  if (g.startsWith("商品成本支出-采购成本") || g === "采购成本") return ["purchaseCost"];
  if (g.startsWith("商品成本支出-头程费用") || g === "头程费用") return ["freight"];
  if (g === "订单支出" && ["FBA配送费-非多渠道订单", "FBA配送费-多渠道订单"].includes(d) || g === "退款" && d === "FBA配送费退款") return ["fbaFee"];
  if (g === "订单支出" && d === "销售佣金" || g === "退款" && d === "佣金退款") return ["commission"];
  if (g === "广告花费") return ["advertising"];
  if (g === "推广费") return d === "LD费" ? ["promotion", "ld"] : d === "优惠券" ? ["promotion", "coupon"] : d === "Vine" ? ["promotion", "vine"] : ["promotion"];
  if (g === "其余服务费" && /仓储/.test(d)) return ["storage"];
  if (g === "订单支出" || g === "其余服务费" || ["其他支出", "订单税费", "商品成本-FBM运费"].includes(g) || g.startsWith("自定义费用")) return ["otherFees"];
  if (g === "退款") return ["FBA销售额退款", "FBM销售额退款"].includes(d) ? ["refundAmount"] : ["otherFees"];
  if (g === "退款金额") return ["refundAmount"];
  if (g === "退款量") return ["refundQty"];
  if (g === "退货量") return ["returnQty"];
  if (g === "广告订单量") return ["adOrders"];
  if (g === "广告销售额") return ["adSales"];
  return [];
}
// Recognized source components only. Unknown children stay raw and make the
// related group total incomplete; their labels do not invent metric semantics.
const knownDetails = new Map<string, readonly string[]>([
  ["毛利润", ["财务毛利润"]], ["销量", ["FBA销量", "FBM销量"]], ["销售额", ["FBA销售额", "FBM销售额"]],
  ["订单收入", ["FBA销售额", "FBM销售额", "FBA买家运费", "FBM买家运费", "礼品包装费", "COD收费", "监管费", "促销折扣"]],
  ["其他收入", ["赔付", "FBA库存赔偿", "亚马逊运费赔偿", "赔偿收入", "清算收入", "费用调整", "FBA按件费用返还", "FBA重量费用返还", "邮资退款", "买家补款", "A-to-Z担保追回", "调整金额", "订阅费调整", "其他调整", "源头代收税", "佣金返还", "担保索赔", "补偿金额", "货到付款收入", "NETCO收入", "补收税费", "其他收入费项", "卖家奖励", "租赁延长费"]],
  ["采购成本", ["FBA采购成本", "FBM采购成本", "固定成本部分"]], ["头程费用", ["FBA头程费用", "FBM头程费用", "固定成本部分"]],
  ["订单支出", ["FBA配送费-非多渠道订单", "FBA配送费-多渠道订单", "销售佣金"]],
  ["退款", ["FBA配送费退款", "佣金退款", "FBA销售额退款", "FBM销售额退款"]],
  ["推广费", ["LD费", "优惠券", "Vine"]], ["其余服务费", ["月仓储费报告"]],
  ["退款量", ["FBA退款量", "FBM退款量"]], ["退货量", ["退货可售", "退货不可售"]],
  ["广告花费", ["SP", "SD", "SB", "SBV", "SBS", "ST", "CR", "SP广告", "SD广告", "SB视频广告", "SB旗舰店广告", "SB商品集广告", "ST广告", "CR广告"]],
  ["广告订单量", ["SP广告订单量", "SD广告订单量", "SB广告订单量", "SBV广告订单量", "SBS广告订单量", "ST广告订单量", "CR广告订单量"]],
  ["广告销售额", ["SP广告销售额", "SD广告销售额", "SB广告销售额", "SBV广告销售额", "SBS广告销售额", "ST广告销售额", "CR广告销售额"]],
]);
function metricColumns(column: PreviewColumn): PreviewMetricName[] {
  const { group, detail } = column;
  const componentGroup = group.startsWith("商品成本支出-采购成本") ? "采购成本" : group.startsWith("商品成本支出-头程费用") ? "头程费用" : group;
  if (detail && detail !== group && !isTotalDetail(detail) && !knownDetails.get(componentGroup)?.includes(detail)) return [];
  return candidateMetricColumns(column);
}

export async function parseMonthlyFinancialReportPreview(input: { bytes: Uint8Array | ArrayBuffer; format: "xlsx" | "csv" }): Promise<MonthlyFinancialReportPreview> {
  if (!input || !["xlsx", "csv"].includes(input.format) || !(input.bytes instanceof Uint8Array || input.bytes instanceof ArrayBuffer)) fail("INPUT", "请提供 XLSX 或 UTF-8 CSV 内存数据");
  if (!input.bytes.byteLength) fail("EMPTY_FILE", "文件为空");
  if (input.bytes.byteLength > MONTHLY_PREVIEW_LIMITS.bytes) fail("FILE_LIMIT", "文件超过 5 MiB 预览上限");
  // Copy before the asynchronous ZIP check so callers cannot change inspected bytes.
  const bytes = input.bytes instanceof Uint8Array ? input.bytes.slice() : new Uint8Array(input.bytes.slice(0));
  let book: XLSX.WorkBook;
  if (input.format === "csv") book = { SheetNames: ["CSV"], Sheets: { CSV: csvSheet(bytes) } };
  else {
    try { await inspectXlsxZip(bytes); }
    catch (error) { if (error instanceof MonthlyPreviewError) throw error; fail("XLSX_ZIP", "Excel ZIP 结构无效"); }
    try { book = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: false, cellNF: true, cellHTML: false, cellText: false, sheetRows: MONTHLY_PREVIEW_LIMITS.rows + 1 }); }
    catch { fail("XLSX_READ", "无法解析 Excel 工作簿"); }
  }
  if (!book.SheetNames.length || book.SheetNames.length > MONTHLY_PREVIEW_LIMITS.sheets) fail("SHEET_LIMIT", "工作表数量为空或超过 8 张");
  const result: MonthlyFinancialReportPreview = { mode: "memory-preview-only", format: input.format, byteLength: bytes.length, amountConvention: "source-signed-no-conversion", sheets: [], rows: [], summaries: [], warnings: [], excludedFromSummaries: [] };
  const warn = (code: string, message: string, sheet?: string, row?: number, columns?: string[]) => result.warnings.push({ code, message, ...(sheet ? { sheet } : {}), ...(row ? { row } : {}), ...(columns ? { columns } : {}) });
  let cellCount = 0, projectedCellCount = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name], cells = new Map<string, PreviewCell>(); let maxRow = -1, maxColumn = -1;
    if (!sheet) fail("SHEET_INVALID", "工作表缺失");
    for (const range of [sheet["!ref"], sheet["!fullref"]]) if (range) {
      if (!/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(range)) fail("SHEET_RANGE", "工作表范围无效");
      const decoded = XLSX.utils.decode_range(range);
      if (decoded.e.r >= MONTHLY_PREVIEW_LIMITS.rows || decoded.e.c >= MONTHLY_PREVIEW_LIMITS.columns) fail("SHEET_LIMIT", "工作表声明范围超限，不截断预览");
    }
    for (const [address, original] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) fail("CELL_ADDRESS", "单元格地址无效");
      const position = XLSX.utils.decode_cell(address), cell = original as XLSX.CellObject;
      if (position.r >= MONTHLY_PREVIEW_LIMITS.rows || position.c >= MONTHLY_PREVIEW_LIMITS.columns || ++cellCount > MONTHLY_PREVIEW_LIMITS.cells) fail("SHEET_LIMIT", "实际行、列或单元格数量超限");
      const value = cell.v ?? null;
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) fail("CELL_TYPE", "不支持的单元格类型");
      const formula = typeof cell.f === "string" ? cell.f : cell.F || typeof value === "string" && value.trimStart().startsWith("=") ? String(cell.F || value) : null;
      if ([String(value ?? ""), formula || "", String(cell.z ?? "")].some(item => item.length > MONTHLY_PREVIEW_LIMITS.cellCharacters)) fail("CELL_LIMIT", "单元格文本或公式过长");
      cells.set(address, { address, value: value as Primitive, formula, format: typeof cell.z === "string" ? cell.z : null, error: cell.t === "e" });
      maxRow = Math.max(maxRow, position.r); maxColumn = Math.max(maxColumn, position.c);
    }
    if (maxRow < 0) { warn("EMPTY_SHEET", "空工作表未生成记录", name); continue; }
    projectedCellCount += (maxRow + 1) * (maxColumn + 1);
    if (projectedCellCount > MONTHLY_PREVIEW_LIMITS.cells) fail("SHEET_LIMIT", "所有工作表展开单元格总数量超限");
    const range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } });
    if (sheet["!ref"] && sheet["!ref"] !== range) warn("RANGE_REBUILT", "声明范围与实际单元格不一致，已按有界实际单元格显示", name);
    const at = (r: number, c: number): PreviewCell => cells.get(XLSX.utils.encode_cell({ r, c })) || { address: XLSX.utils.encode_cell({ r, c }), value: null, formula: null, format: null, error: false };
    const rowCells = (r: number) => Array.from({ length: maxColumn + 1 }, (_, c) => at(r, c));
    let h = -1;
    for (let r = 0; r < Math.min(10, maxRow + 1); r++) {
      const labels = rowCells(r).map(cell => clean(cell.value));
      if (labels.includes("ASIN") && (labels.includes("时间") || labels.includes("月份")) && labels.includes("毛利润")) { h = r; break; }
    }
    if (h < 0) { warn("UNRECOGNIZED_SHEET", "前 10 行未识别月报关键表头，该表不参与预览合计", name); continue; }
    const topCells = rowCells(h), top = topCells.map(cell => clean(cell.value));
    for (const merge of sheet["!merges"] || []) {
      if (merge.e.r >= MONTHLY_PREVIEW_LIMITS.rows || merge.e.c >= MONTHLY_PREVIEW_LIMITS.columns) fail("SHEET_LIMIT", "合并单元格范围超限");
      if (merge.s.r === h && merge.e.r === h && merge.s.c !== merge.e.c) {
        for (let c = merge.s.c + 1; c <= merge.e.c; c++) { if (top[c]) fail("HEADER_MERGE", "合并表头包含冲突内容"); top[c] = top[merge.s.c]; }
      } else if (merge.e.r > h + 1 || merge.s.r > h) fail("DATA_MERGE", "不猜测合并数据单元格的金额或归属");
    }
    const next = rowCells(h + 1);
    const identityName = (label: string) => label === "月份" ? "时间" : label === "货币" ? "币种" : label;
    const identityHeader = top.every((group, c) => !identityLabels.has(group) || !clean(next[c].value) || identityName(clean(next[c].value)) === identityName(group));
    const twoLevels = identityHeader && next.some((cell, c) => {
      const group = top[c], value = clean(cell.value);
      return !identityLabels.has(group) && value !== group && !isTotalDetail(value) && metricColumns({ column: "", group, detail: value, rawGroup: "", rawDetail: "" }).length > 0 && !!value;
    });
    const sub = twoLevels ? next.map(cell => clean(cell.value)) : top.map(() => "");
    if ([...topCells, ...(twoLevels ? next : [])].some(cell => cell.formula || cell.error)) fail("HEADER_FORMULA", "表头不得依赖公式或错误缓存");
    const columns: PreviewColumn[] = top.map((group, c) => ({ column: XLSX.utils.encode_col(c), group: group === "月份" ? "时间" : group === "货币" ? "币种" : group, detail: sub[c], rawGroup: String(topCells[c].value ?? ""), rawDetail: twoLevels ? String(next[c].value ?? "") : "" }));
    if (columns.some(column => !column.group)) fail("HEADER_EMPTY", "存在无名称列；不把空表头自动归属到左侧分组");
    const seen = new Set<string>();
    for (const column of columns) {
      const key = identityLabels.has(column.group) ? column.group : `${column.group}/${column.detail}`;
      if (seen.has(key)) fail("HEADER_DUPLICATE", `重复或歧义表头：${key}`); seen.add(key);
    }
    for (const label of ["时间", "ASIN", "父ASIN", "店铺", "站点", "毛利润", "销量"]) if (!columns.some(column => column.group === label)) fail("HEADER_REQUIRED", `缺少关键列「${label}」`);
    if (!columns.some(column => metricColumns(column).includes("salesAmount"))) fail("HEADER_REQUIRED", "缺少销售额或订单收入/FBA、FBM 销售额列");
    const mappings = MONTHLY_PREVIEW_METRICS.map(metric => ({ metric,
      indexes: columns.flatMap((column, c) => metricColumns(column).includes(metric) ? [c] : []),
      unresolved: columns.flatMap((column, c) => candidateMetricColumns(column).includes(metric) && !metricColumns(column).includes(metric) ? [c] : []),
    }));
    const monetaryIndexes = [...new Set(mappings.filter(({ metric }) => !quantityMetrics.has(metric)).flatMap(({ indexes }) => indexes))];
    for (const group of new Set(columns.map(column => column.group))) {
      const members = columns.filter(column => column.group === group);
      if (!identityLabels.has(group) && members.length > 1 && members.some(column => isTotalDetail(column.detail))) fail("HEADER_TOTAL_AMBIGUOUS", `${group} 同时包含总额和分项，不自动重复相加`);
    }
    for (const { metric, indexes } of mappings) {
      if (indexes.length > 1 && indexes.some(c => !columns[c].detail || columns[c].detail === columns[c].group || isTotalDetail(columns[c].detail))) fail("HEADER_TOTAL_AMBIGUOUS", `${metric} 同时包含总额和分项，不自动重复相加`);
    }
    const unmapped = columns.filter(column => !identityLabels.has(column.group) && !metricColumns(column).length && !/占比|比例|比率|平均|汇率/.test(column.group + column.detail));
    if (unmapped.length) warn("UNMAPPED_COLUMNS", "以下列仅保留原始值，不猜子指标；涉及的分组总额保持未知", name, undefined, unmapped.map(column => column.column));
    result.sheets.push({ name, range, headerRows: twoLevels ? [h + 1, h + 2] : [h + 1], columns });
    for (let r = h + (twoLevels ? 2 : 1); r <= maxRow; r++) {
      const raw = rowCells(r); if (raw.every(cell => missing(cell.value) && !cell.formula)) continue;
      const get = (label: string) => safeCellText(raw[columns.findIndex(column => column.group === label)]);
      const monthRaw = get("时间"), month = monthRaw?.match(/^([1-9]\d{3})(?:[-/])?(0[1-9]|1[0-2])$/);
      const kind = [get("时间"), get("ASIN"), get("店铺")].some(value => value && isSummaryLabel(value)) ? "summary" : "data";
      const asinRaw = get("ASIN"), asin = asinRaw && /^[A-Za-z0-9]{10}$/.test(asinRaw) ? asinRaw.toUpperCase() : null;
      const parentRaw = get("父ASIN"), parentCandidates = [...new Set((parentRaw || "").toUpperCase().split(/[,，、;；\s]+/).filter(Boolean))];
      const validParents = parentCandidates.every(value => /^[A-Z0-9]{10}$/.test(value)), ambiguous = !validParents || parentCandidates.length > 1;
      const parentAsin = !ambiguous && parentCandidates.length === 1 ? parentCandidates[0] : null;
      const storeName = get("店铺"), site = get("站点"), yearMonth = month ? `${month[1]}-${month[2]}` : null;
      if (kind === "data" && (!yearMonth || !storeName || !site || asinRaw && !asin || ambiguous)) warn("IDENTITY_UNRESOLVED", "月份/店铺/站点/ASIN/父体有缺失或歧义；保留原行，不猜归属", name, r + 1);
      if (asin && !parentRaw) warn("PARENT_UNKNOWN", "未提供父 ASIN，不用子 ASIN 回填", name, r + 1);
      const parsed = raw.map(amount), currencyRaw = get("币种"), codes = new Set(monetaryIndexes.map(c => parsed[c].currency).filter((code): code is string => !!code));
      if (currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw)) codes.add(currencyRaw.toUpperCase());
      const currency = (!currencyRaw || /^[A-Za-z]{3}$/.test(currencyRaw)) && codes.size === 1 ? [...codes][0] : null;
      const currencyConflict = codes.size > 1 || !!currencyRaw && !/^[A-Za-z]{3}$/.test(currencyRaw);
      if (!currency) warn("CURRENCY_UNKNOWN", "币种缺失、不支持或冲突；不从站点、$、¥、汇率列猜测币种，不跨行汇总", name, r + 1);
      const metrics = Object.fromEntries(mappings.map(({ metric, indexes, unresolved }) => {
        const unknown = [...unresolved, ...indexes.filter(c => parsed[c].value === null || quantityMetrics.has(metric) && parsed[c].currency !== null)];
        const incompatible = currencyConflict && !quantityMetrics.has(metric);
        return [metric, { value: indexes.length && !unknown.length && !incompatible ? sumDecimals(indexes.map(c => parsed[c].value!)) : null, sources: indexes.map(c => raw[c].address), unknownSources: (incompatible ? indexes : unknown).map(c => raw[c].address), absent: !indexes.length }];
      })) as Record<PreviewMetricName, PreviewMetric>;
      const bad = [...new Set(mappings.flatMap(({ metric, indexes }) => indexes.filter(c => parsed[c].reason || quantityMetrics.has(metric) && parsed[c].currency !== null)))];
      if (bad.length) warn("AMOUNT_UNKNOWN", "空白、非法金额、公式缓存或错误不补零；相关合计保持未知", name, r + 1, bad.map(c => raw[c].address));
      if (raw.some(cell => cell.formula)) warn("FORMULA_NOT_EVALUATED", "公式不执行，缓存原值仅供核对，不作已验证金额/身份", name, r + 1);
      if (raw.some(cell => typeof cell.value === "number")) warn("EXCEL_NUMBER_SOURCE", "数值以 Excel 提供的数值文本计算；不能恢复源表已丢失的精度", name, r + 1);
      result.rows.push({ sheet: name, rowNumber: r + 1, kind, yearMonth, asin, parentAsin, parentCandidates, sku: get("SKU"), title: get("品名"), storeName, site, currency, currencySource: currency ? currencyRaw ? "column" : "amount-code" : "unknown", allocation: ambiguous ? "ambiguous" : asin ? "asin" : parentAsin ? "parent-only" : "unallocated", metrics, ratios: ratios(metrics, !!currency), cells: raw });
    }
  }
  if (!result.sheets.length) fail("HEADER_NOT_FOUND", "未识别支持的月度财务表头；不把日报或其他文件当月报");
  if (!result.rows.some(row => row.kind === "data")) fail("NO_DATA", "月报没有数据行（空白或只有合计）");
  const identities = new Set<string>(), groups = new Map<string, MonthlyPreviewSummary>();
  for (const row of result.rows) {
    const reason = row.kind === "summary" ? "原表合计行仅保留，不重复计入" : !row.yearMonth || !row.storeName || !row.site || !row.currency ? "身份或币种不完整" : null;
    if (reason) { result.excludedFromSummaries.push({ sheet: row.sheet, rowNumber: row.rowNumber, reason }); continue; }
    const identity = JSON.stringify([row.yearMonth, row.storeName, row.site, row.currency, row.asin, row.sku]);
    if (row.asin && identities.has(identity)) fail("DUPLICATE_IDENTITY", "同月份、店铺、站点、币种、ASIN、SKU 的记录重复；不静默重复合计");
    if (row.asin) identities.add(identity);
    // Only report-scope totals: keep unallocated charges, never spread them to ASINs.
    const scope = { yearMonth: row.yearMonth!, storeName: row.storeName!, site: row.site!, currency: row.currency! };
    const key = JSON.stringify(scope), previous = groups.get(key);
    const metrics = previous ? Object.fromEntries(MONTHLY_PREVIEW_METRICS.map(metric => [metric, { value: previous.metrics[metric].value !== null && row.metrics[metric].value !== null ? sumDecimals([previous.metrics[metric].value!, row.metrics[metric].value!]) : null, sources: [...previous.metrics[metric].sources, ...row.metrics[metric].sources], unknownSources: [...previous.metrics[metric].unknownSources, ...row.metrics[metric].unknownSources], absent: previous.metrics[metric].absent || row.metrics[metric].absent }])) as Record<PreviewMetricName, PreviewMetric> : row.metrics;
    groups.set(key, { scope, allocation: "report-scope-only-no-product-allocation", sourceRows: [...previous?.sourceRows || [], { sheet: row.sheet, rowNumber: row.rowNumber }], metrics, ratios: ratios(metrics, true) });
  }
  result.summaries = [...groups.values()];
  return result;
}
