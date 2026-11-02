import { describe, expect, it } from "vitest";
import { buildProjectListRows } from "./domains/product_development/projects/projectListViewModel";
import { repoPath } from "./testPaths";
import { readFileSync } from "node:fs";

describe("product-development project progress list", () => {
  it("combines manual fields with source-backed people, schedule, image and latest profit", () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    const rows = buildProjectListRows({
      projects: [{
        id: 8,
        workspaceId: 2,
        userId: 10,
        ownerName: "开发甲",
        name: "新品项目",
        description: null,
        targetMarket: "US",
        platform: "amazon",
        keywords: null,
        status: "draft",
        phase: "project_execution",
        approvedAt: null,
        approvedScore: null,
        createdAt,
        updatedAt: createdAt,
      }],
      progress: [{
        id: 1,
        workspaceId: 2,
        projectId: 8,
        primaryCompetitorAsin: "b0abc12345",
        selectorName: "选品乙",
        operatorName: "运营己、运营庚",
        landingStage: "sample_sourcing",
        landingProgress: 35,
        reviewStatus: "reviewing",
        assistantName: "协助丙",
        updatedBy: 10,
        createdAt,
        updatedAt: createdAt,
      }],
      products: [{
        id: 88,
        projectId: 8,
        asin: "B0ABC12345",
        imageUrl: "https://example.com/product.jpg",
      } as any],
      timePlans: [
        { projectId: 8, startOffset: 0, estimatedDays: 7 } as any,
        { projectId: 8, startOffset: 7, estimatedDays: 14 } as any,
      ],
      profits: [
        { projectId: 8, sellingPrice: "29.99", profit: "8", profitMargin: "26.7", updatedAt: new Date("2026-08-02") } as any,
        { projectId: 8, sellingPrice: "32.99", profit: "10", profitMargin: "30.3", updatedAt: new Date("2026-08-03") } as any,
      ],
      members: [
        { projectId: 8, userId: 11, name: "开发丁", role: "product_dev" },
        { projectId: 8, userId: 12, name: "运营戊", role: "ops_specialist" },
      ],
    } as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      primaryCompetitorAsin: "B0ABC12345",
      primaryCompetitorImageUrl: "https://example.com/product.jpg",
      selectorName: "选品乙",
      developerNames: ["开发甲", "开发丁"],
      operatorNames: ["运营己", "运营庚"],
      landingStage: "sample_sourcing",
      landingProgress: 35,
      expectedLandingDate: "2026-08-22T00:00:00.000Z",
      reviewStatus: "reviewing",
      assistantName: "协助丙",
      sellingPrice: "32.99",
      profit: "10",
      profitMargin: "30.3",
    });
  });

  it("treats formal project approval as the authoritative review status", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const [row] = buildProjectListRows({
      projects: [{ id: 1, userId: 2, ownerName: "开发甲", status: "completed", approvedAt: now, createdAt: now, updatedAt: now }],
      progress: [{ projectId: 1, reviewStatus: "rejected" }],
      products: [],
      timePlans: [],
      profits: [],
      members: [],
    } as any);

    expect(row.reviewStatus).toBe("approved");
    expect(row.landingStage).toBe("completed");
  });

  it("falls back to assigned operators until a manual operator value is saved", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const [row] = buildProjectListRows({
      projects: [{ id: 2, userId: 2, ownerName: "开发甲", phase: "market_analysis", createdAt: now, updatedAt: now }],
      progress: [{ projectId: 2, operatorName: null }],
      products: [],
      timePlans: [],
      profits: [],
      members: [{ projectId: 2, userId: 3, name: "运营乙", role: "ops_specialist" }],
    } as any);

    expect(row.operatorNames).toEqual(["运营乙"]);
    expect(row.phase).toBe("market_analysis");
    expect(row.landingStage).toBe("research");
  });

  it("keeps every requested project-list field in the table UI", () => {
    const source = readFileSync(repoPath("client/src/pages/dev/DevProjectProgressTable.tsx"), "utf8");
    for (const label of [
      "项目名称", "主要竞品 ASIN", "图片", "选品人", "开发人员", "运营人员",
      "所属阶段", "预期落地时间", "产品审核进度", "产品协助人",
      "产品售价", "产品利润", "利润率",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("updateProgress");
    expect(source).toContain("operatorName");
    expect(source).toContain("landingStageOptions");
    expect(source).toContain("下单生产中");
    expect(source).toContain("供应商选择");
    expect(source).not.toContain("row.landingProgress}%");
    expect(source).toContain("onDelete");
    expect(source).toContain("/dev/project/");
  });
});
