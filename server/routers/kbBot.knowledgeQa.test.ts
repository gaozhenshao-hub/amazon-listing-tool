import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: Object.fromEntries(["preview", "start", "check", "cancel", "threads", "history", "rename", "delete", "clear", "feedback"].map(name => [name, vi.fn()])), getDb: vi.fn(), invoke: vi.fn() }));
vi.mock("../domains/knowledge/knowledgeQaService", () => ({ knowledgeQaService: mocks.service }));
vi.mock("../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.invoke }));
import { kbBotRouter } from "./kbBot";
import type { TrpcContext } from "../_core/context";
const scope = { expectedWorkspaceId: 7, threadId: "22222222-2222-4222-8222-222222222222", operationId: "11111111-1111-4111-8111-111111111111" };
const ctx = { user: { id: 3, role: "super_admin", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const view = { identity: { userId: 3, workspaceId: 7 }, scope, state: "not_found", stage: null, sourceHash: null, runtimeHash: null, resultHash: null, question: null, answer: null, configuration: null, reasonCode: "OPERATION_NOT_OBSERVED", createdAt: null, sourceChanged: false };
beforeEach(() => vi.clearAllMocks()); afterEach(() => vi.unstubAllEnvs());
describe("knowledge QA public router and legacy isolation", () => {
  it("uses mutation only for explicit sends/cancel/feedback/thread edits", () => {
    for (const name of ["qaStart", "qaCancel", "qaRename", "qaDelete", "qaClear", "qaFeedback"] as const) expect(kbBotRouter._def.procedures[name]._def.type).toBe("mutation");
    for (const name of ["qaPreview", "qaCheck", "qaThreads", "qaHistory"] as const) expect(kbBotRouter._def.procedures[name]._def.type).toBe("query");
  });
  it("forwards the exact authenticated original UUID scope", async () => { mocks.service.check.mockResolvedValue(view); expect(await kbBotRouter.createCaller(ctx).qaCheck(scope)).toEqual(view); expect(mocks.service.check).toHaveBeenCalledWith(expect.objectContaining({ user: ctx.user }), scope); });
  it("rejects untrusted authority/body before the service", async () => {
    await expect(kbBotRouter.createCaller(ctx).qaCheck({ ...scope, ownerId: 5 } as never)).rejects.toThrow(); expect(mocks.service.check).not.toHaveBeenCalled();
    await expect(kbBotRouter.createCaller(ctx).qaStart({ ...scope, question: "Q", expectedSourceHash: "a".repeat(64), expectedRuntimeHash: "b".repeat(64), maxCostCents: 1, chargeConfirmed: false } as never)).rejects.toThrow(); expect(mocks.service.start).not.toHaveBeenCalled();
  });
  it("requires login and rejects malformed output", async () => {
    await expect(kbBotRouter.createCaller({ ...ctx, user: null }).qaCheck(scope)).rejects.toThrow(); expect(mocks.service.check).not.toHaveBeenCalled();
    mocks.service.check.mockResolvedValue({ ...view, answer: { private: true } }); await expect(kbBotRouter.createCaller(ctx).qaCheck(scope)).rejects.toThrow();
  });
  it("legacy numeric IDs cannot query private UUID thread history", async () => {
    await expect(kbBotRouter.createCaller(ctx).getHistory({ conversationId: scope.threadId } as never)).rejects.toThrow(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("enabling governed sends closes the old synchronous paid route before any DB/model", async () => {
    vi.stubEnv("ENABLE_KNOWLEDGE_QA_WRITES", "true"); await expect(kbBotRouter.createCaller(ctx).chat({ message: "SYNTHETIC" })).rejects.toThrow("费用确认"); expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cancel returns no private answer or question", async () => { const result = { identity: view.identity, scope, state: "canceled", reasonCode: "OPERATION_CANCELED" }; mocks.service.cancel.mockResolvedValue(result); expect(await kbBotRouter.createCaller(ctx).qaCancel(scope)).toEqual(result); });
});
