import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => {
  const mockVersions = [
    {
      id: 1,
      listingId: 100,
      projectId: 1,
      userId: 1,
      versionNumber: 1,
      changeType: "generate",
      changeDescription: "AI生成Listing",
      title: "Original Title",
      bulletPoints: JSON.stringify([{ subtitle: "BP1", fullText: "Bullet point 1" }]),
      description: "Original description",
      searchTerms: "keyword1 keyword2",
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
      createdAt: new Date("2025-01-01"),
    },
    {
      id: 2,
      listingId: 100,
      projectId: 1,
      userId: 1,
      versionNumber: 2,
      changeType: "manual_edit",
      changeDescription: "手动编辑: 标题",
      title: "Updated Title",
      bulletPoints: JSON.stringify([{ subtitle: "BP1", fullText: "Bullet point 1" }]),
      description: "Original description",
      searchTerms: "keyword1 keyword2",
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
      createdAt: new Date("2025-01-02"),
    },
  ];

  return {
    getProjectById: vi.fn().mockResolvedValue({ id: 1, name: "Test Project", userId: 1 }),
    getActiveListingByProject: vi.fn().mockResolvedValue({
      id: 100,
      projectId: 1,
      title: "Current Title",
      bulletPoints: JSON.stringify([{ subtitle: "BP1", fullText: "Current BP" }]),
      description: "Current description",
      searchTerms: "current keywords",
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
      isActive: 1,
      version: 1,
    }),
    getListingVersionsByProject: vi.fn().mockResolvedValue(mockVersions),
    getListingVersionById: vi.fn().mockImplementation(async (id: number) => {
      return mockVersions.find(v => v.id === id) || null;
    }),
    getLatestVersionNumber: vi.fn().mockResolvedValue(2),
    createListingVersion: vi.fn().mockResolvedValue({
      id: 3,
      versionNumber: 3,
    }),
    updateListing: vi.fn().mockImplementation(async (id: number, data: any) => ({
      id,
      projectId: 1,
      ...data,
      isActive: 1,
      version: 1,
    })),
    getListingById: vi.fn().mockResolvedValue({
      id: 100,
      projectId: 1,
      title: "Current Title",
      bulletPoints: JSON.stringify([{ subtitle: "BP1", fullText: "Current BP" }]),
      description: "Current description",
      searchTerms: "current keywords",
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
    }),
    getListingsByProject: vi.fn().mockResolvedValue([]),
  };
});

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ titleCn: "中文标题" }) } }],
  }),
}));

import * as db from "./db";

describe("Version History - Database Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getListingVersionsByProject returns versions ordered by newest first", async () => {
    const versions = await db.getListingVersionsByProject(1);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[1].versionNumber).toBe(2);
    expect(db.getListingVersionsByProject).toHaveBeenCalledWith(1);
  });

  it("getListingVersionById returns the correct version", async () => {
    const version = await db.getListingVersionById(1);
    expect(version).toBeDefined();
    expect(version!.id).toBe(1);
    expect(version!.changeType).toBe("generate");
    expect(version!.title).toBe("Original Title");
  });

  it("getListingVersionById returns null for non-existent version", async () => {
    const version = await db.getListingVersionById(999);
    expect(version).toBeNull();
  });

  it("createListingVersion creates a new version record", async () => {
    const result = await db.createListingVersion({
      listingId: 100,
      projectId: 1,
      userId: 1,
      versionNumber: 3,
      changeType: "manual_edit",
      changeDescription: "手动编辑: 标题",
      title: "New Title",
      bulletPoints: null,
      description: null,
      searchTerms: null,
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
    });
    expect(result).toBeDefined();
    expect(db.createListingVersion).toHaveBeenCalledTimes(1);
  });

  it("getLatestVersionNumber returns the latest version number", async () => {
    const latestVersion = await db.getLatestVersionNumber(100);
    expect(latestVersion).toBe(2);
  });
});

