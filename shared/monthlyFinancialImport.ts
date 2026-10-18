import { z } from "zod";
import CryptoJS from "crypto-js";
import * as XLSX from "xlsx";
import { loadMonthlyFinancialWorkbook, monthlyFinancialHeaderColumns, monthlyFinancialSourceIdentity, type PreviewCell, type PreviewColumn } from "./monthlyFinancialReportPreview";
import { parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "./monthlyFinancialRead";
import { assertMonthlyFinancialJson, MONTHLY_FINANCIAL_METRICS, MonthlyFinancialMetricsSchema, type MonthlyFinancialJsonObject, type MonthlyFinancialMetrics } from "./monthlyFinancialReadDetails";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

export const MONTHLY_FINANCIAL_IMPORT_VERSION = "monthly-financial-import-v1" as const;
export const MONTHLY_FINANCIAL_IMPORT_LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, payloadBytes: 8 * 1024 * 1024, manifestBytes: 16 * 1024 * 1024, rows: 10000, cells: 100000, sheets: 8, warnings: 100000 });
export class MonthlyFinancialImportError extends Error { constructor(public readonly code: string) { super(code); this.name = "MonthlyFinancialImportError"; } }
const fail = (code: string): never => { throw new MonthlyFinancialImportError(code); };
const short = z.string().max(4096), reason = z.string().min(1).max(200), offset = z.number().int().nonnegative();
export const MonthlyFinancialImportFileNameSchema = z.string().min(1).max(512).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f/\\]/u.test(value) && /\.(xlsx|csv)$/iu.test(value), "Plain XLSX/CSV filename required");
export const MonthlyFinancialImportCellSchema = z.object({ sheet: z.string().min(1).max(200), address: z.string().regex(/^[A-Z]+[1-9]\d*$/u), value: z.union([short, z.number().finite(), z.boolean(), z.null()]), formula: short.nullable(), format: short.nullable(), error: z.boolean() }).strict();
export const MonthlyFinancialImportWarningSchema = z.object({ code: reason, message: short, sheet: z.string().max(200).optional(), row: z.number().int().positive().optional(), columns: z.array(short).max(256).optional() }).strict();
const exactMetric = z.object({ value: z.string().regex(/^-?\d+(?:\.\d+)?$/u).max(100).nullable(), sources: z.array(short).max(256), unknownSources: z.array(short).max(256), absent: z.boolean() }).strict();
export const MonthlyFinancialImportRowSchema = z.object({
  sheet: z.string().min(1).max(200), rowNumber: z.number().int().positive().max(10000), kind: z.enum(["data", "summary"]),
  yearMonth: z.string().nullable(), asin: z.string().nullable(), parentAsin: z.string().nullable(), parentCandidates: z.array(short).max(256), sku: short.nullable(), title: short.nullable(), storeName: short.nullable(), site: short.nullable(), operator: short.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(), currencySource: z.enum(["column", "amount-code", "unknown"]),
  allocation: z.enum(["asin", "parent-only", "unallocated", "ambiguous"]),
  sourceMetrics: z.object(Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, exactMetric])) as Record<typeof MONTHLY_FINANCIAL_METRICS[number], typeof exactMetric>).strict(),
  normalizedMetrics: MonthlyFinancialMetricsSchema, normalizedRowIndex: offset.nullable(), blockingReasons: z.array(reason).max(20),
}).strict();
const position = z.object({ r: z.number().int().min(0).max(9999), c: z.number().int().min(0).max(255) }).strict();
export const MonthlyFinancialImportSheetSchema = z.object({ name: z.string().min(1).max(200), range: short, recognized: z.boolean(), headerRows: z.array(z.number().int().positive()).max(2), columns: z.array(z.object({ column: short, group: short, detail: short, rawGroup: short, rawDetail: short }).strict()).max(256), merges: z.array(z.object({ s: position, e: position }).strict()).max(100000) }).strict();
export const MonthlyFinancialImportCountsSchema = z.object({ dataRows: offset, summaryRows: offset, normalizedRows: offset, unresolvedRows: offset, sourceCells: offset }).strict();
const manifestSchema = z.object({
  parserVersion: z.literal(MONTHLY_FINANCIAL_IMPORT_VERSION), format: z.enum(["xlsx", "csv"]), fileName: MonthlyFinancialImportFileNameSchema, byteLength: z.number().int().positive().max(MONTHLY_FINANCIAL_IMPORT_LIMITS.fileBytes),
  amountConvention: z.literal("stored_normalized_values_and_original_raw_signs"),
  sheets: z.array(MonthlyFinancialImportSheetSchema).min(1).max(8), cells: z.array(MonthlyFinancialImportCellSchema).max(100000), rows: z.array(MonthlyFinancialImportRowSchema).max(10000), warnings: z.array(MonthlyFinancialImportWarningSchema).max(100000),
  counts: MonthlyFinancialImportCountsSchema, blockingReasons: z.array(reason).max(100),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const data = value.rows.filter(row => row.kind === "data"), normalized = data.filter(row => row.normalizedRowIndex !== null);
  if (value.counts.dataRows !== data.length || value.counts.summaryRows !== value.rows.length - data.length || value.counts.normalizedRows !== normalized.length || value.counts.unresolvedRows !== data.filter(row => row.blockingReasons.length > 0).length || value.counts.sourceCells !== value.cells.length) issue("Manifest counts mismatch");
  if (normalized.some((row, index) => row.normalizedRowIndex !== index) || value.rows.some(row => row.kind === "summary" && row.normalizedRowIndex !== null)) issue("Manifest row mapping mismatch");
  const names = new Set(value.sheets.map(sheet => sheet.name)), seen = new Set<string>();
  if (names.size !== value.sheets.length) issue("Duplicate manifest sheet");
  for (const cell of value.cells) { const key = `${cell.sheet}:${cell.address}`; if (!names.has(cell.sheet) || seen.has(key)) issue("Invalid manifest cell reference"); seen.add(key); }
  seen.clear(); for (const row of value.rows) { const key = `${row.sheet}:${row.rowNumber}`; if (!names.has(row.sheet) || seen.has(key)) issue("Invalid manifest row reference"); seen.add(key); }
  if (data.some(row => row.blockingReasons.length) && !value.blockingReasons.includes("unresolved_rows") || value.sheets.some(sheet => !sheet.recognized && sheet.range) && !value.blockingReasons.includes("unrecognized_sheet")) issue("Manifest blockers omitted");
  try { monthlyFinancialImportCanonical(value); } catch { issue("Manifest JSON exceeds safe bounds"); }
});
export const MonthlyFinancialImportManifestSchema = z.preprocess((value, ctx) => { try { monthlyFinancialImportCanonical(value); return value; } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Strict bounded manifest JSON required", fatal: true }); return z.NEVER; } }, manifestSchema);
export type MonthlyFinancialImportManifest = z.infer<typeof MonthlyFinancialImportManifestSchema>;
export type MonthlyFinancialImportRow = z.infer<typeof MonthlyFinancialImportRowSchema>;
export type MonthlyFinancialStoredImportRow = { yearMonth: string; parentAsin: string; asin: string; sku: string; title: string; storeName: string; site: string; operator: string | null; raw: MonthlyFinancialJsonObject } & MonthlyFinancialMetrics;
export type MonthlyFinancialImport = { rows: MonthlyFinancialStoredImportRow[]; manifest: MonthlyFinancialImportManifest; fileHash: string; payloadHash: string; manifestHash: string; totalRows: number; skippedRows: number; unallocatedRows: number; months: string[]; blockingReasons: string[] };

/** Strict canonical JSON for hashes. Does not call toJSON, getters, Date coercion,
 * or omit undefined. Source/raw limits remain the reader's smaller limits. */
export function monthlyFinancialImportCanonical(value: unknown): string {
  try { assertMonthlyFinancialJson(value, { jsonDepth: 24, jsonNodes: 2000000, stringLength: MONTHLY_FINANCIAL_IMPORT_LIMITS.manifestBytes }); } catch { return fail("MONTHLY_IMPORT_JSON_INVALID"); }
  const visit = (item: unknown): string => {
    if (item === null || typeof item === "number" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "string") { if (new TextDecoder().decode(new TextEncoder().encode(item)) !== item) return fail("MONTHLY_IMPORT_JSON_INVALID"); return JSON.stringify(item); }
    if (Array.isArray(item)) return `[${item.map(visit).join(",")}]`;
    const object = item as Record<string, unknown>; return `{${Object.keys(object).sort().map(key => `${visit(key)}:${visit(object[key])}`).join(",")}}`;
  };
  const result = visit(value); if (new TextEncoder().encode(result).length > MONTHLY_FINANCIAL_IMPORT_LIMITS.manifestBytes) return fail("MONTHLY_IMPORT_MANIFEST_LIMIT"); return result;
}
export const monthlyFinancialImportHash = (value: unknown) => CryptoJS.SHA256(monthlyFinancialImportCanonical(value)).toString();
export function monthlyFinancialImportBytesHash(bytes: Uint8Array): string { const words: number[] = []; for (let i = 0; i < bytes.length; i++) words[i >>> 2] = (words[i >>> 2] ?? 0) | bytes[i] << (24 - i % 4 * 8); return CryptoJS.SHA256(CryptoJS.lib.WordArray.create(words, bytes.length)).toString(); }

function exact(text: string): { units: bigint; scale: number } { const [integer, fraction = ""] = text.replace(/^[+-]/u, "").split("."); return { units: BigInt(integer + fraction) * (text.startsWith("-") ? -1n : 1n), scale: fraction.length }; }
function decimalString(units: bigint, scale: number): string { const sign = units < 0 ? "-" : "", digits = (units < 0 ? -units : units).toString().padStart(scale + 1, "0"), result = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, "") : digits; return units === 0n ? "0" : sign + result; }
function expandNumber(value: number) { const text = String(value); if (!/e/iu.test(text)) return text; const [coefficient, exponent] = text.toLowerCase().split("e"), d = exact(coefficient), scale = d.scale - Number(exponent); return decimalString(scale < 0 ? d.units * 10n ** BigInt(-scale) : d.units, Math.max(0, scale)); }
function amount(cell: PreviewCell): { value: string | null; currency: string | null } {
  if (cell.formula || cell.error || cell.value === null || typeof cell.value === "boolean" || typeof cell.value === "number" && (!Number.isFinite(cell.value) || Math.abs(cell.value) > Number.MAX_SAFE_INTEGER)) return { value: null, currency: null };
  let text = typeof cell.value === "number" ? expandNumber(cell.value) : cell.value.trim(), currency: string | null = null;
  const parens = text.startsWith("(") && text.endsWith(")"); if (parens) text = text.slice(1, -1).trim();
  const code = text.match(/^([A-Z]{3})\s+/u) || text.match(/\s+([A-Z]{3})$/u); if (code) { currency = code[1]; text = text.replace(code[0], "").trim(); }
  text = text.replace(/^([+-]?)\s*[$￥¥€£]\s*/u, "$1"); if (parens) { if (/^[+-]/u.test(text)) return { value: null, currency }; text = `-${text}`; }
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?$/u.test(text)) return { value: null, currency };
  text = text.replace(/[,，]/gu, ""); if (text.replace(/\D/gu, "").length > 30 || (text.split(".")[1]?.length ?? 0) > 12) return { value: null, currency };
  const d = exact(text); return { value: decimalString(d.units, d.scale), currency };
}
const totalDetail = (column: PreviewColumn) => !column.detail || column.detail === column.group || /总计|合计|小计|累计|汇总|^总|^(?:total|subtotal|grandtotal)$/iu.test(column.detail);
function metricTargets(column: PreviewColumn): Array<typeof MONTHLY_FINANCIAL_METRICS[number]> {
  const g = column.group, d = column.detail; if (/占比|比例|比率|平均|汇率/u.test(g + d)) return [];
  if (g === "毛利润") return ["financialProfit"]; if (g === "销量") return ["salesQty"]; if (g === "退款量") return ["refundQty"]; if (g === "退货量") return ["returnQty"];
  if (g === "销售额" || g === "订单收入" && ["FBA销售额", "FBM销售额"].includes(d)) return ["salesAmount"];
  if (g === "其他收入" || g === "订单收入" && ["FBA买家运费", "FBM买家运费", "礼品包装费", "COD收费", "监管费"].includes(d)) return ["otherIncome"];
  if (g === "促销折扣" || g === "订单收入" && d === "促销折扣") return ["discount"];
  if (g.startsWith("商品成本支出-采购成本") || g === "采购成本") return ["purchaseCost"]; if (g.startsWith("商品成本支出-头程费用") || g === "头程费用") return ["freight"];
  if (g === "订单支出" && ["FBA配送费-非多渠道订单", "FBA配送费-多渠道订单"].includes(d) || g === "退款" && d === "FBA配送费退款") return ["fbaFee"];
  if (g === "订单支出" && d === "销售佣金" || g === "退款" && d === "佣金退款") return ["commission"];
  if (g === "广告花费") return ["advertising"];
  if (g === "推广费") return d === "LD费" ? ["promotion", "ld"] : d === "优惠券" ? ["promotion", "coupon"] : d === "Vine" ? ["promotion", "vine"] : ["promotion"];
  if (g === "其余服务费" && /仓储/u.test(d)) return ["storage"];
  if (g === "退款金额" || g === "退款" && ["FBA销售额退款", "FBM销售额退款"].includes(d)) return ["refundAmount"];
  if (["订单支出", "其余服务费", "其他支出", "订单税费", "商品成本-FBM运费", "退款"].includes(g) || g.startsWith("自定义费用")) return ["otherFees"];
  return [];
}
const expenses = new Set(["discount", "purchaseCost", "freight", "fbaFee", "commission", "advertising", "promotion", "storage", "otherFees", "refundAmount", "ld", "coupon", "vine"]);
const quantities = new Set(["salesQty", "refundQty", "returnQty"]);
function exactToNumber(text: string | null): number | null { if (text === null) return null; const value = Number(text); return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && expandNumber(value) === text ? value : null; }
function sumExact(values: string[]): string { const parts = values.map(exact), scale = Math.max(0, ...parts.map(part => part.scale)); return decimalString(parts.reduce((sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale), 0n), scale); }
/** Resolve totals independently within each named source group, then add groups.
 * A total spanning multiple business metrics never becomes a residual fee. */
