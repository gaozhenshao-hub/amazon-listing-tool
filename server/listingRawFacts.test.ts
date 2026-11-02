import { describe, expect, it } from "vitest";
import { assertRawFactMatchesSource, parseRawAttributeFacts } from "./domains/listing/services/listingRawFacts";

describe("listing raw fact review candidates", () => {
  const raw = [
    "材质: 不锈钢",
    "功率：[如：1200W]",
    "容量: [ ]",
    "尺寸：20 x 30 cm",
    "SKU: ABC-123",
    "说明: https://example.com/item",
    "颜色：请填写后确认",
    "净重\t2.1 kg",
  ].join("\n");

  it("only suggests factual uploaded rows with provenance and no inferred examples", () => {
    const suggestions = parseRawAttributeFacts(raw);
    expect(suggestions.map(({ attributeKey, value, sourceLine }) => ({ attributeKey, value, sourceLine }))).toEqual([
      { attributeKey: "材质", value: "不锈钢", sourceLine: 1 },
      { attributeKey: "尺寸", value: "20 x 30 cm", sourceLine: 4 },
      { attributeKey: "净重", value: "2.1 kg", sourceLine: 8 },
    ]);
    suggestions.forEach((item) => assertRawFactMatchesSource(raw, item));
  });

  it("rejects stale line, fabricated value and moved source line", () => {
    const suggestion = parseRawAttributeFacts(raw)[0];
    expect(() => assertRawFactMatchesSource(raw.replace("不锈钢", "铁"), suggestion)).toThrow("原文已变化");
    expect(() => assertRawFactMatchesSource(raw, { ...suggestion, value: "铝" })).toThrow("不是可确认");
    expect(() => assertRawFactMatchesSource(raw, { ...suggestion, sourceLine: 2 })).toThrow("原文已变化");
  });

  it("does not turn sample footnotes into facts, while allowing separately observed identical values", () => {
    const candidates = parseRawAttributeFacts("规格: 1200W (example)\n功率：1200W");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ attributeKey: "功率", value: "1200W", sourceLine: 2 });
  });
});
