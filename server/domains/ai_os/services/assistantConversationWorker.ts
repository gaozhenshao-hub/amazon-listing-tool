import { randomUUID } from "node:crypto";
import type { RuntimeRole } from "../../../_core/runtime";
import { AgentLibraryKeySchema, type AgentLibraryKey } from "../../../../shared/agentLibraryContracts";
import { planAssistantConversation, validateAssistantConversationReply, validateAssistantConversationRoute } from "../../../../shared/assistantConversation";
import { assistantConversationRepository, AssistantConversationStorageError,
  type AssistantConversationLease, type AssistantConversationSession, type AssistantConversationTurn } from "../repositories/assistantConversations";
import { assistantConversationService } from "./assistantConversations";
import { assistantConversationRuntime, AssistantConversationRuntimeError,
  type AssistantConversationRuntime } from "./assistantConversationRuntime";
import { assistantConversationQueue, assistantConversationWorkerEnabled, type AssistantConversationQueueHint } from "./assistantConversationQueue";
import type { AssistantConversationSavedConfiguration } from "./assistantConversationContext";
import type { StrictSkillDispatchReceipt } from "./skillRunner";

const leaseSeconds = 120;
type Hooks = Pick<typeof assistantConversationService, "authorizeSession" | "loadSavedConfiguration" | "loadHistoryContext" | "hydrateTurn">;
type Report = (state: "discovery_failed" | "processing_failed" | "outcome_unknown" | "drain_timeout") => void;
type ProcessInput = AssistantConversationQueueHint & { workerId: string; signal: AbortSignal };
type ProcessDependencies = {
  repository: Pick<typeof assistantConversationRepository, "transaction">;
  hooks: Hooks; runtime: AssistantConversationRuntime; enabled: () => boolean; report: Report;
};
function errorCode(error: unknown) {
  const code = error instanceof AssistantConversationStorageError || error instanceof AssistantConversationRuntimeError ? error.code : "PROCESSING_FAILED";
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(code) ? code : "PROCESSING_FAILED";
}

/** One turn, at most one call per planned stage. The repository, not process
 * memory, owns the dispatch fence. Every network call is outside a transaction. */
