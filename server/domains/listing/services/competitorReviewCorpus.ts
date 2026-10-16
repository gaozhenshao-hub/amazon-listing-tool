import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  COMPETITOR_REVIEW_PARSER_VERSION,
  type CompetitorReviewCorpus,
  type CompetitorReviewCorpusCoverage,
  type CompetitorReviewField,
  type CompetitorReviewItem,
  type CompetitorReviewOccurrence,
  type CompetitorReviewValue,
} from "../../../../shared/competitorReviewCorpus";

export const COMPETITOR_REVIEW_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024, zipEntries: 256, sheets: 8,
  dataRows: 20000, columns: 64, cells: 500000, bodyCharacters: 32000,
});
export class CompetitorReviewCorpusError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "CompetitorReviewCorpusError"; }
}
function fail(code: string, message: string): never { throw new CompetitorReviewCorpusError(code, message); }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.replace(/\r\n?/gu, "\n").trim();
const ASIN = /^[A-Z0-9]{10}$/;
type Sheet = { name: string; rows: CompetitorReviewValue[][] };
type MappedSheet = Sheet & { headers: string[]; mapping: Partial<Record<CompetitorReviewField, number>>; asinColumns: number[] };

/** Sorted-key encoding; only our own JSON-safe evidence values enter this function. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function utf8(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("REVIEW_ENCODING", "评论文件必须使用 UTF-8 文本编码"); }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function cellAddress(address: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);
  if (!match) fail("REVIEW_RANGE", "Excel 单元格地址无效");
  let column = 0;
  for (const c of match[1]) column = column * 26 + c.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > COMPETITOR_REVIEW_LIMITS.columns || row > COMPETITOR_REVIEW_LIMITS.dataRows + 1) fail("REVIEW_LIMIT", "评论表行列范围超限");
  return { row, column };
}
function checkXml(xml: string, remainingCells: number): number {
  if (xml.includes("\0") || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail("REVIEW_XML", "不支持 Excel 实体或非 UTF-8 XML");
  // No formula cache is an original review. Inspect ALL admitted parts, not
  // just *.xml worksheets; OPC relationships may target a different suffix.
  if (/<(?:[\w.-]+:)?f(?=[\s/>])/u.test(xml)) fail("REVIEW_FORMULA", "评论文件含公式，不能把缓存值当原文；请核对后另存值副本");
  if (/TargetMode\s*=\s*["']External["']/i.test(xml)) fail("REVIEW_XLSX_UNSUPPORTED", "不支持包含外部关系的评论 Excel");
  // Apply one budget across every admitted XML/relationship part. Do not
  // rely on worksheet filenames: a relationship may target another suffix.
  // Count incrementally rather than allocating an array of every match.
  let cells = 0;
  const cellTags = /<(?:[\w.-]+:)?c(?=[\s/>])/gu;
  while (cellTags.exec(xml)) if (++cells > remainingCells) fail("REVIEW_LIMIT", "Excel 单元格数量超限");
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?(?:c|dimension)\b[^>]*\b(?:r|ref)\s*=\s*["']([^"']+)["']/gu)) {
    for (const address of match[1].split(":")) cellAddress(address);
  }
  const addresses = new Set<string>();
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\b[^>]*\br\s*=\s*["']([^"']+)["']/gu)) {
    if (addresses.has(match[1])) fail("REVIEW_XML", "Excel 同一工作表含重复单元格地址，不能忠实读取");
    addresses.add(match[1]);
  }
  return cells;
}

/** Derived from the limited monthly-preview ZIP admission, with server-side
 * bounded inflate. Budget/identity checks are not an OS or CPU sandbox.
 * All actual bytes are validated BEFORE SheetJS's second parse. */
