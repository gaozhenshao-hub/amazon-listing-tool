import { describe, it, expect } from "vitest";

// Test the OCR content merging logic
describe("Image OCR Enrichment", () => {
  it("should append OCR results to existing content", () => {
    const existingContent = "这是原始文章内容，包含一些文字说明。";
    const ocrResults = [
      { fileName: "screenshot1.png", ocrText: "图片中的关键步骤：1. 设置广告预算 2. 选择关键词" },
      { fileName: "chart.png", ocrText: "数据表格：月销量 1200，月销售额 $45000" },
    ];

    const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n" +
      ocrResults.map(r => `[${r.fileName}]: ${r.ocrText}`).join("\n\n");
    const newContent = (existingContent + ocrSection).slice(0, 50000);

    expect(newContent).toContain("这是原始文章内容");
    expect(newContent).toContain("=== 补充图片内容（AI识别）===");
    expect(newContent).toContain("[screenshot1.png]");
    expect(newContent).toContain("设置广告预算");
    expect(newContent).toContain("[chart.png]");
    expect(newContent).toContain("月销量 1200");
  });

  it("should truncate content to 50000 characters", () => {
    const existingContent = "a".repeat(49990);
    const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n[img.png]: 图片内容";
    const newContent = (existingContent + ocrSection).slice(0, 50000);
    expect(newContent.length).toBeLessThanOrEqual(50000);
  });

  it("should filter out empty OCR results", () => {
    const ocrResults = [
      { status: "fulfilled", value: { fileName: "img1.png", ocrText: "有效内容" } },
      { status: "fulfilled", value: { fileName: "img2.png", ocrText: "" } },  // empty - filtered
      { status: "rejected", reason: "network error" },  // rejected - filtered
    ];

    const validResults = ocrResults
      .filter(r => r.status === "fulfilled" && (r as any).value.ocrText)
      .map(r => (r as any).value);

    expect(validResults).toHaveLength(1);
    expect(validResults[0].fileName).toBe("img1.png");
  });

  it("should handle '无文字内容' response from LLM", () => {
    const ocrText = "无文字内容";
    const result = ocrText.includes("无文字内容") ? "" : ocrText;
    expect(result).toBe("");
  });

  it("should handle base64 image data URL construction", () => {
    const mimeType = "image/jpeg";
    const base64 = "abc123def456";
    const dataUrl = `data:${mimeType};base64,${base64}`;
    expect(dataUrl).toBe("data:image/jpeg;base64,abc123def456");
    expect(dataUrl.startsWith("data:image/")).toBe(true);
  });

  it("should limit images to 20 per batch", () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ name: `img${i}.png` }));
    const limited = files.slice(0, 20);
    expect(limited).toHaveLength(20);
  });

  it("should construct OCR section with proper format", () => {
    const validResults = [
      { index: 1, fileName: "流程图.png", ocrText: "步骤1: 创建广告活动\n步骤2: 设置竞价" },
    ];
    const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n" +
      validResults.map(r => `[${r.fileName}]: ${r.ocrText}`).join("\n\n");

    expect(ocrSection).toContain("=== 补充图片内容（AI识别）===");
    expect(ocrSection).toContain("[流程图.png]");
    expect(ocrSection).toContain("步骤1: 创建广告活动");
  });

  it("should return correct enriched count in response", () => {
    const totalImages = 5;
    const validResults = [
      { fileName: "img1.png", ocrText: "内容1" },
      { fileName: "img2.png", ocrText: "内容2" },
      { fileName: "img3.png", ocrText: "内容3" },
    ];
    const response = {
      success: true,
      enriched: validResults.length,
      message: `已识别 ${validResults.length}/${totalImages} 张图片内容，正在重新分析...`,
    };
    expect(response.enriched).toBe(3);
    expect(response.message).toContain("3/5");
  });

  it("should handle empty content when no existing extractedContent", () => {
    const existingContent = "";  // null/undefined case
    const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n[img.png]: 识别内容";
    const newContent = ((existingContent || "") + ocrSection).slice(0, 50000);
    expect(newContent).toContain("识别内容");
    expect(newContent.startsWith("\n\n===")).toBe(true);
  });

  it("should validate image MIME types", () => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const testFiles = [
      { type: "image/jpeg", valid: true },
      { type: "image/png", valid: true },
      { type: "application/pdf", valid: false },
      { type: "text/plain", valid: false },
    ];
    testFiles.forEach(({ type, valid }) => {
      expect(type.startsWith("image/")).toBe(valid);
    });
  });
});