function normalizeMetrics(columns: PreviewColumn[], cells: PreviewCell[], conflict: boolean) {
  const parsed = cells.map(amount), normalized = {} as MonthlyFinancialMetrics, metrics = {} as MonthlyFinancialImportRow["sourceMetrics"], warnings: Array<{ code: string; message: string; columns: string[] }> = [];
  for (const key of MONTHLY_FINANCIAL_METRICS) {
    const indexes = columns.flatMap((column, index) => metricTargets(column).includes(key) ? [index] : []), groups = new Map<string, number[]>();
    for (const index of indexes) { const group = groups.get(columns[index].group) ?? []; group.push(index); groups.set(columns[index].group, group); }
    const unknown = new Set<number>(), components: Array<string | null> = [];
    for (const [groupName, group] of groups) {
      const totals = group.filter(index => totalDetail(columns[index])), leaves = group.filter(index => !totalDetail(columns[index]));
      const spanning = ["订单支出", "退款", "其余服务费", "订单收入"].includes(groupName) && totals.length > 0;
      const duplicate = new Set(leaves.map(index => columns[index].detail)).size !== leaves.length;
      const invalid = group.filter(index => parsed[index].value === null || quantities.has(key) && parsed[index].currency !== null || conflict && !quantities.has(key)); invalid.forEach(index => unknown.add(index));
      let value: string | null = null;
      if (!spanning && !duplicate && totals.length <= 1 && !invalid.length) {
        const leafSum = leaves.length ? sumExact(leaves.map(index => parsed[index].value!)) : null;
        if (!totals.length) value = leafSum;
        else if (leafSum === null || leafSum === parsed[totals[0]].value) value = parsed[totals[0]].value;
      }
      if (value === null && !invalid.length) { group.forEach(index => unknown.add(index)); warnings.push({ code: "ADDITIVE_SOURCE_UNRESOLVED", message: `${key}/${groupName} 含重复分项、多个总额、合计不一致或跨类别总额；不重复累计或猜分摊`, columns: group.map(index => cells[index].address) }); }
      components.push(value);
    }
    const value = components.length && components.every(value => value !== null) ? sumExact(components as string[]) : null;
    metrics[key] = { value, sources: indexes.map(index => cells[index].address), unknownSources: [...unknown].sort((a, b) => a - b).map(index => cells[index].address), absent: !indexes.length };
    const number = exactToNumber(value); normalized[key] = number === null ? null : expenses.has(key) ? (number === 0 ? 0 : -number) : number;
    if (value !== null && number === null) warnings.push({ code: "NORMALIZED_PRECISION_UNKNOWN", message: "原始十进制不能无损表示为存储数值；保留精确来源且规范化金额为未知", columns: metrics[key].sources });
    if (unknown.size) warnings.push({ code: "AMOUNT_UNKNOWN", message: `${key} 来源不完整、非法或冲突，保留原单元格且金额不补零`, columns: metrics[key].unknownSources });
  }
  return { metrics, normalized, warnings };
}
type ImportSourceRow = ReturnType<typeof monthlyFinancialSourceIdentity> & { sheet: string; rowNumber: number; cells: PreviewCell[]; sku: string | null; title: string | null; allocation: MonthlyFinancialImportRow["allocation"]; headerBlockingReasons: string[] };
function admittedSources(book: XLSX.WorkBook) {
  const sheets: z.infer<typeof MonthlyFinancialImportSheetSchema>[] = [], cells: z.infer<typeof MonthlyFinancialImportCellSchema>[] = [], rows: ImportSourceRow[] = [], warnings: z.infer<typeof MonthlyFinancialImportWarningSchema>[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name], mapped = new Map<string, PreviewCell>(); let maxRow = -1, maxColumn = -1;
    for (const [address, raw] of Object.entries(sheet)) { if (address.startsWith("!")) continue; const cell = raw as XLSX.CellObject, pos = XLSX.utils.decode_cell(address); maxRow = Math.max(maxRow, pos.r); maxColumn = Math.max(maxColumn, pos.c); const value = cell.v ?? null, parsed = MonthlyFinancialImportCellSchema.parse({ sheet: name, address, value, formula: typeof cell.f === "string" ? cell.f : cell.F || typeof value === "string" && value.trimStart().startsWith("=") ? String(cell.F || value) : null, format: typeof cell.z === "string" ? cell.z : null, error: cell.t === "e" }); cells.push(parsed); mapped.set(address, parsed); }
    const rowCells = (r: number) => Array.from({ length: maxColumn + 1 }, (_, c): PreviewCell => { const address = XLSX.utils.encode_cell({ r, c }); return mapped.get(address) ?? { address, value: null, formula: null, format: null, error: false }; }), clean = (value: unknown) => String(value ?? "").replace(/\s+/gu, "");
    let header = -1; for (let r = 0; r < Math.min(10, maxRow + 1); r++) { const labels = rowCells(r).map(cell => clean(cell.value)); if (labels.includes("ASIN") && (labels.includes("时间") || labels.includes("月份")) && labels.includes("毛利润")) { header = r; break; } }
    const range = maxRow < 0 ? "" : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } });
    const merges = sheet["!merges"] ?? [];
    if (header < 0) { sheets.push({ name, range, recognized: false, headerRows: [], columns: [], merges }); warnings.push({ code: maxRow < 0 ? "EMPTY_SHEET" : "UNRECOGNIZED_SHEET", message: "原工作表全部单元格保留，未识别的非空工作表阻止确认", sheet: name }); continue; }
    const { columns, twoLevels } = monthlyFinancialHeaderColumns(sheet, header, rowCells(header), rowCells(header + 1)), headerBlockingReasons: string[] = [];
    const identities = ["时间", "ASIN", "父ASIN", "店铺", "站点", "SKU", "品名", "业务员", "币种"];
    if (identities.some(label => columns.filter(column => column.group === label).length > 1)) headerBlockingReasons.push("duplicate_identity_header");
    if (columns.some(column => !column.group)) headerBlockingReasons.push("unnamed_header");
    if (["时间", "ASIN", "父ASIN", "店铺", "站点", "毛利润", "销量"].some(label => !columns.some(column => column.group === label)) || !columns.some(column => metricTargets(column).includes("salesAmount"))) headerBlockingReasons.push("missing_required_header");
    sheets.push({ name, range, recognized: true, headerRows: twoLevels ? [header + 1, header + 2] : [header + 1], columns, merges });
    for (let r = header + (twoLevels ? 2 : 1); r <= maxRow; r++) { const raw = rowCells(r); if (raw.every(cell => !cell.formula && (cell.value === null || ["", "-", "--", "—"].includes(String(cell.value).trim())))) continue; const identity = monthlyFinancialSourceIdentity(columns, raw);
      rows.push({ ...identity, sheet: name, rowNumber: r + 1, cells: raw, sku: identity.get("SKU"), title: identity.get("品名"), allocation: identity.ambiguous ? "ambiguous" : identity.asin ? "asin" : identity.parentAsin ? "parent-only" : "unallocated", headerBlockingReasons });
    }
  }
  return { sheets, cells, rows, warnings };
}