function inspectXlsx(bytes: Buffer): void {
  const u16 = (p: number) => bytes.readUInt16LE(p), u32 = (p: number) => bytes.readUInt32LE(p);
  if (bytes.length < 22 || u32(0) !== 0x04034b50) fail("REVIEW_ZIP", "仅支持标准未加密 XLSX ZIP");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  if (end < Math.max(0, bytes.length - 65557)) fail("REVIEW_ZIP", "Excel ZIP 目录缺失");
  const count = u16(end + 10), size = u32(end + 12), offset = u32(end + 16);
  if (!count || count > COMPETITOR_REVIEW_LIMITS.zipEntries) fail("REVIEW_LIMIT", "Excel ZIP 成员数量超限");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || [size, offset].includes(0xffffffff) || offset + size !== end) fail("REVIEW_ZIP", "不支持分卷或 ZIP64");
  const names = new Set<string>(), spans: Array<[number, number]> = [];
  const extra = (start: number, length: number) => {
    const stop = start + length;
    if (stop > bytes.length) fail("REVIEW_ZIP", "ZIP 扩展越界");
    for (let i = start; i < stop;) {
      if (i + 4 > stop || u16(i) === 1) fail("REVIEW_ZIP", "不支持 ZIP64 扩展");
      i += 4 + u16(i + 2); if (i > stop) fail("REVIEW_ZIP", "ZIP 扩展损坏");
    }
  };
  let at = offset, expandedTotal = 0, xmlCellTotal = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail("REVIEW_ZIP", "ZIP 成员目录损坏");
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), expanded = u32(at + 24);
    const nl = u16(at + 28), el = u16(at + 30), cl = u16(at + 32), local = u32(at + 42), next = at + 46 + nl + el + cl;
    if (next > end || !nl || nl > 256 || u16(at + 34) || flags & ~0x0806 || ![0, 8].includes(method)) fail("REVIEW_ZIP", "拒绝加密、数据描述符或异常 ZIP 成员");
    if ([compressed, expanded, local].includes(0xffffffff) || expanded > COMPETITOR_REVIEW_LIMITS.entryBytes || (expandedTotal += expanded) > COMPETITOR_REVIEW_LIMITS.expandedBytes) fail("REVIEW_LIMIT", "Excel 解压大小超限");
    const name = utf8(bytes.subarray(at + 46, at + 46 + nl));
    if (name.includes("\\") || name.startsWith("/") || name.includes("\0") || name.split("/").some(part => part === ".." || part === ".") || names.has(name)) fail("REVIEW_ZIP", "ZIP 路径无效或重复");
    names.add(name);
    const directory = name.endsWith("/");
    if (directory ? expanded !== 0 : !/\.(?:xml|rels)$/i.test(name)) fail("REVIEW_XLSX_UNSUPPORTED", "仅支持 XML/关系文本和空目录；图片、二进制或未知 Excel 部件不受支持");
    if (/vbaProject|externalLinks/i.test(name)) fail("REVIEW_XLSX_UNSUPPORTED", "不支持宏或外链");
    extra(at + 46 + nl, el);
    if (local + 30 > offset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail("REVIEW_ZIP", "ZIP 本地头不一致");
    const ln = u16(local + 26), le = u16(local + 28), start = local + 30 + ln + le, finish = start + compressed;
    if (start > offset || finish > offset || ln !== nl || !bytes.subarray(local + 30, local + 30 + ln).equals(bytes.subarray(at + 46, at + 46 + nl))) fail("REVIEW_ZIP", "ZIP 成员越界或名称不一致");
    extra(local + 30 + ln, le);
    if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== expanded) fail("REVIEW_ZIP", "ZIP 本地大小或 CRC 不一致");
    spans.push([local, finish]);
    let content: Buffer;
    try {
      if (method === 0) content = bytes.subarray(start, finish);
      else {
        const inflated = inflateRawSync(bytes.subarray(start, finish), { maxOutputLength: Math.max(1, expanded), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (!Buffer.isBuffer(inflated.buffer) || inflated.engine.bytesWritten !== compressed) fail("REVIEW_ZIP", "Excel 压缩成员存在未消耗字节");
        content = inflated.buffer;
      }
    }
    catch { fail("REVIEW_ZIP", "Excel 实际解压失败或超过声明上限"); }
    if (content.length !== expanded || crc32(content) !== crc) fail("REVIEW_ZIP", "Excel 实际长度或 CRC 不符");
    if (!directory) xmlCellTotal += checkXml(utf8(content), COMPETITOR_REVIEW_LIMITS.cells - xmlCellTotal);
    at = next;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, stop] of spans) { if (start !== cursor) fail("REVIEW_ZIP", "ZIP 存在重叠或未列出的本地成员"); cursor = stop; }
  if (cursor !== offset || at !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) fail("REVIEW_ZIP", "Excel ZIP 完整性不符");
}

