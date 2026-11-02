import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = (name: string) => readFileSync(resolve(process.cwd(), "client/src/pages/imageWorkflow", name), "utf8");

describe("图片工作流只读权限契约", () => {
  it("将统一编辑权限传递给Step0至Step4", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/ImageWorkflowPage.tsx"), "utf8");
    expect(source).toContain('const canEditImageWorkflow = canEdit("listing", "listing_image_workflow");');
    expect(source).toContain("<Step0CompetitorAnalysis projectId={projectId} session={session} onConfirm={handleStepConfirm} canEdit={canEditImageWorkflow} />");
    expect(source).toContain("<Step1SellingPoints projectId={projectId} session={session} onConfirm={handleStepConfirm} canEdit={canEditImageWorkflow} />");
    expect(source).toContain("<Step2ImageOutline projectId={projectId} session={session} onConfirm={handleStepConfirm} canEdit={canEditImageWorkflow} />");
    expect(source).toContain("<Step3StyleConfirm projectId={projectId} session={session} onConfirm={handleStepConfirm} canEdit={canEditImageWorkflow} />");
    expect(source).toContain("<Step4References projectId={projectId} session={session} onConfirm={handleStepConfirm} canEdit={canEditImageWorkflow} />");
    expect(source).toContain("{canEditImageWorkflow && session && (");
  });

  it("在只读会话中将Step0至Step4视为锁定，且参考图头部不渲染写入操作", () => {
    expect(page("CompetitorAnalysisStep.tsx")).toContain("const isLocked = isLockedState || !canEdit;");
    expect(page("SellingPointsStep.tsx")).toContain("const isConfirmed = isLocked || !canEdit;");
    expect(page("ImageOutlineStep.tsx")).toContain("const isLocked = isLockedState || !canEdit;");
    expect(page("StyleConfirmationStep.tsx")).toContain("const isLocked = isLockedState || !canEdit;");
    expect(page("ReferenceImagesStep.tsx")).toContain("const isLocked = isLockedState || !canEdit;");
    expect(page("ReferenceImagesHeader.tsx")).toContain("{canEdit && !hasData && (");
    expect(page("ReferenceImagesHeader.tsx")).toContain("{canEdit && hasData && !isConfirmed && (");
    expect(readFileSync(resolve(process.cwd(), "client/src/pages/ImageWorkflowPage.tsx"), "utf8")).toContain("您仅拥有图片建议查看权限，无法重置工作流");
  });
});
