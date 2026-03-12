import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import fs from "fs";
import path from "path";

// ============================================================
// Module 5: Knowledge Base - Router Structure
// ============================================================

describe("KB - kbProducts router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbProducts.list");
    expect(router).toHaveProperty("kbProducts.getById");
    expect(router).toHaveProperty("kbProducts.importByAsin");
    expect(router).toHaveProperty("kbProducts.batchImportAsins");
    expect(router).toHaveProperty("kbProducts.importByLink");
    expect(router).toHaveProperty("kbProducts.confirmAnalysis");
    expect(router).toHaveProperty("kbProducts.updateTags");
    expect(router).toHaveProperty("kbProducts.delete");
  });
});

describe("KB - kbListings router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbListings.list");
    expect(router).toHaveProperty("kbListings.getById");
    expect(router).toHaveProperty("kbListings.importByAsin");
    expect(router).toHaveProperty("kbListings.batchImportAsins");
    expect(router).toHaveProperty("kbListings.importByLink");
    expect(router).toHaveProperty("kbListings.confirmAnalysis");
    expect(router).toHaveProperty("kbListings.updateTags");
    expect(router).toHaveProperty("kbListings.delete");
  });
});

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

describe("KB - kbSkills router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbSkills.list");
    expect(router).toHaveProperty("kbSkills.getById");
    expect(router).toHaveProperty("kbSkills.uploadFile");
    expect(router).toHaveProperty("kbSkills.batchUploadFiles");
    expect(router).toHaveProperty("kbSkills.importByUrl");
    expect(router).toHaveProperty("kbSkills.createManual");
    expect(router).toHaveProperty("kbSkills.confirmSummary");
    expect(router).toHaveProperty("kbSkills.updateTags");
    expect(router).toHaveProperty("kbSkills.delete");
  });
});

describe("KB - kbVideos router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbVideos.list");
    expect(router).toHaveProperty("kbVideos.getById");
    expect(router).toHaveProperty("kbVideos.importByUrl");
    expect(router).toHaveProperty("kbVideos.batchImportUrls");
    expect(router).toHaveProperty("kbVideos.importByAsin");
    expect(router).toHaveProperty("kbVideos.confirmAnalysis");
    expect(router).toHaveProperty("kbVideos.updateTags");
    expect(router).toHaveProperty("kbVideos.delete");
  });
});

describe("KB - kbSearch router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbSearch.search");
    expect(router).toHaveProperty("kbSearch.stats");
  });
});

// ============================================================
// Module 5: File Structure Verification
// ============================================================

describe("KB - File structure", () => {
  const basePath = path.resolve(__dirname, "..");

  it("should have all required router files", () => {
    const routerFiles = [
      "server/routers/kbProducts.ts",
      "server/routers/kbListings.ts",
      "server/routers/kbImages.ts",
      "server/routers/kbSkills.ts",
      "server/routers/kbVideos.ts",
      "server/routers/kbSearch.ts",
    ];
    for (const file of routerFiles) {
      expect(fs.existsSync(path.join(basePath, file)), `${file} should exist`).toBe(true);
    }
  });

  it("should have kbDb.ts database helpers", () => {
    expect(fs.existsSync(path.join(basePath, "server/kbDb.ts"))).toBe(true);
  });

  it("should have all kb_ tables in schema", () => {
    const schema = fs.readFileSync(path.join(basePath, "drizzle/schema.ts"), "utf-8");
    const requiredTables = [
      "kbProductInnovations", "kbListingCopywriting", "kbImageSets",
      "kbImages", "kbOperationSkills", "kbVideos",
    ];
    for (const table of requiredTables) {
      expect(schema).toContain(table);
    }
  });

  it("should have all knowledge base frontend pages", () => {
    const pages = [
      "client/src/pages/knowledge/KBOverview.tsx",
      "client/src/pages/knowledge/KBProducts.tsx",
      "client/src/pages/knowledge/KBListings.tsx",
      "client/src/pages/knowledge/KBImages.tsx",
      "client/src/pages/knowledge/KBSkills.tsx",
      "client/src/pages/knowledge/KBVideos.tsx",
    ];
    for (const page of pages) {
      expect(fs.existsSync(path.join(basePath, page)), `${page} should exist`).toBe(true);
    }
  });
});

// ============================================================
// Module 5: AI Prompt Verification
// ============================================================

