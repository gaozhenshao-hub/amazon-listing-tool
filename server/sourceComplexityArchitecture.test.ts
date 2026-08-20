import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const FILE_LINE_LIMITS = {
  // 图片工作流按用户约束保留统一页面编排；子步骤已拆分，主页面保留状态协调与权限收口。
  "client/src/pages/ImageWorkflowPage.tsx": 2_000,
  "client/src/pages/dev/DevAnalysisFlow.tsx": 700,
  "client/src/pages/GeneratePage.tsx": 2_150,
  "server/routers/devAnalysis.ts": 1_800,
  "client/src/pages/imageWorkflow/CompetitorAnalysisStep.tsx": 650,
  "client/src/pages/imageWorkflow/ImageOutlineStep.tsx": 650,
  "client/src/pages/imageWorkflow/KnowledgeImagePickerDialog.tsx": 350,
  "client/src/pages/imageWorkflow/ReferenceImagesStep.tsx": 900,
  "client/src/pages/imageWorkflow/SellingPointsStep.tsx": 650,
  "client/src/pages/imageWorkflow/StyleConfirmationStep.tsx": 400,
} as const;

describe("source complexity architecture", () => {
  it("keeps decomposed workflow and router entrypoints within their budgets", () => {
    const violations = Object.entries(FILE_LINE_LIMITS).flatMap(([relativePath, limit]) => {
      const filePath = path.join(repositoryRoot, relativePath);
      const lineCount = fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;
      return lineCount > limit ? [`${relativePath}: ${lineCount} lines exceeds ${limit}`] : [];
    });

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
