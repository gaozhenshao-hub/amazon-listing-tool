import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Step4 参考图与方案版本保留", () => {
  const references = fs.readFileSync(path.join(root, "server/domains/image/routers/references.ts"), "utf8");
  const workflowSteps = fs.readFileSync(path.join(root, "server/domains/image/routers/workflowSteps.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "client/src/pages/imageWorkflow/ReferenceImagesStep.tsx"), "utf8");
  const step4Snapshot = fs.readFileSync(path.join(root, "server/domains/image/step4Snapshot.ts"), "utf8");

  it("提供非破坏性解锁和草稿保存接口", () => {
    expect(references).toContain("saveStep4Draft: protectedProcedure");
    expect(references).toContain("unlockStep4ForEditing: protectedProcedure");
    expect(references).toContain("getLatestStep4ReferenceJob");
    expect(references).toContain("latestResult || session.step4AiResult");
    expect(references).toContain('typeof value === "object" && !Array.isArray(value)');
    expect(references).toContain("await db.unlockAllStep4ImageVersions(session.id)");
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

  it("整体确认只发布已锁定单图快照，不合并旧 AI 或草稿字段", () => {
    expect(workflowSteps).toContain("buildStep4ConfirmedSnapshot(requestedSnapshot, versionByIndex)");
    expect(step4Snapshot).toContain("请先逐图点击“确认此图”，整体确认只会发布独立确认版本");
    expect(step4Snapshot).toContain("compactStep4ReferenceForStorage(confirmedByIndex.get(index)");
    expect(workflowSteps).toContain("step4AiResult: completeUserEdit");
    expect(workflowSteps).toContain("step4UserEdit: completeUserEdit");
  });

  it("锁定态展示以会话确认快照为权威，并只用 Artifact 补齐缺失图片资产", () => {
    const context = fs.readFileSync(path.join(root, "server/domains/image/routerContext.ts"), "utf8");
    const artifactRegistry = fs.readFileSync(path.join(root, "server/domains/ai_os/services/businessArtifactRegistry.ts"), "utf8");
    expect(workflowSteps).toContain("awaitStep4ArtifactRegistration");
    expect(workflowSteps).toContain("registration: registerImageWorkflowStepArtifact(session.id, 4, \"user_edit\")");
    expect(workflowSteps).toContain("STEP4_ARTIFACT_REGISTRATION_TIMEOUT_MS = 5_000");
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
    expect(page).toContain("请先逐图点击“确认此图”。尚有");
  });

  it("Step4 页面确认不会再调用旧 Agent 节点回调并回填历史 Artifact", () => {
    expect(page).toContain("onConfirm: _onConfirm");
    expect(page).toContain("setIsLocked(true);");
    expect(page).toContain("utils.imageWorkflow.getSession.invalidate({ projectId })");
    expect(page).not.toContain("onConfirm();");
  });

  it("单图确认版本使用独立数据库记录，整体确认只能从这些记录发布", () => {
    const refsRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/references.ts"), "utf8");
    const sessionsRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/sessions.ts"), "utf8");
    expect(refsRouter).toContain("confirmStep4ImageVersion");
    expect(refsRouter).toContain("unlockStep4ImageVersion");
    expect(refsRouter).toContain("unlockAllStep4ImageVersions");
    expect(sessionsRouter).toContain("applyCurrentStep4ImageVersions");
    expect(sessionsRouter).toContain("chooseStep4DisplayBase");
    expect(sessionsRouter).toContain("latestJobSnapshot");
    expect(workflowSteps).toContain("getCurrentStep4ImageVersions(session.id)");
    expect(step4Snapshot).toContain("整体确认只会发布独立确认版本");
  });

  it("整体确认后刷新仍以完整确认快照为基准并叠加逐图锁定版本", () => {
    const sessionsRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/sessions.ts"), "utf8");
    expect(workflowSteps).toContain("const completeSnapshot = buildStep4ConfirmedSnapshot(requestedSnapshot, versionByIndex)");
    expect(workflowSteps).toContain("step4Confirmed: 1");
    expect(sessionsRouter).toContain("const versions = await db.getCurrentStep4ImageVersions(session.id)");
    expect(sessionsRouter).toContain("if (confirmed) {");
    expect(sessionsRouter).toContain("return { ...reference, ...confirmed, isLocked: true");
    expect(sessionsRouter).toContain("rebuildStep4DisplaySnapshot(session, snapshot)");
  });

  it("逐图解锁后会清除过期展示锁定标记，恢复重新确认入口", () => {
    const sessionsRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/sessions.ts"), "utf8");
    expect(sessionsRouter).toContain("const { isLocked: _isLocked, lockedSnapshot: _lockedSnapshot, lockedAt: _lockedAt, ...unlockedReference }");
    expect(sessionsRouter).toContain("return { ...unlockedReference, isLocked: false };");
  });

  it("已锁定业务步骤时，旧 Agent 失败状态只能作为历史诊断，不能误标当前工作流失败", () => {
    const shell = fs.readFileSync(path.join(root, "client/src/components/workflow/WorkflowShell.tsx"), "utf8");
    const history = fs.readFileSync(path.join(root, "client/src/components/workflow/AiJobHistoryPanel.tsx"), "utf8");
    expect(shell).toContain('detail?.run?.status === "failed" && locked.size > 0 ? "completed"');
    expect(history).toContain("历史失败");
    expect(history).toContain("待处理失败");
  });
});
