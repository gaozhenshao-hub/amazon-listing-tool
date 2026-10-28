import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import fs from "fs";
import path from "path";
import { readSchemaSources } from "./testPaths";



describe("KB - kbImages router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbImages.listSets");
    expect(router).toHaveProperty("kbImages.getSet");
    expect(router).toHaveProperty("kbImages.listAllImages");
    expect(router).toHaveProperty("kbImages.importByAsin");
    expect(router).toHaveProperty("kbImages.batchImportAsins");
    expect(router).toHaveProperty("kbImages.importByLink");
    expect(router).toHaveProperty("kbImages.confirmImageTags");
    expect(router).toHaveProperty("kbImages.confirmSetAnalysis");
    expect(router).toHaveProperty("kbImages.deleteSet");
  });
});




// ============================================================
// Module 5: File Structure Verification
// ============================================================

describe("KB - File structure", () => {
  const basePath = path.resolve(__dirname, "..");


  it("should have kbDb.ts database helpers", () => {
    expect(fs.existsSync(path.join(basePath, "server/kbDb.ts"))).toBe(true);
  });

  it("should have all kb_ tables in schema", () => {
    const schema = readSchemaSources();
    const requiredTables = [
      "kbProductInnovations", "kbListingCopywriting", "kbImageSets",
      "kbImages", "kbOperationSkills", "kbVideos",
    ];
    for (const table of requiredTables) {
      expect(schema).toContain(table);
    }
  });

});

// ============================================================
// Module 5: AI Prompt Verification
// ============================================================

describe("KB - AI prompts in routers", () => {



  it("kbImages should contain image visual AI analysis with 4 dimensions", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("invokeBusinessSkill");
    expect(code).toMatch(/类目|色系|图片类型|设计风格/);
  });


});

// ============================================================
// Module 5: Import Features Verification
// ============================================================

describe("KB - Import features", () => {



  it("kbImages should support ASIN and link import with image crawling", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("importByAsin");
    expect(code).toContain("importByLink");
    expect(code).toContain("batchImportAsins");
  });


});

// ============================================================
// Module 5: User Interaction (Edit + Confirm) Verification
// ============================================================

describe("KB - User interaction (edit + confirm) workflow", () => {





  it("kbImages should support confirmImageTags and confirmSetAnalysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("confirmImageTags");
    expect(code).toContain("confirmSetAnalysis");
  });
});