function projectMonthlyFinancialImport(preview: ReturnType<typeof admittedSources>, fileName: string, format: "xlsx" | "csv", byteLength: number, fileHash: string): MonthlyFinancialImport {
  const rows: MonthlyFinancialStoredImportRow[] = [], manifestRows: MonthlyFinancialImportRow[] = [], warnings = [...preview.warnings], blockers = new Set<string>(), identities = new Set<string>();
  if (preview.sheets.some(sheet => sheet.range && !sheet.recognized)) blockers.add("unrecognized_sheet");
  for (const source of preview.rows) {
    const columns = preview.sheets.find(sheet => sheet.name === source.sheet)!.columns, parsed = source.cells.map(amount), blockingReasons: string[] = source.kind === "data" ? [...source.headerBlockingReasons] : [];
    const operatorCell = source.cells[columns.findIndex(column => column.group === "业务员")], operator = operatorCell && !operatorCell.formula && !operatorCell.error && operatorCell.value !== null && String(operatorCell.value).trim() ? String(operatorCell.value).trim() : null;
    if (source.kind === "data") { if (!source.yearMonth || !source.storeName || !source.site) blockingReasons.push("missing_scope"); if (source.allocation === "ambiguous") blockingReasons.push("ambiguous_parent"); const asinCell = source.cells[columns.findIndex(column => column.group === "ASIN")]; if (!source.asin && asinCell && !([null, "", "-", "--", "—"] as Array<PreviewCell["value"]>).includes(asinCell.value)) blockingReasons.push("invalid_asin"); if (source.cells.some((cell, c) => ["时间", "店铺", "站点", "ASIN", "父ASIN", "业务员"].includes(columns[c].group) && (cell.formula || cell.error))) blockingReasons.push("identity_formula_or_error"); }
    const currencyCell = source.cells[columns.findIndex(column => column.group === "币种")], currencyRaw = currencyCell && !currencyCell.formula && !currencyCell.error ? String(currencyCell.value ?? "").trim() : "";
    const codes = new Set(parsed.flatMap((item, index) => metricTargets(columns[index]).some(key => !quantities.has(key)) && item.currency ? [item.currency] : [])); if (/^[A-Za-z]{3}$/u.test(currencyRaw)) codes.add(currencyRaw.toUpperCase());
    const conflict = codes.size > 1 || !!currencyRaw && !/^[A-Za-z]{3}$/u.test(currencyRaw), currency = !conflict && codes.size === 1 ? [...codes][0] : null;
    const { metrics, normalized, warnings: metricWarnings } = normalizeMetrics(columns, source.cells, conflict); warnings.push(...metricWarnings.map(warning => ({ ...warning, sheet: source.sheet, row: source.rowNumber })));
    if (!currency) warnings.push({ code: "CURRENCY_UNKNOWN", message: "币种未知或冲突，不由站点或货币符号猜测", sheet: source.sheet, row: source.rowNumber });
    if (source.cells.some(cell => cell.formula)) warnings.push({ code: "FORMULA_NOT_EVALUATED", message: "完整保留原公式与缓存；缓存不作为金额事实", sheet: source.sheet, row: source.rowNumber });
    let normalizedRowIndex: number | null = null;
    if (source.kind === "data" && source.yearMonth && source.storeName && source.site) {
      const businessKey = JSON.stringify([source.yearMonth, source.storeName, normalizeMarketplaceCode(source.site), source.asin ?? "", source.sku ?? ""]); if (source.asin && identities.has(businessKey)) return fail("MONTHLY_IMPORT_DUPLICATE_IDENTITY"); if (source.asin) identities.add(businessKey);
      const raw: MonthlyFinancialJsonObject = { source: "monthly_file_import", currency, provenance: { parserVersion: MONTHLY_FINANCIAL_IMPORT_VERSION, fileHash, sheet: source.sheet, rowNumber: source.rowNumber, amountConvention: "source-signed-no-conversion" } };
      // The flat compatibility projection excludes unverified caches. Their exact
      // values/formulas remain in the complete artifact, not interpreted as facts.
      columns.forEach((column, index) => { const cell = source.cells[index]; raw[`${index + 1}:${column.group}/${column.detail}`] = cell.formula || cell.error ? null : cell.value; });
      if (conflict) raw.currency = "CONFLICT";
      normalizedRowIndex = rows.length; rows.push({ yearMonth: source.yearMonth, parentAsin: source.parentAsin ?? "", asin: source.asin ?? "", sku: source.sku ?? "", title: source.title ?? "", storeName: source.storeName, site: source.site, operator, raw, ...normalized });
    }
    if (blockingReasons.length) blockers.add("unresolved_rows");
    manifestRows.push({ sheet: source.sheet, rowNumber: source.rowNumber, kind: source.kind, yearMonth: source.yearMonth, asin: source.asin, parentAsin: source.parentAsin, parentCandidates: source.parentCandidates, sku: source.sku, title: source.title, storeName: source.storeName, site: source.site, operator, currency, currencySource: currency ? currencyRaw ? "column" : "amount-code" : "unknown", allocation: source.allocation, sourceMetrics: metrics, normalizedMetrics: normalized, normalizedRowIndex, blockingReasons });
  }
  if (!rows.length) blockers.add("no_normalized_rows");
  const months = [...new Set(rows.map(row => row.yearMonth))].sort(), skippedRows = manifestRows.filter(row => row.kind === "summary").length, unallocatedRows = rows.filter(row => !row.parentAsin).length;
  const manifest = MonthlyFinancialImportManifestSchema.parse({ parserVersion: MONTHLY_FINANCIAL_IMPORT_VERSION, format, fileName, byteLength, amountConvention: "stored_normalized_values_and_original_raw_signs", sheets: preview.sheets, cells: preview.cells, rows: manifestRows, warnings, counts: { dataRows: manifestRows.length - skippedRows, summaryRows: skippedRows, normalizedRows: rows.length, unresolvedRows: manifestRows.filter(row => row.kind === "data" && row.blockingReasons.length).length, sourceCells: preview.cells.length }, blockingReasons: [...blockers].sort() });
  const record: MonthlyFinancialBatchRecord = { id: 1, workspaceId: 1, userId: 1, fileName, fileHash, status: "previewing", totalRows: rows.length, skippedRows, unallocatedRows, months, payload: rows, createdAt: "2000-01-01 00:00:00.000000", confirmedAt: null, fileReferenceKind: "storage" };
  parseMonthlyFinancialBatch(record);
  return { rows, manifest, fileHash, payloadHash: monthlyFinancialImportHash(rows), manifestHash: monthlyFinancialImportHash(manifest), totalRows: rows.length, skippedRows, unallocatedRows, months, blockingReasons: manifest.blockingReasons };
}
export async function parseMonthlyFinancialImport(inputBytes: Uint8Array, fileName: string): Promise<MonthlyFinancialImport> {
  MonthlyFinancialImportFileNameSchema.parse(fileName); if (!(inputBytes instanceof Uint8Array)) return fail("MONTHLY_IMPORT_INPUT_INVALID"); const bytes = new Uint8Array(inputBytes), format = fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  return projectMonthlyFinancialImport(admittedSources(await loadMonthlyFinancialWorkbook({ bytes, format })), fileName, format, bytes.length, monthlyFinancialImportBytesHash(bytes));
}

