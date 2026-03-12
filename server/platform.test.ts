import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const basePath = path.resolve(__dirname, "..");

// ============================================================
// Platform Navigation Structure
// ============================================================

describe("Platform - Navigation structure", () => {
  it("DashboardLayout should have 5 module navigation items", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/components/DashboardLayout.tsx"), "utf-8");
    expect(code).toContain("产品开发");
    expect(code).toContain("Listing");
    expect(code).toContain("运营");
    expect(code).toContain("售后");
    expect(code).toContain("知识库");
  });

  it("DashboardLayout should have module navigation with sub-items", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/components/DashboardLayout.tsx"), "utf-8");
    // Should have module definitions with items/features
    expect(code).toMatch(/modules|MODULE/i);
    expect(code).toMatch(/items|label|path/i);
  });
});

// ============================================================
// Platform Routing
// ============================================================

describe("Platform - Routing", () => {
  it("App.tsx should have routes for all 5 modules", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toContain("/dev");
    expect(code).toContain("/listing");
    expect(code).toContain("/ops");
    expect(code).toContain("/service");
    expect(code).toContain("/knowledge");
  });

  it("App.tsx should have module 1 sub-routes", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toContain("DevDashboard");
    expect(code).toContain("DevProjectList");
    expect(code).toContain("DevNewProject");
    expect(code).toContain("DevProjectDetail");
  });

  it("App.tsx should have knowledge base sub-routes", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toContain("KBOverview");
    expect(code).toContain("KBProducts");
    expect(code).toContain("KBListings");
    expect(code).toContain("KBImages");
    expect(code).toContain("KBSkills");
    expect(code).toContain("KBVideos");
  });

  it("App.tsx should have ComingSoonPage for module 3 and 4", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toContain("ComingSoonPage");
    expect(code).toContain("智能运营提效");
    expect(code).toContain("智能售后管理");
  });

  it("App.tsx should have a platform home page", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toContain("PlatformHome");
  });
});

// ============================================================
// Platform - Module 2 Route Migration
// ============================================================

describe("Platform - Module 2 route migration", () => {
  it("listing routes should use /listing prefix", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/App.tsx"), "utf-8");
    expect(code).toMatch(/\/listing/);
  });

  it("existing listing pages should still exist", () => {
    const pages = [
      "client/src/pages/Home.tsx",
      "client/src/pages/GeneratePage.tsx",
      "client/src/pages/KeywordPage.tsx",
    ];
    for (const page of pages) {
      expect(fs.existsSync(path.join(basePath, page)), `${page} should exist`).toBe(true);
    }
  });
});

// ============================================================
// Platform - Database Schema Completeness
// ============================================================

describe("Platform - Database schema completeness", () => {
  it("schema should have all module 2 tables (existing)", () => {
    const schema = fs.readFileSync(path.join(basePath, "drizzle/schema.ts"), "utf-8");
    expect(schema).toContain("users");
    expect(schema).toContain("projects");
    expect(schema).toContain("keywords");
    expect(schema).toContain("listings");
  });

  it("schema should have all module 1 tables (dev_*)", () => {
    const schema = fs.readFileSync(path.join(basePath, "drizzle/schema.ts"), "utf-8");
    const devTables = [
      "devProjects", "devUploadedFiles", "devProducts", "devReviews",
      "devTagDimensions", "devExternalData", "devAnalysisReports",
      "devProjectScores", "devProductProfiles",
      "devBomItems", "devProfitCalculations", "devGlobalSuppliers",
      "devProductManuals", "devTestReports", "devSuppliers",
      "devMoldCosts", "devTimePlans", "devBomSummary",
    ];
    for (const table of devTables) {
      expect(schema).toContain(table);
    }
  });

  it("schema should have all module 5 tables (kb_*)", () => {
    const schema = fs.readFileSync(path.join(basePath, "drizzle/schema.ts"), "utf-8");
    const kbTables = [
      "kbProductInnovations", "kbListingCopywriting", "kbImageSets",
      "kbImages", "kbOperationSkills",
    ];
    for (const table of kbTables) {
      expect(schema).toContain(table);
    }
    // kbVideos table - check for the mysqlTable definition
    expect(schema).toContain("kb_videos");
  });
});

// ============================================================
// Platform - "智能" Prefix Naming Convention
// ============================================================

describe("Platform - '智能' prefix naming convention", () => {
  it("knowledge base pages should use '智能' prefix in titles", () => {
    const pages = [
      { file: "client/src/pages/knowledge/KBProducts.tsx", expected: "智能产品创意库" },
      { file: "client/src/pages/knowledge/KBListings.tsx", expected: "智能Listing文案库" },
      { file: "client/src/pages/knowledge/KBImages.tsx", expected: "智能图片知识库" },
      { file: "client/src/pages/knowledge/KBSkills.tsx", expected: "智能运营SOP知识库" },
      { file: "client/src/pages/knowledge/KBVideos.tsx", expected: "智能视频知识库" },
    ];
    for (const { file, expected } of pages) {
      const code = fs.readFileSync(path.join(basePath, file), "utf-8");
      expect(code).toContain(expected);
    }
  });

  it("navigation should use '智能' prefix for new module names", () => {
    const code = fs.readFileSync(path.join(basePath, "client/src/components/DashboardLayout.tsx"), "utf-8");
    expect(code).toContain("智能");
  });
});