export function createAssistantConversationProcessor(overrides: Partial<ProcessDependencies> = {}) {
  const deps: ProcessDependencies = { repository: assistantConversationRepository, hooks: assistantConversationService,
    runtime: assistantConversationRuntime, enabled: assistantConversationWorkerEnabled,
    report: state => console.warn("[AssistantConversation]", { state }), ...overrides };
  return async (input: ProcessInput): Promise<void> => {
    if (!deps.enabled() || input.signal.aborted) return;
    const owner = { workspaceId: input.workspaceId, userId: input.userId }, controller = new AbortController();
    const abort = () => controller.abort(); input.signal.addEventListener("abort", abort, { once: true });
    let lease: AssistantConversationLease | null = null, agentKey: AgentLibraryKey | null = null;
    let timer: ReturnType<typeof setInterval> | undefined, heartbeat: Promise<void> | null = null;
    let resultCommitAttempted = false;
    const active = () => { if (!deps.enabled() || input.signal.aborted) controller.abort(); controller.signal.throwIfAborted(); };
    async function authorized(session: AssistantConversationSession) {
      const thread = await session.thread(input.threadId), turn = await session.turn(input.operationId);
      if (!turn || turn.id !== input.id || turn.threadId !== thread.threadId || turn.agentKey !== thread.agentKey
        || turn.workspaceId !== owner.workspaceId || turn.userId !== owner.userId) throw new AssistantConversationStorageError("TURN_UNAVAILABLE");
      const key = AgentLibraryKeySchema.parse(thread.agentKey);
      if (agentKey !== null && agentKey !== key) throw new AssistantConversationStorageError("SCOPE_MISMATCH");
      await deps.hooks.authorizeSession(session, key, "run", input.threadId);
      const request = turn.request as { files?: unknown } | null;
      if (turn.state !== "reply_ready" && Array.isArray(request?.files) && request.files.length) {
        await deps.hooks.authorizeSession(session, key, "upload", input.threadId);
      }
      agentKey = key; return turn;
    }
    const beat = (): Promise<void> => {
      if (heartbeat) return heartbeat;
      heartbeat = (async () => {
        try {
          active();
          await deps.repository.transaction(owner, async session => { await authorized(session); active(); await session.heartbeat(lease!, leaseSeconds); });
        } catch { controller.abort(); }
        finally { heartbeat = null; }
      })();
      return heartbeat;
    };
    try {
      const claimed = await deps.repository.transaction(owner, async session => {
        active(); await authorized(session); active();
        return session.claim({ threadId: input.threadId, operationId: input.operationId, workerId: input.workerId, leaseSeconds });
      });
      lease = claimed.lease;
      // An expired dispatched turn becomes unknown here, never re-dispatched.
      if (!lease) return;
      timer = setInterval(() => { void beat(); }, 30_000); timer.unref();
      for (let remaining = 3; remaining > 0; remaining--) {
        active(); if (heartbeat) await heartbeat; active();
        let current: AssistantConversationTurn | null = null;
        let frozenConfiguration: AssistantConversationSavedConfiguration | null = null;
        const prepared = await deps.repository.transaction(owner, async session => {
          const turn = await authorized(session); current = turn; active();
          await session.heartbeat(lease!, leaseSeconds);
          if (turn.state === "reply_ready") return null;
          if (turn.state !== "queued" && turn.state !== "route_ready") throw new AssistantConversationStorageError("CHECKPOINT_CONFLICT");
          const hydrated = await deps.hooks.hydrateTurn(session, turn);
          frozenConfiguration = hydrated.savedConfiguration;
          const saved = await deps.hooks.loadSavedConfiguration(session, agentKey!);
          if (!saved) throw new AssistantConversationStorageError("CONFIGURATION_UNAVAILABLE");
          const history = await deps.hooks.loadHistoryContext(session, input.threadId, turn.sequence ?? undefined);
          const plan = planAssistantConversation(hydrated.request.mode, hydrated.request.selection, saved.config.skills.filter(item => item.enabled).map(item => item.slug));
          const stage = turn.state === "route_ready" ? "reply" : plan.stages[0];
          return deps.runtime.prepareStage({ ...hydrated, ...history, executor: session.executor,
            savedConfiguration: saved, runtimeSnapshot: turn.runtime, stage, routeResult: turn.routeResult });
        });
        const before = current as AssistantConversationTurn | null;
        if (!before) throw new AssistantConversationStorageError("TURN_UNAVAILABLE");
        if (!prepared) {
          // A durable paid reply is published locally even after a worker restart.
          // No new model/source resolution is necessary for this final commit.
          active(); resultCommitAttempted = true;
          await deps.repository.transaction(owner, async session => {
            const turn = await authorized(session); active();
            if (!turn.mode) throw new AssistantConversationStorageError("TURN_INVALID");
            validateAssistantConversationReply(turn.mode, turn.replyResult);
            await session.finish(lease!);
          });
          return;
        }
        const nextState = prepared.stage === "route" ? "route_dispatched" : "reply_dispatched";
        let dispatchedReceipt: StrictSkillDispatchReceipt | null = null;
        const paid = await deps.runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
          active();
          if (receipt.stage !== prepared.stage || receipt.bindingHash !== prepared.bindingHash) throw new AssistantConversationStorageError("DISPATCH_RECEIPT_INVALID");
          await deps.repository.transaction(owner, async session => {
            await authorized(session); active();
            const saved = await deps.hooks.loadSavedConfiguration(session, agentKey!);
            if (!saved) throw new AssistantConversationStorageError("CONFIGURATION_UNAVAILABLE");
            await verifyFresh(session.executor, saved); active();
            const dispatchReceipt = { logicalRequestHash: prepared.logicalRequestHash, contextHash: prepared.contextHash,
              runtimeSnapshotHash: prepared.snapshotHash, strictDispatch: receipt };
            if (nextState === "route_dispatched") await session.checkpoint(lease!, { expectedState: "queued", nextState, dispatchReceipt });
            else if (before.state === "queued" || before.state === "route_ready") await session.checkpoint(lease!, { expectedState: before.state, nextState, dispatchReceipt });
            else throw new AssistantConversationStorageError("CHECKPOINT_CONFLICT");
          });
          dispatchedReceipt = receipt;
          active();
        } });
        active(); if (heartbeat) await heartbeat; active();
        const receipt = dispatchedReceipt as StrictSkillDispatchReceipt | null;
        const frozen = frozenConfiguration as AssistantConversationSavedConfiguration | null;
        if (!receipt || !frozen || paid.runId !== receipt.runId || paid.stage !== prepared.stage || paid.bindingHash !== prepared.bindingHash || paid.contextHash !== prepared.contextHash) throw new AssistantConversationStorageError("RESULT_RECEIPT_INVALID");
        // Once a result commit has been attempted, a lost ACK MUST NOT be turned
        // into failure. Recovery sees the durable ready/dispatched state instead.
        resultCommitAttempted = true;
        await deps.repository.transaction(owner, async session => {
          const turn = await authorized(session); active();
          // A configuration edit after a paid dispatch does not invalidate its
          // exact frozen result. Check current authority plus the immutable
          // dispatch binding, not a newer unrelated prompt/model configuration.
          const persisted = (paid.stage === "route" ? turn.routeDispatch : turn.replyDispatch) as { runtimeSnapshotHash?: unknown; contextHash?: unknown; logicalRequestHash?: unknown; strictDispatch?: StrictSkillDispatchReceipt } | null;
          if (!persisted || persisted.runtimeSnapshotHash !== prepared.snapshotHash || persisted.contextHash !== prepared.contextHash
            || persisted.logicalRequestHash !== prepared.logicalRequestHash || persisted.strictDispatch?.runId !== paid.runId
            || persisted.strictDispatch?.bindingHash !== prepared.bindingHash || persisted.strictDispatch?.requestHash !== receipt.requestHash) {
            throw new AssistantConversationStorageError("RESULT_RECEIPT_INVALID");
          }
          active();
          if (paid.stage === "route") {
            const candidates = frozen.config.skills.filter(item => item.enabled).map(item => item.slug);
            const result = { skillSlug: validateAssistantConversationRoute(paid.result, candidates) };
            await session.checkpoint(lease!, { expectedState: "route_dispatched", nextState: "route_ready", result });
          } else {
            if (!turn.mode) throw new AssistantConversationStorageError("TURN_INVALID");
            const result = validateAssistantConversationReply(turn.mode, paid.result);
            await session.checkpoint(lease!, { expectedState: "reply_dispatched", nextState: "reply_ready", result, proposal: result.proposedRules });
          }
        });
        resultCommitAttempted = false;
      }
      throw new AssistantConversationStorageError("STAGE_LIMIT");
    } catch (error) {
      if (!lease || resultCommitAttempted) { deps.report(resultCommitAttempted ? "outcome_unknown" : "processing_failed"); return; }
      try {
        await deps.repository.transaction(owner, async session => {
          const turn = await authorized(session);
          // A durable reply must survive a drain, gate change or transient
          // follow-up read failure. Restart finishes it without a new model call.
          if (turn.state !== "reply_ready") await session.fail(lease!, errorCode(error));
        });
      } catch { deps.report("outcome_unknown"); }
    } finally {
      if (timer) clearInterval(timer);
      if (heartbeat) await heartbeat;
      input.signal.removeEventListener("abort", abort);
    }
  };
}