/** Pure verification of the persisted artifact against immutable batch payload.
 * It replays header/identity/amount projections from all original cells, but never
 * executes formulas or trusts artifact-normalized values as their own evidence. */
export function validateMonthlyFinancialStoredArtifact(record: MonthlyFinancialBatchRecord, prepared: unknown, rawManifest: unknown, payloadHash: string): MonthlyFinancialImportManifest {
  monthlyFinancialImportCanonical(prepared); monthlyFinancialImportCanonical(rawManifest);
  const binding = z.object({ identity: z.object({ workspaceId: z.number().int().positive(), userId: z.number().int().positive() }), fileName: MonthlyFinancialImportFileNameSchema, format: z.enum(["xlsx", "csv"]), fileHash: z.string().regex(/^[a-f0-9]{64}$/u), byteSize: z.number().int().positive().max(MONTHLY_FINANCIAL_IMPORT_LIMITS.fileBytes), parserVersion: z.literal(MONTHLY_FINANCIAL_IMPORT_VERSION) }).passthrough().parse(prepared), manifest = MonthlyFinancialImportManifestSchema.parse(rawManifest), parsed = parseMonthlyFinancialBatch(record);
  if (binding.identity.workspaceId !== record.workspaceId || binding.identity.userId !== record.userId || binding.fileName !== record.fileName || binding.fileHash !== record.fileHash || manifest.fileName !== binding.fileName || manifest.format !== binding.format || manifest.byteLength !== binding.byteSize || manifest.parserVersion !== binding.parserVersion || !binding.fileName.toLowerCase().endsWith(`.${binding.format}`)) return fail("MONTHLY_IMPORT_ARTIFACT_BINDING_MISMATCH");
  const stored = parsed.rows.map(({ yearMonth, parentAsin, asin, sku, title, storeName, site, operator, metrics, raw }) => ({ yearMonth, parentAsin, asin, sku, title, storeName, site, operator, raw, ...metrics }));
  if (monthlyFinancialImportHash(stored) !== payloadHash || stored.length !== manifest.counts.normalizedRows || record.skippedRows !== manifest.counts.summaryRows) return fail("MONTHLY_IMPORT_ARTIFACT_PAYLOAD_MISMATCH");
  const book: XLSX.WorkBook = { SheetNames: manifest.sheets.map(sheet => sheet.name), Sheets: {} };
  for (const sheet of manifest.sheets) book.Sheets[sheet.name] = { "!merges": sheet.merges };
  for (const cell of manifest.cells) book.Sheets[cell.sheet][cell.address] = { t: cell.error ? "e" : typeof cell.value === "number" ? "n" : typeof cell.value === "boolean" ? "b" : "s", v: cell.value, ...(cell.formula === null ? {} : { f: cell.formula }), ...(cell.format === null ? {} : { z: cell.format }) };
  const replayed = projectMonthlyFinancialImport(admittedSources(book), binding.fileName, binding.format, binding.byteSize, binding.fileHash);
  if (monthlyFinancialImportCanonical(replayed.manifest) !== monthlyFinancialImportCanonical(manifest) || replayed.payloadHash !== payloadHash) return fail("MONTHLY_IMPORT_ARTIFACT_REPLAY_MISMATCH");
  const cellMap = new Map(manifest.cells.map(cell => [`${cell.sheet}:${cell.address}`, cell])), used = new Set<number>();
  for (const sheet of manifest.sheets) if (sheet.recognized) {
    if (!sheet.headerRows.length) return fail("MONTHLY_IMPORT_ARTIFACT_HEADER_MISMATCH");
    const at = (r: number, c: number): PreviewCell => { const address = XLSX.utils.encode_cell({ r, c }); return cellMap.get(`${sheet.name}:${address}`) ?? { address, value: null, formula: null, format: null, error: false }; }, h = sheet.headerRows[0] - 1;
    const headers = monthlyFinancialHeaderColumns({ "!merges": sheet.merges }, h, sheet.columns.map((_, c) => at(h, c)), sheet.columns.map((_, c) => at(h + 1, c)));
    if (monthlyFinancialImportCanonical(headers.columns) !== monthlyFinancialImportCanonical(sheet.columns) || headers.twoLevels !== (sheet.headerRows.length === 2)) return fail("MONTHLY_IMPORT_ARTIFACT_HEADER_MISMATCH");
  }
  for (const row of manifest.rows) {
    const sheet = manifest.sheets.find(sheet => sheet.name === row.sheet); if (!sheet?.recognized) return fail("MONTHLY_IMPORT_ARTIFACT_ROW_MISMATCH");
    const cells = sheet.columns.map((_, c): PreviewCell => { const address = XLSX.utils.encode_cell({ r: row.rowNumber - 1, c }); return cellMap.get(`${row.sheet}:${address}`) ?? { address, value: null, formula: null, format: null, error: false }; }), identity = monthlyFinancialSourceIdentity(sheet.columns, cells);
    for (const key of ["kind", "yearMonth", "asin", "parentAsin", "parentCandidates", "storeName", "site"] as const) if (monthlyFinancialImportCanonical(identity[key]) !== monthlyFinancialImportCanonical(row[key])) return fail("MONTHLY_IMPORT_ARTIFACT_IDENTITY_MISMATCH");
    const values = cells.map(amount), currencyRaw = identity.get("币种") ?? "", codes = new Set(values.flatMap((value, index) => metricTargets(sheet.columns[index]).some(key => !quantities.has(key)) && value.currency ? [value.currency] : [])); if (/^[A-Za-z]{3}$/u.test(currencyRaw)) codes.add(currencyRaw.toUpperCase()); const conflict = codes.size > 1 || !!currencyRaw && !/^[A-Za-z]{3}$/u.test(currencyRaw), currency = !conflict && codes.size === 1 ? [...codes][0] : null;
    const replay = normalizeMetrics(sheet.columns, cells, conflict); if (monthlyFinancialImportCanonical(replay.metrics) !== monthlyFinancialImportCanonical(row.sourceMetrics) || monthlyFinancialImportCanonical(replay.normalized) !== monthlyFinancialImportCanonical(row.normalizedMetrics) || row.currency !== currency || row.operator !== identity.get("业务员") || row.sku !== identity.get("SKU") || row.title !== identity.get("品名")) return fail("MONTHLY_IMPORT_ARTIFACT_VALUE_MISMATCH");
    if (row.normalizedRowIndex !== null) { const actual = stored[row.normalizedRowIndex]; if (!actual || used.has(row.normalizedRowIndex)) return fail("MONTHLY_IMPORT_ARTIFACT_ROW_MISMATCH"); used.add(row.normalizedRowIndex);
      const raw: MonthlyFinancialJsonObject = { source: "monthly_file_import", currency: conflict ? "CONFLICT" : currency, provenance: { parserVersion: MONTHLY_FINANCIAL_IMPORT_VERSION, fileHash: record.fileHash, sheet: row.sheet, rowNumber: row.rowNumber, amountConvention: "source-signed-no-conversion" } }; sheet.columns.forEach((column, index) => { raw[`${index + 1}:${column.group}/${column.detail}`] = cells[index].formula || cells[index].error ? null : cells[index].value; });
      const expected = { yearMonth: row.yearMonth, parentAsin: row.parentAsin ?? "", asin: row.asin ?? "", sku: row.sku ?? "", title: row.title ?? "", storeName: row.storeName, site: row.site, operator: row.operator, raw, ...row.normalizedMetrics }; if (monthlyFinancialImportCanonical(actual) !== monthlyFinancialImportCanonical(expected)) return fail("MONTHLY_IMPORT_ARTIFACT_PAYLOAD_MISMATCH");
    } else if (row.kind === "data" && row.yearMonth && row.storeName && row.site) return fail("MONTHLY_IMPORT_ARTIFACT_ROW_MISMATCH");
  }
  if (used.size !== stored.length) return fail("MONTHLY_IMPORT_ARTIFACT_ROW_MISMATCH"); return manifest;
}
