import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// Phase 1-8 KB Image Optimization Test Suite
// ═══════════════════════════════════════════════════════════════════

// ─── Test 1: imageTagConstants exports ───
describe("imageTagConstants exports", () => {
  it("should export IMAGE_STYLES array with 13 styles", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_STYLES).toBeDefined();
    expect(Array.isArray(mod.IMAGE_STYLES)).toBe(true);
    expect(mod.IMAGE_STYLES.length).toBe(13);
  });

  it("should export IMAGE_TYPE_MAIN_OPTIONS with 6 main types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_MAIN_OPTIONS).toBeDefined();
    expect(Array.isArray(mod.IMAGE_TYPE_MAIN_OPTIONS)).toBe(true);
    expect(mod.IMAGE_TYPE_MAIN_OPTIONS.length).toBe(6);
  });

  it("should export IMAGE_TYPE_HIERARCHY with correct structure", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY).toBeDefined();
    expect(typeof mod.IMAGE_TYPE_HIERARCHY).toBe("object");
    // Each main type should have sub-types
    for (const main of mod.IMAGE_TYPE_MAIN_OPTIONS) {
      expect(mod.IMAGE_TYPE_HIERARCHY[main]).toBeDefined();
      expect(Array.isArray(mod.IMAGE_TYPE_HIERARCHY[main])).toBe(true);
    }
  });

  it("should export SELLING_POINT_MAIN_OPTIONS with 6 categories", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.SELLING_POINT_MAIN_OPTIONS).toBeDefined();
    expect(Array.isArray(mod.SELLING_POINT_MAIN_OPTIONS)).toBe(true);
    expect(mod.SELLING_POINT_MAIN_OPTIONS.length).toBe(6);
  });

  it("should export COMPOSITION_OPTIONS", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.COMPOSITION_OPTIONS).toBeDefined();
    expect(Array.isArray(mod.COMPOSITION_OPTIONS)).toBe(true);
  });

  it("should export COLOR_SCHEME_OPTIONS with 10 options", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.COLOR_SCHEME_OPTIONS).toBeDefined();
    expect(Array.isArray(mod.COLOR_SCHEME_OPTIONS)).toBe(true);
    expect(mod.COLOR_SCHEME_OPTIONS.length).toBe(10);
  });

  it("each IMAGE_STYLES entry should have all required fields", async () => {
    const mod = await import("./constants/imageTagConstants");
    for (const style of mod.IMAGE_STYLES) {
      expect(style).toHaveProperty("name");
      expect(style).toHaveProperty("lightType");
      expect(style).toHaveProperty("colorTemp");
      expect(style).toHaveProperty("materialKeywords");
      expect(style).toHaveProperty("tabooElements");
      expect(style).toHaveProperty("refBrands");
      expect(style).toHaveProperty("aiKeywords");
    }
  });

  it("should export getStyleParams function", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(typeof mod.getStyleParams).toBe("function");
    // Test with a known style
    const params = mod.getStyleParams("大厂极简风");
    expect(params).toBeDefined();
    expect(params?.lightType).toBeDefined();
  });

  it("getStyleParams should return undefined for unknown style", async () => {
    const mod = await import("./constants/imageTagConstants");
    const params = mod.getStyleParams("不存在的风格");
    expect(params).toBeUndefined();
  });

  it("should export getImageSubTypes function", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(typeof mod.getImageSubTypes).toBe("function");
    const subs = mod.getImageSubTypes("对比");
    expect(subs.length).toBeGreaterThanOrEqual(3);
  });

  it("should export getSellingPointDetails function", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(typeof mod.getSellingPointDetails).toBe("function");
  });
});

// ─── Test 2: kbImages router exports and procedures ───
describe("kbImages router", () => {
  it("should export kbImagesRouter", async () => {
    const mod = await import("./routers/kbImages");
    expect(mod.kbImagesRouter).toBeDefined();
    expect(mod.kbImagesRouter._def).toBeDefined();
  });

  it("should have updateSetStyle procedure", async () => {
    const mod = await import("./routers/kbImages");
    const procedures = Object.keys(mod.kbImagesRouter._def.procedures);
    expect(procedures).toContain("updateSetStyle");
  });

  it("should have confirmImageTags procedure", async () => {
    const mod = await import("./routers/kbImages");
    const procedures = Object.keys(mod.kbImagesRouter._def.procedures);
    expect(procedures).toContain("confirmImageTags");
  });

  it("should have reAnalyze procedure", async () => {
    const mod = await import("./routers/kbImages");
    const procedures = Object.keys(mod.kbImagesRouter._def.procedures);
    expect(procedures).toContain("reAnalyze");
  });

  it("should have listAllImages procedure", async () => {
    const mod = await import("./routers/kbImages");
    const procedures = Object.keys(mod.kbImagesRouter._def.procedures);
    expect(procedures).toContain("listAllImages");
  });
});

