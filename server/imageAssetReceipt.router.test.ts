import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveProjectAccess: vi.fn(), resolveSessionAccess: vi.fn(),
  getExpressionGroupByProject: vi.fn(), countExpressionGroupImages: vi.fn(),
  updateImageWorkflowSession: vi.fn(), insertExpressionGroupImage: vi.fn(), getCurrentStep4ImageVersions: vi.fn(),
  resolveSessionForExecution: vi.fn(), invokeBusinessSkill: vi.fn(), getReadableImage: vi.fn(),
}));
vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return { ...actual, resolveProjectAccess: mocks.resolveProjectAccess,
    resolveSessionAccess: mocks.resolveSessionAccess,
    resolveSessionForExecution: mocks.resolveSessionForExecution,
    invokeBusinessSkill: mocks.invokeBusinessSkill,
    kbDb: { ...actual.kbDb, getReadableImage: mocks.getReadableImage },
    db: { ...actual.db,
      getExpressionGroupByProject: mocks.getExpressionGroupByProject,
      countExpressionGroupImages: mocks.countExpressionGroupImages,
      updateImageWorkflowSession: mocks.updateImageWorkflowSession,
      insertExpressionGroupImage: mocks.insertExpressionGroupImage,
      getCurrentStep4ImageVersions: mocks.getCurrentStep4ImageVersions,
    } };
});
vi.mock("./domains/image/routers/sessions", async (importOriginal) => ({
  ...await importOriginal<typeof import("./domains/image/routers/sessions")>(),
  rebuildStep4DisplaySnapshot: (_session: unknown, requested: unknown) => requested,
}));

