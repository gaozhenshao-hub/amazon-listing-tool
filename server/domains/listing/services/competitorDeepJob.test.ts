import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../../_core/context";
import { CompetitorDeepOperationInputSchema, CompetitorDeepStartInputSchema } from "../../../../shared/competitorDeepExecutionJob";
import { createCompetitorDeepJobService, deepPublicView } from "./competitorDeepJob";
import { deepFixture, syntheticIdentity, clone } from "./competitorDeepJob.testFixture";
import { deepOperationScope, deepRunId, type DeepJob, type CompetitorDeepJobSession } from "../../../repositories/listing/competitorDeepJobRepository";
import type { CompetitorDeepStoredInput } from "../../../repositories/listing/competitorDeepExecutionRepository";
import { createCompetitorDeepExecution } from "./competitorDeepExecution";
const ctx = { user: { id: 3, defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
async function harness() {
  const h = await deepFixture(); let row: DeepJob | null = null, canceled = false, enabled = true, lostAck = false, revision = h.input.expectedRevision;
  const session = { executor: h.executor, agent: vi.fn(async () => undefined),
    job: vi.fn(async () => clone(row)), authorize: vi.fn(async () => ({ actor: { role: "admin" }, analysis: { summaryStatus: "draft" }, revision, sourceWorkspaceId: 7 })),
    fence: vi.fn(async () => canceled), bound: vi.fn((value: DeepJob, scope: { analysisId: number }) => { if (value.input.evidence.identity.analysisId !== scope.analysisId) throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_DEEP_OPERATION_SCOPE_CONFLICT" }); }),
    reserve: vi.fn(async (input: CompetitorDeepStoredInput) => { row = { ...clone(h.job), input }; return clone(row); }),
    cancel: vi.fn(async () => { canceled = true; if (row && row.status !== "succeeded") row = { ...row, status: "canceled" }; return clone(row); }),
  } as unknown as CompetitorDeepJobSession;
  const repository = { transaction: async <T>(body: (value: CompetitorDeepJobSession) => Promise<T>) => { const value = await body(session); if (lostAck) { lostAck = false; throw new Error("SYNTHETIC_LOST_ACK"); } return value; }, next: vi.fn() };
  const evidence = { load: vi.fn(async () => clone(h.evidence)), preview: vi.fn() }, ensureAgent = vi.fn(async () => "synthetic-agent");
  const service = createCompetitorDeepJobService({ repository, runtime: h.runtime, evidence, ensureAgent, enabled: () => enabled, workerEnabled: () => enabled });
  const operation = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, operationId: h.input.operationId };
  return { h, service, session, repository, evidence, ensureAgent, operation, setRow: (value: DeepJob | null) => { row = value; }, getRow: () => row,
    disable: () => { enabled = false; }, loseNextAck: () => { lostAck = true; }, changeRevision: () => { revision = "b".repeat(64); } };
}
describe("dedicated deep service reservation and recovery", () => {
  it("accepts the complete strict start shape and persists before returning queued without model", async () => {
    const h = await harness(), result = await h.service.start(ctx, h.h.input); expect(result.status).toBe("queued"); expect(h.session.reserve).toHaveBeenCalledTimes(1); expect(h.h.paid()).toBe(0);
    expect(h.getRow()?.input.reservation?.request).toEqual(h.h.input);
    expect(h.getRow()?.input.reservation?.runtime).toMatchObject({ version: 2, configuration: { agentKey: "listing", revision: 1, hash: h.h.configuration.configHash, config: h.h.config } });
  });
  it("stable run ID ignores unrelated evidence identity fields", async () => {
    const h = await harness(); expect(deepRunId(h.h.evidence.identity, h.h.input.operationId)).toBe(deepRunId(syntheticIdentity, h.h.input.operationId));
    expect(deepOperationScope(syntheticIdentity, h.h.input)).toEqual({ ...syntheticIdentity, projectId: 11, analysisId: 21 });
  });
  it("replays same UUID before changed approvals/evidence and even when writes disabled", async () => {
    const h = await harness(); await h.service.start(ctx, h.h.input); h.disable(); h.changeRevision(); h.h.setApprovals([]); h.evidence.load.mockClear();
    h.h.configuration.configText = "invalid current config"; h.h.permission.mockRejectedValue(new Error("AGENT_REVOKED"));
    expect((await h.service.start(ctx, h.h.input)).sourceChanged).toBe(true); expect(h.evidence.load).not.toHaveBeenCalled(); expect(h.session.reserve).toHaveBeenCalledTimes(1);
  });
  it("disabled saved Agent returns a fixed capability reason and prevents reservation", async () => {
    const h = await harness(); h.h.config.enabled = false; h.h.saveConfiguration();
    const options = await h.service.options(ctx, { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, expectedRevision: h.h.input.expectedRevision });
    expect(options.capability).toEqual({ available: false, reasonCode: "CONFIGURATION_DISABLED" });
    await expect(h.service.start(ctx, h.h.input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COMPETITOR_DEEP_CONFIGURATION_DISABLED" });
    expect(h.session.reserve).not.toHaveBeenCalled(); expect(h.ensureAgent).not.toHaveBeenCalled();
  });
  it("config changes between preparation and reservation fail CAS without persisting a mixed job", async () => {
    const h = await harness(); h.ensureAgent.mockImplementation(async () => { h.h.config.rules.push("CHANGED_BEFORE_RESERVE"); h.h.saveConfiguration(); return "synthetic-agent"; });
    await expect(h.service.start(ctx, h.h.input)).rejects.toThrow("APPROVED_RUNTIME_CHANGED"); expect(h.session.reserve).not.toHaveBeenCalled(); expect(h.h.paid()).toBe(0);
  });
  it("rejects different request content under the same UUID", async () => {
    const h = await harness(); await h.service.start(ctx, h.h.input); await expect(h.service.start(ctx, { ...h.h.input, expectedEvidenceHash: "b".repeat(64) })).rejects.toThrow("OPERATION_CONTENT_CONFLICT");
  });
  it("rejects cross-analysis reuse before exposing the receipt", async () => {
    const h = await harness(); await h.service.start(ctx, h.h.input); await expect(h.service.check(ctx, { ...h.operation, analysisId: 22 })).rejects.toThrow("OPERATION_SCOPE_CONFLICT");
  });
  it("disabled start creates no agent/reservation/model", async () => {
    const h = await harness(); h.disable(); await expect(h.service.start(ctx, h.h.input)).rejects.toThrow("WRITES_DISABLED"); expect(h.session.reserve).not.toHaveBeenCalled(); expect(h.ensureAgent).not.toHaveBeenCalled(); expect(h.h.paid()).toBe(0);
  });
  it("options reports unavailable while preserving complete actual evidence hash", async () => {
    const h = await harness(); h.disable(); const result = await h.service.options(ctx, { ...h.operation, operationId: undefined, expectedRevision: h.h.input.expectedRevision } as never).catch(() => null);
    expect(result).toBeNull(); // public strict input must not accept operationId.
    expect((await h.service.options(ctx, { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, expectedRevision: h.h.input.expectedRevision })).capability).toEqual({ available: false, reasonCode: "WRITES_DISABLED" });
  });
  it("cancel-before-start is a durable same-UUID fence and works flag off", async () => {
    const h = await harness(); h.disable(); expect((await h.service.cancel(ctx, h.operation)).status).toBe("canceled"); expect((await h.service.start(ctx, h.h.input)).status).toBe("canceled"); expect(h.session.reserve).not.toHaveBeenCalled();
  });
  it("missing check is not a proven failure and never starts a model", async () => {
    const h = await harness(); const result = await h.service.check(ctx, h.operation); expect(result).toMatchObject({ status: "not_found", progress: null, canCancel: true }); expect(h.ensureAgent).not.toHaveBeenCalled();
  });
  it("lost response remains recoverable under the original UUID without re-reserving", async () => {
    const h = await harness(); await h.service.start(ctx, h.h.input); h.loseNextAck(); await expect(h.service.check(ctx, h.operation)).rejects.toThrow("OUTCOME_UNKNOWN");
    expect((await h.service.check(ctx, h.operation)).status).toBe("queued"); expect(h.session.reserve).toHaveBeenCalledTimes(1);
  });
  it("explicit null cannot regain a default workspace", async () => {
    const h = await harness(); await expect(h.service.start({ ...ctx, workspaceId: null }, h.h.input)).rejects.toThrow("WORKSPACE_CHANGED"); expect(h.session.job).not.toHaveBeenCalled();
  });
  it("current revoked authority blocks check and cancel", async () => {
    const h = await harness(); vi.mocked(h.session.authorize).mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "COMPETITOR_DEEP_ACCESS_DENIED" }));
    await expect(h.service.check(ctx, h.operation)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(h.service.cancel(ctx, h.operation)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.session.cancel).not.toHaveBeenCalled();
  });
  it("any durable dispatched checkpoint is unknown after failure/lease expiry, never retryable failed", async () => {
    const h = await harness(), stored = clone(h.h.stored); let journal = stored.journal;
    await expect(createCompetitorDeepExecution(stored.evidence, stored.skills).runNext({ read: async () => journal, compareAndSwap: async (_hash, value) => journal = value, assertCurrent: async () => undefined }, async () => { throw new Error("unknown"); }, new AbortController().signal)).rejects.toThrow("unknown");
    for (const status of ["failed", "running"] as const) expect(deepPublicView(syntheticIdentity, h.operation, { ...h.h.job, status, input: { ...stored, journal }, leaseUntil: new Date(0) }, h.h.input.expectedRevision)).toMatchObject({ status: "unknown", progress: null, canCancel: true });
  });
  it("strict schemas reject client runtime approval and uppercase UUID", async () => {
    const h = await harness(); expect(CompetitorDeepStartInputSchema.safeParse({ ...h.h.input, runtime: h.h.snapshot }).success).toBe(false);
    expect(CompetitorDeepOperationInputSchema.safeParse({ ...h.operation, operationId: h.operation.operationId.toUpperCase() }).success).toBe(false);
  });
});
