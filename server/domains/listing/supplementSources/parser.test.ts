import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildSupplementPreview, decodeSupplementOriginal } from "./parser";
import {
  SupplementOriginalInputSchema,
  supplementCanonical,
  supplementHash,
  LISTING_SUPPLEMENT_LIMITS,
  type SupplementOriginalInput,
  type SupplementKind,
} from "../../../../shared/listingSupplementSources";
const identity = { userId: 3, workspaceId: 7 },
  scope = { expectedWorkspaceId: 7, projectId: 11 },
  target = {
    type: "competitor" as const,
    analysisId: 21,
    asin: "B000000021",
    revisionHash: "a".repeat(64),
  };
const file = (
  text: string,
  fileName = "reviews.csv"
): SupplementOriginalInput => ({
  originalType: "file",
  fileName,
  contentType: "text/csv",
  base64: Buffer.from(text).toString("base64"),
});
const parse = (kind: SupplementKind, original: SupplementOriginalInput) =>
  buildSupplementPreview(
    identity,
    scope,
    kind,
    original,
    kind === "attributes"
      ? [{ type: "product", projectId: 11, revisionHash: "b".repeat(64) }]
      : [target]
  ).preview;
describe("typed complete supplemental preview without model or external parsing", () => {
  it("retains exact source cells, row gaps and unrecognized columns without inventing interpretation", () => {
    const result = parse(
      "reviews",
      file(
        'asin,body,note\nB000000021,"  First  body  ",Original unknown column\n,,\nB000000021,,Missing body\nB000000021,Last body,Kept\n'
      )
    );
    expect(result.status).toBe("ready");
    expect(result.coverage).toMatchObject({
      totalRows: 4,
      acceptedRows: 2,
      excluded: [{ reason: "blank" }, { reason: "empty_required_field" }],
    });
    expect(result.records[0]).toMatchObject({
      value: { body: "First  body" },
      sourceFields: [
        { value: "B000000021" },
        { value: "  First  body  " },
        { value: "Original unknown column" },
      ],
    });
    expect(result.records[1].locator.row).toBe(5);
  });
  it("does not assign missing ASIN from file name or an answer's brand", () => {
    const result = parse(
      "reviews",
      file("body\nNo ASIN supplied\n", "B000000021-reviews.csv")
    );
    expect(result.records[0].declaredAsin).toBeNull();
    expect(result.targets).toEqual([target]);
  });
  it("different ASIN declarations remain explicit and cannot silently collapse", () => {
    const result = parse(
      "reviews",
      file("asin,body\nB000000021,One\nB000000022,Two\n")
    );
    expect(result.records.map(row => row.declaredAsin)).toEqual([
      "B000000021",
      "B000000022",
    ]);
  });
  it.each([
    "asin,body\nnot-an-asin,Text\n",
    "body,reviewcontent\nOne,Two\n",
    "body,rating\nBody,excellent\n",
    "body,verified\nBody,maybe\n",
  ])("rejects ambiguous/invalid typed values: %s", text => {
    expect(parse("reviews", file(text))).toMatchObject({
      status: "failed",
      records: [],
      coverage: { totalRows: null },
    });
  });
  it("strict CSV does not truncate over 20000 records or malformed quoted tails", () => {
    expect(
      parse("reviews", file("body\n" + "A\n".repeat(20_001)))
    ).toMatchObject({
      status: "failed",
      reasonCode: "TABLE_INVALID",
      records: [],
    });
    expect(parse("reviews", file('body\n"unclosed\n'))).toMatchObject({
      status: "failed",
      reasonCode: "TABLE_INVALID",
    });
  });
  it("reads all admitted XLSX worksheets and refuses formula caches", () => {
    const book = XLSX.utils.book_new();
    for (const [sheet, body] of [
      ["First", "One"],
      ["Second", "Two"],
    ])
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["asin", "body"],
          ["B000000021", body],
        ]),
        sheet
      );
    const source: SupplementOriginalInput = {
      originalType: "file",
      fileName: "multi.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: XLSX.write(book, { type: "base64", bookType: "xlsx" }),
    };
    expect(
      parse("reviews", source).records.map(row => row.locator.part)
    ).toEqual(["First", "Second"]);
    book.Sheets.First.B2 = {
      t: "s",
      v: "Cached invented body",
      f: '"Cached invented body"',
    };
    expect(
      parse("reviews", {
        ...source,
        base64: XLSX.write(book, { type: "base64", bookType: "xlsx" }),
      })
    ).toMatchObject({ status: "failed", reasonCode: "TABLE_INVALID" });
  });
  it("legacy XLS is honestly unsupported here but its original can be archived as failed", () => {
    const source: SupplementOriginalInput = {
      originalType: "file",
      fileName: "legacy.xls",
      contentType: "application/vnd.ms-excel",
      base64: Buffer.from("Unparsed original").toString("base64"),
    };
    expect(parse("reviews", source)).toMatchObject({
      status: "failed",
      reasonCode: "FORMAT_UNSUPPORTED",
      original: { byteSize: 17, originalType: "file" },
    });
  });
  it("structured question translation/follow-up fields retain explicit parentage; ambiguous export rows fail", () => {
    const result = parse(
      "questions",
      file(
        "asin,question,questioncn,answer,answercn,parentquestion,type\nB000000021,Follow?,追问？,Answer,答案,Main?,follow_up\n"
      )
    );
    expect(result.records[0]).toMatchObject({
      kind: "questions",
      value: {
        type: "follow_up",
        questionCn: "追问？",
        answerCn: "答案",
        parentQuestion: "Main?",
      },
    });
    expect(
      parse("questions", file("question,type\n翻译,翻译\n"))
    ).toMatchObject({ status: "failed" });
  });
  it("attributes use explicit name/value, with no implicit confirmation or generated analysis", () => {
    const result = parse(
      "attributes",
      file("属性,内容\nMaterial,User supplied\nWeight,\n")
    );
    expect(result.records).toHaveLength(2);
    expect(result.records[1]).toMatchObject({
      kind: "attributes",
      value: { name: "Weight", value: "" },
    });
    expect(result.targets[0].type).toBe("product");
  });
  it("clipboard HTML is inert and complete text/html bytes remain unchanged", () => {
    const source: SupplementOriginalInput = {
      originalType: "clipboard",
      text: "Original plain representation\r\n",
      html: '<input id="ASIN" value="B000000021"><script>Do not execute</script><div data-hook="review" id="review-1"><span data-hook="review-body">Exact  inner  spaces</span><span data-hook="review-star-rating">4.0 out of 5 stars</span></div>',
    };
    const result = parse("reviews", source);
    expect(result.records[0]).toMatchObject({
      declaredAsin: "B000000021",
      value: { body: "Exact  inner  spaces", rating: 4 },
    });
    const raw = decodeSupplementOriginal(source);
    expect(JSON.parse(raw.bytes.toString("utf8"))).toEqual({
      version: 1,
      text: source.text,
      html: source.html,
    });
    expect(raw.metadata.contentType).toBe(
      "application/vnd.listing.clipboard+json"
    );
  });
  it("clipboard budget counts UTF-8 bytes, and malformed/surplus base64 is rejected before any preparation", () => {
    expect(
      SupplementOriginalInputSchema.safeParse({
        originalType: "clipboard",
        text: "汉".repeat(50_001),
        html: "",
      }).success
    ).toBe(false);
    expect(() =>
      decodeSupplementOriginal({ ...file("x"), base64: "eA==junk" })
    ).toThrow();
    expect(() =>
      decodeSupplementOriginal({ ...file("x"), base64: "eB==" })
    ).toThrow();
    expect(() =>
      decodeSupplementOriginal(
        file("x".repeat(LISTING_SUPPLEMENT_LIMITS.fileBytes + 1))
      )
    ).toThrow();
  });
  it("canonical hash refuses accessors, sparse arrays, nonfinite numbers and oversized complete values", () => {
    expect(() => supplementCanonical([, "a"])).toThrow();
    expect(() => supplementCanonical({ x: Infinity })).toThrow();
    expect(() =>
      supplementCanonical({
        get x() {
          throw new Error("must not execute");
        },
      })
    ).toThrow();
    expect(() => supplementCanonical({ value: "x".repeat(100) }, 20)).toThrow();
    expect(supplementHash({ b: 1, a: 2 })).toBe(supplementHash({ a: 2, b: 1 }));
  });
  it("expanded preview budget failure retains the original and never emits a truncated accepted corpus", () => {
    const headers = [
        "body",
        ...Array.from(
          { length: 31 },
          (_, i) => `unmapped_${i}_${"h".repeat(2000)}`
        ),
      ],
      line = ["Original body", ...Array.from({ length: 31 }, () => "x")].join(
        ","
      );
    const result = parse(
      "reviews",
      file(headers.join(",") + "\n" + (line + "\n").repeat(600))
    );
    expect(result).toMatchObject({
      status: "failed",
      reasonCode: "PREVIEW_BUDGET",
      records: [],
      coverage: { totalRows: null },
    });
    expect(result.original.byteSize).toBeGreaterThan(60_000);
  });
});
