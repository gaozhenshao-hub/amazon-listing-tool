import { describe, it, expect } from "vitest";
import { buildProfileContext, buildProfileSummary } from "./profileContextBuilder";

describe("profileContextBuilder", () => {
  describe("buildProfileContext", () => {
    it("returns placeholder when profile is null", () => {
      const result = buildProfileContext(null);
      expect(result).toContain("暂无");
    });

    it("returns placeholder when profile is undefined", () => {
      const result = buildProfileContext(undefined);
      expect(result).toContain("暂无");
    });

    it("returns placeholder when all fields are empty", () => {
      const result = buildProfileContext({});
      expect(result).toContain("暂无");
    });

    it("includes appearance data when present", () => {
      const result = buildProfileContext({
        appearanceColors: JSON.stringify({ colors: ["黑色", "银色"], materials: ["铝合金", "ABS塑料"], dimensions: "30x20x15cm" }),
        appearanceConfirmed: 1,
      });
      expect(result).toContain("外观设计");
      expect(result).toContain("已确认");
      expect(result).toContain("黑色");
      expect(result).toContain("铝合金");
    });

    it("includes functions data with main features and upgrade points", () => {
      const result = buildProfileContext({
        mainFunctions: JSON.stringify({
          mainFeatures: [
            { name: "多功能安全隔离", description: "提供宠物与驾驶员之间的安全物理隔离", priority: "高" },
            { name: "车辆内部保护", description: "有效保护车辆座椅", priority: "高" },
          ],
          upgradePoints: [
            { name: "模块化设计", title: "模块化设计与组合", description: "考虑将宠物隔离网设计成模块化", difficulty: "中等", costImpact: "中等" },
          ],
          differentiatedFeatures: "全方位呵护模块化系统",
        }),
        functionsConfirmed: 1,
      });
      expect(result).toContain("功能提升");
      expect(result).toContain("已确认");
      expect(result).toContain("多功能安全隔离");
      expect(result).toContain("模块化设计");
      expect(result).toContain("差异化功能");
    });

    it("includes cost breakdown data", () => {
      const result = buildProfileContext({
        costBreakdown: JSON.stringify({
          targetCost: "¥50",
          targetPrice: "$29.99",
          targetMargin: "45%",
          materialCost: "¥25",
          laborCost: "¥8",
        }),
        costConfirmed: 1,
      });
      expect(result).toContain("产品成本");
      expect(result).toContain("¥50");
      expect(result).toContain("$29.99");
      expect(result).toContain("45%");
    });

    it("includes package dimensions data", () => {
      const result = buildProfileContext({
        packageDimensions: JSON.stringify({
          length: 40, width: 30, height: 20, unit: "cm",
          weight: 2.5, weightUnit: "kg",
          type: "彩盒",
          material: "瓦楞纸",
        }),
        packageConfirmed: 1,
      });
      expect(result).toContain("包装设计");
      expect(result).toContain("40x30x20");
      expect(result).toContain("彩盒");
    });

    it("includes user persona data", () => {
      const result = buildProfileContext({
        userPersona: JSON.stringify({
          targetAge: "25-45岁",
          gender: "男女均有",
          income: "中高收入",
          painPoints: ["车内宠物安全", "座椅保护"],
          needs: ["安全隔离", "易安装"],
        }),
        userPersonaConfirmed: 1,
      });
      expect(result).toContain("用户画像");
      expect(result).toContain("25-45岁");
      expect(result).toContain("车内宠物安全");
    });

    it("includes usage scenarios data", () => {
      const result = buildProfileContext({
        usageScenarios: JSON.stringify([
          { name: "长途旅行", description: "高速公路长途驾驶时隔离宠物" },
          { name: "日常通勤", description: "城市短途出行" },
        ]),
        usageScenariosConfirmed: 1,
      });
      expect(result).toContain("使用场景");
      expect(result).toContain("长途旅行");
    });

    it("handles all 8 modules together", () => {
      const result = buildProfileContext({
        appearanceColors: JSON.stringify({ colors: ["黑色"] }),
        mainFunctions: JSON.stringify({ mainFeatures: [{ name: "功能A" }] }),
        costBreakdown: JSON.stringify({ targetCost: "¥50" }),
        packageDimensions: JSON.stringify({ length: 40 }),
        packageDesign: JSON.stringify({ style: "简约" }),
        userPersona: JSON.stringify({ targetAge: "25-45" }),
        usageScenarios: JSON.stringify([{ name: "场景A" }]),
        productMap: JSON.stringify({ category: "宠物用品" }),
        appearanceConfirmed: 1,
        functionsConfirmed: 1,
        costConfirmed: 0,
      });
      expect(result).toContain("共8个模块");
      expect(result).toContain("外观设计");
      expect(result).toContain("功能提升");
      expect(result).toContain("产品成本");
      expect(result).toContain("包装设计");
      expect(result).toContain("包装外观");
      expect(result).toContain("用户画像");
      expect(result).toContain("使用场景");
      expect(result).toContain("产品地图");
    });

    it("marks draft modules correctly", () => {
      const result = buildProfileContext({
        mainFunctions: JSON.stringify({ mainFeatures: [{ name: "功能A" }] }),
        functionsConfirmed: 0,
      });
      expect(result).toContain("草稿");
    });

    it("handles raw string values gracefully", () => {
      const result = buildProfileContext({
        appearanceColors: "黑色铝合金外壳",
        mainFunctions: "多功能安全隔离网",
      });
      expect(result).toContain("黑色铝合金外壳");
      expect(result).toContain("多功能安全隔离网");
    });

    it("handles items array format (SectionEditor format)", () => {
      const result = buildProfileContext({
        appearanceColors: JSON.stringify({
          items: [
            { name: "主色调", value: "黑色" },
            { name: "材质", value: "铝合金" },
          ],
        }),
      });
      expect(result).toContain("主色调");
      expect(result).toContain("黑色");
    });
  });

  describe("buildProfileSummary", () => {
    it("returns empty string for null profile", () => {
      expect(buildProfileSummary(null)).toBe("");
    });

    it("returns concise summary with key fields", () => {
      const result = buildProfileSummary({
        appearanceColors: JSON.stringify({ colors: ["黑色"], materials: ["铝合金"] }),
        mainFunctions: JSON.stringify({ mainFeatures: [{ name: "安全隔离", description: "物理隔离" }] }),
        costBreakdown: JSON.stringify({ targetCost: "¥50", targetPrice: "$29.99" }),
        packageDimensions: JSON.stringify({ length: 40, width: 30, height: 20 }),
      });
      expect(result).toContain("外观:");
      expect(result).toContain("功能:");
      expect(result).toContain("成本:");
      expect(result).toContain("包装:");
    });

    it("truncates long content", () => {
      const longDescription = "A".repeat(500);
      const result = buildProfileSummary({
        mainFunctions: JSON.stringify({ mainFeatures: [{ name: "功能", description: longDescription }] }),
      });
      expect(result.length).toBeLessThan(600);
    });
  });
});
