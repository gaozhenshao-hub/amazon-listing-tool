/**
 * Tests for Intel Dedup and OCR Two-Step Flow
 */
import { describe, it, expect } from "vitest";

// ─── Intel Dedup Logic ────────────────────────────────────────
describe("Intel Dedup Logic", () => {
  type IntelItem = {
    id: number;
    originalUrl: string | null;
    aiQualityScore: string | null;
    title: string;
  };

  function dedupByUrl(items: IntelItem[]): { deduped: IntelItem[]; removed: number } {
    const urlMap = new Map<string, IntelItem>();
    for (const item of items) {
      const url = item.originalUrl || `__no_url_${item.id}`;
      const existing = urlMap.get(url);
      if (!existing) {
        urlMap.set(url, item);
      } else {
        const existingScore = parseFloat(existing.aiQualityScore || "0");
        const newScore = parseFloat(item.aiQualityScore || "0");
        if (newScore > existingScore) urlMap.set(url, item);
      }
    }
    const deduped = Array.from(urlMap.values());
    return { deduped, removed: items.length - deduped.length };
  }

  it("should remove duplicate URLs, keeping highest score", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: "https://example.com/article1", aiQualityScore: "7.5", title: "Article A v1" },
      { id: 2, originalUrl: "https://example.com/article1", aiQualityScore: "8.2", title: "Article A v2" },
      { id: 3, originalUrl: "https://example.com/article2", aiQualityScore: "6.0", title: "Article B" },
    ];
    const { deduped, removed } = dedupByUrl(items);
    expect(deduped).toHaveLength(2);
    expect(removed).toBe(1);
    // Should keep the one with higher score (id=2, score=8.2)
    const article1 = deduped.find(i => i.originalUrl === "https://example.com/article1");
    expect(article1?.id).toBe(2);
    expect(article1?.aiQualityScore).toBe("8.2");
  });

  it("should not remove items with different URLs", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: "https://example.com/a", aiQualityScore: "7.0", title: "A" },
      { id: 2, originalUrl: "https://example.com/b", aiQualityScore: "7.0", title: "B" },
      { id: 3, originalUrl: "https://example.com/c", aiQualityScore: "7.0", title: "C" },
    ];
    const { deduped, removed } = dedupByUrl(items);
    expect(deduped).toHaveLength(3);
    expect(removed).toBe(0);
  });

  it("should handle null URLs — each null URL treated as unique", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: null, aiQualityScore: "5.0", title: "No URL 1" },
      { id: 2, originalUrl: null, aiQualityScore: "6.0", title: "No URL 2" },
    ];
    const { deduped, removed } = dedupByUrl(items);
    // Each null URL gets unique key __no_url_<id>, so no dedup
    expect(deduped).toHaveLength(2);
    expect(removed).toBe(0);
  });

  it("should handle empty input", () => {
    const { deduped, removed } = dedupByUrl([]);
    expect(deduped).toHaveLength(0);
    expect(removed).toBe(0);
  });

  it("should keep first item when scores are equal", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: "https://example.com/same", aiQualityScore: "7.0", title: "First" },
      { id: 2, originalUrl: "https://example.com/same", aiQualityScore: "7.0", title: "Second" },
    ];
    const { deduped } = dedupByUrl(items);
    expect(deduped).toHaveLength(1);
    // Equal score — first one wins (id=1)
    expect(deduped[0].id).toBe(1);
  });

  it("should handle null quality scores as 0", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: "https://example.com/x", aiQualityScore: null, title: "No Score" },
      { id: 2, originalUrl: "https://example.com/x", aiQualityScore: "5.0", title: "With Score" },
    ];
    const { deduped } = dedupByUrl(items);
    expect(deduped).toHaveLength(1);
    // id=2 has higher score (5.0 > 0)
    expect(deduped[0].id).toBe(2);
  });

  it("should correctly count removed duplicates", () => {
    const items: IntelItem[] = [
      { id: 1, originalUrl: "https://a.com", aiQualityScore: "7.0", title: "A1" },
      { id: 2, originalUrl: "https://a.com", aiQualityScore: "8.0", title: "A2" },
      { id: 3, originalUrl: "https://a.com", aiQualityScore: "6.0", title: "A3" },
      { id: 4, originalUrl: "https://b.com", aiQualityScore: "7.0", title: "B1" },
      { id: 5, originalUrl: "https://b.com", aiQualityScore: "9.0", title: "B2" },
    ];
    const { deduped, removed } = dedupByUrl(items);
    expect(deduped).toHaveLength(2);
    expect(removed).toBe(3);
    const aItem = deduped.find(i => i.originalUrl === "https://a.com");
    const bItem = deduped.find(i => i.originalUrl === "https://b.com");
    expect(aItem?.id).toBe(2); // highest score 8.0
    expect(bItem?.id).toBe(5); // highest score 9.0
  });
});

