import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("AI Tag Generation from Bullet Points Data", () => {
  const routerCode = readFileSync("server/routers/devProjectTags.ts", "utf-8");

  describe("aiGenerateTags procedure", () => {
    it("should check bullet_points data confirmation status", () => {
      expect(routerCode).toContain("getDataConfirmationStatus");
      expect(routerCode).toContain("bullet_points");
    });

    it("should include bulletPoints in product context (up to 2000 chars)", () => {
      expect(routerCode).toContain("String(p.bulletPoints).slice(0, 2000)");
    });

    it("should include description in product context", () => {
      expect(routerCode).toContain("p.description");
    });

    it("should include specifications in product context", () => {
      expect(routerCode).toContain("p.specifications");
    });

    it("should use enhanced prompt mentioning bullet points analysis", () => {
      expect(routerCode).toContain("五点描述");
      expect(routerCode).toContain("Bullet Points");
    });

    it("should extract attributes from titles (品类词/材质词/功能词/场景词)", () => {
      expect(routerCode).toContain("品类词");
      expect(routerCode).toContain("材质词");
      expect(routerCode).toContain("功能词");
      expect(routerCode).toContain("场景词");
    });

    it("should extract core selling points from bullet points", () => {
      expect(routerCode).toContain("核心卖点");
      expect(routerCode).toContain("功能特性");
      expect(routerCode).toContain("技术参数");
    });

    it("should indicate data source in prompt when bullet_points confirmed", () => {
      expect(routerCode).toContain("hasBulletPointsData");
      expect(routerCode).toContain("已确认的标题五点描述数据");
    });

    it("should process up to 30 products for context", () => {
      expect(routerCode).toContain("products.slice(0, 30)");
    });
  });

  describe("aiGenerateCategoryTags procedure", () => {
    it("should also use enhanced product context with full bullet points", () => {
      // The category-level AI generation should also use rich context
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("bulletPoints");
      expect(categorySection).toContain("description");
    });

    it("should use enhanced prompt for category tags", () => {
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("五点描述");
      expect(categorySection).toContain("Bullet Points");
    });

    it("should process up to 30 products for category context", () => {
      const categorySection = routerCode.split("aiGenerateCategoryTags")[1];
      expect(categorySection).toContain("products.slice(0, 30)");
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