function csvSheet(bytes: Buffer): Sheet {
  const input = utf8(bytes).replace(/^\uFEFF/u, "");
  if (input.includes("\0")) fail("REVIEW_CSV", "CSV 包含 NUL 字符");
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false, started = false, cells = 0;
  const save = () => {
    if (row.length >= COMPETITOR_REVIEW_LIMITS.columns || ++cells > COMPETITOR_REVIEW_LIMITS.cells) fail("REVIEW_LIMIT", "CSV 列或单元格数量超限");
    row.push(field); field = ""; closed = false; started = false;
  };
  const line = () => { save(); rows.push(row); row = []; if (rows.length > COMPETITOR_REVIEW_LIMITS.dataRows + 1) fail("REVIEW_LIMIT", "评论数据超过 20000 行"); };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ",") save();
    else if (c === "\n" || c === "\r") { line(); if (c === "\r" && input[i + 1] === "\n") i++; }
    else if (closed) fail("REVIEW_CSV", "CSV 引号关闭后存在多余字符");
    else if (c === '"') { if (started) fail("REVIEW_CSV", "CSV 引号位置无效"); quoted = true; started = true; }
    else { field += c; started = true; }
    if (field.length > COMPETITOR_REVIEW_LIMITS.bodyCharacters) fail("REVIEW_LIMIT", "单元格超过 32000 字符，不截断");
  }
  if (quoted) fail("REVIEW_CSV", "CSV 引号未闭合");
  if (started || closed || field || row.length) line();
  return { name: "CSV", rows };
}
function xlsxSheets(bytes: Buffer): Sheet[] {
  inspectXlsx(bytes);
  // Compressed/expanded bytes, aggregate XML cell tags and each address range
  // are bounded before this call. Workbook sheet count and combined physical
  // data-row count below remain post-parse checks, not OPC preflight claims.
  let book: XLSX.WorkBook;
  try { book = XLSX.read(bytes, { type: "buffer", cellFormula: true, cellDates: false, cellHTML: false, cellText: false, dense: false, sheetRows: COMPETITOR_REVIEW_LIMITS.dataRows + 2 }); }
  catch { fail("REVIEW_XLSX", "无法解析受限 XLSX"); }
  if (!book.SheetNames.length || book.SheetNames.length > COMPETITOR_REVIEW_LIMITS.sheets || new Set(book.SheetNames).size !== book.SheetNames.length) fail("REVIEW_LIMIT", "Excel 工作表数量无效");
  let cellCount = 0, totalRows = 0;
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    if (!sheet) fail("REVIEW_XLSX", "Excel 工作表缺失");
    if (sheet["!merges"]?.length) fail("REVIEW_XLSX_UNSUPPORTED", "不支持合并单元格评论表");
    for (const range of [sheet["!ref"], sheet["!fullref"]]) if (range) for (const point of range.split(":")) cellAddress(point);
    const rows: CompetitorReviewValue[][] = [];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      const { row, column } = cellAddress(address);
      if (++cellCount > COMPETITOR_REVIEW_LIMITS.cells) fail("REVIEW_LIMIT", "Excel 单元格数量超限");
      if (cell.f !== undefined || cell.F !== undefined || cell.t === "e") fail("REVIEW_FORMULA", "公式或错误单元格不能当原评论");
      const value: unknown = cell.v ?? null;
      if (!(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) fail("REVIEW_CELL", "不支持此单元格类型");
      if (typeof value === "string" && (value.length > COMPETITOR_REVIEW_LIMITS.bodyCharacters || value.includes("\0"))) fail("REVIEW_LIMIT", "单元格超过限制，不截断");
      rows[row - 1] ??= []; rows[row - 1][column - 1] = value as CompetitorReviewValue;
    }
    // Materialize gaps explicitly so counts never silently drop sparse rows.
    for (let r = 0; r < rows.length; r++) rows[r] ??= [];
    totalRows += Math.max(0, rows.length - 1);
    if (totalRows > COMPETITOR_REVIEW_LIMITS.dataRows) fail("REVIEW_LIMIT", "评论总数据超过 20000 行");
    return { name, rows };
  });
}

