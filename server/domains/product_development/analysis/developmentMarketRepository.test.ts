import { describe, expect, it, vi } from "vitest";
import { developmentMarketHash, validateDevelopmentMarketCandidate } from "../../../../shared/developmentMarket";
import { createDevelopmentMarketTestFixture, marketOperation, marketOtherOperation, marketApplyOperation, marketCandidate } from "./developmentMarket.testFixture";
import { developmentMarketSourceContext } from "./developmentMarketSource";
import type { DevelopmentMarketLease } from "./developmentMarketRepository";
import * as dbClient from "../../../repositories/dbClient";
import { completeDevAnalysisStageRunConsistently, StaleDevAnalysisRunError } from "./stageConsistency";

export async function marketDispatchFixture(f: ReturnType<typeof createDevelopmentMarketTestFixture>, lease: DevelopmentMarketLease) {
  const prepared = await f.repository.prepareStage(lease, (executor, run, source) => f.runtime.prepareStage({ executor, identity: f.identity, operationId: marketOperation,
    configuration: f.configuration, source, sourceHash: source.sourceHash, sourceContext: developmentMarketSourceContext(source), runtimeSnapshot: run.runtimeSnapshot }));
  const receipt = { runId: "synthetic-paid-market", stage: "development_market_overview" as const, requestHash: prepared.providerRequestHash,
    modelConfigurationHash: (await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run!.runtimeSnapshot.model.configurationHash,
    bindingHash: prepared.bindingHash, budget: prepared.budget }, dispatch = { receipt, snapshotHash: prepared.snapshotHash, contextHash: prepared.contextHash, providerRequestHash: prepared.providerRequestHash, bindingHash: prepared.bindingHash };
  return { prepared, dispatch, verify: async (executor: typeof f.tx, run: NonNullable<Awaited<ReturnType<typeof f.repository.check>>["run"]>, source: typeof run.source) => f.runtime.revalidate({ executor, identity: f.identity,
    operationId: marketOperation, configuration: f.configuration, source, sourceHash: source.sourceHash, sourceContext: developmentMarketSourceContext(source), runtimeSnapshot: run.runtimeSnapshot }),
    result: { ...prepared, runId: receipt.runId, candidate: marketCandidate } };
}
async function claimed() { const f = createDevelopmentMarketTestFixture(), reserved = await f.submitted(), lease = await f.repository.claim(f.identity, { ...f.scope, operationId: marketOperation }, "worker"); expect(lease).not.toBeNull(); return { ...f, reserved, lease: lease! }; }
async function candidate() { const f = await claimed(), d = await marketDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.dispatch, d.verify); const run = await f.repository.candidate(f.lease, d.result); return { ...f, run, d }; }
describe("Development market durable source and SQL protocol", () => {
  it("captures the real complete confirmed panorama, colleague policy and private frozen source/runtime", async () => {
    const f = createDevelopmentMarketTestFixture(), before = structuredClone(f.state.stages), { input, run } = await f.submitted();
    expect(run.source.products).toHaveLength(2); expect(run.source.panorama.version).toBe(2); expect(run.source.asOf).toBe("2026-10-18");
    expect(run.requestHash).toBe(developmentMarketHash({ identity: f.identity, request: input }));
    expect(run.configuration.config.rules).toEqual(["SAVED_DEVELOPMENT_RULE"]); expect(run.runtimeSnapshot.approval.source.origin).toBe("qingdao");
    expect(f.state.jobs[0]).toMatchObject({ kind: "product.development.market_overview.v1", projectId: null, userId: 3, workspaceId: 7, maxAttempts: 1 });
    expect(f.state.artifacts[0]).toMatchObject({ projectId: null, userId: 3, isCurrent: 0, status: "draft" }); expect(f.state.stages).toEqual(before);
    expect(f.events).toContain("permission:product_development:run"); expect(f.state.project.userId).toBe(99);
    const locks = f.calls.filter(call => call.sql.includes("FOR UPDATE") || call.sql.includes("FOR SHARE")).map(call => call.sql);
    expect(locks.findIndex(sql => sql.includes("FROM dev_projects"))).toBeLessThan(locks.findIndex(sql => sql.includes("FROM dev_panorama_status")));
  });
  it("same UUID idempotency avoids prepare and changed content rejects", async () => {
    const f = createDevelopmentMarketTestFixture(), { input, run } = await f.submitted();
    expect((await f.repository.reserve(f.identity, input, async () => { throw new Error("NO_SECOND_PREPARE"); })).runId).toBe(run.runId);
    await expect(f.repository.reserve(f.identity, { ...input, maxCostCents: 101 }, f.prepare())).rejects.toMatchObject({ code: "OPERATION_CONTENT_CONFLICT" }); expect(f.state.jobs).toHaveLength(1);
  });
  it("reserve ACK loss recovers original UUID without a new job", async () => {
    const f = createDevelopmentMarketTestFixture(); f.control.ackLostOn = "INSERT INTO ai_jobs";
    await expect(f.submitted()).rejects.toMatchObject({ outcomeUnknown: true });
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("queued"); expect(f.state.jobs).toHaveLength(1);
  });
  it("active fence spans other UUIDs, including durable unknown", async () => {
    const f = await claimed(), d = await marketDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.dispatch, d.verify); f.control.now += 121;
    expect(await f.repository.claim(f.identity, { ...f.scope, operationId: marketOperation }, "newworker")).toBeNull();
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("outcome_unknown");
    await expect(f.submitted(marketOtherOperation)).rejects.toMatchObject({ code: "ACTIVE_OPERATION_EXISTS" });
  });
  it.each(["workspaceStatus", "actorStatus", "memberStatus"] as const)("fresh %s revocation denies check", async field => {
    const f = createDevelopmentMarketTestFixture(); await f.submitted(); f.control[field] = "disabled";
    await expect(f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("Agent revocation/closed gate retains check/cancel and original UUID tombstone", async () => {
    const f = createDevelopmentMarketTestFixture(); await f.submitted(); f.control.agentDenied = true; f.control.enabled = false;
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("queued");
    expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: marketOperation })).run?.state).toBe("canceled");
    f.control.agentDenied = false; f.control.enabled = true; await expect(f.submitted()).rejects.toMatchObject({ code: "OPERATION_CANCELED" });
  });
  it("pre-start cancellation fences a request with gates off", async () => {
    const f = createDevelopmentMarketTestFixture(); f.control.enabled = false;
    expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: marketOperation })).receipt?.status).toBe("canceled"); f.control.enabled = true;
    await expect(f.submitted()).rejects.toMatchObject({ code: "OPERATION_CANCELED" }); expect(f.state.jobs).toHaveLength(0);
  });
  it.each(["source", "runtime", "cost"])("rejects stale %s consent before queuing", async kind => {
    const f = createDevelopmentMarketTestFixture(), plan = await f.repository.preview(f.identity, { ...f.scope, operationId: marketOperation }, f.prepare()), input = { ...f.scope, operationId: marketOperation, expectedSourceHash: plan.source.sourceHash,
      expectedRuntimeHash: plan.runtimeSnapshot.snapshotHash, maxCostCents: 100, chargeConfirmed: true as const };
    if (kind === "source") input.expectedSourceHash = "0".repeat(64); if (kind === "runtime") input.expectedRuntimeHash = "0".repeat(64); if (kind === "cost") input.maxCostCents = 99;
    await expect(f.repository.reserve(f.identity, input, f.prepare())).rejects.toThrow(); expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0);
  });
  it("does not truncate 2000 products and rejects 2001 or a stale panorama", async () => {
    const f = createDevelopmentMarketTestFixture(), first = f.state.products[0]; f.state.products.splice(0, 2, ...Array.from({ length: 2000 }, (_, index) => ({ ...first, id: index + 9, asin: `B${String(index).padStart(9, "0")}` })));
    (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    expect((await f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation })).products).toHaveLength(2000);
    f.state.products.push({ ...first, id: 2010 }); await expect(f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation })).rejects.toThrow();
  });
  it("captures all 20000 confirmed tag fingerprints and rejects an extra row rather than sampling", async () => {
    const f = createDevelopmentMarketTestFixture(), tag = f.state.tags[0]; f.state.tags.splice(0, 2, ...Array.from({ length: 20000 }, (_, index) => ({ ...tag, id: index + 1 })));
    expect((await f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation })).tags).toHaveLength(20000);
    f.state.tags.push({ ...tag, id: 20001 }); await expect(f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation })).rejects.toThrow();
  });
  it("complete statistics too large for original TEXT are unavailable before charge, never truncated", async () => {
    const f = createDevelopmentMarketTestFixture(), first = f.state.products[0]; f.state.products.splice(0, 2, ...Array.from({ length: 1000 }, (_, index) => ({ ...first, id: index + 9, asin: `B${String(index).padStart(9, "0")}` })));
    (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    await expect(f.submitted()).rejects.toMatchObject({ code: "OUTPUT_STORAGE_BUDGET_UNAVAILABLE" }); expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0);
  });
  it("same original UUID cannot be inspected/canceled through another authorized project or workspace", async () => {
    const f = createDevelopmentMarketTestFixture(); await f.submitted(); f.state.project.id = 6;
    await expect(f.repository.check(f.identity, { ...f.scope, devProjectId: 6, operationId: marketOperation })).rejects.toMatchObject({ code: "OPERATION_SCOPE_MISMATCH" });
    await expect(f.repository.cancel(f.identity, { ...f.scope, devProjectId: 6, operationId: marketOperation })).rejects.toMatchObject({ code: "OPERATION_SCOPE_MISMATCH" });
    await expect(f.repository.check(f.identity, { ...f.scope, expectedWorkspaceId: 8, operationId: marketOperation })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("confirmed snapshot date freezes new/old calculation across worker dates", async () => {
    const f = createDevelopmentMarketTestFixture(); f.state.products[0].listingDate = "2025-10-19"; (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    try { expect((await f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation })).stats.newProductRatio).toBe(0.5); } finally { vi.useRealTimers(); }
  });
  it("malformed detailed permission JSON cannot fall back to a broader role", async () => {
    const f = createDevelopmentMarketTestFixture(); f.control.role = "admin"; f.state.roles.push({ id: 1, workspaceId: 7, role: "admin", modules: ["dev", "emperor"], detailedPermissions: "{broken" });
    await expect(f.submitted()).rejects.toThrow(); expect(f.state.jobs).toHaveLength(0);
  });
  it.each(["2026-02-31", "2025-02-29", "2026-13-01", "2026-1-01"])("does not let Date normalize invalid/noncanonical listing date %s", async listingDate => {
    const f = createDevelopmentMarketTestFixture(); f.state.products[0].listingDate = listingDate; (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    await expect(f.submitted()).rejects.toMatchObject({ code: "SOURCE_DATE_INVALID" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("rejects duplicate natural month aliases rather than counting them as independent growth evidence", async () => {
    const f = createDevelopmentMarketTestFixture(); f.state.products[0].monthlySalesHistory = JSON.stringify({ "2026-1": 10, "2026/01": 20 });
    (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    await expect(f.submitted()).rejects.toMatchObject({ code: "SOURCE_HISTORY_INVALID" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("twelve disconnected monthly observations cannot establish seasonality", async () => {
    const f = createDevelopmentMarketTestFixture(); f.state.products[0].monthlySalesHistory = JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`${2010 + index}-01`, 100])));
    (f.state.version.snapshot as { products: unknown }).products = structuredClone(f.state.products);
    const source = await f.repository.readSource(f.identity, { ...f.scope, operationId: marketOperation });
    expect(() => validateDevelopmentMarketCandidate({ ...marketCandidate, seasonality: { ...marketCandidate.seasonality, hasSeasonality: true } }, source)).toThrow("SEASONAL_EVIDENCE_MISSING");
  });
  it.each(["1", true, null, 0])("strict confirmed flag %s cannot become approved evidence", async confirmed => {
    const f = createDevelopmentMarketTestFixture(); f.state.status.confirmed = confirmed;
    await expect(f.submitted()).rejects.toMatchObject({ code: "PANORAMA_NOT_CONFIRMED" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("full-row changes, stale live product values and human lock are unavailable before fee", async () => {
    const f = createDevelopmentMarketTestFixture(); f.state.products[0].monthlySales = 999;
    await expect(f.submitted()).rejects.toMatchObject({ code: "PANORAMA_LIVE_DATA_CHANGED" });
    f.state.products[0].monthlySales = 100; f.state.stages[0].status = "confirmed";
    await expect(f.submitted()).rejects.toMatchObject({ code: "MARKET_STAGE_CONFIRMED_REQUIRES_UNLOCK" }); expect(f.state.jobs).toHaveLength(0);
  });
  it("dispatch ACK and full fresh runtime verification precede paid permission; duplicate dispatch blocked", async () => {
    const f = await claimed(), d = await marketDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.dispatch, d.verify);
    expect(f.events.at(-1)).toBe("commit_ack"); expect(f.events).toContain("checkpoint:dispatched");
    await expect(f.repository.dispatch(f.lease, d.dispatch, d.verify)).rejects.toMatchObject({ code: "DISPATCH_CONFLICT" });
    const before = structuredClone(f.state.stages); await f.repository.candidate(f.lease, d.result); expect(f.state.stages).toEqual(before);
  });
  it("late source/config drift blocks dispatch without touching prior bodies", async () => {
    const f = await claimed(), d = await marketDispatchFixture(f, f.lease); f.state.tags[0].tag = "CONCURRENT_HUMAN_EDIT";
    await expect(f.repository.dispatch(f.lease, d.dispatch, d.verify)).rejects.toMatchObject({ code: "DISPATCH_CONFLICT" }); expect(f.state.artifacts).toHaveLength(1);
  });
  it("paid candidate persists with write gate off and is immutable", async () => {
    const f = await claimed(), d = await marketDispatchFixture(f, f.lease); await f.repository.dispatch(f.lease, d.dispatch, d.verify); f.control.enabled = false;
    expect((await f.repository.candidate(f.lease, d.result)).state).toBe("candidate");
    await expect(f.repository.candidate(f.lease, d.result)).rejects.toMatchObject({ code: "LEASE_LOST" }); expect(f.state.artifacts).toHaveLength(2);
  });
  it("manual apply archives complete previous AI/human bodies, invalidates downstream and never confirms", async () => {
    const f = await candidate(), before = structuredClone(f.state.stages), input = { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation,
      expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash! }, receipt = await f.repository.apply(f.identity, input);
    expect(receipt).toMatchObject({ status: "committed", stageId: 6, stageRevision: 3 }); expect(f.state.stages[0]).toMatchObject({ status: "completed", editedResult: null, confirmedAt: null });
    expect(JSON.parse(String(f.state.stages[0].rawResult))).toEqual(f.run.result);
    expect(f.state.stages[1]).toMatchObject({ status: "generated", rawResult: "OLD_SUMMARY_AI", editedResult: "OLD_SUMMARY_HUMAN", confirmedAt: null });
    expect((f.state.artifacts.find(row => row.artifactKey === "product.development.market_overview.apply.v1")!.contentJson as { before: unknown }).before).toEqual([...before].sort((a, b) => String(a.stageType).localeCompare(String(b.stageType))));
    expect(await f.repository.apply(f.identity, input)).toEqual(receipt); expect(f.state.artifacts).toHaveLength(3);
  });
  it("apply ACK loss is resolved by original UUID; cancellation cannot undo committed application", async () => {
    const f = await candidate(), input = { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash! };
    f.control.ackLostOn = "UPDATE dev_analysis_stages"; await expect(f.repository.apply(f.identity, input)).rejects.toMatchObject({ outcomeUnknown: true });
    const operation = { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation };
    expect((await f.repository.applyCheck(f.identity, operation))?.status).toBe("committed"); expect((await f.repository.applyCancel(f.identity, operation)).status).toBe("committed");
  });
  it("apply cancel tombstone blocks late original application", async () => {
    const f = await candidate(), operation = { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation };
    await f.repository.applyCancel(f.identity, operation); const before = structuredClone(f.state.stages);
    await expect(f.repository.apply(f.identity, { ...operation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash! })).rejects.toMatchObject({ code: "OPERATION_CANCELED" }); expect(f.state.stages).toEqual(before);
  });
  it("concurrent human edits preserve all old/current output and reject candidate application", async () => {
    const f = await candidate(); f.state.stages[0].editedResult = "NEWER_HUMAN_EDIT"; const before = structuredClone(f.state.stages);
    await expect(f.repository.apply(f.identity, { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation, expectedSourceHash: f.run.sourceHash, expectedResultHash: f.run.resultHash! })).rejects.toMatchObject({ code: "SOURCE_OR_RESULT_CHANGED" });
    expect(f.state.stages).toEqual(before); expect(f.state.artifacts).toHaveLength(2);
  });
  it("real new apply fences a previously dispatched legacy final helper before any old output/artifact write", async () => {
    const f = createDevelopmentMarketTestFixture(); f.state.stages[0].runId = "old-paid-worker-still-returning";
    await f.submitted(); const lease = (await f.repository.claim(f.identity, { ...f.scope, operationId: marketOperation }, "worker"))!, d = await marketDispatchFixture(f, lease);
    await f.repository.dispatch(lease, d.dispatch, d.verify); const run = await f.repository.candidate(lease, d.result);
    await f.repository.apply(f.identity, { ...f.scope, operationId: marketApplyOperation, runOperationId: marketOperation, expectedSourceHash: run.sourceHash, expectedResultHash: run.resultHash! });
    expect(f.state.stages[0].runId).toBeNull(); const before = structuredClone(f.state), update = vi.fn(() => { throw new Error("OLD_WRITE_MUST_NOT_HAPPEN"); }), locks: string[] = [];
    const spy = vi.spyOn(dbClient, "withDbTransaction").mockImplementation(async (_context, body) => body({ execute: async () => { locks.push("stage-for-update"); return [[{ id: 6 }], []]; },
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [structuredClone(f.state.stages[0])] }) }) }), update }));
    try { await expect(completeDevAnalysisStageRunConsistently({ projectId: 5, stageType: "market_overview", runId: "old-paid-worker-still-returning", rawResult: "OLD_LATE_PAID_RESULT" })).rejects.toBeInstanceOf(StaleDevAnalysisRunError);
      expect(locks).toEqual(["stage-for-update"]); expect(update).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it.each(["engine", "trigger", "packet", "warning", "readback"])("physical %s admission/ACK failure cannot partly mutate a stage", async kind => {
    const f = createDevelopmentMarketTestFixture(); if (kind === "engine") f.control.engine = "MyISAM"; if (kind === "trigger") f.control.trigger = true; if (kind === "packet") f.control.packet = 1; if (kind === "warning") f.control.warning = true; if (kind === "readback") f.control.badReadback = "artifact";
    const before = structuredClone(f.state.stages); await expect(f.submitted()).rejects.toThrow(); expect(f.state.stages).toEqual(before); expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0);
  });
});