export function shouldProcessAssistantConversations(role: RuntimeRole, env: NodeJS.ProcessEnv = process.env) {
  return role === "worker" && env.ENABLE_ASSISTANT_CONVERSATION_WRITES === "true" && env.ENABLE_ASSISTANT_CONVERSATION_WORKER === "true";
}
/** Private queue lifecycle; no body in discovery, logs, shared jobs or retries. */
export function createAssistantConversationWorker(options: {
  discover?: typeof assistantConversationQueue.discover; processTurn?: ReturnType<typeof createAssistantConversationProcessor>;
  enabled?: () => boolean; report?: Report; workerId?: string;
} = {}) {
  const enabled = options.enabled ?? assistantConversationWorkerEnabled;
  const report: Report = options.report ?? (state => console.warn("[AssistantConversation]", { state }));
  const discover = options.discover ?? assistantConversationQueue.discover;
  const processTurn = options.processTurn ?? createAssistantConversationProcessor({ enabled, report });
  const workerId = options.workerId ?? `assistant-${randomUUID()}`;
  let stopped = false, cursor = 0, active: Promise<void> | null = null;
  const controller = new AbortController();
  return {
    tick(): Promise<void> {
      if (stopped || !enabled()) return Promise.resolve();
      if (active) return active;
      active = (async () => {
        let hints: AssistantConversationQueueHint[];
        try { hints = await discover({ afterId: cursor, limit: 10 }); }
        catch { report("discovery_failed"); return; }
        if (!hints.length) { cursor = 0; return; }
        for (const hint of hints) {
          if (stopped || !enabled()) return;
          cursor = hint.id;
          try { await processTurn({ ...hint, workerId, signal: controller.signal }); }
          catch { report("processing_failed"); }
        }
      })().finally(() => { active = null; });
      return active;
    },
    stop(): Promise<void> { stopped = true; controller.abort(); return active ?? Promise.resolve(); },
  };
}
export function startAssistantConversationWorker(role: RuntimeRole) {
  if (!shouldProcessAssistantConversations(role)) return async () => {};
  const worker = createAssistantConversationWorker();
  const interval = setInterval(() => { void worker.tick(); }, 5_000); interval.unref();
  void worker.tick();
  return async () => {
    clearInterval(interval);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const drained = await Promise.race([worker.stop().then(() => true), new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 5_000); })]);
      if (!drained) console.warn("[AssistantConversation]", { state: "drain_timeout" });
    } finally { if (timeout) clearTimeout(timeout); }
  };
}
