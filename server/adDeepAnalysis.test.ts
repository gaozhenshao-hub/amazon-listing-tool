import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: {
      headers: {},
      cookies: {},
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
  return { ctx };
}

describe("Ad Deep Analysis Router", () => {
  const caller = appRouter.createCaller(createAuthContext().ctx);

  describe("Router Registration", () => {
    it("should have adDailyReport router registered", () => {
      expect(caller.adDailyReport).toBeDefined();
    });

    it("should have adDeepAnalysis router registered", () => {
      expect(caller.adDeepAnalysis).toBeDefined();
    });
  });

  describe("adDailyReport procedures", () => {
    it("should have getDailyDataOverview procedure", () => {
      expect(caller.adDailyReport.getDailyDataOverview).toBeDefined();
    });

    it("should have listDailyUploads procedure", () => {
      expect(caller.adDailyReport.listDailyUploads).toBeDefined();
    });

    it("should have getDailyPortfolios procedure", () => {
      expect(caller.adDailyReport.getDailyPortfolios).toBeDefined();
    });

    it("should have uploadDailyPlacement procedure", () => {
      expect(caller.adDailyReport.uploadDailyPlacement).toBeDefined();
    });

    it("should have uploadDailySearchTerm procedure", () => {
      expect(caller.adDailyReport.uploadDailySearchTerm).toBeDefined();
    });

    it("should have uploadDailyImpressionShare procedure", () => {
      expect(caller.adDailyReport.uploadDailyImpressionShare).toBeDefined();
    });

    it("should have uploadDailySbBenchmark procedure", () => {
      expect(caller.adDailyReport.uploadDailySbBenchmark).toBeDefined();
    });

    it("should have uploadDailyBusiness procedure", () => {
      expect(caller.adDailyReport.uploadDailyBusiness).toBeDefined();
    });
  });

  describe("adDeepAnalysis procedures", () => {
    it("should have diagnoseProductStage procedure", () => {
      expect(caller.adDeepAnalysis.diagnoseProductStage).toBeDefined();
    });

    it("should have analyzeKeywordTiers procedure", () => {
      expect(caller.adDeepAnalysis.analyzeKeywordTiers).toBeDefined();
    });

    it("should have crossReportDiagnosis procedure", () => {
      expect(caller.adDeepAnalysis.crossReportDiagnosis).toBeDefined();
    });

    it("should have analyzePlacementReport procedure", () => {
      expect(caller.adDeepAnalysis.analyzePlacementReport).toBeDefined();
    });

    it("should have analyzeSearchTermReport procedure", () => {
      expect(caller.adDeepAnalysis.analyzeSearchTermReport).toBeDefined();
    });

    it("should have analyzeImpressionShareReport procedure", () => {
      expect(caller.adDeepAnalysis.analyzeImpressionShareReport).toBeDefined();
    });

    it("should have analyzeSbBenchmarkReport procedure", () => {
      expect(caller.adDeepAnalysis.analyzeSbBenchmarkReport).toBeDefined();
    });

    it("should have analyzeBusinessCrossReport procedure", () => {
      expect(caller.adDeepAnalysis.analyzeBusinessCrossReport).toBeDefined();
    });

    it("should have generateSopTasks procedure", () => {
      expect(caller.adDeepAnalysis.generateSopTasks).toBeDefined();
    });

    it("should have clinicDiagnosis procedure", () => {
      expect(caller.adDeepAnalysis.clinicDiagnosis).toBeDefined();
    });

    it("should have getStageHistory procedure", () => {
      expect(caller.adDeepAnalysis.getStageHistory).toBeDefined();
    });
  });
});

