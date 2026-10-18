import { load } from "cheerio";
import { z } from "zod";
import {
  LISTING_SUPPLEMENT_LIMITS,
  LISTING_SUPPLEMENT_PARSER,
  SupplementOriginalInputSchema,
  SupplementOriginalMetadataSchema,
  SupplementPreviewSchema,
  SupplementRecordSchema,
  supplementHash,
  type SupplementOriginalInput,
  type SupplementOriginalMetadata,
  type SupplementKind,
  type SupplementIdentity,
  type SupplementScope,
  type SupplementTarget,
  type SupplementPreview,
  type SupplementRecord,
} from "../../../../shared/listingSupplementSources";
import {
  readSupplementSheets,
  SupplementTabularError,
  type SupplementSheet,
} from "./tabular";
import {
  supplementBytesHash,
  supplementFail,
  SupplementSourceError,
} from "./protocol";
export function decodeSupplementOriginal(raw: SupplementOriginalInput): {
  bytes: Buffer;
  metadata: SupplementOriginalMetadata;
} {
  const input = SupplementOriginalInputSchema.parse(raw);
  if (input.originalType === "clipboard") {
    // This exact envelope preserves both complete UTF-8 clipboard representations.
    // It is neither HTML rendered in a browser nor a synthesized CSV file.
    const bytes = Buffer.from(
      JSON.stringify({ version: 1, text: input.text, html: input.html }),
      "utf8"
    );
    if (bytes.length > LISTING_SUPPLEMENT_LIMITS.clipboardBytes)
      supplementFail("CLIPBOARD_LIMIT");
    return {
      bytes,
      metadata: SupplementOriginalMetadataSchema.parse({
        originalType: "clipboard",
        fileName: "clipboard.txt+html.json",
        contentType: "application/vnd.listing.clipboard+json",
        byteSize: bytes.length,
        contentHash: supplementBytesHash(bytes),
      }),
    };
  }
  if (
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64)
  )
    supplementFail("BASE64_INVALID");
  const bytes = Buffer.from(input.base64, "base64");
  if (
    !bytes.length ||
    bytes.length > LISTING_SUPPLEMENT_LIMITS.fileBytes ||
    bytes.toString("base64") !== input.base64
  )
    supplementFail("BASE64_INVALID");
  return {
    bytes,
    metadata: SupplementOriginalMetadataSchema.parse({
      originalType: "file",
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: bytes.length,
      contentHash: supplementBytesHash(bytes),
    }),
  };
}
const normalize = (value: string) => value.replace(/\r\n?/gu, "\n").trim();
const optional = (value: unknown) => {
  if (value !== null && value !== undefined && typeof value !== "string")
    supplementFail("CELL_TYPE_INVALID");
  return typeof value === "string" && normalize(value)
    ? normalize(value)
    : null;
};
const asin = (value: unknown) => {
  const text = optional(value)?.toUpperCase();
  if (text && !/^[A-Z0-9]{10}$/u.test(text)) supplementFail("ASIN_INVALID");
  return text ?? null;
};
const key = (value: string) =>
  value.toLowerCase().replace(/[\s_\-（）()]/gu, "");