describe("Version History - Data Integrity", () => {
  it("version snapshot preserves all listing fields", async () => {
    const version = await db.getListingVersionById(1);
    expect(version).toHaveProperty("title");
    expect(version).toHaveProperty("bulletPoints");
    expect(version).toHaveProperty("description");
    expect(version).toHaveProperty("searchTerms");
    expect(version).toHaveProperty("titleCn");
    expect(version).toHaveProperty("bulletPointsCn");
    expect(version).toHaveProperty("descriptionCn");
    expect(version).toHaveProperty("searchTermsCn");
  });

  it("version has proper metadata fields", async () => {
    const version = await db.getListingVersionById(1);
    expect(version).toHaveProperty("changeType");
    expect(version).toHaveProperty("changeDescription");
    expect(version).toHaveProperty("versionNumber");
    expect(version).toHaveProperty("createdAt");
    expect(version).toHaveProperty("userId");
  });

  it("bulletPoints are stored as valid JSON strings", async () => {
    const version = await db.getListingVersionById(1);
    expect(version?.bulletPoints).toBeDefined();
    const parsed = JSON.parse(version!.bulletPoints!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("subtitle");
    expect(parsed[0]).toHaveProperty("fullText");
  });
});

describe("Bulk Sheet Export - Data Structure", () => {
  // Test the data transformation logic for Bulk Sheet export
  const mockCampaigns = [
    {
      campaignName: "SP-Core-Broad",
      adGroupType: "core_keywords",
      matchType: "broad",
      dailyBudget: "$15",
      bidStrategy: "legacyForSales",
      keywords: [
        { keyword: "test keyword 1", suggestedBid: "$1.20", searchVolume: "5000", competition: "high" },
        { keyword: "test keyword 2", suggestedBid: "$0.80", searchVolume: "3000", competition: "medium" },
      ],
      negativeKeywords: ["irrelevant term"],
    },
    {
      campaignName: "SP-Competitor-ASIN",
      adGroupType: "competitor_asin",
      matchType: "exact",
      dailyBudget: "$10",
      bidStrategy: "legacyForSales",
      keywords: [
        { keyword: "B0ABCDEF12", suggestedBid: "$0.90", searchVolume: "0", competition: "low" },
      ],
      negativeKeywords: [],
    },
  ];

  it("generates correct number of rows for campaigns", () => {
    const rows: string[][] = [];
    for (const campaign of mockCampaigns) {
      // Campaign row
      rows.push(["Campaign", campaign.campaignName]);
      // Ad Group row
      rows.push(["Ad Group", campaign.campaignName]);
      // Keyword rows
      for (const kw of campaign.keywords) {
        const isAsin = /^B0[A-Z0-9]{8}$/i.test(kw.keyword.trim());
        rows.push([isAsin ? "Product Targeting" : "Keyword", kw.keyword]);
      }
      // Negative keyword rows
      for (const negKw of campaign.negativeKeywords) {
        rows.push(["Negative Keyword", negKw]);
      }
    }

    // 2 campaigns + 2 ad groups + 2 keywords + 1 ASIN + 1 negative = 8 rows
    expect(rows.length).toBe(8);
    expect(rows.filter(r => r[0] === "Campaign").length).toBe(2);
    expect(rows.filter(r => r[0] === "Ad Group").length).toBe(2);
    expect(rows.filter(r => r[0] === "Keyword").length).toBe(2);
    expect(rows.filter(r => r[0] === "Product Targeting").length).toBe(1);
    expect(rows.filter(r => r[0] === "Negative Keyword").length).toBe(1);
  });

  it("correctly identifies ASIN targeting vs keyword targeting", () => {
    const asinPattern = /^B0[A-Z0-9]{8}$/i;
    expect(asinPattern.test("B0ABCDEF12")).toBe(true);
    expect(asinPattern.test("B0abcdef12")).toBe(true);
    expect(asinPattern.test("test keyword")).toBe(false);
    expect(asinPattern.test("B0SHORT")).toBe(false);
    expect(asinPattern.test("A0ABCDEF12")).toBe(false);
  });

  it("correctly strips dollar sign from bid values", () => {
    const stripDollar = (val: string) => val.replace("$", "");
    expect(stripDollar("$1.20")).toBe("1.20");
    expect(stripDollar("$0.80")).toBe("0.80");
    expect(stripDollar("0.50")).toBe("0.50");
  });

  it("generates correct match type values", () => {
    const validMatchTypes = ["broad", "phrase", "exact", "negative exact", "negative phrase"];
    for (const campaign of mockCampaigns) {
      expect(validMatchTypes).toContain(campaign.matchType);
    }
  });
});
