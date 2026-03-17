import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Test: devTagging router structure ──────────────────────────
describe("devTagging router (refactored)", () => {
  const routerPath = path.join(__dirname, "routers/devTagging.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should export devTaggingRouter", () => {
    expect(routerSrc).toContain("export const devTaggingRouter");
  });

  it("should have getTaggingStatus procedure", () => {
    expect(routerSrc).toContain("getTaggingStatus:");
  });

  it("should have getDimensions procedure", () => {
    expect(routerSrc).toContain("getDimensions:");
  });

  it("should have startTagging procedure", () => {
    expect(routerSrc).toContain("startTagging:");
  });

  it("should have getTaggedProducts procedure", () => {
    expect(routerSrc).toContain("getTaggedProducts:");
  });

  it("should have updateTag procedure", () => {
    expect(routerSrc).toContain("updateTag:");
  });

  it("should have addTag procedure", () => {
    expect(routerSrc).toContain("addTag:");
  });

  it("should have deleteTag procedure", () => {
    expect(routerSrc).toContain("deleteTag:");
  });

  it("should have confirmAll procedure", () => {
    expect(routerSrc).toContain("confirmAll:");
  });

  it("should have unlockAll procedure", () => {
    expect(routerSrc).toContain("unlockAll:");
  });
});

// ─── Test: devTagging reads from tag management framework ──────
describe("devTagging reads tag management dimensions", () => {
  const routerPath = path.join(__dirname, "routers/devTagging.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should import devProjectTagCategories from schema", () => {
    expect(routerSrc).toContain("devProjectTagCategories");
  });

  it("should import devProjectTagItems from schema", () => {
    expect(routerSrc).toContain("devProjectTagItems");
  });

  it("should import devProductTags from schema", () => {
    expect(routerSrc).toContain("devProductTags");
  });

  it("startTagging should read from devProjectTagCategories", () => {
    // The startTagging function should query devProjectTagCategories
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("devProjectTagCategories");
  });

  it("startTagging should read from devProjectTagItems for available values", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("devProjectTagItems");
  });

  it("startTagging should check for confirmed categories", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("confirmed");
    expect(startTaggingSection).toContain("confirmedCats");
  });

  it("startTagging should build dimensionFramework from confirmed categories", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("dimensionFramework");
    expect(startTaggingSection).toContain("categoryName");
  });

  it("startTagging should use categoryName as dimensionName (not hardcoded English keys)", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("dimensionName: cat.categoryName");
    // Should NOT contain old hardcoded dimensions
    expect(startTaggingSection).not.toContain("productCategory");
    expect(startTaggingSection).not.toContain("mainMaterial");
    expect(startTaggingSection).not.toContain("style");
  });
});

// ─── Test: startTagging writes to dev_product_tags table ────────
describe("devTagging writes to dev_product_tags", () => {
  const routerPath = path.join(__dirname, "routers/devTagging.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should write tags to devProductTags table (not devProducts.tags)", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    // Should insert into devProductTags
    expect(startTaggingSection).toContain("db.insert(devProductTags)");
    // Should NOT write to devProducts.tags JSON field
    expect(startTaggingSection).not.toContain("devProducts.tags");
    expect(startTaggingSection).not.toContain('tags: JSON.stringify');
  });

  it("should delete old AI tags before inserting new ones", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("db.delete(devProductTags)");
    expect(startTaggingSection).toContain('"ai"');
  });

  it("should batch insert tags in groups of 100", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain("i += 100");
  });

  it("should set source to 'ai' for AI-generated tags", () => {
    const startTaggingSection = routerSrc.substring(
      routerSrc.indexOf("startTagging:"),
      routerSrc.indexOf("getTaggedProducts:")
    );
    expect(startTaggingSection).toContain('source: "ai"');
  });
});

// ─── Test: AI prompt uses Chinese dimension names ───────────────
describe("devTagging AI prompt quality", () => {
  const routerPath = path.join(__dirname, "routers/devTagging.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should include strict rules against fabrication", () => {
    expect(routerSrc).toContain("禁止编造");
  });

  it("should require Chinese output", () => {
    expect(routerSrc).toContain("中文输出");
  });

  it("should instruct to prioritize available values", () => {
    expect(routerSrc).toContain("优先使用可选值");
  });

  it("should instruct to leave empty when uncertain", () => {
    expect(routerSrc).toContain("无法判断时留空");
  });

  it("should mention differential features", () => {
    expect(routerSrc).toContain("差异化特征不遗漏");
  });

  it("should use json_schema response format", () => {
    expect(routerSrc).toContain("json_schema");
    expect(routerSrc).toContain("product_tagging");
  });

  it("should process products in batches of 5", () => {
    expect(routerSrc).toContain("batchSize = 5");
  });
});

// ─── Test: devTagging router is registered in main router ───────
describe("devTagging router registration", () => {
  const routersPath = path.join(__dirname, "routers.ts");
  const routersSrc = fs.readFileSync(routersPath, "utf-8");

  it("should import devTaggingRouter", () => {
    expect(routersSrc).toContain("devTaggingRouter");
  });

  it("should register devTagging in appRouter", () => {
    expect(routersSrc).toContain("devTagging:");
  });
});