const aliases: Record<string, string[]> = {
  asin: ["asin", "childasin", "productasin", "子asin", "商品asin", "产品asin"],
  body: [
    "body",
    "review",
    "content",
    "reviewcontent",
    "reviewbody",
    "reviewtext",
    "评论内容",
    "评论正文",
  ],
  title: ["title", "reviewtitle", "headline", "评论标题"],
  rating: ["rating", "stars", "评分", "星级"],
  date: ["date", "reviewdate", "评论日期"],
  author: ["author", "reviewer", "reviewername", "评论人"],
  variant: ["variant", "variation", "变体"],
  sourceReviewId: ["reviewid", "评论id"],
  verifiedPurchase: ["verifiedpurchase", "verified", "vp", "验证购买"],
  question: [
    "question",
    "alexaquestion",
    "alexaquestions",
    "问题",
    "alexa问题",
    "rufusquestion",
  ],
  questionCn: ["questioncn", "questiontranslation", "问题翻译", "中文翻译"],
  answer: ["answer", "回答", "答案"],
  answerCn: ["answercn", "回答翻译"],
  parentQuestion: ["parentquestion", "主问题", "原问题"],
  type: ["type", "类型", "问题类型"],
  name: ["attribute", "name", "属性", "属性名称"],
  value: ["value", "内容", "属性值"],
};
function record(
  kind: SupplementKind,
  value: unknown,
  declaredAsin: string | null,
  part: string,
  row: number,
  sourceFields: SupplementRecord["sourceFields"] = []
): SupplementRecord {
  const body = {
    kind,
    value,
    declaredAsin,
    locator: { part, row },
    sourceFields,
  };
  return SupplementRecordSchema.parse({
    ...body,
    recordId: supplementHash(body),
  });
}
function tableRecords(kind: SupplementKind, sheets: SupplementSheet[]) {
  const records: SupplementRecord[] = [],
    excluded: SupplementPreview["coverage"]["excluded"] = [];
  let totalRows = 0;
  for (const sheet of sheets) {
    if (!sheet.rows.length) supplementFail("TABLE_EMPTY");
    const headers = sheet.rows[0];
    if (headers.some(item => typeof item !== "string"))
      supplementFail("HEADER_INVALID");
    const mapping = new Map<string, number>();
    for (const [field, names] of Object.entries(aliases)) {
      const found = headers.flatMap((item, i) =>
        names.includes(key(String(item))) ? [i] : []
      );
      if (found.length > 1) supplementFail("HEADER_AMBIGUOUS");
      if (found.length) mapping.set(field, found[0]);
    }
    const required =
      kind === "reviews"
        ? ["body"]
        : kind === "questions"
          ? ["question"]
          : ["name", "value"];
    if (required.some(field => !mapping.has(field)))
      supplementFail("HEADER_MISSING");
    for (let i = 1; i < sheet.rows.length; i++) {
      if (++totalRows > LISTING_SUPPLEMENT_LIMITS.records)
        supplementFail("RECORD_LIMIT");
      const row = sheet.rows[i],
        locator = { part: sheet.name, row: i + 1 };
      if (row.length > headers.length) supplementFail("HEADER_INVALID");
      if (
        row.every(
          item => item === null || (typeof item === "string" && !item.trim())
        )
      ) {
        excluded.push({ locator, reason: "blank" });
        continue;
      }
      const get = (field: string): unknown =>
        mapping.has(field) ? (row[mapping.get(field)!] ?? null) : null;
      const sourceFields = headers.map((header, column) => ({
        column: column + 1,
        header: String(header),
        value: row[column] ?? null,
      }));
      if (
        required.some(
          field => get(field) !== null && typeof get(field) !== "string"
        )
      )
        supplementFail("CELL_TYPE_INVALID");
      if (!optional(get(required[0]))) {
        excluded.push({ locator, reason: "empty_required_field" });
        continue;
      }
      const declaredAsin = asin(get("asin"));
      if (kind === "reviews") {
        const rawRating = get("rating"),
          rating =
            rawRating === null || rawRating === ""
              ? null
              : typeof rawRating === "number"
                ? rawRating
                : typeof rawRating === "string" &&
                    /^\d(?:\.\d+)?$/u.test(rawRating)
                  ? Number(rawRating)
                  : supplementFail("RATING_INVALID");
        const vp = get("verifiedPurchase"),
          verifiedPurchase =
            vp === null || vp === ""
              ? null
              : typeof vp === "boolean"
                ? vp
                : ["true", "1", "yes", "是"].includes(String(vp).toLowerCase())
                  ? true
                  : ["false", "0", "no", "否"].includes(
                        String(vp).toLowerCase()
                      )
                    ? false
                    : supplementFail("VERIFIED_PURCHASE_INVALID");
        records.push(
          record(
            kind,
            {
              body: optional(get("body")),
              title: optional(get("title")),
              rating,
              date: optional(get("date")),
              author: optional(get("author")),
              variant: optional(get("variant")),
              sourceReviewId: optional(get("sourceReviewId")),
              verifiedPurchase,
            },
            declaredAsin,
            sheet.name,
            i + 1,
            sourceFields
          )
        );
      } else if (kind === "questions") {
        const type = optional(get("type"));
        if (type && !["alexa", "follow_up"].includes(type))
          supplementFail("QUESTION_TYPE_INVALID");
        if (row.some(value => value === "翻译"))
          supplementFail("QUESTION_TRANSLATION_AMBIGUOUS");
        records.push(
          record(
            kind,
            {
              question: optional(get("question")),
              questionCn: optional(get("questionCn")),
              answer: optional(get("answer")),
              answerCn: optional(get("answerCn")),
              parentQuestion: optional(get("parentQuestion")),
              type: type ?? "alexa",
            },
            declaredAsin,
            sheet.name,
            i + 1,
            sourceFields
          )
        );
      } else
        records.push(
          record(
            kind,
            {
              name: optional(get("name")),
              value: normalize(String(get("value") ?? "")),
            },
            declaredAsin,
            sheet.name,
            i + 1,
            sourceFields
          )
        );
    }
  }
  return { records, totalRows, excluded };
}
function clipboardReviews(text: string, html: string) {
  const records: SupplementRecord[] = [];
  let declaredAsin: string | null = null;
  if (html.trim()) {
    const $ = load(html, { xmlMode: false });
    const declared = $("#ASIN,input[name='ASIN']")
      .map((_i, node) => $(node).attr("value") ?? "")
      .get()
      .filter(Boolean);
    if (new Set(declared).size > 1) supplementFail("ASIN_AMBIGUOUS");
    declaredAsin = asin(declared[0] ?? null);
    $(
      "script,style,iframe,template,noscript,[aria-hidden='true'],.a-hidden"
    ).remove();
    const blocks = $("[data-hook='review']");
    if (blocks.length > 20) supplementFail("CLIPBOARD_REVIEW_LIMIT");
    blocks.each((i, node) => {
      const block = $(node),
        ratingText = block
          .find(
            "[data-hook='review-star-rating'],[data-hook='cmps-review-star-rating']"
          )
          .first()
          .text(),
        match = /^\s*([0-5](?:\.\d+)?)\s+(?:out of 5|颗星|满分)/u.exec(
          ratingText
        );
      const body = optional(
        block.find("[data-hook='review-body']").first().text()
      );
      if (!body) supplementFail("REVIEW_BODY_MISSING");
      records.push(
        record(
          "reviews",
          {
            body,
            title: optional(
              block.find("[data-hook='review-title']").first().text()
            ),
            rating: match ? Number(match[1]) : null,
            date: optional(
              block.find("[data-hook='review-date']").first().text()
            ),
            author: optional(block.find(".a-profile-name").first().text()),
            verifiedPurchase: block.find("[data-hook='avp-badge']").length
              ? true
              : null,
            variant: optional(
              block.find("[data-hook='format-strip']").first().text()
            ),
            sourceReviewId: optional(block.attr("id")),
          },
          declaredAsin,
          "clipboard-html",
          i + 1
        )
      );
    });
  }
  if (!records.length) {
    const matches = [
      ...text.matchAll(/([0-5](?:\.\d+)?)\s+out of\s+5\s+stars\b/giu),
    ];
    if (!matches.length || matches.length > 20)
      supplementFail("CLIPBOARD_REVIEW_FORMAT");
    matches.forEach((match, i) => {
      const lines = text
        .slice(
          match.index! + match[0].length,
          matches[i + 1]?.index ?? text.length
        )
        .replace(/\r\n?/gu, "\n")
        .split("\n");
      const dateIndex = lines.findIndex(line =>
        /^Reviewed in .+ on .+/iu.test(line.trim())
      );
      if (dateIndex < 0) supplementFail("REVIEW_DATE_MISSING");
      const tail = lines.slice(dateIndex + 1),
        body: string[] = [];
      let vp: boolean | null = null;
      for (const line of tail) {
        if (
          /^(Helpful|Report|Report Review|Translate review to English)$/iu.test(
            line.trim()
          )
        )
          break;
        if (/^Verified Purchase$/iu.test(line.trim())) {
          vp = true;
          continue;
        }
        body.push(line);
      }
      if (!body.join("\n").trim()) supplementFail("REVIEW_BODY_MISSING");
      records.push(
        record(
          "reviews",
          {
            body: normalize(body.join("\n")),
            title: optional(lines.slice(0, dateIndex).join("\n")),
            rating: Number(match[1]),
            date: normalize(lines[dateIndex]),
            author: null,
            verifiedPurchase: vp,
            variant: null,
            sourceReviewId: null,
          },
          declaredAsin,
          "clipboard-text",
          i + 1
        )
      );
    });
  }
  return { records, totalRows: records.length, excluded: [] };
}
function parseJson(kind: SupplementKind, text: string) {
  const values: unknown = JSON.parse(text);
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > LISTING_SUPPLEMENT_LIMITS.records
  )
    supplementFail("JSON_RECORDS_INVALID");
  const rows = values.map((value, i) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      supplementFail("JSON_RECORD_INVALID");
    const parsed = z
      .object({
        declaredAsin: z.string().nullable().optional(),
        value: z.unknown(),
      })
      .strict()
      .parse(value);
    return record(kind, parsed.value, asin(parsed.declaredAsin), "JSON", i + 1);
  });
  return { records: rows, totalRows: rows.length, excluded: [] };
}
export function buildSupplementPreview(
  identity: SupplementIdentity,
  scope: SupplementScope,
  kind: SupplementKind,
  original: SupplementOriginalInput,
  targets: SupplementTarget[]
): { bytes: Buffer; preview: SupplementPreview } {
  const decoded = decodeSupplementOriginal(original);
  let result: ReturnType<typeof tableRecords>,
    reasonCode: string | null = null;
  try {
    if (original.originalType === "clipboard")
      result =
        kind === "reviews"
          ? clipboardReviews(original.text, original.html)
          : parseJson(kind, original.text);
    else if (
      /\.json$/iu.test(original.fileName) &&
      original.contentType === "application/json"
    )
      result = parseJson(
        kind,
        new TextDecoder("utf-8", { fatal: true }).decode(decoded.bytes)
      );
    else {
      const expectedMime = /\.csv$/iu.test(original.fileName)
        ? "text/csv"
        : /\.xlsx$/iu.test(original.fileName)
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : null;
      if (expectedMime !== original.contentType)
        supplementFail("FORMAT_UNSUPPORTED");
      result = tableRecords(
        kind,
        readSupplementSheets(decoded.bytes, original.fileName)
      );
    }
    if (!result.records.length) supplementFail("NO_RECORDS");
  } catch (error) {
    reasonCode =
      error instanceof SupplementSourceError
        ? error.code
        : error instanceof SupplementTabularError
          ? "TABLE_INVALID"
          : "FORMAT_INVALID";
    result = { records: [], totalRows: 0, excluded: [] };
  }
  const body = {
    identity,
    scope,
    kind,
    original: decoded.metadata,
    parserVersion: LISTING_SUPPLEMENT_PARSER,
    status: reasonCode ? ("failed" as const) : ("ready" as const),
    reasonCode,
    records: result.records,
    coverage: {
      scope: "complete_supplied_original_not_market_total" as const,
      totalRows: reasonCode ? null : result.totalRows,
      acceptedRows: result.records.length,
      excluded: result.excluded,
      normalization: "LF_then_trim_no_internal_whitespace_collapse" as const,
    },
    targets,
  };
  try {
    return {
      bytes: decoded.bytes,
      preview: SupplementPreviewSchema.parse({
        ...body,
        previewHash: supplementHash(body),
      }),
    };
  } catch {
    // Expanded normalization may exceed its own complete byte/node budget even
    // when the original fits 20MiB. Archive that exact original as a failure;
    // never publish the first rows or pretend the accepted set was complete.
    const failed = {
      ...body,
      status: "failed" as const,
      reasonCode: "PREVIEW_BUDGET",
      records: [],
      coverage: {
        ...body.coverage,
        totalRows: null,
        acceptedRows: 0,
        excluded: [],
      },
    };
    return {
      bytes: decoded.bytes,
      preview: SupplementPreviewSchema.parse({
        ...failed,
        previewHash: supplementHash(failed),
      }),
    };
  }
}
