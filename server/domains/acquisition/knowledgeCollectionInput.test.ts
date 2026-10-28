import { describe, expect, it } from "vitest";
import { parseKnowledgeAsins, KnowledgeCollectionInputSchema, collectionDisplayAsin, knowledgeCollectionRef, knowledgeCollectionVersion } from "../../../shared/knowledgeCollection";

describe("knowledge ASIN input", () => {
  it("keeps all pasted ASINs across Chinese separators, URLs and repeated input", () => {
    expect(parseKnowledgeAsins("b0fkn88mfl，B0G3WN7CL2；https://www.amazon.com/dp/B0FH1LZLD9?ref=test\nB0FKN88MFL")).toEqual({
      asins: ["B0FKN88MFL", "B0G3WN7CL2", "B0FH1LZLD9"], invalid: [], repeated: ["B0FKN88MFL"],
    });
  });
  it("rejects unsupported domains and malformed input without truncation", () => {
    expect(parseKnowledgeAsins("新B0FKN88MFL B0G3WN7CL2 https://amazon.com.evil.org/dp/B0FH1LZLD9 invalid").invalid).toHaveLength(2);
    expect(KnowledgeCollectionInputSchema.safeParse({ requestId: crypto.randomUUID(), asins: Array.from({ length: 11 }, (_, n) => `B${String(n).padStart(9, '0')}`) }).success).toBe(false);
  });
  it("maps version aliases to the real ASIN and deduplicates mixed pasted versions", () => {
    expect(parseKnowledgeAsins("新B0FH1LZLD9 新2b0fh1lzld9 B0FH1LZLD9")).toEqual({
      asins: ["B0FH1LZLD9"], repeated: ["B0FH1LZLD9"], invalid: [],
    });
    expect(parseKnowledgeAsins("其他B0FH1LZLD9 新2B0FH1LZLD9X").invalid).toHaveLength(2);
  });
  it("separates real ASINs from independent display versions", () => {
    const asin = "B0FH1LZLD9";
    expect([1,2,3].map(n => collectionDisplayAsin(asin, n))).toEqual([asin, `新${asin}`, `新2${asin}`]);
    expect(knowledgeCollectionVersion(knowledgeCollectionRef(asin, 3))).toBe(3);
    expect(knowledgeCollectionVersion(knowledgeCollectionRef(asin))).toBe(1);
  });
});