// ─── Test: AttributeTagging frontend component exists ───────────
describe("AttributeTagging frontend component", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/dev/AttributeTagging.tsx");
  const componentSrc = fs.readFileSync(componentPath, "utf-8");

  it("should export default AttributeTagging component", () => {
    expect(componentSrc).toContain("export default function AttributeTagging");
  });

  it("should accept projectId prop", () => {
    expect(componentSrc).toContain("projectId: number");
  });

  it("should call devTagging.getTaggingStatus", () => {
    expect(componentSrc).toContain("devTagging.getTaggingStatus");
  });

  it("should call devTagging.getDimensions", () => {
    expect(componentSrc).toContain("devTagging.getDimensions");
  });

  it("should call devTagging.getTaggedProducts", () => {
    expect(componentSrc).toContain("devTagging.getTaggedProducts");
  });

  it("should call devTagging.startTagging mutation", () => {
    expect(componentSrc).toContain("devTagging.startTagging.useMutation");
  });

  it("should call devTagging.confirmAll mutation", () => {
    expect(componentSrc).toContain("devTagging.confirmAll.useMutation");
  });

  it("should call devTagging.unlockAll mutation", () => {
    expect(componentSrc).toContain("devTagging.unlockAll.useMutation");
  });

  it("should show pre-condition check for missing categories", () => {
    expect(componentSrc).toContain("请先完成标签管理");
  });

  it("should show pre-condition check for unconfirmed categories", () => {
    expect(componentSrc).toContain("请先确认标签维度");
  });

  it("should display dimension framework from tag management", () => {
    expect(componentSrc).toContain("当前维度框架");
    expect(componentSrc).toContain("来自标签管理");
  });

  it("should support inline tag editing", () => {
    expect(componentSrc).toContain("devTagging.updateTag.useMutation");
  });
});

// ─── Test: DevProjectDetail includes tagging tab ────────────────
describe("DevProjectDetail tagging tab integration", () => {
  const detailPath = path.join(__dirname, "../client/src/pages/dev/DevProjectDetail.tsx");
  const detailSrc = fs.readFileSync(detailPath, "utf-8");

  it("should import AttributeTagging component", () => {
    expect(detailSrc).toContain('import AttributeTagging from "./AttributeTagging"');
  });

  it("should have tagging tab in phase1Tabs", () => {
    expect(detailSrc).toContain('"tagging"');
    expect(detailSrc).toContain('"属性标注"');
  });

  it("should have tagging tab between tags and panorama", () => {
    const tagsIdx = detailSrc.indexOf('"tags"');
    const taggingIdx = detailSrc.indexOf('"tagging"');
    const panoramaIdx = detailSrc.indexOf('"panorama"');
    expect(taggingIdx).toBeGreaterThan(tagsIdx);
    expect(taggingIdx).toBeLessThan(panoramaIdx);
  });

  it("should render AttributeTagging in TabsContent", () => {
    expect(detailSrc).toContain('<TabsContent value="tagging"');
    expect(detailSrc).toContain("<AttributeTagging");
  });

  it("should import Tag icon from lucide-react", () => {
    expect(detailSrc).toContain("Tag,");
  });
});

// ─── Test: Panorama table reads from dev_product_tags ───────────
describe("PanoramaTable reads from dev_product_tags", () => {
  const panoramaBackendPath = path.join(__dirname, "routers/devPanorama.ts");
  const panoramaSrc = fs.readFileSync(panoramaBackendPath, "utf-8");

  it("should import devProductTags from schema", () => {
    expect(panoramaSrc).toContain("devProductTags");
  });

  it("should build tagMap from devProductTags", () => {
    expect(panoramaSrc).toContain("tagMap");
    expect(panoramaSrc).toContain("dimensionName");
    expect(panoramaSrc).toContain("dimensionValue");
  });

  it("should use tagCategories for column headers", () => {
    expect(panoramaSrc).toContain("tagCategories");
    expect(panoramaSrc).toContain("categoryName");
  });
});

// ─── Test: No hardcoded 14 English dimensions remain ────────────
describe("No hardcoded dimensions in devTagging", () => {
  const routerPath = path.join(__dirname, "routers/devTagging.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  const oldHardcodedDimensions = [
    "productCategory", "style", "mainMaterial", "targetAudience",
    "sizeRange", "priceSegment", "designPattern", "specialFeature",
    "usageScenario", "brandPositioning", "colorScheme", "packagingType",
    "certifications", "ecoFriendly",
  ];

  for (const dim of oldHardcodedDimensions) {
    it(`should NOT contain old hardcoded dimension "${dim}"`, () => {
      // Check in the startTagging section specifically
      const startTaggingSection = routerSrc.substring(
        routerSrc.indexOf("startTagging:"),
        routerSrc.indexOf("getTaggedProducts:")
      );
      expect(startTaggingSection).not.toContain(`"${dim}"`);
    });
  }
});
