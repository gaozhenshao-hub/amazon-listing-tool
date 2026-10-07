import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveProjectAccess: vi.fn(), resolveSessionAccess: vi.fn(),
  updateCompetitorImage: vi.fn(), deleteCompetitorImage: vi.fn(),
  updateImageWorkflowSession: vi.fn(), unlockAllStep4ImageVersions: vi.fn(),
  storagePut: vi.fn(), confirmPrimary: vi.fn(), confirmSelections: vi.fn(), composite: vi.fn(),
  confirmHumanImageWorkflowStage: vi.fn(),
}));
vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return { ...actual, confirmHumanImageWorkflowStage: mocks.confirmHumanImageWorkflowStage };
});
vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return { ...actual, resolveProjectAccess: mocks.resolveProjectAccess,
    resolveSessionAccess: mocks.resolveSessionAccess, storagePut: mocks.storagePut,
    db: { ...actual.db, updateCompetitorImage: mocks.updateCompetitorImage,
      deleteCompetitorImage: mocks.deleteCompetitorImage,
      updateImageWorkflowSession: mocks.updateImageWorkflowSession,
      unlockAllStep4ImageVersions: mocks.unlockAllStep4ImageVersions },
  };
});
vi.mock("./domains/image/imageWorkflowAgentBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>();
  return { ...actual, syncStepConfirmToAgent: vi.fn(async () => {}) };
});
vi.mock("./domains/image/competitorGalleryService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/competitorGalleryService")>();
  return { ...actual, requireConfirmedPrimaryGallery: mocks.confirmPrimary };
});
vi.mock("./domains/image/expressionLinkageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/expressionLinkageService")>();
  return { ...actual, requireConfirmedCompositeForSelections: mocks.confirmSelections,
    getConfirmedCompositeContext: mocks.composite };
});
import { router } from "./_core/trpc";
import { imageCompetitorProcedures } from "./domains/image/routers/competitors";

const callerFactory = router({ update: imageCompetitorProcedures.updateCompetitorImageAnalysis,
  delete: imageCompetitorProcedures.deleteCompetitorImage, upload: imageCompetitorProcedures.uploadCompetitorImage,
  confirm: imageCompetitorProcedures.confirmStep0 });
function ctx(): TrpcContext {
  return { user: { id: 17, role: "super_admin", openId: "test", email: "test@invalid.local", name: "test",
    loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    workspaceId: 7, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveProjectAccess.mockResolvedValue({ id: 51, userId: 17, workspaceId: 7 });
  mocks.resolveSessionAccess.mockResolvedValue({ id: 23, userId: 17, projectId: 51,
    step0Confirmed: 1, step0AiResult: JSON.stringify({ summary: "previous" }),
    step0UserEdit: null, agentRunId: null });
  mocks.confirmPrimary.mockResolvedValue(undefined);
  mocks.confirmSelections.mockResolvedValue(undefined);
  mocks.composite.mockResolvedValue(null);
  mocks.confirmHumanImageWorkflowStage.mockResolvedValue({
    snapshot: { version: 2 }, scopeRevision: 8,
    invalidation: { changed: true, invalidateSteps: [1, 2, 3, 4, 5, 6] }, unchanged: false,
  });
});

describe("竞品图片ID与项目、内容变更和图片字节的服务端边界", () => {
  it("更新和删除都把图片ID与当前项目ID一同下推仓储；无归属行失败关闭", async () => {
    const caller = callerFactory.createCaller(ctx());
    mocks.updateCompetitorImage.mockResolvedValue(false);
    await expect(caller.update({ projectId: 51, imageId: 999, userEdit: "edited" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.updateCompetitorImage).toHaveBeenCalledWith(999, 51, { userEdit: "edited", imageType: null });
    mocks.deleteCompetitorImage.mockResolvedValue(false);
    await expect(caller.delete({ projectId: 51, imageId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.deleteCompetitorImage).toHaveBeenCalledWith(999, 51);
  });
  it("旧竞品tRPC上传的HTML/SVG伪装为PNG也不得在存储前通过", async () => {
    const caller = callerFactory.createCaller(ctx());
    await expect(caller.upload({ projectId: 51, competitorName: "Research only", fileName: "fake.png",
      imageData: Buffer.from("<html><script>bad()</script></html>").toString("base64") }))
      .rejects.toThrow();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("Step0重确认不同研究结论时必须交由同一0206确认事务撤销Step1–6", async () => {
    const caller = callerFactory.createCaller(ctx());
    await expect(caller.confirm({ projectId: 51, userEdit: JSON.stringify({ summary: "reviewed change" }) }))
      .resolves.toMatchObject({ success: true, version: 2, scopeRevision: 8 });
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7, projectId: 51, sessionId: 23, step: 0, content: { summary: "reviewed change" },
    }));
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
    expect(mocks.unlockAllStep4ImageVersions).not.toHaveBeenCalled();
  });
});
