import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { readSchemaSources } from "./testPaths";

const basePath = path.resolve(__dirname, "..");

// ============================================================
// Platform Navigation Structure
// ============================================================

describe("Platform - Navigation structure", () => {


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
    const schema = readSchemaSources();
    expect(schema).toContain("users");
    expect(schema).toContain("projects");
    expect(schema).toContain("keywords");
    expect(schema).toContain("listings");
  });

  it("schema should have all module 1 tables (dev_*)", () => {
    const schema = readSchemaSources();
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
    const schema = readSchemaSources();
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
      { file: "client/src/pages/knowledge/KBImages.tsx", expected: "智能图片知识库" },
    ];
    for (const { file, expected } of pages) {
      const code = fs.readFileSync(path.join(basePath, file), "utf-8");
      expect(code).toContain(expected);
    }
  });

});