// ─── Test 3: kbDb functions for new filter fields ───
describe("kbDb functions", () => {
  it("should export listAllImages with filter support", async () => {
    const kbDb = await import("./kbDb");
    expect(typeof kbDb.listAllImages).toBe("function");
  });

  it("should export listImageSets", async () => {
    const kbDb = await import("./kbDb");
    expect(typeof kbDb.listImageSets).toBe("function");
  });

  it("should export updateImageSet", async () => {
    const kbDb = await import("./kbDb");
    expect(typeof kbDb.updateImageSet).toBe("function");
  });

  it("should export updateImage", async () => {
    const kbDb = await import("./kbDb");
    expect(typeof kbDb.updateImage).toBe("function");
  });
});

// ─── Test 4: imageWorkflow router KB reference integration ───
describe("imageWorkflow router KB integration", () => {
  it("should export imageWorkflowRouter", async () => {
    const mod = await import("./routers/imageWorkflow");
    expect(mod.imageWorkflowRouter).toBeDefined();
    expect(mod.imageWorkflowRouter._def).toBeDefined();
  });

  it("should have generateStep3 procedure (with KB reference)", async () => {
    const mod = await import("./routers/imageWorkflow");
    const procedures = Object.keys(mod.imageWorkflowRouter._def.procedures);
    expect(procedures).toContain("generateStep3");
  });

  it("should have generateStep5 procedure (with KB reference)", async () => {
    const mod = await import("./routers/imageWorkflow");
    const procedures = Object.keys(mod.imageWorkflowRouter._def.procedures);
    expect(procedures).toContain("generateStep5");
  });
});

// ─── Test 5: Schema has new v2 fields ───
describe("schema v2 fields", () => {
  it("kbImageSets should have setStyle field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImageSets.setStyle).toBeDefined();
  });

  it("kbImageSets should have setStyleParams field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImageSets.setStyleParams).toBeDefined();
  });

  it("kbImageSets should have setColorScheme field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImageSets.setColorScheme).toBeDefined();
  });

  it("kbImages should have tagImageTypeMain field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagImageTypeMain).toBeDefined();
  });

  it("kbImages should have tagImageTypeSub field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagImageTypeSub).toBeDefined();
  });

  it("kbImages should have tagSellingPointCategory field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagSellingPointCategory).toBeDefined();
  });

  it("kbImages should have tagComposition field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagComposition).toBeDefined();
  });

  it("kbImages should have tagColorSchemeV2 field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagColorSchemeV2).toBeDefined();
  });

  it("kbImages should have tagDesignStyleV2 field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagDesignStyleV2).toBeDefined();
  });

  it("kbImages should have tagImageBelong field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.kbImages.tagImageBelong).toBeDefined();
  });
});

// ─── Test 6: IMAGE_STYLES data integrity ───
describe("IMAGE_STYLES data integrity", () => {
  it("all styles should have non-empty lightType", async () => {
    const mod = await import("./constants/imageTagConstants");
    for (const style of mod.IMAGE_STYLES) {
      expect(style.lightType).toBeTruthy();
    }
  });

  it("all styles should have non-empty aiKeywords", async () => {
    const mod = await import("./constants/imageTagConstants");
    for (const style of mod.IMAGE_STYLES) {
      expect(style.aiKeywords).toBeTruthy();
    }
  });

  it("all styles should have non-empty tabooElements", async () => {
    const mod = await import("./constants/imageTagConstants");
    for (const style of mod.IMAGE_STYLES) {
      expect(style.tabooElements).toBeTruthy();
    }
  });
});

// ─── Test 7: IMAGE_TYPE_HIERARCHY completeness ───
describe("IMAGE_TYPE_HIERARCHY completeness", () => {
  it("对比 should have at least 3 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["对比"].length).toBeGreaterThanOrEqual(3);
  });

  it("细节 should have at least 3 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["细节"].length).toBeGreaterThanOrEqual(3);
  });

  it("场景 should have at least 3 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["场景"].length).toBeGreaterThanOrEqual(3);
  });

  it("特效 should have at least 3 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["特效"].length).toBeGreaterThanOrEqual(3);
  });

  it("必要 should have at least 3 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["必要"].length).toBeGreaterThanOrEqual(3);
  });

  it("品牌 should have at least 2 sub-types", async () => {
    const mod = await import("./constants/imageTagConstants");
    expect(mod.IMAGE_TYPE_HIERARCHY["品牌"].length).toBeGreaterThanOrEqual(2);
  });
});
