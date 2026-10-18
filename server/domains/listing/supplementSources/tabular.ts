// Bounded table reader derived from the existing complete review-corpus reader.
// It never follows external relationships, executes formulas, or truncates rows.
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
type CompetitorReviewValue = string | number | boolean | null;

export const SUPPLEMENT_TABULAR_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  zipEntries: 256,
  sheets: 8,
  dataRows: 20000,
  columns: 64,
  cells: 500000,
  bodyCharacters: 32000,
});
export class SupplementTabularError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplementTabularError";
  }
}
function fail(code: string, message: string): never {
  throw new SupplementTabularError(code, message);
}
export type SupplementSheet = { name: string; rows: CompetitorReviewValue[][] };

function utf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("REVIEW_ENCODING", "评论文件必须使用 UTF-8 文本编码");
  }
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
  if (
    column > SUPPLEMENT_TABULAR_LIMITS.columns ||
    row > SUPPLEMENT_TABULAR_LIMITS.dataRows + 1
  )
    fail("REVIEW_LIMIT", "评论表行列范围超限");
  return { row, column };
}
function checkXml(xml: string, remainingCells: number): number {
  if (xml.includes("\0") || /<!DOCTYPE|<!ENTITY/i.test(xml))
    fail("REVIEW_XML", "不支持 Excel 实体或非 UTF-8 XML");
  // No formula cache is an original review. Inspect ALL admitted parts, not
  // just *.xml worksheets; OPC relationships may target a different suffix.
  if (/<(?:[\w.-]+:)?f(?=[\s/>])/u.test(xml))
    fail(
      "REVIEW_FORMULA",
      "评论文件含公式，不能把缓存值当原文；请核对后另存值副本"
    );
  if (/TargetMode\s*=\s*["']External["']/i.test(xml))
    fail("REVIEW_XLSX_UNSUPPORTED", "不支持包含外部关系的评论 Excel");
  // Apply one budget across every admitted XML/relationship part. Do not
  // rely on worksheet filenames: a relationship may target another suffix.
  // Count incrementally rather than allocating an array of every match.
  let cells = 0;
  const cellTags = /<(?:[\w.-]+:)?c(?=[\s/>])/gu;
  while (cellTags.exec(xml))
    if (++cells > remainingCells) fail("REVIEW_LIMIT", "Excel 单元格数量超限");
  for (const match of xml.matchAll(
    /<(?:[\w.-]+:)?(?:c|dimension)\b[^>]*\b(?:r|ref)\s*=\s*["']([^"']+)["']/gu
  )) {
    for (const address of match[1].split(":")) cellAddress(address);
  }
  const addresses = new Set<string>();
  for (const match of xml.matchAll(
    /<(?:[\w.-]+:)?c\b[^>]*\br\s*=\s*["']([^"']+)["']/gu
  )) {
    if (addresses.has(match[1]))
      fail("REVIEW_XML", "Excel 同一工作表含重复单元格地址，不能忠实读取");
    addresses.add(match[1]);
  }
  return cells;
}

/** Derived from the limited monthly-preview ZIP admission, with server-side
 * bounded inflate. Budget/identity checks are not an OS or CPU sandbox.
 * All actual bytes are validated BEFORE SheetJS's second parse. */
function inspectXlsx(bytes: Buffer): void {
  const u16 = (p: number) => bytes.readUInt16LE(p),
    u32 = (p: number) => bytes.readUInt32LE(p);
  if (bytes.length < 22 || u32(0) !== 0x04034b50)
    fail("REVIEW_ZIP", "仅支持标准未加密 XLSX ZIP");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
      break;
  if (end < Math.max(0, bytes.length - 65557))
    fail("REVIEW_ZIP", "Excel ZIP 目录缺失");
  const count = u16(end + 10),
    size = u32(end + 12),
    offset = u32(end + 16);
  if (!count || count > SUPPLEMENT_TABULAR_LIMITS.zipEntries)
    fail("REVIEW_LIMIT", "Excel ZIP 成员数量超限");
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    [size, offset].includes(0xffffffff) ||
    offset + size !== end
  )
    fail("REVIEW_ZIP", "不支持分卷或 ZIP64");
  const names = new Set<string>(),
    spans: Array<[number, number]> = [];
  const extra = (start: number, length: number) => {
    const stop = start + length;
    if (stop > bytes.length) fail("REVIEW_ZIP", "ZIP 扩展越界");
    for (let i = start; i < stop; ) {
      if (i + 4 > stop || u16(i) === 1) fail("REVIEW_ZIP", "不支持 ZIP64 扩展");
      i += 4 + u16(i + 2);
      if (i > stop) fail("REVIEW_ZIP", "ZIP 扩展损坏");
    }
  };
  let at = offset,
    expandedTotal = 0,
    xmlCellTotal = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50)
      fail("REVIEW_ZIP", "ZIP 成员目录损坏");
    const flags = u16(at + 8),
      method = u16(at + 10),
      crc = u32(at + 16),
      compressed = u32(at + 20),
      expanded = u32(at + 24);
    const nl = u16(at + 28),
      el = u16(at + 30),
      cl = u16(at + 32),
      local = u32(at + 42),
      next = at + 46 + nl + el + cl;
    if (
      next > end ||
      !nl ||
      nl > 256 ||
      u16(at + 34) ||
      flags & ~0x0806 ||
      ![0, 8].includes(method)
    )
      fail("REVIEW_ZIP", "拒绝加密、数据描述符或异常 ZIP 成员");
    if (
      [compressed, expanded, local].includes(0xffffffff) ||
      expanded > SUPPLEMENT_TABULAR_LIMITS.entryBytes ||
      (expandedTotal += expanded) > SUPPLEMENT_TABULAR_LIMITS.expandedBytes
    )
      fail("REVIEW_LIMIT", "Excel 解压大小超限");
    const name = utf8(bytes.subarray(at + 46, at + 46 + nl));
    if (
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("\0") ||
      name.split("/").some(part => part === ".." || part === ".") ||
      names.has(name)
    )
      fail("REVIEW_ZIP", "ZIP 路径无效或重复");
    names.add(name);
    const directory = name.endsWith("/");
    if (directory ? expanded !== 0 : !/\.(?:xml|rels)$/i.test(name))
      fail(
        "REVIEW_XLSX_UNSUPPORTED",
        "仅支持 XML/关系文本和空目录；图片、二进制或未知 Excel 部件不受支持"
      );
    if (/vbaProject|externalLinks/i.test(name))
      fail("REVIEW_XLSX_UNSUPPORTED", "不支持宏或外链");
    extra(at + 46 + nl, el);
    if (
      local + 30 > offset ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      fail("REVIEW_ZIP", "ZIP 本地头不一致");
    const ln = u16(local + 26),
      le = u16(local + 28),
      start = local + 30 + ln + le,
      finish = start + compressed;
    if (
      start > offset ||
      finish > offset ||
      ln !== nl ||
      !bytes
        .subarray(local + 30, local + 30 + ln)
        .equals(bytes.subarray(at + 46, at + 46 + nl))
    )
      fail("REVIEW_ZIP", "ZIP 成员越界或名称不一致");
    extra(local + 30 + ln, le);
    if (
      u32(local + 14) !== crc ||
      u32(local + 18) !== compressed ||
      u32(local + 22) !== expanded
    )
      fail("REVIEW_ZIP", "ZIP 本地大小或 CRC 不一致");
    spans.push([local, finish]);
    let content: Buffer;
    try {
      if (method === 0) content = bytes.subarray(start, finish);
      else {
        const inflated = inflateRawSync(bytes.subarray(start, finish), {
          maxOutputLength: Math.max(1, expanded),
          info: true,
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (
          !Buffer.isBuffer(inflated.buffer) ||
          inflated.engine.bytesWritten !== compressed
        )
          fail("REVIEW_ZIP", "Excel 压缩成员存在未消耗字节");
        content = inflated.buffer;
      }
    } catch {
      fail("REVIEW_ZIP", "Excel 实际解压失败或超过声明上限");
    }
    if (content.length !== expanded || crc32(content) !== crc)
      fail("REVIEW_ZIP", "Excel 实际长度或 CRC 不符");
    if (!directory)
      xmlCellTotal += checkXml(
        utf8(content),
        SUPPLEMENT_TABULAR_LIMITS.cells - xmlCellTotal
      );
    at = next;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, stop] of spans) {
    if (start !== cursor) fail("REVIEW_ZIP", "ZIP 存在重叠或未列出的本地成员");
    cursor = stop;
  }
  if (
    cursor !== offset ||
    at !== end ||
    !names.has("[Content_Types].xml") ||
    !names.has("xl/workbook.xml")
  )
    fail("REVIEW_ZIP", "Excel ZIP 完整性不符");
}

function csvSheet(bytes: Buffer): SupplementSheet {
  const input = utf8(bytes).replace(/^\uFEFF/u, "");
  if (input.includes("\0")) fail("REVIEW_CSV", "CSV 包含 NUL 字符");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false,
    started = false,
    cells = 0;
  const save = () => {
    if (
      row.length >= SUPPLEMENT_TABULAR_LIMITS.columns ||
      ++cells > SUPPLEMENT_TABULAR_LIMITS.cells
    )
      fail("REVIEW_LIMIT", "CSV 列或单元格数量超限");
    row.push(field);
    field = "";
    closed = false;
    started = false;
  };
  const line = () => {
    save();
    rows.push(row);
    row = [];
    if (rows.length > SUPPLEMENT_TABULAR_LIMITS.dataRows + 1)
      fail("REVIEW_LIMIT", "评论数据超过 20000 行");
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") save();
    else if (c === "\n" || c === "\r") {
      line();
      if (c === "\r" && input[i + 1] === "\n") i++;
    } else if (closed) fail("REVIEW_CSV", "CSV 引号关闭后存在多余字符");
    else if (c === '"') {
      if (started) fail("REVIEW_CSV", "CSV 引号位置无效");
      quoted = true;
      started = true;
    } else {
      field += c;
      started = true;
    }
    if (field.length > SUPPLEMENT_TABULAR_LIMITS.bodyCharacters)
      fail("REVIEW_LIMIT", "单元格超过 32000 字符，不截断");
  }
  if (quoted) fail("REVIEW_CSV", "CSV 引号未闭合");
  if (started || closed || field || row.length) line();
  return { name: "CSV", rows };
}
function xlsxSheets(bytes: Buffer): SupplementSheet[] {
  inspectXlsx(bytes);
  // Compressed/expanded bytes, aggregate XML cell tags and each address range
  // are bounded before this call. Workbook sheet count and combined physical
  // data-row count below remain post-parse checks, not OPC preflight claims.
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, {
      type: "buffer",
      cellFormula: true,
      cellDates: false,
      cellHTML: false,
      cellText: false,
      dense: false,
      sheetRows: SUPPLEMENT_TABULAR_LIMITS.dataRows + 2,
    });
  } catch {
    fail("REVIEW_XLSX", "无法解析受限 XLSX");
  }
  if (
    !book.SheetNames.length ||
    book.SheetNames.length > SUPPLEMENT_TABULAR_LIMITS.sheets ||
    new Set(book.SheetNames).size !== book.SheetNames.length
  )
    fail("REVIEW_LIMIT", "Excel 工作表数量无效");
  let cellCount = 0,
    totalRows = 0;
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    if (!sheet) fail("REVIEW_XLSX", "Excel 工作表缺失");
    if (sheet["!merges"]?.length)
      fail("REVIEW_XLSX_UNSUPPORTED", "不支持合并单元格评论表");
    for (const range of [sheet["!ref"], sheet["!fullref"]])
      if (range) for (const point of range.split(":")) cellAddress(point);
    const rows: CompetitorReviewValue[][] = [];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      const { row, column } = cellAddress(address);
      if (++cellCount > SUPPLEMENT_TABULAR_LIMITS.cells)
        fail("REVIEW_LIMIT", "Excel 单元格数量超限");
      if (cell.f !== undefined || cell.F !== undefined || cell.t === "e")
        fail("REVIEW_FORMULA", "公式或错误单元格不能当原评论");
      const value: unknown = cell.v ?? null;
      if (
        !(
          value === null ||
          typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= Number.MAX_SAFE_INTEGER)
        )
      )
        fail("REVIEW_CELL", "不支持此单元格类型");
      if (
        typeof value === "string" &&
        (value.length > SUPPLEMENT_TABULAR_LIMITS.bodyCharacters ||
          value.includes("\0"))
      )
        fail("REVIEW_LIMIT", "单元格超过限制，不截断");
      rows[row - 1] ??= [];
      rows[row - 1][column - 1] = value as CompetitorReviewValue;
    }
    // Materialize gaps explicitly so counts never silently drop sparse rows.
    for (let r = 0; r < rows.length; r++) rows[r] ??= [];
    totalRows += Math.max(0, rows.length - 1);
    if (totalRows > SUPPLEMENT_TABULAR_LIMITS.dataRows)
      fail("REVIEW_LIMIT", "评论总数据超过 20000 行");
    return { name, rows };
  });
}
export function readSupplementSheets(
  bytes: Buffer,
  fileName: string
): SupplementSheet[] {
  if (!bytes.length || bytes.length > SUPPLEMENT_TABULAR_LIMITS.bytes)
    fail("SOURCE_SIZE", "Invalid source size");
  if (/\.csv$/iu.test(fileName)) return [csvSheet(bytes)];
  if (/\.xlsx$/iu.test(fileName)) return xlsxSheets(bytes);
  fail(
    "FORMAT_UNSUPPORTED",
    "Only bounded UTF-8 CSV and XLSX tables are admitted"
  );
}
