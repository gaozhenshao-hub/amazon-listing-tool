import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Step4 参考图与方案版本保留", () => {
  const references = fs.readFileSync(path.join(root, "server/domains/image/routers/references.ts"), "utf8");
  const workflowSteps = fs.readFileSync(path.join(root, "server/domains/image/routers/workflowSteps.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "client/src/pages/imageWorkflow/ReferenceImagesStep.tsx"), "utf8");

  it("提供非破坏性解锁和草稿保存接口", () => {
    expect(references).toContain("saveStep4Draft: protectedProcedure");
    expect(references).toContain("unlockStep4ForEditing: protectedProcedure");
    expect(references).toContain("mergeStep4DraftVersions(session.step4UserEdit, session.step4AiResult)");
    expect(references).toContain("step4Confirmed: 0");
  });

  it("单图重新优化会保存完整合并结果，而非只返回内存对象", () => {
    expect(references).toContain("const updatedResult = { ...(currentStep4 || {}), imageReferences: updatedRefs };");
    expect(references).toContain("step4UserEdit: JSON.stringify(updatedResult)");
    expect(references).toContain("compositionRefImageUrl: existingRef?.compositionRefImageUrl");
    expect(references).toContain("kbReferenceImages: existingRef?.kbReferenceImages");
  });

  it("前台解锁、上传、选图和优化后都会保存草稿", () => {
    expect(page).toContain("trpc.imageWorkflow.unlockStep4ForEditing.useMutation()");
    expect(page).toContain("trpc.imageWorkflow.saveStep4Draft.useMutation()");
    expect(page).toContain("已解锁，已保留当前方案与参考图");
    expect(page.match(/await persistStep4Draft\(/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("重新锁定时将完整快照而非旧 Artifact 文本设为当前正式版本", () => {
    expect(workflowSteps).toContain("function mergeStep4CompleteSnapshot(");
    expect(workflowSteps).toContain("compositionRefImageUrl:");
    expect(workflowSteps).toContain("effectRefImageUrl:");
    expect(workflowSteps).toContain("kbReferenceImages:");
    expect(workflowSteps).toContain("step4AiResult: completeUserEdit");
    expect(workflowSteps).toContain("step4UserEdit: completeUserEdit");
  });

  it("锁定态展示以会话确认快照为权威，并只用 Artifact 补齐缺失图片资产", () => {
    const context = fs.readFileSync(path.join(root, "server/domains/image/routerContext.ts"), "utf8");
    const artifactRegistry = fs.readFileSync(path.join(root, "server/domains/ai_os/services/businessArtifactRegistry.ts"), "utf8");
    expect(workflowSteps).toContain("await registerImageWorkflowStepArtifact(session.id, 4, \"user_edit\")");
    expect(context).toContain("const completeStep4 = { ...artifactStep4, ...sessionStep4, imageReferences: mergedReferences }");
    expect(context).toContain("compositionRefImageUrl: sessionRef.compositionRefImageUrl || artifactRef.compositionRefImageUrl");
    expect(context).toContain("kbReferenceImages: sessionRef.kbReferenceImages?.length");
    expect(artifactRegistry).toContain("function mergeStep4SessionSnapshotWithArtifact(");
    expect(artifactRegistry).toContain("sessionRef.compositionRefImageUrl || artifactRef.compositionRefImageUrl");
    expect(artifactRegistry).toContain("step === 4 && session.step4UserEdit");
  });

  it("单图重新生成可独立确认锁定，且全局确认会采用该图的锁定快照", () => {
    expect(page).toContain("const handleLockSingle = async (idx: number)");
    expect(page).toContain("const handleUnlockSingle = async (idx: number)");
    expect(page).toContain("lockedSnapshot:");
    expect(page).toContain("确认此图");
    expect(page).toContain("解锁此图");
    expect(workflowSteps).toContain("const lockedSnapshot = currentRef.isLocked && currentRef.lockedSnapshot");
    expect(workflowSteps).toContain("...(lockedSnapshot || {})");
  });
});
