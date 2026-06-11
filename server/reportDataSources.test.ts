import { describe, expect, it, vi } from "vitest";

// Mock db module before importing router
vi.mock("./db", () => ({
  getProjectById: vi.fn().mockResolvedValue({
    id: 1,
    name: "Test Product",
    brand: "TestBrand",
    category: "Electronics",
    targetMarket: "US",
  }),
  getActiveListingByProject: vi.fn().mockResolvedValue({
    id: 1,
    projectId: 1,
    title: "Test Product Title",
    bulletPoints: JSON.stringify([
      { subtitle: "Feature 1", fullText: "Description of feature 1" },
    ]),
    description: "Test description",
    searchTerms: "test keyword",
    titleCn: "测试产品标题",
    bulletPointsCn: JSON.stringify([{ subtitle: "特点1", fullText: "特点1描述" }]),
    descriptionCn: "测试描述",
    searchTermsCn: "测试关键词",
    imageAdvice: null,
  }),
  getProjectFilesByProject: vi.fn().mockResolvedValue([
    {
      id: 1,
      fileType: "product_attributes",
      status: "completed",
      analysisResult: JSON.stringify({
        uniqueSellingPoints: ["Durable", "Lightweight"],
        coreSpecs: [{ attribute: "Weight", value: "100g" }],
        rufusFriendlyAttributes: ["Easy to use"],
        suggestedKeywordsFromAttributes: ["durable gadget"],
      }),
    },
  ]),
  getCompetitorAnalysesByProject: vi.fn().mockResolvedValue([
    {
      id: 1,
      asin: "B001TEST01",
      title: "Competitor Product 1",
      price: "29.99",
      rating: "4.5",
      reviewCount: 1200,
      bulletPoints: JSON.stringify(["Great quality", "Easy to use"]),
      keywords: JSON.stringify({ core: [{ keyword: "gadget" }, { keyword: "tool" }] }),
      reviewAnalysis: JSON.stringify({
        painPoints: [{ issue: "Battery life too short" }],
        delightPoints: [{ feature: "Compact design" }],
      }),
    },
    {
      id: 2,
      asin: "B002TEST02",
      title: "Competitor Product 2",
      price: "34.99",
      rating: "4.2",
      reviewCount: 800,
      bulletPoints: JSON.stringify(["Great quality", "Premium material"]),
      keywords: JSON.stringify({ core: [{ keyword: "premium gadget" }] }),
      reviewAnalysis: JSON.stringify({
        painPoints: [{ issue: "Too expensive" }],
        delightPoints: [{ feature: "Great packaging" }],
      }),
    },
  ]),
  getKeywordsByProject: vi.fn().mockResolvedValue([
    {
      id: 1,
      keyword: "wireless gadget",
      sceneTags: JSON.stringify(["outdoor use", "travel"]),
      intentTag: "purchase",
      strategyCategory: "core_main",
      listingPlacement: "title_front",
      rootCategory: "core",
    },
    {
      id: 2,
      keyword: "portable tool",
      sceneTags: JSON.stringify(["outdoor use", "camping"]),
      intentTag: "research",
      strategyCategory: "sub_core",
      listingPlacement: "bullet_first",
      rootCategory: "function",
    },
    {
      id: 3,
      keyword: "compact device",
      sceneTags: JSON.stringify(["travel"]),
      intentTag: "purchase",
      strategyCategory: "precise_longtail",
      listingPlacement: "backend",
      rootCategory: "scene",
    },
  ]),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createTestContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("Report data sources - uses real module data", () => {
  it("generates report HTML successfully", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toBeDefined();
    expect(result.html.length).toBeGreaterThan(500);
    expect(result.hasListing).toBe(true);
    expect(result.hasAnalysis).toBe(true);
  });

  it("includes Module 1 Rufus attributes from file analysis", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("Rufus 属性提取");
    expect(result.html).toContain("Durable");
    expect(result.html).toContain("Lightweight");
    expect(result.html).toContain("Easy to use");
  });

  it("includes Module 2 competitor data from competitor analyses table (not file)", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    // Should reference real competitor ASINs from the competitor analysis module
    expect(result.html).toContain("B001TEST01");
    expect(result.html).toContain("B002TEST02");
    expect(result.html).toContain("Competitor Product 1");
    expect(result.html).toContain("29.99");
    expect(result.html).toContain("基于竞品分析模块");
  });

  it("includes competitor review pain points and delight points", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("Battery life too short");
    expect(result.html).toContain("Compact design");
  });

  it("includes competitor parity selling points", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    // "Great quality" appears in both competitors' bulletPoints
    expect(result.html).toContain("great quality");
    expect(result.html).toContain("2 个竞品");
  });

  it("includes Module 3 COSMO scene data from keyword scene tags", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("基于关键词场景打标");
    expect(result.html).toContain("outdoor use");
    expect(result.html).toContain("travel");
    expect(result.html).toContain("camping");
  });

  it("includes Module 3 intent groups from keyword intent tags", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("purchase");
    expect(result.html).toContain("research");
  });

  it("includes Module 4 strategy matrix from keyword 3D strategy", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("3D策略矩阵");
    expect(result.html).toContain("核心主词");
    expect(result.html).toContain("wireless gadget");
    expect(result.html).toContain("次核心词");
    expect(result.html).toContain("portable tool");
  });

  it("includes Module 4 listing placement suggestions from keyword data", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("Listing关键词布局建议");
    expect(result.html).toContain("标题前段");
    expect(result.html).toContain("五点首行");
    expect(result.html).toContain("后台搜索词");
  });

  it("includes Module 4 root classification from keyword data", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("关键词词根分类");
    expect(result.html).toContain("核心词根");
    expect(result.html).toContain("功能词根");
    expect(result.html).toContain("场景词根");
  });

  it("includes listing bilingual content", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    expect(result.html).toContain("Test Product Title");
    expect(result.html).toContain("测试产品标题");
    expect(result.html).toContain("Feature 1");
    expect(result.html).toContain("特点1");
  });

  it("does NOT reference old file-based competitor_listings or search_term_report", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.report.generateReport({ projectId: 1 });

    // The old report used file-based data sources with these labels
    expect(result.html).not.toContain("未上传竞品Listing文本");
    expect(result.html).not.toContain("未上传ABA关键词数据");
  });
});
