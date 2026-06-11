import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Test: devPanorama router structure ──────────────────────────
describe("devPanorama router", () => {
  const routerPath = path.join(__dirname, "routers/devPanorama.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should export devPanoramaRouter", () => {
    expect(routerSrc).toContain("export const devPanoramaRouter");
  });

  it("should have getData procedure", () => {
    expect(routerSrc).toContain("getData:");
  });

  it("should have getStatus procedure", () => {
    expect(routerSrc).toContain("getStatus:");
  });

  it("should have confirm procedure", () => {
    expect(routerSrc).toContain("confirm:");
  });

  it("should have unlock procedure", () => {
    expect(routerSrc).toContain("unlock:");
  });

  it("should have updateProductField procedure", () => {
    expect(routerSrc).toContain("updateProductField:");
  });

  it("should have updateProductTag procedure", () => {
    expect(routerSrc).toContain("updateProductTag:");
  });

  it("should have exportCsv procedure", () => {
    expect(routerSrc).toContain("exportCsv:");
  });
});

// ─── Test: devPanorama router is registered ──────────────────────
describe("devPanorama router registration", () => {
  const routersPath = path.join(__dirname, "routers.ts");
  const routersSrc = fs.readFileSync(routersPath, "utf-8");

  it("should import devPanoramaRouter", () => {
    expect(routersSrc).toContain("devPanoramaRouter");
  });

  it("should register devPanorama in appRouter", () => {
    expect(routersSrc).toContain("devPanorama:");
  });
});

// ─── Test: Panorama status table in schema ──────────────────────
describe("devPanoramaStatus schema", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  const schemaSrc = fs.readFileSync(schemaPath, "utf-8");

  it("should define devPanoramaStatus table", () => {
    expect(schemaSrc).toContain("devPanoramaStatus");
    expect(schemaSrc).toContain("dev_panorama_status");
  });

  it("should have projectId field", () => {
    expect(schemaSrc).toMatch(/devPanoramaStatus[\s\S]*?projectId/);
  });

  it("should have confirmed field", () => {
    expect(schemaSrc).toMatch(/devPanoramaStatus[\s\S]*?confirmed/);
  });

  it("should have confirmedAt field", () => {
    expect(schemaSrc).toMatch(/devPanoramaStatus[\s\S]*?confirmedAt/);
  });
});

// ─── Test: devProducts has panorama fields ──────────────────────
describe("devProducts panorama fields", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  const schemaSrc = fs.readFileSync(schemaPath, "utf-8");

  const panoramaFields = [
    "parentAsin", "sku", "bsrLarge", "bsrSmall",
    "fbaFee", "grossMargin", "lqs", "reviewRate",
    "hasAPlus", "hasVideo", "hasBrandStory", "hasAmazonChoice",
    "buyboxSeller", "buyboxType", "sellerLocation",
    "productWeight", "productSize", "packageWeight", "packageSize", "packageSizeTier",
  ];

  for (const field of panoramaFields) {
    it(`should have ${field} field in devProducts`, () => {
      expect(schemaSrc).toContain(`"${field}"`);
    });
  }
});

// ─── Test: Stage gating includes panorama check ─────────────────
describe("Stage gating panorama check", () => {
  const analysisPath = path.join(__dirname, "routers/devAnalysis.ts");
  const analysisSrc = fs.readFileSync(analysisPath, "utf-8");

  it("should have isPanoramaConfirmed helper", () => {
    expect(analysisSrc).toContain("isPanoramaConfirmed");
  });

  it("should check panorama for market_overview", () => {
    // Find the market_overview case and check it references panorama
    const marketSection = analysisSrc.split("case \"market_overview\"")[1]?.split("break")[0] || "";
    expect(marketSection).toContain("isPanoramaConfirmed");
    expect(marketSection).toContain("竞品全景分析表未确认");
  });

  it("should check panorama for attribute_cross", () => {
    const section = analysisSrc.split("case \"attribute_cross\"")[1]?.split("break")[0] || "";
    expect(section).toContain("isPanoramaConfirmed");
    expect(section).toContain("竞品全景分析表未确认");
  });

  it("should check panorama for price_analysis", () => {
    const section = analysisSrc.split("case \"price_analysis\"")[1]?.split("break")[0] || "";
    expect(section).toContain("isPanoramaConfirmed");
    expect(section).toContain("竞品全景分析表未确认");
  });

  it("should check panorama for brand_competition", () => {
    const section = analysisSrc.split("case \"brand_competition\"")[1]?.split("break")[0] || "";
    expect(section).toContain("isPanoramaConfirmed");
    expect(section).toContain("竞品全景分析表未确认");
  });
});