// ─── OCR Two-Step Flow ────────────────────────────────────────
describe("OCR Two-Step Flow", () => {
  it("should filter out empty OCR texts before merge", () => {
    const ocrResults = [
      { index: 0, fileName: "img1.png", ocrText: "有效文字内容" },
      { index: 1, fileName: "img2.png", ocrText: "" },
      { index: 2, fileName: "img3.png", ocrText: "   " }, // whitespace only
    ];
    const validTexts = ocrResults.filter(r => r.ocrText.trim());
    expect(validTexts).toHaveLength(1);
    expect(validTexts[0].fileName).toBe("img1.png");
  });

  it("should count OCR image sections in extractedContent", () => {
    const extractedContent = `原始内容

=== 补充图片内容（AI识别）===
[图片1.png]: 这是第一张图片的内容

[图片2.png]: 这是第二张图片的内容`;

    // Count entries matching [filename]: pattern
    const entries = extractedContent.match(/^\[.+?\]:/gm);
    expect(entries).toHaveLength(2);
  });

  it("should return 0 for content without OCR sections", () => {
    const extractedContent = "普通文档内容，没有图片识别部分";
    const sectionStart = extractedContent.indexOf("=== 补充图片内容（AI识别）===");
    expect(sectionStart).toBe(-1);
  });

  it("should handle user editing OCR results before merge", () => {
    const ocrResults = [
      { index: 0, fileName: "screenshot.png", ocrText: "原始识别文字（可能有误）" },
    ];
    // Simulate user editing
    const edited = ocrResults.map(r =>
      r.index === 0 ? { ...r, ocrText: "用户修正后的文字" } : r
    );
    expect(edited[0].ocrText).toBe("用户修正后的文字");
    expect(edited[0].fileName).toBe("screenshot.png");
  });

  it("should build OCR section from confirmed texts", () => {
    const confirmedTexts = [
      { fileName: "流程图.png", ocrText: "步骤1: 创建广告活动\n步骤2: 设置竞价" },
      { fileName: "数据表.png", ocrText: "月销量: 1200\n月销售额: $45000" },
    ];
    const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n" +
      confirmedTexts.map(r => `[${r.fileName}]: ${r.ocrText}`).join("\n\n");

    expect(ocrSection).toContain("=== 补充图片内容（AI识别）===");
    expect(ocrSection).toContain("[流程图.png]: 步骤1");
    expect(ocrSection).toContain("[数据表.png]: 月销量");
  });

  it("should correctly report recognizedCount vs total", () => {
    const ocrResults = [
      { fileName: "img1.png", ocrText: "有内容" },
      { fileName: "img2.png", ocrText: "" },
      { fileName: "img3.png", ocrText: "也有内容" },
    ];
    const recognizedCount = ocrResults.filter(r => r.ocrText.trim()).length;
    expect(recognizedCount).toBe(2);
    expect(ocrResults.length).toBe(3);
  });
});
