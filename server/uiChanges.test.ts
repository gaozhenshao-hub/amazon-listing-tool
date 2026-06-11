import { describe, it, expect } from "vitest";

// Test: DataFilesPage only supports product_attributes file type
describe("DataFilesPage simplification", () => {
  it("should only have product_attributes file type config", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/DataFilesPage.tsx", "utf-8");
    
    // product_attributes should exist
    expect(content).toContain("product_attributes");
    
    // Other file types should NOT exist in FILE_TYPE_CONFIG
    expect(content).not.toContain('"competitor_listings"');
    expect(content).not.toContain('"search_term_report"');
    expect(content).not.toContain('"aba_keywords"');
  });

  it("FILE_TYPES should only contain product_attributes", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/DataFilesPage.tsx", "utf-8");
    
    // Check FILE_TYPES definition line
    const fileTypesLine = content.split("\n").find(l => l.includes("const FILE_TYPES"));
    expect(fileTypesLine).toBeTruthy();
    expect(fileTypesLine).toContain("product_attributes");
    expect(fileTypesLine).not.toContain("competitor_listings");
    expect(fileTypesLine).not.toContain("search_term_report");
    expect(fileTypesLine).not.toContain("aba_keywords");
  });
});

// Test: Sidebar navigation order
describe("Sidebar navigation order", () => {
  it("should have 关键词管理 before 数据文件 in DashboardLayout", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/components/DashboardLayout.tsx", "utf-8");
    
    const keywordIndex = content.indexOf("关键词管理");
    const dataFileIndex = content.indexOf("数据文件");
    
    expect(keywordIndex).toBeGreaterThan(-1);
    expect(dataFileIndex).toBeGreaterThan(-1);
    expect(keywordIndex).toBeLessThan(dataFileIndex);
  });
});

// Test: Image advice bilingual support
describe("Image advice bilingual support", () => {
  it("should have imageAdviceCn field in schema", async () => {
    const fs = await import("fs");
    const schema = fs.readFileSync("drizzle/schema.ts", "utf-8");
    expect(schema).toContain("imageAdviceCn");
  });

  it("should have IMAGE_ADVICE_TRANSLATION_PROMPT in prompts", async () => {
    const fs = await import("fs");
    const prompts = fs.readFileSync("server/prompts.ts", "utf-8");
    expect(prompts).toContain("IMAGE_ADVICE_TRANSLATION_PROMPT");
    expect(prompts).toContain("export const IMAGE_ADVICE_TRANSLATION_PROMPT");
  });

  it("should have translateImageAdviceToChinese function in listing router", async () => {
    const fs = await import("fs");
    const listing = fs.readFileSync("server/routers/listing.ts", "utf-8");
    expect(listing).toContain("translateImageAdviceToChinese");
    expect(listing).toContain("IMAGE_ADVICE_TRANSLATION_PROMPT");
  });

  it("should save imageAdviceCn in generateFull", async () => {
    const fs = await import("fs");
    const listing = fs.readFileSync("server/routers/listing.ts", "utf-8");
    expect(listing).toContain("imageAdviceCn: imageAdviceCnStr");
  });

  it("should translate imageAdviceCn in translateToChinese", async () => {
    const fs = await import("fs");
    const listing = fs.readFileSync("server/routers/listing.ts", "utf-8");
    expect(listing).toContain("imageAdviceCn: imageAdviceCnStr");
    // Check that translateToChinese calls translateImageAdviceToChinese
    const translateSection = listing.substring(
      listing.indexOf("translateToChinese:"),
      listing.indexOf("update: protectedProcedure")
    );
    expect(translateSection).toContain("translateImageAdviceToChinese");
  });

  it("should display imageAdviceCn in PreviewPage bilingual tab", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("imageAdviceCn");
    // Check for bilingual comparison layout in image advice
    expect(preview).toContain("图片建议");
  });
});

// Test: Enhanced image advice fields display
describe("Enhanced image advice fields", () => {
  it("should display colorScheme fields in PreviewPage", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("colorScheme");
    expect(preview).toContain("配色方案");
    expect(preview).toContain("主色");
    expect(preview).toContain("辅色");
    expect(preview).toContain("点缀色");
  });

  it("should display expressionMethod in secondary images", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("expressionMethod");
    expect(preview).toContain("表达方式");
  });

  it("should display dataVisualization in secondary images and A+ content", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("dataVisualization");
    expect(preview).toContain("数据可视化");
  });

  it("should display icons in secondary images", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("img.icons");
    expect(preview).toContain("图标建议");
  });

  it("should display designGuidelines section", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("designGuidelines");
    expect(preview).toContain("整体设计指南");
    expect(preview).toContain("fontRecommendation");
    expect(preview).toContain("overallColorPalette");
    expect(preview).toContain("brandTone");
    expect(preview).toContain("mobileOptimization");
    expect(preview).toContain("推荐字体");
    expect(preview).toContain("品牌调性");
    expect(preview).toContain("手机端优化");
  });

  it("should display title field in main and secondary images", async () => {
    const fs = await import("fs");
    const preview = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(preview).toContain("imageAdvice.mainImage.title");
    expect(preview).toContain("img.title");
  });

  it("should have new fields in IMAGE_ADVICE_PROMPT", async () => {
    const fs = await import("fs");
    const prompts = fs.readFileSync("server/prompts.ts", "utf-8");
    expect(prompts).toContain('"colorScheme"');
    expect(prompts).toContain('"expressionMethod"');
    expect(prompts).toContain('"dataVisualization"');
    expect(prompts).toContain('"icons"');
    expect(prompts).toContain('"designGuidelines"');
    expect(prompts).toContain('"fontRecommendation"');
    expect(prompts).toContain('"overallColorPalette"');
    expect(prompts).toContain('"brandTone"');
    expect(prompts).toContain('"mobileOptimization"');
  });

  it("should have new fields in IMAGE_ADVICE_TRANSLATION_PROMPT", async () => {
    const fs = await import("fs");
    const prompts = fs.readFileSync("server/prompts.ts", "utf-8");
    const translationPrompt = prompts.substring(
      prompts.indexOf("IMAGE_ADVICE_TRANSLATION_PROMPT"),
      prompts.length
    );
    expect(translationPrompt).toContain("colorScheme");
    expect(translationPrompt).toContain("expressionMethod");
    expect(translationPrompt).toContain("dataVisualization");
    expect(translationPrompt).toContain("icons");
    expect(translationPrompt).toContain("designGuidelines");
    expect(translationPrompt).toContain("fontRecommendation");
    expect(translationPrompt).toContain("mobileOptimization");
  });
});
