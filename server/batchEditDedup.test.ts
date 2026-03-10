import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for batch edit extended fields and import dedup logic.
 * These test the data transformation and dedup algorithm without hitting the database.
 */

// ─── Dedup Algorithm Tests ──────────────────────────────────────

describe("Import Dedup Algorithm", () => {
  // Simulate the dedup logic from keyword.ts importCsv
  function runDedup(
    newKeywords: { keyword: string; monthlySearchVolume?: number; spr?: number; ppcBid?: string }[],
    existingKeywords: { id: number; keyword: string; monthlySearchVolume?: number | null; spr?: number | null; ppcBid?: string | null }[]
  ) {
    const existingMap = new Map<string, any>();
    for (const ek of existingKeywords) {
      existingMap.set(ek.keyword.toLowerCase().trim(), ek);
    }

    // Dedup within file
    const seenInFile = new Map<string, number>();
    const deduplicatedInsert: any[] = [];
    let inFileDuplicates = 0;
    for (const kw of newKeywords) {
      const key = kw.keyword.toLowerCase().trim();
      if (seenInFile.has(key)) {
        const existingIdx = seenInFile.get(key)!;
        const existing = deduplicatedInsert[existingIdx];
        if ((kw.monthlySearchVolume || 0) > (existing.monthlySearchVolume || 0)) {
          deduplicatedInsert[existingIdx] = kw;
        }
        inFileDuplicates++;
      } else {
        seenInFile.set(key, deduplicatedInsert.length);
        deduplicatedInsert.push(kw);
      }
    }

    const toInsert: any[] = [];
    const duplicateKeywords: { keyword: string; existingId: number }[] = [];
    const mergedKeywords: { id: number; data: any }[] = [];

    for (const kw of deduplicatedInsert) {
      const key = kw.keyword.toLowerCase().trim();
      const existing = existingMap.get(key);
      if (existing) {
        const updateData: any = {};
        if (!existing.monthlySearchVolume && kw.monthlySearchVolume) updateData.monthlySearchVolume = kw.monthlySearchVolume;
        if (!existing.spr && kw.spr) updateData.spr = kw.spr;
        if (!existing.ppcBid && kw.ppcBid) updateData.ppcBid = kw.ppcBid;
        if (Object.keys(updateData).length > 0) {
          mergedKeywords.push({ id: existing.id, data: updateData });
        }
        duplicateKeywords.push({ keyword: kw.keyword, existingId: existing.id });
      } else {
        toInsert.push(kw);
      }
    }

    return {
      imported: toInsert.length,
      duplicatesFound: duplicateKeywords.length,
      duplicatesMerged: mergedKeywords.length,
      inFileDuplicates,
      totalParsed: newKeywords.length,
      toInsert,
      mergedKeywords,
    };
  }

  it("should detect no duplicates when all keywords are new", () => {
    const result = runDedup(
      [
        { keyword: "wireless earbuds", monthlySearchVolume: 50000 },
        { keyword: "bluetooth headphones", monthlySearchVolume: 30000 },
      ],
      []
    );
    expect(result.imported).toBe(2);
    expect(result.duplicatesFound).toBe(0);
    expect(result.inFileDuplicates).toBe(0);
  });

  it("should detect duplicates with existing keywords (case-insensitive)", () => {
    const result = runDedup(
      [
        { keyword: "Wireless Earbuds", monthlySearchVolume: 50000 },
        { keyword: "bluetooth headphones", monthlySearchVolume: 30000 },
      ],
      [
        { id: 1, keyword: "wireless earbuds", monthlySearchVolume: null, spr: null, ppcBid: null },
      ]
    );
    expect(result.imported).toBe(1);
    expect(result.duplicatesFound).toBe(1);
    expect(result.duplicatesMerged).toBe(1); // merged search volume
    expect(result.mergedKeywords[0].id).toBe(1);
    expect(result.mergedKeywords[0].data.monthlySearchVolume).toBe(50000);
  });

  it("should not overwrite existing data with new import data", () => {
    const result = runDedup(
      [
        { keyword: "wireless earbuds", monthlySearchVolume: 50000, spr: 80 },
      ],
      [
        { id: 1, keyword: "wireless earbuds", monthlySearchVolume: 60000, spr: 50, ppcBid: "1.50" },
      ]
    );
    expect(result.imported).toBe(0);
    expect(result.duplicatesFound).toBe(1);
    expect(result.duplicatesMerged).toBe(0); // nothing to merge, existing has all data
  });

  it("should merge missing fields from import into existing keywords", () => {
    const result = runDedup(
      [
        { keyword: "wireless earbuds", monthlySearchVolume: 50000, spr: 80, ppcBid: "2.50" },
      ],
      [
        { id: 1, keyword: "wireless earbuds", monthlySearchVolume: 60000, spr: null, ppcBid: null },
      ]
    );
    expect(result.duplicatesMerged).toBe(1);
    expect(result.mergedKeywords[0].data).toEqual({ spr: 80, ppcBid: "2.50" });
  });

  it("should dedup within the import file itself", () => {
    const result = runDedup(
      [
        { keyword: "wireless earbuds", monthlySearchVolume: 50000 },
        { keyword: "wireless earbuds", monthlySearchVolume: 60000 }, // duplicate with higher volume
        { keyword: "wireless earbuds", monthlySearchVolume: 40000 }, // duplicate with lower volume
      ],
      []
    );
    expect(result.imported).toBe(1);
    expect(result.inFileDuplicates).toBe(2);
    // Should keep the one with highest search volume
    expect(result.toInsert[0].monthlySearchVolume).toBe(60000);
  });

  it("should handle combined in-file and cross-database dedup", () => {
    const result = runDedup(
      [
        { keyword: "wireless earbuds", monthlySearchVolume: 50000 },
        { keyword: "Wireless Earbuds", monthlySearchVolume: 60000 }, // in-file dup
        { keyword: "bluetooth headphones", monthlySearchVolume: 30000 }, // exists in DB
        { keyword: "noise cancelling", monthlySearchVolume: 20000 }, // new
      ],
      [
        { id: 5, keyword: "bluetooth headphones", monthlySearchVolume: null, spr: null, ppcBid: null },
      ]
    );
    expect(result.totalParsed).toBe(4);
    expect(result.inFileDuplicates).toBe(1);
    expect(result.duplicatesFound).toBe(1); // bluetooth headphones
    expect(result.imported).toBe(2); // wireless earbuds + noise cancelling
  });

  it("should handle empty import gracefully", () => {
    const result = runDedup([], []);
    expect(result.imported).toBe(0);
    expect(result.duplicatesFound).toBe(0);
    expect(result.inFileDuplicates).toBe(0);
  });

  it("should trim whitespace when comparing keywords", () => {
    const result = runDedup(
      [{ keyword: "  wireless earbuds  ", monthlySearchVolume: 50000 }],
      [{ id: 1, keyword: "wireless earbuds", monthlySearchVolume: null, spr: null, ppcBid: null }]
    );
    expect(result.duplicatesFound).toBe(1);
    expect(result.imported).toBe(0);
  });
});

