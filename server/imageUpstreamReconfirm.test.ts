import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ resolveSessionAccess: vi.fn(), updateImageWorkflowSession: vi.fn(),
  unlockAllStep4ImageVersions: vi.fn(), registerArtifact: vi.fn(), confirmHumanImageWorkflowStage: vi.fn() }));
vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return { ...actual, confirmHumanImageWorkflowStage: mocks.confirmHumanImageWorkflowStage };
});
vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return { ...actual, resolveSessionAccess: mocks.resolveSessionAccess,
    db: { ...actual.db, updateImageWorkflowSession: mocks.updateImageWorkflowSession,
      unlockAllStep4ImageVersions: mocks.unlockAllStep4ImageVersions } };
});
vi.mock("./domains/image/imageWorkflowAgentBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>();
  return { ...actual, syncStepConfirmToAgent: vi.fn(async () => {}) };
});
vi.mock("./domains/ai_os/services/businessArtifactRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/businessArtifactRegistry")>();
  return { ...actual, registerImageWorkflowStepArtifact: mocks.registerArtifact };
});
import { router } from "./_core/trpc";
import { imageWorkflowStepProcedures } from "./domains/image/routers/workflowSteps";

const caller = router({ step1: imageWorkflowStepProcedures.confirmStep1,
  step2: imageWorkflowStepProcedures.confirmStep2, step3: imageWorkflowStepProcedures.confirmStep3,
  lockAplus: imageWorkflowStepProcedures.lockStep2AplusSubmodule }).createCaller({
  user: { id: 17, role: "super_admin", openId: "test", email: "test@invalid.local", name: "test",
    loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  workspaceId: 7, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"],
} as TrpcContext);

describe("Step1–3直接重确认不能绕开下游失效链", () => {
  beforeEach(() => { vi.clearAllMocks();
    mocks.confirmHumanImageWorkflowStage.mockResolvedValue({
      snapshot: { version: 2 }, scopeRevision: 8,
      invalidation: { changed: true, invalidateSteps: [2, 3, 4, 5, 6] }, unchanged: false,
    });
    mocks.resolveSessionAccess.mockResolvedValue({ id: 23, userId: 17, projectId: 51,
      step1Confirmed: 1, step1UserEdit: JSON.stringify({ old: true }),
      step2Confirmed: 1, step2UserEdit: JSON.stringify({ secondaryImages: [] }),
      step3Confirmed: 1, step3UserEdit: JSON.stringify({ style: "old" }) });
  });
  it("Step1改变时清除Step2–6，并在落库前拒绝坏JSON", async () => {
    await expect(caller.step1({ projectId: 51, userEdit: "{" })).rejects.toThrow();
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
    await caller.step1({ projectId: 51, userEdit: JSON.stringify({ sellingPoints: ["new"] }) });
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7, projectId: 51, sessionId: 23, step: 1,
      content: { sellingPoints: ["new"] },
    }));
  });
  it("Step2重新确认改变时清除Step3–6", async () => {
    const secondaryImages = Array.from({ length: 6 }, (_, index) => ({
      imageNumber: index + 2, purpose: `Purpose ${index + 2}`, contentBrief: "Supported product message",
    }));
    await caller.step2({ projectId: 51, userEdit: JSON.stringify({ secondaryImages }) });
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7, projectId: 51, sessionId: 23, step: 2,
      content: expect.objectContaining({ secondaryImages: expect.any(Array) }),
    }));
  });
  it("Step3重新确认不同风格时清除Step4–6", async () => {
    await caller.step3({ projectId: 51, userEdit: JSON.stringify({ style: "new" }) });
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7, projectId: 51, sessionId: 23, step: 3, content: { style: "new" },
    }));
  });
  it("已确认Step2不能通过子模块锁定暗中改变后续步骤的原始输入", async () => {
    await expect(caller.lockAplus({ projectId: 51, moduleIndex: 0, submoduleIndex: 0 }))
      .rejects.toThrow(/已整体确认.*先解锁Step2/);
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
});
