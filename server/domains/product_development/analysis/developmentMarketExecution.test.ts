import { describe, expect, it } from "vitest";
import { createDevelopmentMarketTestFixture, marketOperation, marketCandidate } from "./developmentMarket.testFixture";
import { createDevelopmentMarketRuntime } from "./developmentMarketRuntime";
import { createDevelopmentMarketExecution } from "./developmentMarketExecution";
import { createDevelopmentMarketService } from "./developmentMarketService";
import { createDevelopmentMarketWorker, shouldProcessDevelopmentMarket } from "./developmentMarketWorker";
import type { TrpcContext } from "../../../_core/context";
import type { runEmperorSkill } from "../../ai_os/services/skillRunner";

function fixture(options: { ackLost?: "dispatch" | "candidate"; providerFailure?: boolean; stopAfterPaid?: boolean; changeSourceBeforeDispatch?: boolean } = {}) {
  const f = createDevelopmentMarketTestFixture(), calls: Array<Parameters<typeof runEmperorSkill>[0]> = [], abort = new AbortController(); let paid = 0;
  const runtime = createDevelopmentMarketRuntime({ approvalResolver: async () => structuredClone(f.approval), credentialResolver: () => "SYNTHETIC_ONLY",
    runSkill: async input => {
      calls.push(input); expect(input.strictExecution).toBeDefined(); expect(input.maxModelAttempts).toBe(1); expect(input.fallbackModels).toEqual([]);
      expect(input.context).toContain("SAVED_DEVELOPMENT_RULE"); expect(input.context).toContain("SAVED_DEVELOPMENT_INSTRUCTIONS"); expect(input.context).toContain("SAVED_SKILL_BINDING");
      expect(input.context).toContain("development-market-input/v1"); expect(input.expectedSkillVersion).toBe("2");
      if (options.changeSourceBeforeDispatch) f.state.tags[0].tag = "LATE_EDIT";
      if (options.ackLost === "dispatch") f.control.ackLostOn = "UPDATE ai_jobs";
      const strict = input.strictExecution!, preparedBudget = (await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run!.runtimeSnapshot.budgetPlan.budget;
      // The real configured runtime computes/validates this full actual payload
      // hash before our synthetic provider permission can be granted.
      const stage = await f.repository.prepareStage(currentLease!, async (executor, run, source) => runtime.prepareStage({ executor, identity: f.identity, operationId: marketOperation,
        configuration: f.configuration, source, sourceHash: source.sourceHash, sourceContext: (await import("./developmentMarketSource")).developmentMarketSourceContext(source), runtimeSnapshot: run.runtimeSnapshot }));
      await strict.beforeDispatch({ runId: "synthetic-one-paid", stage: "development_market_overview", requestHash: stage.providerRequestHash,
        modelConfigurationHash: strict.modelSnapshot.configurationHash, bindingHash: strict.bindingHash, budget: preparedBudget });
      paid++; expect(f.events.at(-1)).toBe("commit_ack");
      if (options.providerFailure) throw new Error("SYNTHETIC_PROVIDER_RESULT_UNKNOWN");
      if (options.ackLost === "candidate") f.control.ackLostOn = "INSERT INTO ai_artifacts";
      if (options.stopAfterPaid) { f.control.enabled = false; abort.abort(); }
      if (!input.validate) throw new Error("SYNTHETIC_VALIDATOR_REQUIRED");
      const content = JSON.stringify(marketCandidate), parsed = input.validate(content);
      return { runId: "synthetic-one-paid", skillSlug: input.skillSlug, skillName: "Synthetic", skillVersion: "2", skillPromptHash: "a".repeat(16), skillManifestHash: "b".repeat(16),
        modelSlug: f.modelRow.slug, provider: "custom", fallbackCount: 0, content, parsed, durationMs: 1, costCents: 1, inputTokens: 1, outputTokens: 1,
        executionPreset: "standard", governance: null, auditWarnings: [] };
    } });
  let currentLease: Awaited<ReturnType<typeof f.repository.claim>>;
  const originalClaim = f.repository.claim;
  f.repository.claim = async (...args) => { currentLease = await originalClaim(...args); return currentLease; };
  const process = createDevelopmentMarketExecution({ repository: f.repository, runtime, loadConfiguration: async () => structuredClone(f.configuration), enabled: () => f.control.enabled, report: () => {} });
  return { ...f, runtime, process, abort, calls, paid: () => paid, async execute() { await f.submitted(); await process({ identity: f.identity, operation: { ...f.scope, operationId: marketOperation }, workerId: "testworker", signal: abort.signal }); } };
}
describe("Development market execution/service/worker", () => {
  it("actual configured runtime drives the original complete candidate and never writes the stage before apply", async () => {
    const f = fixture(), before = structuredClone(f.state.stages); await f.execute();
    expect(f.paid()).toBe(1); expect(f.calls).toHaveLength(1); expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("candidate"); expect(f.state.stages).toEqual(before);
  });
  it("stopping after a paid reply persists the full candidate without another dispatch", async () => {
    const f = fixture({ stopAfterPaid: true }); await f.execute(); expect(f.paid()).toBe(1);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("candidate");
  });
  it("dispatch ACK loss never grants the provider permission or retries the call", async () => {
    const f = fixture({ ackLost: "dispatch" }); await f.execute(); expect(f.paid()).toBe(0);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("outcome_unknown");
    await f.process({ identity: f.identity, operation: { ...f.scope, operationId: marketOperation }, workerId: "restart", signal: new AbortController().signal }); expect(f.calls).toHaveLength(1);
  });
  it("provider uncertainty never becomes a normal retryable failure", async () => {
    const f = fixture({ providerFailure: true }); await f.execute(); expect(f.paid()).toBe(1);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("outcome_unknown");
  });
  it("candidate ACK loss preserves its actual committed candidate and never marks it failed", async () => {
    const f = fixture({ ackLost: "candidate" }); await f.execute(); expect(f.paid()).toBe(1);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("candidate");
    expect(f.events).not.toContain("checkpoint:failed"); expect(f.state.artifacts).toHaveLength(2);
  });
  it("late complete-source change before dispatch yields no paid request", async () => {
    const f = fixture({ changeSourceBeforeDispatch: true }); await f.execute(); expect(f.paid()).toBe(0);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("failed");
  });
  it("HTTP preview and start use real source/runtime without a model or leaking private config bodies", async () => {
    const f = fixture(), service = createDevelopmentMarketService({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled }),
      ctx = { user: { id: 3, defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext, operation = { ...f.scope, operationId: marketOperation }, preview = await service.preview(ctx, operation);
    expect(preview.available).toBe(true); expect(JSON.stringify(preview)).not.toContain("SAVED_DEVELOPMENT_RULE");
    const job = await service.start(ctx, { ...operation, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash!, maxCostCents: preview.maxCostCents!, chargeConfirmed: true });
    expect(job.state).toBe("queued"); expect(f.paid()).toBe(0); expect(f.calls).toHaveLength(0);
  });
  it("missing approval gives honest unavailable preview and zero calls; fresh revoke cannot leak previous preview", async () => {
    const f = fixture(), runtime = createDevelopmentMarketRuntime({ approvalResolver: async () => null }), service = createDevelopmentMarketService({ repository: f.repository, runtime, loadConfiguration: async () => f.configuration, enabled: () => true }),
      ctx = { user: { id: 3, defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
    expect(await service.preview(ctx, { ...f.scope, operationId: marketOperation })).toMatchObject({ available: false, runtimeHash: null, reasonCode: "SOURCE_UNAVAILABLE" });
    f.control.memberStatus = "disabled"; await expect(service.preview(ctx, { ...f.scope, operationId: marketOperation })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.paid()).toBe(0);
  });
  it("worker is dedicated-role and explicit-gate only, serializes ticks, drains one in-flight processor", async () => {
    expect(shouldProcessDevelopmentMarket("all", { ENABLE_DEVELOPMENT_MARKET_WRITES: "true", ENABLE_DEVELOPMENT_MARKET_WORKER: "true" })).toBe(false);
    expect(shouldProcessDevelopmentMarket("worker", { ENABLE_DEVELOPMENT_MARKET_WRITES: "true", ENABLE_DEVELOPMENT_MARKET_WORKER: "true" })).toBe(true);
    let finish!: () => void, count = 0, signal: AbortSignal | undefined; const worker = createDevelopmentMarketWorker({ enabled: () => true,
      discover: async () => [{ id: 1, userId: 3, workspaceId: 7, devProjectId: 5, operationId: marketOperation }],
      process: async input => { count++; signal = input.signal; await new Promise<void>(resolve => { finish = resolve; }); } });
    const first = worker.tick(), second = worker.tick(); expect(first).toBe(second); await new Promise(resolve => setTimeout(resolve, 0));
    const stop = worker.stop(100); expect(signal?.aborted).toBe(true); finish(); await stop; expect(count).toBe(1); await worker.tick(); expect(count).toBe(1);
  });
});
