import * as XLSX from "xlsx";
import { TRPCError } from "@trpc/server";
import { admitOffice } from "../ai_os/services/assistantConversationAttachments";
import { researchThumbnail } from "../../../shared/researchLibrary";
import {
  PICK_FILE_BYTES,
  PICK_MAX_ROWS,
  pickAsin,
  pickCompetitorSchema,
  pickDate,
  pickMonth,
  type PickCompetitor,
  type PickImport,
} from "../../../shared/productSelection";

export type PickFile = { name: string; base64: string };
const invalid = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });

export function pickFileBytes(file: PickFile, extensions: readonly string[]) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (
    !extension ||
    !extensions.includes(extension) ||
    /[\\/\u0000-\u001f]/u.test(file.name)
  )
    throw invalid("文件类型或名称不受支持");
  const bytes = Buffer.from(file.base64, "base64");
  if (
    !bytes.length ||
    bytes.length > PICK_FILE_BYTES ||
    bytes.toString("base64") !== file.base64
  )
    throw invalid("文件无效或超过 8 MB");
  return bytes;
}

const text = (value: unknown, max = 250) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const normalize = (value: unknown) =>
  text(value).normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
function number(value: unknown, integer = false): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const cleaned = String(value)
    .trim()
    .replace(/[$¥￥,，]/gu, "");
  if (!/^\d+(?:\.\d+)?$/u.test(cleaned)) return null;
  const result = Number(cleaned);
  return result <= 100_000_000 && (!integer || Number.isSafeInteger(result))
    ? result
    : null;
}
function date(value: unknown) {
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts)
      value = [parts.y, parts.m, parts.d]
        .map(v => String(v).padStart(2, "0"))
        .join("-");
  }
  const match = text(value).match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[ T])/u
  );
  const parsed = pickDate.safeParse(
    match
      ?.slice(1)
      .map(v => v.padStart(2, "0"))
      .join("-")
  );
  return parsed.success ? parsed.data : null;
}
function fileDate(name: string, fallback: string) {
  const compact = name.match(/(?:^|\D)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/u);
  return date(compact?.slice(1).join("-")) ?? fallback;
}
const asin = (value: unknown) => {
  const result = pickAsin.safeParse(text(value).toUpperCase());
  return result.success ? result.data : null;
};

function measurement(
  value: unknown,
  quantity: number,
  factor: number,
  pattern: RegExp
) {
  const parts = text(value).match(/\d+(?:\.\d+)?/gu);
  if (parts?.length !== quantity || !pattern.test(text(value))) return null;
  const result = parts.map(part => Number(part) * factor);
  return result.every(n => n > 0 && n <= 10000) ? result : null;
}
function cm(metric: unknown, raw: unknown) {
  return (measurement(metric, 3, 1, /\bcm\b|厘米/i) ??
    measurement(raw, 3, 1, /\bcm\b|厘米/i) ??
    measurement(raw, 3, 2.54, /\b(?:in|inch|inches)\b|英寸|"/i) ??
    measurement(raw, 3, 0.1, /\bmm\b|毫米/i)) as PickCompetitor["packageCm"];
}
function kg(metric: unknown, raw: unknown) {
  return (
    (measurement(metric, 1, 1, /\bkg\b|千克|公斤/i) ??
      measurement(raw, 1, 1, /\bkg\b|千克|公斤/i) ??
      measurement(raw, 1, 0.45359237, /\b(?:lbs?|pounds?)\b|磅/i) ??
      measurement(raw, 1, 0.028349523125, /\b(?:oz|ounces?)\b|盎司/i) ??
      measurement(metric ?? raw, 1, 0.001, /\bg\b|克/i))?.[0] ?? null
  );
}
function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  const range = sheet["!fullref"] ?? sheet["!ref"];
  if (!range) return [];
  const bounds = XLSX.utils.decode_range(range);
  if (bounds.e.r > PICK_MAX_ROWS + 20 || bounds.e.c > 160)
    throw invalid("表格超出支持范围，请按产品拆分后导入");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
}
function findHeader(book: XLSX.WorkBook, kind: "snapshot" | "history") {
  const names = book.SheetNames.filter(name =>
    kind === "history"
      ? /^(?:产品|父体)历史月销量$/u.test(name.trim())
      : !/^(?:brands|sellers|note|说明)$/iu.test(name.trim())
  );
  for (const name of names) {
    const rows = sheetRows(book.Sheets[name]);
    const start = rows.slice(0, 15).findIndex(row => {
      const labels = row.map(normalize);
      return (
        labels.includes("asin") &&
        (kind === "history"
          ? labels.some(label => pickMonth.safeParse(label).success)
          : labels.includes("月销量") && labels.includes("商品标题"))
      );
    });
    if (start >= 0) {
      const header = rows[start].map(normalize);
      return { rows: rows.slice(start + 1), header };
    }
  }
  throw invalid(
    kind === "history"
      ? "找不到「产品历史月销量」工作表或月份列"
      : "找不到包含 ASIN、商品标题和月销量的搜索结果工作表"
  );
}

