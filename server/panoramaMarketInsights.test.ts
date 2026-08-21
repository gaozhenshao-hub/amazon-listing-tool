import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  panoramaCompetitorAsinsSchema,
  panoramaMarketInsightResultSchema,
} from "./domains/product_development/panorama/marketInsightSchema";

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("panorama market insight contract", () => {
  it("accepts a four-section competitor matrix with 4-5 price bands", () => {
    const result = panoramaMarketInsightResultSchema.parse({
      priceBands: Array.from({ length: 4 }, (_, index) => ({
        label: `$${index * 10}-$${index * 10 + 9}`,
        min: index * 10,
        max: index * 10 + 9,
      })),
      competitors: [
        { asin: "B001", name: "竞品1" },
        { asin: "B002", name: "竞品2" },
      ],
      sections: [
        { key: "selling_points", label: "卖点分析", rows: [{ item: "防水", cells: { B001: "✓" } }] },
        { key: "parameters", label: "参数分析", rows: [{ item: "尺寸", cells: { B001: "15英寸" } }] },
        { key: "positive_reviews", label: "评论分析-好评", rows: [{ item: "易用", cells: { B001: "✓" } }] },
        { key: "negative_reviews", label: "评论分析-差评", rows: [{ item: "噪音", cells: { B002: "✓" } }] },
      ],
      summary: "总结",
    });
    expect(result.sections).toHaveLength(4);
  });

  it("requires 2-4 unique, normalized competitors selected by the user", () => {
    expect(panoramaCompetitorAsinsSchema.parse([" b001 ", "b002"])).toEqual(["B001", "B002"]);
    expect(() => panoramaCompetitorAsinsSchema.parse(["B001"])).toThrow();
    expect(() => panoramaCompetitorAsinsSchema.parse(["B001", "B001"])).toThrow();
    expect(() => panoramaCompetitorAsinsSchema.parse(["B001", "B002", "B003", "B004", "B005"])).toThrow();
  });

  it("keeps the prompt in Emperor database migration and runs through an AI Job", () => {
    const migration = read("drizzle/0133_dev_panorama_competitor_selection.sql");
    const service = read("server/domains/product_development/panorama/marketInsightService.ts");
    const worker = read("server/_core/aiWorker.ts");
    expect(migration).toContain("dev.panorama.market_insights");
    expect(migration).toContain("systemPrompt");
    expect(migration).toContain("selectionPolicy.selectedCompetitorAsins");
    expect(migration).toContain("不得新增、删除、替换");
    expect(service).toContain('kind: "dev.panorama.marketInsight"');
    expect(service).toContain('skillSlug: "dev.panorama.market_insights"');
    expect(service).toContain("runEmperorSkill");
    expect(service).toContain("competitorAsins");
    expect(service).toContain("与用户勾选结果不一致");
    expect(worker).toContain('import "../domains/product_development/panorama/marketInsightService"');
  });

  it("provides edit, confirmation, unlock and cancel routes", () => {
    const router = read("server/routers/devPanorama.ts");
    for (const procedure of [
      "generateMarketInsight",
      "setMarketInsightSelection",
      "saveMarketInsight",
      "confirmMarketInsight",
      "unlockMarketInsight",
      "cancelMarketInsight",
    ]) {
      expect(router).toContain(`${procedure}:`);
    }
  });

  it("publishes confirmed output as an Artifact consumed by information summary", () => {
    const registry = read("server/domains/ai_os/services/businessArtifactRegistry.ts");
    const service = read("server/domains/product_development/panorama/marketInsightService.ts");
    const summary = read("server/domains/product_development/analysis/informationSummaryService.ts");
    expect(registry).toContain("registerPanoramaMarketInsightArtifact");
    expect(registry).toContain('artifactKey: "dev.panorama.market_insights"');
    expect(service).toContain("registerPanoramaMarketInsightArtifact");
    expect(summary).toContain("resolveCurrentPanoramaMarketInsightArtifact");
    expect(summary).toContain("confirmedPanoramaMarketInsight");
  });

  it("renders the matrix after the panorama table", () => {
    const panorama = read("client/src/pages/dev/PanoramaTable.tsx");
    const matrix = read("client/src/pages/dev/MajorCompetitorAnalysis.tsx");
    expect(panorama).toContain("<MajorCompetitorAnalysis");
    expect(panorama).toContain("主要竞品");
    expect(panorama).toContain("selectedCompetitorAsins");
    expect(panorama).toContain("setMarketInsightSelection");
    expect(panorama).toContain("<Checkbox");
    expect(matrix).toContain("主要竞争对手分析");
    expect(matrix).toContain("分析已选");
    expect(matrix).toContain("人工备注");
    expect(matrix).toContain("确认锁定");
    expect(matrix).toContain("主要竞品选择会自动保存");
  });
});
