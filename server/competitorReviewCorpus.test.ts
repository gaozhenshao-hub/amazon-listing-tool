import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { buildCompetitorReviewCorpus as build, COMPETITOR_REVIEW_LIMITS as limits } from "./domains/listing/services/competitorReviewCorpus";

vi.mock("xlsx", async original => { const actual = await original<typeof import("xlsx")>(); return { ...actual, read: vi.fn(actual.read) }; });
const A = "B000000001", B = "B000000002";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const csv = (rows: unknown[][]) => Buffer.from(rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/gu, '""')}"`).join(",")).join("\r\n"));
const headers = ["ASIN", "评论内容", "评论标题", "评分", "评论日期", "作者", "验证购买", "变体", "有用投票", "评论ID"];
const row = [A, "First line\r\nSecond  line", " Good ", "0", "2026-01-02", "Person", "false", "Small", "0", "r1"];
function parse(bytes: Buffer = csv([headers, row]), fileName = "reviews.csv", extra: Record<string, unknown> = {}) {
  return build({ bytes, fileName, asin: A, projectId: 7, analysisId: 11, sourceFileHash: digest(bytes), ...extra });
}
function workbook(rows: unknown[][], compressed = false, edit?: (sheet: XLSX.WorkSheet) => void): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows); edit?.(sheet);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Reviews");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: compressed });
}
type Part = { name: string; bytes: Buffer; method?: number; flags?: number; expanded?: number; localExpanded?: number; crc?: number; trailing?: Buffer };
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Small synthetic canonical ZIP fixtures. Declared bomb sizes never allocate
// their claimed bodies, and the reader spy proves rejection before XLSX.read.
function zip(parts: Part[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name), method = part.method ?? 0, flags = part.flags ?? 0;
    const body = Buffer.concat([method === 8 ? deflateRawSync(part.bytes) : part.bytes, part.trailing ?? Buffer.alloc(0)]);
    const size = part.expanded ?? part.bytes.length, crc = part.crc ?? crc32(part.bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(part.localExpanded ?? size, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const bareParts = (): Part[] => [
  { name: "[Content_Types].xml", bytes: Buffer.from("<Types/>") },
  { name: "xl/workbook.xml", bytes: Buffer.from("<workbook/>") },
];
const rejectedBeforeRead = (bytes: Buffer, code?: string) => {
  vi.mocked(XLSX.read).mockClear();
  if (code) expect(() => parse(bytes, "reviews.xlsx")).toThrow(expect.objectContaining({ code }));
  else expect(() => parse(bytes, "reviews.xlsx")).toThrow();
  expect(XLSX.read).not.toHaveBeenCalled();
};
beforeEach(() => { vi.mocked(XLSX.read).mockClear(); });

describe("original review corpus — human specified gold", () => {
  it.each(["csv", "xlsx", "compressed"])("retains original evidence and genuine zero/false: %s", format => {
    const bytes = format === "csv" ? csv([headers, row]) : workbook([headers, row], format === "compressed");
    const result = parse(bytes, format === "csv" ? "reviews.csv" : "reviews.xlsx");
    expect(result.parserVersion).toBe("competitor-review-corpus/1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ asin: A, body: "First line\nSecond  line", title: "Good", rating: 0, verifiedPurchase: false, helpfulVotes: 0, sourceReviewId: "r1" });
    expect(result.items[0].occurrences[0]).toMatchObject({ row: 2, assignment: "row_asin", mapping: { asin: 1, body: 2, rating: 4 }, warnings: [] });
    expect(result.items[0].occurrences[0].fields[1].value).toBe(row[1]);
    expect(result.coverage).toMatchObject({ scope: "complete_file_not_market_total", totalRows: 1, matchedRows: 1, uniqueReviews: 1, duplicateRows: 0 });
    expect(result.corpusHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("partitions all source rows and counts duplicates without a market denominator", () => {
    const result = parse(csv([headers, row, [...row], [B, "other"], ["", "unassigned"], [A, ""], [""]]));
    expect(result.coverage).toMatchObject({ totalRows: 6, matchedRows: 2, duplicateRows: 1, uniqueReviews: 1, otherAsinRows: 1, unassignedRows: 1, emptyBodyRows: 1, blankRows: 1 });
    expect(result.items[0].occurrences.map(o => o.row)).toEqual([2, 3]);
    expect(result.coverage.excluded.map(e => e.reason)).toEqual(["other_asin", "unassigned_asin", "empty_body", "blank_row"]);
    expect(result.coverage).not.toHaveProperty("reviewCount");
  });
  it("has stable full corpus hashes, and binds all original raw fields and scope", () => {
    const bytes = csv([[...headers, "Unknown note"], [...row, "preserved"]]);
    expect(parse(bytes)).toEqual(parse(Buffer.from(bytes)));
    expect(parse(bytes).corpusHash).not.toBe(parse(bytes, "reviews.csv", { analysisId: 12 }).corpusHash);
    expect(parse(bytes).corpusHash).not.toBe(parse(bytes, "reviews.csv", { projectId: 8 }).corpusHash);
    expect(parse(bytes).corpusHash).not.toBe(parse(csv([[...headers, "Unknown note"], [...row, "changed"]])).corpusHash);
    expect(JSON.parse(JSON.stringify(parse(bytes)))).toEqual(parse(bytes));
  });
  it("normalizes only LF and outer whitespace, not internal spacing or case", () => {
    const result = parse(csv([["ASIN", "body"], [A, " a\r\nb "], [A, "a\nb"], [A, "a  b"], [A, "a b"], [A, "A b"]]));
    expect(result.items.map(i => i.body)).toEqual(["a\nb", "a  b", "a b", "A b"]);
    expect(result.coverage.duplicateRows).toBe(1);
  });
  it("unknown metadata remains unknown, raw and distinct, not false or zero", () => {
    const rows = [headers, [A, "body", "", "unknown", 1234, "", "unknown", "", "unknown"], [A, "body", "", "bad", 1234, "", "unknown", "", "unknown"]];
    const result = parse(workbook(rows), "reviews.xlsx");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ rating: null, date: null, verifiedPurchase: null, helpfulVotes: null });
    expect(result.items[0].occurrences[0].warnings).toEqual(expect.arrayContaining(["UNKNOWN_rating", "UNKNOWN_date", "UNKNOWN_verifiedPurchase", "UNKNOWN_helpfulVotes"]));
  });
  it("accepts full 32000-character text without truncation", () => {
    expect(parse(csv([["ASIN", "body"], [A, "x".repeat(32000)]])).items[0].body).toHaveLength(32000);
  });
  it("CSV formula-looking text is literal unexecuted source", () => {
    expect(parse(csv([["ASIN", "body"], [A, '=HYPERLINK("https://invalid")']])).items[0].body).toBe('=HYPERLINK("https://invalid")');
  });
  it("preserves Unicode, quoted commas, escaped quotes and multiline locators", () => {
    const result = parse(csv([["ASIN", "body"], [A, '很棒,"原文"\n第二行'], [A, "下条"]]));
    expect(result.items.map(i => i.occurrences[0].row)).toEqual([2, 3]);
    expect(result.items[0].body).toBe('很棒,"原文"\n第二行');
  });
});

describe("explicit ASIN assignment only", () => {
  it("uses a unique filename ASIN only when all declared identities agree", () => {
    const result = parse(csv([["ASIN", "body"], [A, "explicit"], ["", "from filename"]]), `${A}-reviews.csv`);
    expect(result.items.map(i => i.occurrences[0].assignment)).toEqual(["row_asin", "filename_unique_asin"]);
    expect(result.coverage.filenameFallbackRows).toBe(1);
  });
  it.each([[B, "valid foreign"], ["bad", "malformed"], ["123", "numeric-like"]])("conflicting %s disables fallback but never reassigns an explicit row", asin => {
    const result = parse(csv([["ASIN", "body"], [A, "explicit"], [asin, "conflict"], ["", "not guessed"]]), `${A}.csv`);
    expect(result.items).toHaveLength(1); expect(result.coverage.filenameFallbackRows).toBe(0);
    expect(result.coverage.unassignedRows).toBeGreaterThan(0);
  });
  it.each(["reviews.csv", `${A}_${B}.csv`, `prefix${A}suffix.csv`])("does not guess ambiguous filename %s", name => {
    const result = parse(csv([["body"], ["no ID"]]), name);
    expect(result.items).toEqual([]); expect(result.coverage.unassignedRows).toBe(1);
  });
  it("does not use a parent ASIN column as the reviewed child's identity", () => {
    const result = parse(csv([["父ASIN", "body"], [A, "parent only"]]));
    expect(result.items).toEqual([]); expect(result.coverage.unassignedRows).toBe(1);
  });
  it("parent conflict also disables filename inference", () => {
    const result = parse(csv([["父ASIN", "body"], [B, "parent conflict"]]), `${A}.csv`);
    expect(result.coverage.unassignedRows).toBe(1);
  });
  it("does not group missing ASIN under the largest group", () => {
    const result = parse(csv([["ASIN", "body"], [A, "one"], [A, "two"], ["", "missing"]]));
    expect(result.items).toHaveLength(2); expect(result.coverage.unassignedRows).toBe(1);
  });
  it("keeps explicit per-row IDs when filename refers to another ASIN", () => {
    expect(parse(csv([["ASIN", "body"], [A, "exact"]]), `${B}.csv`).items).toHaveLength(1);
  });
});

describe("bounded source validation", () => {
  it.each([Buffer.alloc(0), Buffer.from("ASIN,body")])("rejects empty source/data", bytes => expect(() => parse(bytes)).toThrow(expect.objectContaining({ code: "REVIEW_EMPTY" })));
  it.each(["reviews.xls", "reviews.xlsm", "reviews.json", "../reviews.csv"])("rejects unsupported %s explicitly", name => expect(() => parse(undefined, name)).toThrow(expect.objectContaining({ code: "REVIEW_FORMAT" })));
  it("rejects wrong byte hash before workbook parsing", () => {
    expect(() => parse(workbook([headers, row]), "reviews.xlsx", { sourceFileHash: "0".repeat(64) })).toThrow(expect.objectContaining({ code: "REVIEW_HASH" }));
    expect(XLSX.read).not.toHaveBeenCalled();
  });
  it.each([{ projectId: 0 }, { analysisId: Number.MAX_SAFE_INTEGER + 1 }, { asin: "b000000001" }, { asin: "short" }, { asin: 1234567890 }])("rejects malformed identity %j", extra => expect(() => parse(undefined, undefined, extra)).toThrow(expect.objectContaining({ code: "REVIEW_IDENTITY" })));
  it("rejects more than 20 MiB before decoding", () => expect(() => parse(Buffer.alloc(limits.bytes + 1))).toThrow(expect.objectContaining({ code: "REVIEW_LIMIT" })));
  it("rejects >20000 data records and >64 columns", () => {
    expect(() => parse(csv([["ASIN", "body"], ...Array.from({ length: 20001 }, () => [A, "body"])]))).toThrow(expect.objectContaining({ code: "REVIEW_LIMIT" }));
    expect(() => parse(csv([Array.from({ length: 65 }, (_, i) => i ? `c${i}` : "body"), ["body"]]))).toThrow(expect.objectContaining({ code: "REVIEW_LIMIT" }));
  });
  it("rejects >32000 body, including outer spaces (no silent trim-to-fit)", () => expect(() => parse(csv([["body"], [" " + "x".repeat(32000)]]))).toThrow(expect.objectContaining({ code: "REVIEW_LIMIT" })));
  it.each(["ASIN,body\n\"unclosed", 'ASIN,body\nA,"body" trailing', 'ASIN,body\nA,mid"quote']) ("rejects malformed CSV quotes", source => expect(() => parse(Buffer.from(source))).toThrow(expect.objectContaining({ code: "REVIEW_CSV" })));
  it("rejects non-UTF8 bytes", () => expect(() => parse(Buffer.from([0xff, 0xfe, 0x41]))).toThrow(expect.objectContaining({ code: "REVIEW_ENCODING" })));
  it.each([{ header: ["ASIN", "unknown"] }, { header: ["ASIN", "body", "review content"] }, { header: ["ASIN", "child ASIN", "body"] }])("rejects missing or ambiguous header $header", ({ header }) => expect(() => parse(csv([header, [A, "long source text that must never be guessed", "body"]]))).toThrow(expect.objectContaining({ code: "REVIEW_HEADER" })));
  it("rejects data outside declared header and nontext Excel body", () => {
    expect(() => parse(csv([["body"], ["text", "undeclared"]]))).toThrow(expect.objectContaining({ code: "REVIEW_HEADER" }));
    expect(() => parse(workbook([["ASIN", "body"], [A, 99]]), "reviews.xlsx")).toThrow(expect.objectContaining({ code: "REVIEW_BODY" }));
  });
});

describe("pre-SheetJS ZIP/formula gates", () => {
  it.each(["<f>1+1</f>", "<f/>", '<f t="shared" si="999"/>', '<f t="dataTable" ref="B2:B3"/>', "<x:f>1+1</x:f>"])("rejects every formula marker %s", marker => rejectedBeforeRead(zip([...bareParts(), { name: "xl/worksheets/sheet1.xml", bytes: Buffer.from(`<worksheet><c r="B2">${marker}<v>99</v></c></worksheet>`) }]), "REVIEW_FORMULA"));
  it("rejects formula in allowed rels, unknown alternate suffix and nonempty directories", () => {
    rejectedBeforeRead(zip([...bareParts(), { name: "xl/worksheets/sheet1.rels", bytes: Buffer.from("<f/>") }]), "REVIEW_FORMULA");
    rejectedBeforeRead(zip([...bareParts(), { name: "xl/worksheets/sheet1.data", bytes: Buffer.from("<f/>") }]), "REVIEW_XLSX_UNSUPPORTED");
    rejectedBeforeRead(zip([...bareParts(), { name: "folder/", bytes: Buffer.from("x") }]), "REVIEW_XLSX_UNSUPPORTED");
  });
  it("rejects local descriptor allocation hints before a second parser", () => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from("x"), method: 8, flags: 8, localExpanded: 0x7fffffff }]), "REVIEW_ZIP"));
  it("rejects declared single-member and cumulative expansion bombs", () => {
    rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from("x"), expanded: limits.entryBytes + 1 }]), "REVIEW_LIMIT");
    // Earlier entries must be valid to reach the cumulative gate; the sum is
    // still bounded to 64MiB and never sent to SheetJS.
    const full = Buffer.alloc(limits.entryBytes, 32);
    rejectedBeforeRead(zip([{ name: "a.xml", bytes: full, method: 8 }, { name: "b.xml", bytes: full, method: 8 }, ...bareParts()]), "REVIEW_LIMIT");
  });
  it("rejects actual expansion larger than the advertised size", () => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.alloc(10000, 32), method: 8, expanded: 1 }]), "REVIEW_ZIP"));
  it("rejects cumulative cell elements across members before XLSX.read", () => {
    // ~2 MiB total XML, no giant worksheet or workbook allocation. Each member
    // individually fits 500k, but the aggregate exceeds the fixed global cap.
    const part = Buffer.from(`<worksheet>${"<c/>".repeat(250001)}</worksheet>`);
    const bytes = zip([...bareParts(), { name: "xl/worksheets/one.xml", bytes: part }, { name: "xl/worksheets/two.rels", bytes: part }]);
    expect(bytes.length).toBeLessThan(3 * 1024 * 1024);
    let error: unknown;
    try { parse(bytes, "reviews.xlsx"); } catch (caught) { error = caught; }
    expect(XLSX.read).not.toHaveBeenCalled();
    expect(error).toMatchObject({ code: "REVIEW_LIMIT" });
  });
  it("rejects unconsumed compressed bytes rather than reparsing a different stream", () => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from("<worksheet/>"), method: 8, trailing: Buffer.from("hidden") }]), "REVIEW_ZIP"));
  it("rejects duplicate worksheet cell addresses before silent overwrite", () => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from('<worksheet><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></worksheet>') }]), "REVIEW_XML"));
  it("rejects real workbook formulas and merges, preserving literal values only", () => {
    rejectedBeforeRead(workbook([headers, row], false, sheet => { sheet.B2.f = '"cached"'; }), "REVIEW_FORMULA");
    expect(() => parse(workbook([headers, row], false, sheet => { sheet["!merges"] = [{ s: { c: 1, r: 1 }, e: { c: 2, r: 1 } }]; }), "reviews.xlsx")).toThrow(expect.objectContaining({ code: "REVIEW_XLSX_UNSUPPORTED" }));
  });
  it("counts sparse blank Excel rows instead of hiding gaps", () => {
    const bytes = workbook([["ASIN", "body"], [A, "one"], [], [A, "two"]]);
    const result = parse(bytes, "reviews.xlsx");
    expect(result.coverage).toMatchObject({ totalRows: 3, blankRows: 1, matchedRows: 2 });
    expect(result.items[1].occurrences[0].row).toBe(4);
  });
  it.each([{ flags: 1 }, { crc: 123 }, { localExpanded: 999 }, { method: 9 }])("rejects unsafe header/CRC %j", patch => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from("<worksheet/>"), ...patch }]), "REVIEW_ZIP"));
  it("rejects duplicate members, traversal and excessive members", () => {
    rejectedBeforeRead(zip([...bareParts(), ...bareParts()]), "REVIEW_ZIP");
    rejectedBeforeRead(zip([...bareParts(), { name: "../s.xml", bytes: Buffer.from("x") }]), "REVIEW_ZIP");
    rejectedBeforeRead(zip(Array.from({ length: 257 }, (_, i) => ({ name: `${i}.xml`, bytes: Buffer.from("x") }))), "REVIEW_LIMIT");
  });
  it.each(['<worksheet><dimension ref="A1:XFD1048576"/></worksheet>', '<worksheet><c r="A20002"><v>1</v></c></worksheet>'])("rejects sparse huge ranges before workbook allocation", xml => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from(xml) }]), "REVIEW_LIMIT"));
  it.each(['<!DOCTYPE x [<!ENTITY a "huge">]><x/>', '<Relationships><Relationship TargetMode="External"/></Relationships>'])("rejects unsafe XML", xml => rejectedBeforeRead(zip([...bareParts(), { name: "xl/s.xml", bytes: Buffer.from(xml) }])));
  it("supports multiple sheets with original locators, but total cap is global", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["ASIN", "body"], [A, "one"]]), "One");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["ASIN", "body"], [A, "two"]]), "Two");
    const result = parse(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "reviews.xlsx");
    expect(result.items.map(i => i.occurrences[0].sheet)).toEqual(["One", "Two"]); expect(result.coverage.totalRows).toBe(2);
  });
});
