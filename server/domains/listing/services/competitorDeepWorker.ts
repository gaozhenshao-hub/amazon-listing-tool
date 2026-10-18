import { randomUUID } from "node:crypto";
import type { TrpcContext } from "../../../_core/context";
import type { RuntimeRole } from "../../../_core/runtime";
import { competitorDeepJobRepository, deepJobError, type DeepJob, type CompetitorDeepJobSession } from "../../../repositories/listing/competitorDeepJobRepository";
import { createCompetitorDeepExecutionStore } from "../../../repositories/listing/competitorDeepExecutionRepository";
import { competitorResearchEvidence } from "./competitorResearchEvidence";
import { competitorDeepRuntime } from "./competitorDeepRuntime";
import { competitorDeepWorkerEnabled } from "./competitorDeepJob";
import { createCompetitorDeepExecution } from "./competitorDeepExecution";
const defaults = { repository: competitorDeepJobRepository, runtime: competitorDeepRuntime, evidence: competitorResearchEvidence,
  store: createCompetitorDeepExecutionStore, enabled: competitorDeepWorkerEnabled };
export function createCompetitorDeepProcessor(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (runId: string, stop: AbortSignal): Promise<void> => {
    if (!deps.enabled() || stop.aborted) return;
    const controller = new AbortController(), token = `deep-worker:${randomUUID()}`;
    const abort = () => controller.abort(); stop.addEventListener("abort", abort, { once: true });
    let claimed: DeepJob | null = null, heartbeat: Promise<void> | null = null, timer: ReturnType<typeof setInterval> | null = null;
    let immutable: string | null = null;
    const active = () => { if (!deps.enabled() || stop.aborted) controller.abort(); controller.signal.throwIfAborted(); };
    async function bound(session: CompetitorDeepJobSession, requireLease: boolean) {
      const row = await session.job(runId); if (!row || !row.input.reservation) deepJobError("JOB_UNAVAILABLE");
      const identity = row.input.evidence.identity, request = row.input.reservation.request;
      const current = await session.authorize(identity, "run");
      if (await session.fence(identity, request.operationId)) deepJobError("CANCELED");
      if (immutable !== null && row.input.reservation.runtime.snapshotHash !== immutable) deepJobError("RUNTIME_CHANGED");
      if (current.revision !== identity.revision || current.analysis.summaryStatus !== "draft" || current.sourceWorkspaceId !== identity.sourceWorkspaceId) deepJobError("SOURCE_CHANGED", "CONFLICT");
      if (requireLease) session.lease(row, token);
      await session.agent(row.input);
      return row;
    }
    async function currentEvidence(row: DeepJob) {
      const identity = row.input.evidence.identity;
      // Only a server-internal locator. load() independently re-reads the actor,
      // project permissions and complete original corpus; no context assertion
      // is accepted as authority by that existing service.
      const context = { user: { id: identity.userId, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId } as TrpcContext;
      const fresh = await deps.evidence.load(context, { projectId: identity.projectId, analysisId: identity.analysisId, expectedWorkspaceId: identity.workspaceId, expectedRevision: identity.revision });
      if (fresh.evidenceHash !== row.input.evidence.evidenceHash) deepJobError("EVIDENCE_CHANGED", "CONFLICT");
    }
    const beat = () => {
      if (heartbeat) return heartbeat;
      heartbeat = (async () => { try { active(); await deps.repository.transaction(async session => {
        const row = await bound(session, true); active();
        await session.write("UPDATE ai_jobs SET leaseUntil=DATE_ADD(NOW(),INTERVAL 180 SECOND),lastHeartbeatAt=NOW() WHERE runId=? AND status='running' AND lockedBy=? AND attempt=1 AND leaseUntil>NOW()", [row.runId, token]);
      }); } catch { controller.abort(); } finally { heartbeat = null; } })(); return heartbeat;
    };
    try {
      claimed = await deps.repository.transaction(async session => {
        const row = await bound(session, false); active();
        if (!["queued", "running"].includes(row.status) || row.status === "running" && row.leaseUntil && new Date(row.leaseUntil).getTime() >= Date.now()) return null;
        if (row.input.journal.steps.some(step => step.status === "dispatched")) {
          await session.write("UPDATE ai_jobs SET status='failed',errorMessage='COMPETITOR_DEEP_MODEL_RESULT_UNKNOWN',lockedBy=NULL,leaseUntil=NULL,completedAt=NOW(),updatedAt=NOW() WHERE runId=? AND status=?", [runId, row.status]); return null;
        }
        if (row.status === "queued" && row.attempt !== 0 || row.status === "running" && row.attempt !== 1) deepJobError("ATTEMPT_INVALID");
        await deps.runtime.revalidate(session.executor, row.input.reservation!.runtime); active();
        await session.write("UPDATE ai_jobs SET status='running',attempt=1,lockedBy=?,leaseUntil=DATE_ADD(NOW(),INTERVAL 180 SECOND),lastHeartbeatAt=NOW(),startedAt=COALESCE(startedAt,NOW()),updatedAt=NOW() WHERE runId=? AND status=? AND (status='queued' OR leaseUntil<NOW())", [token, runId, row.status]);
        const saved = await session.job(runId); if (!saved) deepJobError("CLAIM_UNKNOWN"); session.lease(saved, token); return saved;
      });
      if (!claimed) return;
      immutable = claimed.input.reservation!.runtime.snapshotHash;
      timer = setInterval(() => { void beat(); }, 30_000); timer.unref();
      const identity = claimed.input.evidence.identity;
      const store = deps.store({ runId, lockedBy: token, attempt: 1, userId: identity.userId, workspaceId: identity.workspaceId,
        projectId: identity.projectId, analysisId: identity.analysisId, signal: controller.signal });
      const kernel = createCompetitorDeepExecution(claimed.input.evidence, claimed.input.skills);
      for (let index = 0; index <= claimed.input.journal.steps.length; index++) {
        active(); await currentEvidence(claimed); active();
        const result = await kernel.runNext(store, async (request, signal) => {
          active(); if (heartbeat) await heartbeat; active();
          const prepared = await deps.repository.transaction(async session => {
            const row = await bound(session, true); active();
            const step = row.input.journal.steps.find(value => value.status === "dispatched");
            if (!step || step.requestHash !== request.requestHash || step.dispatchId !== request.dispatchId) deepJobError("DISPATCH_CONFLICT");
            return deps.runtime.prepareStage({ executor: session.executor, identity: { userId: identity.userId, workspaceId: identity.workspaceId! }, runtime: row.input.reservation!.runtime, request });
          });
          return deps.runtime.invoke({ prepared, signal, beforeDispatch: async (_receipt, verify) => {
            active(); await currentEvidence(claimed!); active();
            await deps.repository.transaction(async session => {
              const row = await bound(session, true), step = row.input.journal.steps.find(value => value.status === "dispatched");
              if (!step || step.requestHash !== request.requestHash || step.dispatchId !== request.dispatchId) deepJobError("DISPATCH_CONFLICT");
              await verify(session.executor); active();
            }); // A fresh TX acknowledgement must precede provider dispatch.
            active();
          } });
        }, controller.signal);
        if (result.state === "ready_for_review") { active(); await currentEvidence(claimed); active(); await store.publish(); return; }
        if (result.state === "incomplete_sources") deepJobError("SOURCES_INCOMPLETE");
      }
      deepJobError("STEP_LIMIT");
    } catch {
      // A success ACK may have been lost: only a still-owned active row can be
      // marked failed. Durable dispatched journals remain publicly UNKNOWN.
      if (claimed) try { await deps.repository.transaction(async session => {
        const row = await session.job(runId); if (!row || row.status !== "running" || row.lockedBy !== token || row.attempt !== 1) return;
        await session.authorize(row.input.evidence.identity, "run");
        if (row.input.journal.steps.every(step => step.status === "succeeded" || step.status === "missing")
          && row.input.journal.steps.some(step => step.stage === "summary" && step.status === "succeeded")) {
          // Every model result is durable. A publication/commit failure must
          // remain recoverable locally under this same operation, not invite
          // a new paid generation. A new lease can only run publish here.
          await session.write("UPDATE ai_jobs SET leaseUntil=DATE_SUB(NOW(),INTERVAL 1 SECOND),lockedBy=NULL,updatedAt=NOW() WHERE runId=? AND status='running' AND lockedBy=? AND attempt=1", [runId, token]);
          return;
        }
        await session.write("UPDATE ai_jobs SET status='failed',errorMessage=?,lockedBy=NULL,leaseUntil=NULL,completedAt=NOW(),updatedAt=NOW() WHERE runId=? AND status='running' AND lockedBy=? AND attempt=1",
          [row.input.journal.steps.some(step => step.status === "dispatched") ? "COMPETITOR_DEEP_MODEL_RESULT_UNKNOWN" : "COMPETITOR_DEEP_EXECUTION_FAILED", runId, token]);
      }); } catch { /* No acknowledgement: keep same UUID; never start another call. */ }
    } finally { if (timer) clearInterval(timer); if (heartbeat) await heartbeat; stop.removeEventListener("abort", abort); }
  };
}
export function startCompetitorDeepWorker(role: RuntimeRole, overrides: { repository?: typeof competitorDeepJobRepository;
  process?: ReturnType<typeof createCompetitorDeepProcessor>; enabled?: () => boolean; pollMs?: number } = {}) {
  const repository = overrides.repository ?? competitorDeepJobRepository, process = overrides.process ?? createCompetitorDeepProcessor(), enabled = overrides.enabled ?? competitorDeepWorkerEnabled;
  const controller = new AbortController(); let pending: Promise<void> | null = null, cursor: string | null = null;
  const tick = () => { if (role !== "worker" || controller.signal.aborted || !enabled() || pending) return;
    pending = (async () => { try { const next = await repository.next(cursor); cursor = next?.runId ?? null; if (next) await process(next.runId, controller.signal); }
      catch { /* Only fixed metadata in logs; provider/SQL/source errors stay private. */ }
      finally { pending = null; } })(); };
  const timer = setInterval(tick, overrides.pollMs ?? 5000); timer.unref(); tick();
  return async () => { clearInterval(timer); controller.abort(); if (pending) await pending; };
}