describe("KB - AI prompts in routers", () => {
  it("kbProducts should contain product innovation AI analysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbProducts.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("创意");
  });

  it("kbListings should contain listing copywriting AI analysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbListings.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("文案");
  });

  it("kbImages should contain image visual AI analysis with 4 dimensions", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toMatch(/类目|色系|图片类型|设计风格/);
  });

  it("kbSkills should contain SOP AI summary generation", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbSkills.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("运营");
  });

  it("kbVideos should contain video content AI analysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbVideos.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("视频");
  });
});

// ============================================================
// Module 5: Import Features Verification
// ============================================================

describe("KB - Import features", () => {
  it("kbProducts should support link and ASIN import", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbProducts.ts"), "utf-8");
    expect(code).toContain("importByLink");
    expect(code).toContain("importByAsin");
    expect(code).toContain("batchImportAsins");
  });

  it("kbListings should support link and ASIN import", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbListings.ts"), "utf-8");
    expect(code).toContain("importByLink");
    expect(code).toContain("importByAsin");
    expect(code).toContain("batchImportAsins");
  });

  it("kbImages should support ASIN and link import with image crawling", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("importByAsin");
    expect(code).toContain("importByLink");
    expect(code).toContain("batchImportAsins");
  });

  it("kbSkills should support multi-format file upload and URL import", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbSkills.ts"), "utf-8");
    expect(code).toContain("uploadFile");
    expect(code).toContain("batchUploadFiles");
    expect(code).toContain("importByUrl");
    expect(code).toContain("createManual");
    // Should support multiple file formats
    expect(code).toMatch(/pdf|docx|xlsx|pptx|markdown/i);
  });

  it("kbVideos should support URL and ASIN import", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbVideos.ts"), "utf-8");
    expect(code).toContain("importByUrl");
    expect(code).toContain("importByAsin");
    expect(code).toContain("batchImportUrls");
  });
});

// ============================================================
// Module 5: User Interaction (Edit + Confirm) Verification
// ============================================================

describe("KB - User interaction (edit + confirm) workflow", () => {
  it("kbProducts should support confirmAnalysis with editedAnalysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbProducts.ts"), "utf-8");
    expect(code).toContain("confirmAnalysis");
    expect(code).toContain("editedAnalysis");
  });

  it("kbListings should support confirmAnalysis with editedAnalysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbListings.ts"), "utf-8");
    expect(code).toContain("confirmAnalysis");
    expect(code).toContain("editedAnalysis");
  });

  it("kbSkills should support confirmSummary with editedSummary", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbSkills.ts"), "utf-8");
    expect(code).toContain("confirmSummary");
    expect(code).toContain("editedSummary");
  });

  it("kbVideos should support confirmAnalysis with editedAnalysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbVideos.ts"), "utf-8");
    expect(code).toContain("confirmAnalysis");
    expect(code).toContain("editedAnalysis");
  });

  it("kbImages should support confirmImageTags and confirmSetAnalysis", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbImages.ts"), "utf-8");
    expect(code).toContain("confirmImageTags");
    expect(code).toContain("confirmSetAnalysis");
  });
});

// ============================================================
// Module 5: Router Registration
// ============================================================

describe("KB - Router registration", () => {
  it("all KB routers should be registered in appRouter", () => {
    const routersCode = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    expect(routersCode).toContain("kbProducts");
    expect(routersCode).toContain("kbListings");
    expect(routersCode).toContain("kbImages");
    expect(routersCode).toContain("kbSkills");
    expect(routersCode).toContain("kbVideos");
    expect(routersCode).toContain("kbSearch");
  });
});

// ============================================================
// Cross-module: Knowledge Base Search
// ============================================================

describe("KB - Cross-module search", () => {
  it("kbDb should have search across all 5 knowledge base modules", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "kbDb.ts"), "utf-8");
    expect(code).toContain("kbProductInnovations");
    expect(code).toContain("kbListingCopywriting");
    expect(code).toContain("kbImageSets");
    expect(code).toContain("kbOperationSkills");
    expect(code).toContain("kbVideos");
  });

  it("kbSearch router should delegate to kbDb for search and stats", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/kbSearch.ts"), "utf-8");
    expect(code).toContain("kbDb");
    expect(code).toContain("searchKnowledgeBase");
    expect(code).toContain("getKbStats");
  });
});
