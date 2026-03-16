import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("AI Tag Generation from Bullet Points Data", () => {
  const routerCode = readFileSync("server/routers/devProjectTags.ts", "utf-8");

  describe("aiGenerateTags procedure", () => {
    it("should check bullet_points data confirmation status", () => {
      expect(routerCode).toContain("getDataConfirmationStatus");
      expect(routerCode).toContain("bullet_points");
    });

    it("should pass full bulletPoints without truncation", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("ctx.bulletPoints = String(p.bulletPoints)");
      // Should NOT truncate
      expect(aiGenSection).not.toContain("bulletPoints).slice(0, 2000)");
    });

    it("should include description in product context", () => {
      expect(routerCode).toContain("p.description");
    });

    it("should include specifications in product context", () => {
      expect(routerCode).toContain("p.specifications");
    });

    it("should use strict anti-hallucination prompt", () => {
      expect(routerCode).toContain("绝对禁止编造");
      expect(routerCode).toContain("每个标签必须有原文依据");
    });

    it("should extract attributes from titles (品类词/材质词/功能词)", () => {
      expect(routerCode).toContain("品类词");
      expect(routerCode).toContain("材质词");
      expect(routerCode).toContain("功能词");
    });

    it("should require evidence field in AI response", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain('"evidence"');
      expect(aiGenSection).toContain("sourceEvidence: tag.evidence");
    });

    it("should indicate data source in prompt when bullet_points confirmed", () => {
      expect(routerCode).toContain("hasBulletPointsData");
    });

    it("should process up to 50 products for context", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("products.slice(0, 50)");
    });
  });

  describe("aiGenerateCategoryTags procedure", () => {
    it("should also use enhanced product context with full bullet points", () => {
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("bulletPoints");
      expect(categorySection).toContain("description");
    });

    it("should use strict anti-hallucination prompt for category tags", () => {
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("绝对禁止编造");
      expect(categorySection).toContain("evidence");
    });

    it("should process up to 50 products for category context", () => {
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("products.slice(0, 50)");
    });
  });

  describe("Frontend data source indicator", () => {
    const detailCode = readFileSync("client/src/pages/dev/DevProjectDetail.tsx", "utf-8");

    it("should query data status for bullet_points confirmation", () => {
      expect(detailCode).toContain("getDataStatus");
      expect(detailCode).toContain("bullet_points");
    });

    it("should show confirmed indicator when bullet_points data is confirmed", () => {
      expect(detailCode).toContain("标题五点数据已确认");
    });

    it("should show warning when bullet_points data is not confirmed", () => {
      expect(detailCode).toContain("标题五点数据未确认");
    });

    it("should show record count for confirmed bullet_points data", () => {
      expect(detailCode).toContain("totalRows");
    });

    it("should suggest uploading bullet_points data for better results", () => {
      expect(detailCode).toContain("建议先上传并确认标题五点数据");
    });
  });
});