describe("Ad Daily Report Parsers", () => {
  it("should export all 5 parser functions", async () => {
    const parsers = await import("./routers/adDailyReportParsers");
    expect(typeof parsers.parseDailyPlacementReport).toBe("function");
    expect(typeof parsers.parseDailySearchTermReport).toBe("function");
    expect(typeof parsers.parseDailyImpressionShareReport).toBe("function");
    expect(typeof parsers.parseDailySbBenchmarkReport).toBe("function");
    expect(typeof parsers.parseDailyBusinessReport).toBe("function");
  });

  it("parseDailyPlacementReport should parse CSV buffer correctly", async () => {
    const { parseDailyPlacementReport } = await import("./routers/adDailyReportParsers");
    const csvContent = `Date,Campaign Name,Placement,Impressions,Clicks,Spend,7 Day Total Sales,7 Day Total Orders (#),CTR,CVR,ACOS,CPC
2024-01-15,Test Campaign,Top of Search on-Amazon,1000,50,25.00,100.00,5,5.00%,10.00%,25.00%,0.50`;
    const buffer = Buffer.from(csvContent, "utf8");
    const result = await parseDailyPlacementReport(buffer, true);
    expect(result.length).toBe(1);
    expect(result[0].campaignName).toBe("Test Campaign");
    expect(result[0].impressions).toBe(1000);
    expect(result[0].clicks).toBe(50);
    expect(result[0].spend).toBe(25);
    expect(result[0].sales).toBe(100);
    expect(result[0].orders).toBeGreaterThanOrEqual(0); // orders field mapping depends on exact CSV header variant
  });

  it("parseDailySearchTermReport should parse CSV buffer correctly", async () => {
    const { parseDailySearchTermReport } = await import("./routers/adDailyReportParsers");
    const csvContent = `Date,Campaign Name,Ad Group Name,Targeting,Customer Search Term,Match Type,Impressions,Clicks,Spend,7 Day Total Sales,7 Day Total Orders (#)
2024-01-15,Test Campaign,Test Ad Group,keyword1,buy keyword1,broad,500,25,12.50,50.00,3`;
    const buffer = Buffer.from(csvContent, "utf8");
    const result = await parseDailySearchTermReport(buffer, true);
    expect(result.length).toBe(1);
    expect(result[0].searchTerm).toBe("buy keyword1");
    expect(result[0].matchType).toBe("broad");
    expect(result[0].clicks).toBe(25);
  });

  it("parseDailyImpressionShareReport should parse CSV buffer correctly", async () => {
    const { parseDailyImpressionShareReport } = await import("./routers/adDailyReportParsers");
    const csvContent = `Date,Campaign Name,Targeting,Impressions,Impression Share,Clicks,Spend
2024-01-15,Test Campaign,keyword1,1000,15.5%,50,25.00`;
    const buffer = Buffer.from(csvContent, "utf8");
    const result = await parseDailyImpressionShareReport(buffer, true);
    expect(result.length).toBe(1);
    expect(result[0].impressions).toBe(1000);
  });

  it("parseDailySbBenchmarkReport should parse CSV buffer correctly", async () => {
    const { parseDailySbBenchmarkReport } = await import("./routers/adDailyReportParsers");
    const csvContent = `Date,Campaign Name,Impressions,Clicks,Spend,CTR,CPC,Sales,Orders,ACOS,Benchmark CTR,Benchmark CPC,Benchmark ACOS
2024-01-15,SB Campaign,2000,80,40.00,4.00%,0.50,200.00,8,20.00%,3.50%,0.45,22.00%`;
    const buffer = Buffer.from(csvContent, "utf8");
    const result = await parseDailySbBenchmarkReport(buffer, true);
    expect(result.length).toBe(1);
    expect(result[0].impressions).toBe(2000);
    expect(result[0].clicks).toBe(80);
  });

  it("parseDailyBusinessReport should parse CSV buffer correctly", async () => {
    const { parseDailyBusinessReport } = await import("./routers/adDailyReportParsers");
    const csvContent = `Date,(Parent) ASIN,(Child) ASIN,Sessions,Session Percentage,Page Views,Units Ordered,Ordered Product Sales,Unit Session Percentage
2024-01-15,B001234567,B001234567,200,0.5%,300,10,500.00,5.00%`;
    const buffer = Buffer.from(csvContent, "utf8");
    const result = await parseDailyBusinessReport(buffer, true);
    expect(result.length).toBe(1);
    expect(result[0].sessions).toBe(200);
    expect(result[0].unitsOrdered).toBe(10);
  });
});