const aliases: Record<CompetitorReviewField, string[]> = {
  asin: ["asin", "childasin", "productasin", "子asin", "商品asin", "产品asin", "asin码"],
  sourceReviewId: ["reviewid", "评论id", "评论编号"],
  body: ["content", "body", "review", "reviewcontent", "reviewbody", "reviewtext", "评论内容", "评论正文", "评价内容", "评论详情"],
  title: ["title", "reviewtitle", "headline", "评论标题", "评价标题"],
  rating: ["rating", "stars", "star", "starrating", "评分", "星级", "星数"],
  date: ["date", "reviewdate", "评论日期", "评价日期", "日期"],
  author: ["author", "reviewer", "reviewername", "profilename", "评论者", "评论人", "作者"],
  verifiedPurchase: ["verifiedpurchase", "verified", "vp", "isverified", "验证购买", "是否验证购买"],
  variant: ["variant", "variation", "model", "型号", "变体"],
  helpfulVotes: ["helpfulvotes", "helpfulcount", "helpful", "有用投票", "有用", "点赞数"],
};
const headerKey = (value: string) => value.toLowerCase().replace(/[\s_-]/gu, "");
function mapSheet(sheet: Sheet): MappedSheet {
  if (!sheet.rows.length) fail("REVIEW_EMPTY", "评论文件或工作表为空");
  const headers = Array.from({ length: sheet.rows[0].length }, (_, i) => sheet.rows[0][i] ?? "").map(value => {
    if (typeof value !== "string") fail("REVIEW_HEADER", "评论第一行必须是明确文本表头");
    return value;
  });
  const keys = headers.map(headerKey), mapping: Partial<Record<CompetitorReviewField, number>> = {};
  for (const [field, names] of Object.entries(aliases) as Array<[CompetitorReviewField, string[]]>) {
    const found = keys.flatMap((key, i) => names.includes(key) ? [i] : []);
    if (found.length > 1) fail("REVIEW_HEADER", `评论字段 ${field} 存在重复或歧义列`);
    if (found.length) mapping[field] = found[0];
  }
  if (mapping.body === undefined) fail("REVIEW_HEADER", "缺少明确的评论正文列，不猜测最长文本列");
  if (sheet.rows.some(row => row.length > headers.length)) fail("REVIEW_HEADER", "数据列超过表头范围");
  return { ...sheet, headers, mapping, asinColumns: keys.flatMap((key, i) => aliases.asin.includes(key) || ["parentasin", "父asin"].includes(key) ? [i] : []) };
}
const text = (value: CompetitorReviewValue | undefined) => typeof value === "string" && normalize(value) ? normalize(value) : null;
function optionalNumber(value: CompetitorReviewValue | undefined, max: number, integer: boolean): number | null {
  const candidate = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value.trim()) : null;
  return candidate !== null && Number.isFinite(candidate) && candidate >= 0 && candidate <= max && (!integer || Number.isSafeInteger(candidate)) ? candidate : null;
}
function optionalBoolean(value: CompetitorReviewValue | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  return ["true", "yes", "1", "是"].includes(v) ? true : ["false", "no", "0", "否"].includes(v) ? false : null;
}

