import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveSessionAccess: vi.fn(), updateImageWorkflowSession: vi.fn(), ensureWriteAccess: vi.fn(),
  confirmHumanImageWorkflowStage: vi.fn(),
}));
vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return { ...actual, confirmHumanImageWorkflowStage: mocks.confirmHumanImageWorkflowStage };
});
vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return {
    ...actual,
    resolveSessionAccess: mocks.resolveSessionAccess,
    ensureWriteAccess: mocks.ensureWriteAccess,
    db: { ...actual.db, updateImageWorkflowSession: mocks.updateImageWorkflowSession },
  };
});
import { router } from "./_core/trpc";
import { imageStep6Procedures } from "./domains/image/routers/step6";

const ctx: TrpcContext = {
  user: { id: 2, role: "admin", openId: "step6test", email: "step6@test.local", name: "Reviewer",
    loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  workspaceId: 3,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
};
const caller = router({ confirmStep6: imageStep6Procedures.confirmStep6 }).createCaller(ctx);
const input = { projectId: 11, userEdit: JSON.stringify({ prompts: [{ target: "main", englishPrompt: "Confirmed" }] }) };

describe("Step6前序确认约束", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmHumanImageWorkflowStage.mockResolvedValue({ snapshot: { version: 6 }, scopeRevision: 12 });
  });
  it("Step5已解锁时，0206确认事务拒绝Step6且不降级为旧会话写入", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ id: 33, projectId: 11, userId: 2, step5UserEdit: '{"mainImage":{}}', step5Confirmed: 0 });
    mocks.confirmHumanImageWorkflowStage.mockRejectedValueOnce(new Error("请先确认当前Step5"));
    await expect(caller.confirmStep6(input)).rejects.toThrow("请先确认当前Step5");
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({ step: 6, sessionId: 33 }));
  });
  it("当前Step5已确认时由0206确认事务保存Step6人审结果", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ id: 33, projectId: 11, userId: 2, step5UserEdit: '{"mainImage":{}}', step5Confirmed: 1 });
    await expect(caller.confirmStep6(input)).resolves.toMatchObject({ success: true });
    expect(mocks.confirmHumanImageWorkflowStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 3, projectId: 11, sessionId: 33, step: 6,
    }));
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
});