function readCompetitors(rows: unknown[][], header: string[]) {
  const parsed = new Map<string, PickCompetitor>();
  for (const row of rows) {
    const get = (label: string) => row[header.indexOf(normalize(label))];
    const child = asin(get("ASIN"));
    if (!child) continue;
    const parent = asin(get("父ASIN")) ?? child;
    if (parsed.has(child)) {
      if (parsed.get(child)?.parentAsin !== parent)
        throw invalid("同一个子 ASIN 对应多个父 ASIN，请检查搜索结果表");
      continue;
    }
    const has = (field: string) => /^y$/iu.test(text(get(field)));
    const badges = (
      [
        ["BS", "Best Seller标识"],
        ["AC", "Amazon's Choice"],
        ["CPF", "CPF绿标"],
        ["NR", "New Release标识"],
      ] as const
    )
      .filter(([, field]) => has(field))
      .map(([badge]) => badge);
    const listing = (
      [
        ["A+", "A+页面"],
        ["视频", "视频介绍"],
        ["品牌故事", "品牌故事"],
      ] as const
    )
      .filter(([, field]) => has(field))
      .map(([name]) => name);
    const score = number(get("评分"));
    parsed.set(
      child,
      pickCompetitorSchema.parse({
        asin: child,
        parentAsin: parent,
        title: text(get("商品标题"), 1500),
        brand: text(get("品牌")),
        sku: text(get("SKU"), 1000),
        spec: text(get("详细参数"), 1200),
        image: researchThumbnail(text(get("商品主图"), 2000)),
        category: text(get("小类目") ?? get("大类目"), 300),
        rank: number(get("大类BSR"), true),
        parentSales: number(get("月销量"), true),
        childSales: number(get("子体销量"), true),
        price: number(get("价格($)")),
        rating: score !== null && score <= 5 ? score : null,
        reviews: number(get("评分数"), true),
        listedOn: date(get("上架时间")),
        sellerCountry: text(get("卖家所属地"), 80),
        fulfillment: text(get("配送方式"), 80),
        fbaFee: number(get("FBA($)")),
        packageCm: cm(get("包装尺寸（单位换算）"), get("包装尺寸")),
        packageKg: kg(get("包装重量（单位换算）"), get("包装重量")),
        productCm: cm(get("商品尺寸（单位换算）"), get("商品尺寸")),
        productKg: kg(get("商品重量（单位换算）"), get("商品重量")),
        sizeTier: text(get("包装尺寸分段"), 80),
        badges,
        listing,
      })
    );
  }
  return [...parsed.values()];
}

export async function parsePickImport(
  file: PickFile,
  kind: "snapshot" | "history",
  today: string
) {
  const bytes = pickFileBytes(file, ["xlsx"]);
  let book: XLSX.WorkBook;
  try {
    // SellerSprite includes hundreds of embedded thumbnails. Admit the archive
    // before reading the worksheets. The table uses the supplied image URLs.
    await admitOffice(bytes, "xlsx", 2048);
    book = XLSX.read(bytes, {
      type: "buffer",
      sheetRows: PICK_MAX_ROWS + 22,
      cellHTML: false,
      cellFormula: false,
    });
    if (book.SheetNames.length > 20) throw invalid("工作表数量超过限制");
  } catch {
    throw invalid("无法读取这份 Excel，请使用卖家精灵导出的 .xlsx 文件");
  }
  const asOf = fileDate(file.name, today);
  const { header, rows } = findHeader(book, kind);
  if (kind === "snapshot") {
    const records = readCompetitors(rows, header);
    if (!records.length || records.length > PICK_MAX_ROWS)
      throw invalid("搜索结果表没有有效 ASIN，或记录数超过 5,000");
    return {
      kind,
      source: { name: file.name, count: records.length, asOf },
      rows: records,
    } as const;
  }
  const childColumn = header.indexOf("asin"),
    parentColumn = header.indexOf("父asin");
  const monthColumns = header
    .map((month, column) => ({ month, column }))
    .filter(
      ({ month }) =>
        pickMonth.safeParse(month).success && month < asOf.slice(0, 7)
    )
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12);
  if (!monthColumns.length)
    throw invalid("销量表未包含完整月份，请检查导出时间");
  const records = new Map<string, PickImport["historyRows"][number]>();
  for (const row of rows) {
    const child = asin(row[childColumn]);
    if (!child) continue;
    const parent = asin(row[parentColumn]);
    const previous = records.get(child);
    if (previous?.parentAsin && parent && previous.parentAsin !== parent)
      throw invalid("历史表中的同一个子 ASIN 对应多个父 ASIN");
    const values = previous?.values ?? {};
    for (const { month, column } of monthColumns) {
      const units = number(row[column], true);
      if (units !== null)
        values[month] = Math.max(values[month] ?? units, units);
    }
    records.set(child, {
      asin: child,
      parentAsin: parent ?? previous?.parentAsin ?? null,
      values,
    });
  }
  if (!records.size || records.size > PICK_MAX_ROWS)
    throw invalid("销量表没有有效 ASIN，或记录数超过 5,000");
  return {
    kind,
    source: { name: file.name, count: records.size, asOf },
    rows: [...records.values()],
  } as const;
}
