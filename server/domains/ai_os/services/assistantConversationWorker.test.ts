import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantConversationProcessor, createAssistantConversationWorker, shouldProcessAssistantConversations, startAssistantConversationWorker } from "./assistantConversationWorker";
import { AssistantConversationStorageError, type AssistantConversationSession, type AssistantConversationTurn, type AssistantConversationLease, type AssistantConversationCheckpoint } from "../repositories/assistantConversations";
import type { AssistantConversationRuntime, AssistantConversationPreparedStage } from "./assistantConversationRuntime";
import type { AssistantConversationSavedConfiguration } from "./assistantConversationContext";
import type { AssistantConversationSubmitInputSchema } from "../../../../shared/assistantConversation";
import type { z } from "zod";

const hint = { id: 3, workspaceId: 1, userId: 2, threadId: "a0000000-0000-4000-8000-000000000001", operationId: "a0000000-0000-4000-8000-000000000002" };
const digest = "a".repeat(64);
function processorFixture(state: AssistantConversationTurn["state"] = "queued", mode: "work" | "coach" = "work", automatic = true) {
  let enabled = true, inTransaction = false, duplicateFence = false;
  const controller = new AbortController(), events: string[] = [];
  const lease: AssistantConversationLease = { operationId: hint.operationId, threadId: hint.threadId, workerId: "synthetic-worker", leaseToken: "a0000000-0000-4000-8000-000000000003", attempt: 1 };
  const saved: AssistantConversationSavedConfiguration = { workspaceId: 1, agentKey: "listing", revision: 1, hash: digest,
    config: { name: "Synthetic", description: "", enabled: true, modelSlug: "synthetic", instructions: "", rules: [], skills: [{ slug: "listing.test", enabled: true, trigger: "", instructions: "", version: 1, manifestSha256: digest }] } };
  const request: z.infer<typeof AssistantConversationSubmitInputSchema> = { expectedWorkspaceId: 1, agentKey: "listing", threadId: hint.threadId, operationId: hint.operationId, expectedThreadVersion: 1,
    expectedConfiguration: { revision: 1, hash: digest }, mode, selection: automatic ? { kind: "automatic" } : { kind: "explicit", skillSlug: "listing.test" }, message: "Private test message", files: [] };
  const turn = { ...hint, agentKey: "listing", sequence: 1, mode, state, runtime: { synthetic: true }, routeResult: state === "route_ready" ? { skillSlug: "listing.test" } : null,
    replyResult: state === "reply_ready" ? { reply: "Already saved", proposedRules: null } : null } as unknown as AssistantConversationTurn;
  const authorized = vi.fn(async () => { events.push("authorize"); });
  const heartbeat = vi.fn(async () => { events.push("heartbeat"); });
  const checkpoint = vi.fn(async (_lease: AssistantConversationLease, change: AssistantConversationCheckpoint) => {
    if (turn.state !== change.expectedState) throw new AssistantConversationStorageError("CHECKPOINT_CONFLICT");
    turn.state = change.nextState; events.push(change.nextState);
    if (change.nextState === "route_dispatched") turn.routeDispatch = change.dispatchReceipt;
    if (change.nextState === "reply_dispatched") turn.replyDispatch = change.dispatchReceipt;
    if (change.nextState === "route_ready") turn.routeResult = change.result;
    if (change.nextState === "reply_ready") { turn.replyResult = change.result; turn.proposal = change.proposal; }
    return structuredClone(turn);
  });
  const claim = vi.fn(async () => {
    if (turn.state.endsWith("dispatched")) { turn.state = "unknown"; return { turn, lease: null }; }
    return { turn: structuredClone(turn), lease };
  });
  const finish = vi.fn(async () => { if (turn.state !== "reply_ready") throw new Error("not ready"); turn.state = "succeeded"; events.push("succeeded"); return turn; });
  const fail = vi.fn(async (_lease: AssistantConversationLease, code: string) => { turn.state = turn.state.endsWith("dispatched") ? "unknown" : "failed"; turn.errorCode = code; return turn; });
  const session = { executor: { execute: vi.fn() }, identity: { workspaceId: 1, userId: 2 }, actor: { id: 2, role: "admin" },
    thread: vi.fn(async () => ({ threadId: hint.threadId, agentKey: "listing" })), turn: vi.fn(async () => structuredClone(turn)), claim, heartbeat, checkpoint, finish, fail } as unknown as AssistantConversationSession;
  const transaction = vi.fn();
  async function transact<T>(owner: unknown, body: (value: AssistantConversationSession) => Promise<T>): Promise<T> {
    transaction(owner);
    inTransaction = true;
    try { return await body(session); } finally { inTransaction = false; }
  }
  const hydrateTurn = vi.fn(async () => ({ identity: { workspaceId: 1, userId: 2, agentKey: "listing" as const, threadId: hint.threadId }, request, savedConfiguration: saved, attachments: [] }));
  const loadHistoryContext = vi.fn(async () => ({ history: [], hasOlderHistory: false }));
  const loadSavedConfiguration = vi.fn(async () => saved);
  const prepareStage = vi.fn(async (input: Parameters<AssistantConversationRuntime["prepareStage"]>[0]) => {
    expect(inTransaction).toBe(true);
    return { stage: input.stage, logicalRequestHash: digest, contextHash: digest, bindingHash: digest, snapshotHash: digest } as AssistantConversationPreparedStage;
  });
  const verifyFresh = vi.fn(async () => { expect(inTransaction).toBe(true); events.push("verify-fresh"); });
  const provider = vi.fn(async (stage: string) => { events.push(`provider:${stage}`); });
  const executeStage = vi.fn(async (prepared: AssistantConversationPreparedStage, options: Parameters<AssistantConversationRuntime["executeStage"]>[1]) => {
    expect(inTransaction).toBe(false);
    const receipt = { runId: `synthetic-${prepared.stage}`, stage: prepared.stage, requestHash: "b".repeat(64), modelConfigurationHash: digest, bindingHash: digest,
      budget: { textBytes: 1, imageCount: 0, imageBytes: 0, contextAdmissionUnits: 1025, outputTokens: 100, contextLimit: 10000, tokenEstimateIsExact: false as const } };
    await options.beforeDispatch(receipt, verifyFresh);
    if (duplicateFence) await options.beforeDispatch(receipt, verifyFresh);
    options.signal?.throwIfAborted();
    expect(inTransaction).toBe(false); await provider(prepared.stage);
    return { stage: prepared.stage, result: prepared.stage === "route" ? { skillSlug: "listing.test" } : { reply: "Synthetic reply", proposedRules: mode === "coach" ? ["Candidate only"] : null }, runId: receipt.runId, contextHash: digest, bindingHash: digest, auditWarnings: [] };
  });
  const revalidate = vi.fn(async () => { expect(inTransaction).toBe(true); events.push("revalidate-result"); return {} as never; });
  const runtime = { prepareStage, executeStage, revalidate } as unknown as AssistantConversationRuntime;
  const report = vi.fn();
  const processTurn = createAssistantConversationProcessor({ repository: { transaction: transact }, hooks: { authorizeSession: authorized, hydrateTurn, loadSavedConfiguration, loadHistoryContext }, runtime, enabled: () => enabled, report });
  return { turn, session, events, controller, lease, saved, request, authorized, checkpoint, claim, heartbeat, fail, finish, transaction, hydrateTurn, loadHistoryContext, loadSavedConfiguration, prepareStage, verifyFresh, provider, executeStage, revalidate, report,
    setEnabled: (value: boolean) => { enabled = value; }, duplicateFence: () => { duplicateFence = true; },
    run: () => processTurn({ ...hint, workerId: lease.workerId, signal: controller.signal }) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("private durable stage processor", () => {
  it("executes automatic work route/reply once, only after durable fresh fences, then local finish", async () => {
    const t = processorFixture(); await t.run();
    expect(t.turn.state).toBe("succeeded"); expect(t.provider.mock.calls).toEqual([["route"], ["reply"]]);
    expect(t.events.indexOf("verify-fresh")).toBeLessThan(t.events.indexOf("route_dispatched"));
    expect(t.events.indexOf("route_dispatched")).toBeLessThan(t.events.indexOf("provider:route"));
    expect(t.events.indexOf("route_ready")).toBeLessThan(t.events.indexOf("reply_dispatched"));
    expect(t.loadHistoryContext).toHaveBeenCalledWith(t.session, hint.threadId, 1);
    const dispatch = t.checkpoint.mock.calls[0][1];
    expect(dispatch).toMatchObject({ dispatchReceipt: { logicalRequestHash: digest, strictDispatch: { requestHash: "b".repeat(64) } } });
    expect(t.fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([["work", false], ["coach", true]] as const)("%s mode explicit=%s makes only one reply call", async (mode, automatic) => {
    const t = processorFixture("queued", mode, automatic); await t.run(); expect(t.provider.mock.calls).toEqual([["reply"]]); expect(t.turn.state).toBe("succeeded");
    expect(t.turn.proposal).toEqual(mode === "coach" ? ["Candidate only"] : null);
  });
  it("off or already aborted does not read the private repository", async () => { const t = processorFixture(); t.setEnabled(false); await t.run(); expect(t.transaction).not.toHaveBeenCalled(); t.setEnabled(true); t.controller.abort(); await t.run(); expect(t.transaction).not.toHaveBeenCalled(); });
  it.each(["route_dispatched", "reply_dispatched"] as const)("expired %s becomes unknown without any model attempt", async state => { const t = processorFixture(state); await t.run(); expect(t.turn.state).toBe("unknown"); expect(t.provider).not.toHaveBeenCalled(); expect(t.hydrateTurn).not.toHaveBeenCalled(); });
  it("durable route ready resumes reply only", async () => { const t = processorFixture("route_ready"); await t.run(); expect(t.provider.mock.calls).toEqual([["reply"]]); expect(t.turn.state).toBe("succeeded"); });
  it("durable reply ready finishes locally without re-resolving or calling any model", async () => { const t = processorFixture("reply_ready"); await t.run(); expect(t.turn.state).toBe("succeeded"); expect(t.provider).not.toHaveBeenCalled(); expect(t.prepareStage).not.toHaveBeenCalled(); expect(t.hydrateTurn).not.toHaveBeenCalled(); });
  it("current permission denial prevents claim/provider", async () => { const t = processorFixture(); t.authorized.mockRejectedValue(new Error("private policy")); await t.run(); expect(t.claim).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("processing_failed"); });
  it("foreign or stale hint never gets a lease", async () => { const t = processorFixture(); t.turn.userId = 8; await t.run(); expect(t.claim).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); });
  it("lost claim acknowledgement never attempts paid work or an unowned failure", async () => { const t = processorFixture(); t.claim.mockRejectedValue(new Error("DB ACK lost")); await t.run(); expect(t.provider).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); });
  it("source change at immediate pre-dispatch check prevents provider", async () => { const t = processorFixture(); t.verifyFresh.mockRejectedValue(new Error("source changed")); await t.run(); expect(t.provider).not.toHaveBeenCalled(); expect(t.turn.state).toBe("failed"); });
  it("a duplicate beforeDispatch callback is fenced, with no provider call", async () => { const t = processorFixture(); t.duplicateFence(); await t.run(); expect(t.provider).not.toHaveBeenCalled(); expect(t.turn.state).toBe("unknown"); });
  it("provider outcome unknown never retries", async () => { const t = processorFixture(); t.provider.mockRejectedValue(new Error("private provider body")); await t.run(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.turn.state).toBe("unknown"); expect(t.turn.errorCode).toBe("PROCESSING_FAILED"); });
  it("lost durable result ACK preserves ready state for recovery, never marks failed", async () => {
    const t = processorFixture(); const original = t.checkpoint.getMockImplementation()!;
    t.checkpoint.mockImplementation(async (lease, change) => { const result = await original(lease, change); if (change.nextState === "route_ready") throw new Error("ACK lost after commit"); return result; });
    await t.run(); expect(t.turn.state).toBe("route_ready"); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.fail).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown");
  });
  it("lost finish ACK never rewrites succeeded to failure", async () => { const t = processorFixture("reply_ready"); t.finish.mockImplementation(async () => { t.turn.state = "succeeded"; throw new Error("ACK lost"); }); await t.run(); expect(t.turn.state).toBe("succeeded"); expect(t.fail).not.toHaveBeenCalled(); });
  it("shutdown after the paid reply is durable preserves reply_ready for local recovery", async () => {
    const t = processorFixture("queued", "work", false), original = t.checkpoint.getMockImplementation()!;
    t.checkpoint.mockImplementation(async (lease, change) => { const result = await original(lease, change); if (change.nextState === "reply_ready") t.controller.abort(); return result; });
    await t.run(); expect(t.turn.state).toBe("reply_ready"); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.fail).not.toHaveBeenCalled();
  });
  it("a transient heartbeat failure on reply_ready does not erase an already paid result", async () => { const t = processorFixture("reply_ready"); t.heartbeat.mockRejectedValue(new Error("temporary database failure")); await t.run(); expect(t.turn.state).toBe("reply_ready"); expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); });
  it("current model/configuration change after payment does not discard its frozen reply", async () => { const t = processorFixture("queued", "work", false); t.provider.mockImplementation(async () => { t.loadSavedConfiguration.mockRejectedValue(new Error("configuration edited after dispatch")); }); await t.run(); expect(t.turn.state).toBe("succeeded"); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.revalidate).not.toHaveBeenCalled(); });
  it("rechecks upload rights for a stored attachment before sending it", async () => {
    const t = processorFixture(); t.turn.request = { files: [{ name: "private.txt" }] };
    t.authorized.mockImplementation(async (...args: unknown[]) => { if (args[2] === "upload") throw new Error("upload revoked"); });
    await t.run(); expect(t.claim).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled();
  });
  it("shutdown or gate off after dispatch blocks publication and the second stage", async () => {
    for (const stop of ["abort", "gate"]) {
      const t = processorFixture(); t.provider.mockImplementation(async () => { if (stop === "abort") t.controller.abort(); else t.setEnabled(false); });
      await t.run(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.finish).not.toHaveBeenCalled(); expect(t.turn.state).toBe("unknown");
    }
  });
  it("heartbeat revocation aborts a live stage and cannot publish its late reply", async () => {
    const t = processorFixture(); t.provider.mockImplementation(async () => { t.heartbeat.mockRejectedValue(new Error("revoked")); await vi.advanceTimersByTimeAsync(30_000); });
    await t.run(); expect(t.turn.state).toBe("unknown"); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.finish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("private queue worker lifecycle", () => {
  it.each(["worker", "web", "scheduler", "all"] as const)("is disabled by default for %s", role => expect(shouldProcessAssistantConversations(role, {})).toBe(false));
  it("requires worker role and both exact gates", async () => { const env = { ENABLE_ASSISTANT_CONVERSATION_WRITES: "true", ENABLE_ASSISTANT_CONVERSATION_WORKER: "true" }; expect(shouldProcessAssistantConversations("worker", env)).toBe(true); for (const role of ["web", "scheduler", "all"] as const) expect(shouldProcessAssistantConversations(role, env)).toBe(false); expect(shouldProcessAssistantConversations("worker", { ...env, ENABLE_ASSISTANT_CONVERSATION_WRITES: "TRUE" })).toBe(false); vi.stubEnv("ENABLE_ASSISTANT_CONVERSATION_WORKER", "false"); await startAssistantConversationWorker("worker")(); expect(vi.getTimerCount()).toBe(0); });
  it("coalesces ticks, advances past denied work, and wraps the bounded scan fairly", async () => {
    const discover = vi.fn().mockResolvedValueOnce([hint, { ...hint, id: 4 }]).mockResolvedValue([]);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const processTurn = vi.fn().mockReturnValueOnce(pending).mockRejectedValueOnce(new Error("private failure")); const report = vi.fn();
    const worker = createAssistantConversationWorker({ discover, processTurn, enabled: () => true, report });
    const first = worker.tick(); expect(worker.tick()).toBe(first); await Promise.resolve(); release(); await first;
    expect(processTurn).toHaveBeenCalledTimes(2); expect(report).toHaveBeenCalledWith("processing_failed");
    await worker.tick(); await worker.tick(); expect(discover.mock.calls.map(call => call[0].afterId)).toEqual([0, 4, 0]);
  });
  it("stop aborts active work and forbids all subsequent discoveries", async () => {
    const discover = vi.fn().mockResolvedValue([hint]); let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const processTurn = vi.fn().mockReturnValue(pending); const worker = createAssistantConversationWorker({ discover, processTurn, enabled: () => true });
    const tick = worker.tick(); await Promise.resolve(); const stop = worker.stop(); expect(processTurn.mock.calls[0][0].signal.aborted).toBe(true); release(); await stop; await tick; await worker.tick(); expect(discover).toHaveBeenCalledTimes(1);
  });
  it("does not expose discovery errors or instantiate a paid operation when disabled", async () => {
    const discover = vi.fn().mockRejectedValue(new Error("password private SQL")), processTurn = vi.fn(), report = vi.fn(); let enabled = false;
    const worker = createAssistantConversationWorker({ discover, processTurn, report, enabled: () => enabled }); await worker.tick(); expect(discover).not.toHaveBeenCalled(); enabled = true; await worker.tick(); expect(report.mock.calls).toEqual([["discovery_failed"]]); expect(processTurn).not.toHaveBeenCalled();
  });
});
