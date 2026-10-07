import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ resolveSessionAccess: vi.fn(), updateImageWorkflowSession: vi.fn(), ensureWriteAccess: vi.fn() }));
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
  beforeEach(() => { vi.clearAllMocks(); });
  it("Step5已解锁的会话不能确认Step6", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ id: 33, projectId: 11, userId: 2, step5UserEdit: '{"mainImage":{}}', step5Confirmed: 0 });
    await expect(caller.confirmStep6(input)).rejects.toThrow("请先确认当前Step5");
    expect(mocks.updateImageWorkflowSession).not.toHaveBeenCalled();
  });
  it("只有当前Step5确已确认才保存Step6人审结果", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ id: 33, projectId: 11, userId: 2, step5UserEdit: '{"mainImage":{}}', step5Confirmed: 1 });
    mocks.updateImageWorkflowSession.mockResolvedValue(undefined);
    await expect(caller.confirmStep6(input)).resolves.toMatchObject({ success: true });
    expect(mocks.updateImageWorkflowSession).toHaveBeenCalledWith(33, expect.objectContaining({ step6Confirmed: 1 }));
  });
});
