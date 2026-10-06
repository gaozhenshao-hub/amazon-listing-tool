import { describe, expect, it } from "vitest";
import { isComplexRichContent } from "@/components/LazyRichContent";
import { normalizePerformanceRoute, ratePerformanceMetric } from "./performanceVitals";

describe("匿名性能指标契约", () => {
  it("规范化路径，不保留项目编号、ASIN或查询参数", () => {
    expect(normalizePerformanceRoute("/listing/image-workflow/900001?asin=B0C61JBT71")).toBe("/listing/image-workflow/:id");
    expect(normalizePerformanceRoute("/knowledge/images/B0C61JBT71#details")).toBe("/knowledge/images/:asin");
  });

  it("以公开阈值标注性能等级", () => {
    expect(ratePerformanceMetric("LCP", 1200)).toBe("good");
    expect(ratePerformanceMetric("INP", 300)).toBe("needs-improvement");
    expect(ratePerformanceMetric("CLS", 0.31)).toBe("poor");
  });
});

describe("富文本惰性渲染分流", () => {
  it("仅为Mermaid或代码块启用重量渲染器", () => {
    expect(isComplexRichContent("**普通说明**\n\n可编辑内容")).toBe(false);
    expect(isComplexRichContent("```mermaid\ngraph TD\nA-->B\n```")).toBe(true);
    expect(isComplexRichContent("```ts\nconst value = 1\n```")).toBe(true);
  });
});