import { router } from "./_core/trpc";
import { imageReferenceProcedures, requireStep4DraftAssets } from "./domains/image/routers/references";
import { imageExpressionGroupProcedures } from "./domains/image/routers/expressionGroups";
import { imageWorkflowStepProcedures } from "./domains/image/routers/workflowSteps";
import { createImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";

const callerFactory = router({
  saveStep4Draft: imageReferenceProcedures.saveStep4Draft,
  regenerateAllFromReferences: imageReferenceProcedures.regenerateAllFromReferences,
  reoptimizeStep4WithRefs: imageReferenceProcedures.reoptimizeStep4WithRefs,
  addDesignerUpload: imageReferenceProcedures.addDesignerUpload,
  addImageToGroup: imageExpressionGroupProcedures.addImageToGroup,
  confirmStep4: imageWorkflowStepProcedures.confirmStep4,
});

const originalSecret = process.env.JWT_SECRET;
function ctx(userId = 17, workspaceId = 7): TrpcContext {
  return { user: { id: userId, role: "admin", openId: "test", name: "Test", email: "test@local.invalid",
    loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    workspaceId, req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
}

const signed = (kind: "designer" | "step4-ref" | "expression-group", projectId = 51, userId = 17) =>
  createImageAssetReceipt({ url: "https://assets.example.invalid/owned.png", key: "synthetic/owned.png", kind, projectId, userId }).url;

beforeEach(() => {
  process.env.JWT_SECRET = "local-only-synthetic-test-secret";
  vi.clearAllMocks();
  mocks.resolveProjectAccess.mockResolvedValue({ id: 51, userId: 17, workspaceId: 7 });
  mocks.resolveSessionAccess.mockResolvedValue({ id: 23, projectId: 51, userId: 17, step5DesignerUploads: "[]" });
  mocks.getExpressionGroupByProject.mockResolvedValue({ id: 9, projectId: 51 });
  mocks.countExpressionGroupImages.mockResolvedValue(0);
  mocks.insertExpressionGroupImage.mockResolvedValue({ insertId: 101 });
  mocks.getCurrentStep4ImageVersions.mockResolvedValue([]);
  mocks.resolveSessionForExecution.mockResolvedValue({ id: 23, projectId: 51, userId: 17 });
  mocks.getReadableImage.mockResolvedValue(null);
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("图片资产来源写入真实路由", () => {
  it("设计师图片拒绝任意URL、用途不符和跨项目回执；合法回执会撤销原已确认步骤", async () => {
    const caller = callerFactory.createCaller(ctx());
    const input = { projectId: 51, imageNumber: "main", imageUrl: "https://competitor.invalid/copied.jpg" };
    await expect(caller.addDesignerUpload(input)).rejects.toThrow(/受控上传/);
    await expect(caller.addDesignerUpload({ ...input, imageUrl: signed("step4-ref") })).rejects.toThrow(/类型/);
    await expect(caller.addDesignerUpload({ ...input, imageUrl: signed("designer", 52) })).rejects.toThrow(/项目/);
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
    await caller.addDesignerUpload({ ...input, imageUrl: signed("designer") });
    expect(mocks.updateImageWorkflowSession).toHaveBeenCalledWith(23, expect.objectContaining({ step5Confirmed: 0, step6Confirmed: 0 }));
  });
  it("Step4草稿拒绝裸URL和伪造KB ID，不写入旧的正式快照", async () => {
    const caller = callerFactory.createCaller(ctx());
    const draft = (url: string) => JSON.stringify({ imageReferences: [{ compositionRefImageUrl: url }] });
    await expect(caller.saveStep4Draft({ projectId: 51, userEdit: draft("https://competitor.invalid/image.jpg") })).rejects.toThrow(/受控上传/);
    await expect(caller.saveStep4Draft({ projectId: 51, userEdit: draft(signed("designer")) })).rejects.toThrow(/类型/);
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
    await caller.saveStep4Draft({ projectId: 51, userEdit: draft(signed("step4-ref")) });
    expect(mocks.updateImageWorkflowSession).toHaveBeenCalledWith(23, expect.objectContaining({ step4Confirmed: 0, step5Confirmed: 0, step6Confirmed: 0 }));
    await expect(requireStep4DraftAssets({ imageReferences: [{ kbReferenceImages: [{ id: -1, imageUrl: "https://competitor.invalid" }] }] }, ctx(), 51)).rejects.toThrow();
  });
  it("同空间可读但用途未审批的竞品知识库图片不能作为本品Step4参考或调用模型", async () => {
    mocks.getReadableImage.mockResolvedValue({ id: 77, imageUrl: "https://competitor.invalid/research.jpg", imagePosition: "main" });
    const caller = callerFactory.createCaller(ctx());
    const draft = JSON.stringify({ imageReferences: [{ imageNumber: "main", kbReferenceImages: [{ id: 77 }] }] });
    await expect(caller.saveStep4Draft({ projectId: 51, userEdit: draft })).rejects.toThrow(/用途尚未审核/);
    await expect(caller.regenerateAllFromReferences({ projectId: 51, kbImages: [{ id: 77 }] })).rejects.toThrow(/用途尚未审核/);
    expect(mocks.getReadableImage).not.toHaveBeenCalled();
    expect(mocks.invokeBusinessSkill).not.toHaveBeenCalled();
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
  it("Step4整体确认不会把旧版本中的外部图片URL升级成正式成果", async () => {
    mocks.getCurrentStep4ImageVersions.mockResolvedValue([{ imageIndex: 0,
      content: JSON.stringify({ imageNumber: "main", compositionRefImageUrl: "https://competitor.invalid/foreign.jpg" }) }]);
    const caller = callerFactory.createCaller(ctx());
    await expect(caller.confirmStep4({ projectId: 51,
      userEdit: JSON.stringify({ imageReferences: [{ imageNumber: "main" }] }) })).rejects.toThrow(/受控上传/);
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
  it("Step4再优化在裸URL或未审批知识库图片ID时不调用模型", async () => {
    const caller = callerFactory.createCaller(ctx());
    await expect(caller.reoptimizeStep4WithRefs({ projectId: 51, imageKey: "main",
      compositionRefUrl: "https://competitor.invalid/image.jpg" })).rejects.toThrow(/受控上传/);
    await expect(caller.regenerateAllFromReferences({ projectId: 51, kbImages: [{ id: 2024 }] })).rejects.toThrow(/用途尚未审核/);
    expect(mocks.invokeBusinessSkill).not.toHaveBeenCalled();
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
  it("竞品表达方式组仅可追加受签研究素材，不能裸写外部URL或引用别的项目", async () => {
    const caller = callerFactory.createCaller(ctx());
    const input = { projectId: 51, groupId: 9, competitorName: "research", imageUrl: "https://competitor.invalid/image.jpg" };
    await expect(caller.addImageToGroup(input)).rejects.toThrow(/受控上传/);
    expect(mocks.insertExpressionGroupImage).not.toHaveBeenCalled();
    await caller.addImageToGroup({ ...input, imageUrl: signed("expression-group") });
    expect(mocks.insertExpressionGroupImage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 51, imageUrl: "https://assets.example.invalid/owned.png" }));
    mocks.getExpressionGroupByProject.mockResolvedValue(null);
    await expect(caller.addImageToGroup({ ...input, imageUrl: signed("expression-group") })).rejects.toThrow(/Group not found/);
  });
});