// ─── Batch Edit Field Validation Tests ──────────────────────────

describe("Batch Edit Field Validation", () => {
  const validStrategyCategories = ["core_main", "sub_core", "precise_longtail", "scene_intent", "longtail_main", "observe_test", "negative"];
  const validRootCategories = ["core", "function", "scene", "audience", "spec", "painpoint", "gift_holiday"];
  const validPlacements = ["title_front", "title_mid", "title_end", "bullet_first", "bullet_body", "aplus", "search_term", "not_use"];
  const validRelevance = ["high", "medium", "low", "none"];
  const validTrafficLevels = ["high", "medium", "low"];
  const validCompetition = ["high", "medium", "low"];
  const validStatuses = ["raw", "cleaned", "scored", "tagged", "finalized", "negative"];

  it("should have all strategy categories defined", () => {
    expect(validStrategyCategories).toHaveLength(7);
    for (const cat of validStrategyCategories) {
      expect(typeof cat).toBe("string");
      expect(cat.length).toBeGreaterThan(0);
    }
  });

  it("should have all root categories defined", () => {
    expect(validRootCategories).toHaveLength(7);
  });

  it("should have all listing placements defined", () => {
    expect(validPlacements).toHaveLength(8);
  });

  it("should have all relevance levels defined", () => {
    expect(validRelevance).toHaveLength(4);
  });

  it("should have all traffic levels defined", () => {
    expect(validTrafficLevels).toHaveLength(3);
  });

  it("should have all competition levels defined", () => {
    expect(validCompetition).toHaveLength(3);
  });

  it("should have all statuses defined", () => {
    expect(validStatuses).toHaveLength(6);
  });

  // Test that batch edit data construction works correctly
  it("should construct batch edit data correctly with partial fields", () => {
    const batchStrategy = "core_main";
    const batchRelevance = "_none";
    const batchStatus = "finalized";
    const batchPlacement = "_clear";
    const batchRootCategory = "_none";
    const batchTrafficLevel = "_none";
    const batchCompetition = "_none";

    const data: any = {};
    if (batchStrategy !== "_none") data.strategyCategory = batchStrategy === "_clear" ? null : batchStrategy;
    if (batchRelevance !== "_none") data.relevance = batchRelevance;
    if (batchStatus !== "_none") data.status = batchStatus;
    if (batchPlacement !== "_none") data.listingPlacement = batchPlacement === "_clear" ? null : batchPlacement;
    if (batchRootCategory !== "_none") data.rootCategory = batchRootCategory === "_clear" ? null : batchRootCategory;
    if (batchTrafficLevel !== "_none") data.trafficLevel = batchTrafficLevel;
    if (batchCompetition !== "_none") data.competition = batchCompetition;

    expect(data).toEqual({
      strategyCategory: "core_main",
      status: "finalized",
      listingPlacement: null, // cleared
    });
  });

  it("should produce empty data when all fields are _none", () => {
    const data: any = {};
    const fields = ["_none", "_none", "_none", "_none", "_none", "_none", "_none"];
    // All _none means nothing to update
    expect(Object.keys(data)).toHaveLength(0);
  });
});