export function buildCompetitorReviewCorpus(input: {
  bytes: Buffer; fileName: string; asin: string; projectId: number; analysisId: number; sourceFileHash: string;
}): CompetitorReviewCorpus {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) fail("REVIEW_EMPTY", "评论文件为空");
  if (input.bytes.length > COMPETITOR_REVIEW_LIMITS.bytes) fail("REVIEW_LIMIT", "评论文件超过 20 MiB");
  if (typeof input.asin !== "string" || !ASIN.test(input.asin) || !Number.isSafeInteger(input.projectId) || input.projectId <= 0 || !Number.isSafeInteger(input.analysisId) || input.analysisId <= 0) fail("REVIEW_IDENTITY", "评论归属参数无效");
  if (typeof input.sourceFileHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.sourceFileHash) || hash(input.bytes) !== input.sourceFileHash) fail("REVIEW_HASH", "原评论文件校验不一致");
  if (typeof input.fileName !== "string" || !input.fileName || input.fileName.length > 500 || /[\\/]/u.test(input.fileName) || Array.from(input.fileName).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) fail("REVIEW_FORMAT", "评论文件名无效");
  const format = input.fileName.toLowerCase().endsWith(".csv") ? "csv" : input.fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : null;
  if (!format) fail("REVIEW_FORMAT", "本批仅支持 UTF-8 CSV 或受限 XLSX；旧式 XLS 不受支持，请另存值副本");
  const sheets = (format === "csv" ? [csvSheet(input.bytes)] : xlsxSheets(input.bytes)).map(mapSheet);
  const filenameAsins = [...new Set(input.fileName.toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{10}(?![A-Z0-9])/gu) ?? [])];
  const filenameAsin = filenameAsins.length === 1 ? filenameAsins[0] : null;
  // Any conflicting/invalid declared child OR parent ASIN disables filename
  // fallback for the whole file. A parent column alone never assigns a row.
  const filenameSafe = filenameAsin !== null && sheets.every(sheet => sheet.rows.slice(1).every(row => sheet.asinColumns.every(c => {
    const value = row[c]; return value == null || value === "" || typeof value === "string" && (!value.trim() || value.trim().toUpperCase() === filenameAsin);
  })));
  const coverage: CompetitorReviewCorpusCoverage = {
    scope: "complete_file_not_market_total", format, sourceFileHash: input.sourceFileHash,
    sourceBytes: input.bytes.length, sourceFileName: input.fileName,
    sheets: sheets.map(sheet => ({ name: sheet.name, headerRow: 1, dataRows: sheet.rows.length - 1 })),
    totalRows: 0, blankRows: 0, emptyBodyRows: 0, unassignedRows: 0, otherAsinRows: 0,
    matchedRows: 0, duplicateRows: 0, uniqueReviews: 0, filenameFallbackRows: 0,
    excluded: [], normalization: "LF_then_trim_no_internal_whitespace_collapse",
  };
  const unique = new Map<string, CompetitorReviewItem>();
  for (const sheet of sheets) for (let r = 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r], location = { sheet: sheet.name, row: r + 1 }; coverage.totalRows++;
    const exclude = (reason: CompetitorReviewCorpusCoverage["excluded"][number]["reason"]) => coverage.excluded.push({ ...location, reason });
    if (row.every(value => value == null || typeof value === "string" && !value.trim())) { coverage.blankRows++; exclude("blank_row"); continue; }
    const get = (field: CompetitorReviewField) => sheet.mapping[field] === undefined ? null : row[sheet.mapping[field]!] ?? null;
    const rawBody = get("body");
    if (rawBody !== null && typeof rawBody !== "string") fail("REVIEW_BODY", "评论正文必须是文本，不把数字或布尔缓存转换为评论");
    const body = text(rawBody);
    if (!body) { coverage.emptyBodyRows++; exclude("empty_body"); continue; }
    const rawAsin = get("asin"), rowAsin = text(rawAsin)?.toUpperCase();
    const assignment = rowAsin && ASIN.test(rowAsin) ? "row_asin" : rawAsin == null || typeof rawAsin === "string" && !rawAsin.trim() ? filenameSafe ? "filename_unique_asin" : null : null;
    const asin = assignment === "row_asin" ? rowAsin : assignment ? filenameAsin : null;
    if (!asin) { coverage.unassignedRows++; exclude("unassigned_asin"); continue; }
    if (asin !== input.asin) { coverage.otherAsinRows++; exclude("other_asin"); continue; }
    const data = {
      asin, sourceReviewId: text(get("sourceReviewId")), title: text(get("title")), body,
      rating: optionalNumber(get("rating"), 5, false), date: text(get("date")), author: text(get("author")),
      verifiedPurchase: optionalBoolean(get("verifiedPurchase")), variant: text(get("variant")),
      helpfulVotes: optionalNumber(get("helpfulVotes"), Number.MAX_SAFE_INTEGER, true),
    };
    const warnings = (Object.keys(data) as Array<keyof typeof data>).filter(key => key !== "asin" && key !== "body" && data[key] === null && get(key as CompetitorReviewField) !== null && get(key as CompetitorReviewField) !== "").map(key => `UNKNOWN_${key}`);
    const occurrence: CompetitorReviewOccurrence = {
      ...location, assignment: assignment!, mapping: Object.fromEntries(Object.entries(sheet.mapping).map(([key, value]) => [key, value + 1])),
      fields: sheet.headers.map((header, c) => ({ column: c + 1, header, value: row[c] ?? null })), warnings,
    };
    // Unknown optional values remain part of identity; do not collapse two
    // different unparseable ratings/dates into the same null-normalized row.
    const unknown = Object.fromEntries(warnings.map(warning => { const key = warning.slice(8) as CompetitorReviewField; return [key, get(key)]; }));
    const reviewId = `review_${hash(canonical({ ...data, unknown }))}`;
    const prior = unique.get(reviewId);
    if (prior) { prior.occurrences.push(occurrence); coverage.duplicateRows++; }
    else unique.set(reviewId, { ...data, reviewId, occurrences: [occurrence] });
    coverage.matchedRows++;
    if (assignment === "filename_unique_asin") coverage.filenameFallbackRows++;
  }
  if (!coverage.totalRows) fail("REVIEW_EMPTY", "评论文件没有数据行");
  const items = [...unique.values()]; coverage.uniqueReviews = items.length;
  const payload = { parserVersion: COMPETITOR_REVIEW_PARSER_VERSION, projectId: input.projectId, analysisId: input.analysisId, asin: input.asin, items, coverage };
  return { ...payload, corpusHash: hash(canonical(payload)) };
}