// ─── Test: PanoramaTable frontend component ─────────────────────
describe("PanoramaTable frontend component", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/dev/PanoramaTable.tsx");
  const componentSrc = fs.readFileSync(componentPath, "utf-8");

  it("should export PanoramaTable component", () => {
    expect(componentSrc).toContain("export default function PanoramaTable");
  });

  it("should use trpc.devPanorama.getData", () => {
    expect(componentSrc).toContain("trpc.devPanorama.getData");
  });

  it("should use trpc.devPanorama.getStatus", () => {
    expect(componentSrc).toContain("trpc.devPanorama.getStatus");
  });

  it("should have confirm mutation", () => {
    expect(componentSrc).toContain("trpc.devPanorama.confirm");
  });

  it("should have unlock mutation", () => {
    expect(componentSrc).toContain("trpc.devPanorama.unlock");
  });

  it("should have export CSV mutation", () => {
    expect(componentSrc).toContain("trpc.devPanorama.exportCsv");
  });

  it("should have search functionality", () => {
    expect(componentSrc).toContain("searchTerm");
    expect(componentSrc).toContain("搜索 ASIN");
  });

  it("should have column group toggle", () => {
    expect(componentSrc).toContain("hiddenGroups");
    expect(componentSrc).toContain("toggleGroup");
  });

  it("should have inline editing", () => {
    expect(componentSrc).toContain("editingCell");
    expect(componentSrc).toContain("startEdit");
    expect(componentSrc).toContain("saveEdit");
  });

  it("should have pagination", () => {
    expect(componentSrc).toContain("PAGE_SIZE");
    expect(componentSrc).toContain("pagedProducts");
    expect(componentSrc).toContain("上一页");
    expect(componentSrc).toContain("下一页");
  });

  it("should display confirmation gate warning", () => {
    expect(componentSrc).toContain("全景分析表尚未确认");
    expect(componentSrc).toContain("确认锁定");
  });

  it("should define all required column groups", () => {
    const requiredGroups = ["基础信息", "类目", "排名", "价格利润", "销量", "评论", "Listing", "卖家", "时间", "物流", "内容"];
    for (const group of requiredGroups) {
      expect(componentSrc).toContain(`"${group}"`);
    }
  });

  it("should handle history columns dynamically", () => {
    expect(componentSrc).toContain("historyCols");
    expect(componentSrc).toContain("历史月销量");
  });

  it("should handle tag columns dynamically", () => {
    expect(componentSrc).toContain("tagCategories");
    expect(componentSrc).toContain("属性标签");
  });
});

// ─── Test: DevProjectDetail includes panorama tab ───────────────
describe("DevProjectDetail panorama tab", () => {
  const detailPath = path.join(__dirname, "../client/src/pages/dev/DevProjectDetail.tsx");
  const detailSrc = fs.readFileSync(detailPath, "utf-8");

  it("should import PanoramaTable", () => {
    expect(detailSrc).toContain("import PanoramaTable");
  });

  it("should have panorama tab definition", () => {
    expect(detailSrc).toContain("\"panorama\"");
    expect(detailSrc).toContain("全景分析表");
  });

  it("should render PanoramaTable in panorama tab", () => {
    expect(detailSrc).toContain("<PanoramaTable");
  });
});

// ─── Test: parseBulletPointsData column mapping ─────────────────
describe("parseBulletPointsData column mapping", () => {
  const uploadPath = path.join(__dirname, "../client/src/pages/dev/DevDataUpload.tsx");
  const uploadSrc = fs.readFileSync(uploadPath, "utf-8");

  it("should support 产品卖点 column name", () => {
    expect(uploadSrc).toContain("产品卖点");
  });

  it("should support 详细参数 column name", () => {
    expect(uploadSrc).toContain("详细参数");
  });
});
