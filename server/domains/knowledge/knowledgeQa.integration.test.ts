import { describe, expect, it } from "vitest";
import { createKnowledgeQaTestFixture, qaOperation, qaThread } from "./knowledgeQa.testFixture";
import { knowledgeQaOperation, knowledgeQaHash } from "../../../shared/knowledgeQa";
import { createKnowledgeQaQueue, createKnowledgeQaWorker } from "./knowledgeQaWorker";
import { knowledgeQaView } from "./knowledgeQaService";
import { createKnowledgeQaRuntime } from "./knowledgeQaRuntime";
import type { TrpcContext } from "../../_core/context";
const nextOperation = "33333333-3333-4333-8333-333333333333";
describe("knowledge QA actual repository/runtime/source/worker composition", () => {
  it("freezes both approved skills before dispatch and executes real L1/L2/Markdown with citations", async () => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted();
    expect(f.control.paidCalls).toBe(0); expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(2);
    await f.process(input); const run = await f.check(input);
    expect(run?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(3); expect(run?.answer?.references).toHaveLength(5);
    expect(run?.answer?.content).toContain("# SYNTHETIC"); expect(run?.answer?.searchPath.map(value => value.modelCalled)).toEqual([true, true, true]);
    expect(run?.answer?.tokensUsed).toBe(90); expect(f.state.artifacts).toHaveLength(3);
    expect(f.providerCalls.map(value => value.skillSlug)).toEqual(["knowledge.qa.select", "knowledge.qa.select", "knowledge.qa.answer"]);
    const contexts = f.providerCalls.map(value => JSON.parse(value.context!));
    expect(contexts[0].material).toHaveLength(12); expect(contexts[1].material).toHaveLength(10); expect(contexts[2].material).toHaveLength(5);
    expect(JSON.stringify(contexts[0])).not.toContain("FULL ORIGINAL"); expect(JSON.stringify(contexts[2])).toContain("FULL ORIGINAL");
    for (const value of f.providerCalls) { expect(value.context).toContain("SAVED_KNOWLEDGE_INSTRUCTION"); expect(value.context).toContain("SAVED_KNOWLEDGE_RULE"); expect(value.fallbackModels).toEqual([]); expect(value.maxModelAttempts).toBe(1); }
    for (const index of f.events.flatMap((event, i) => event === "provider_called" ? [i] : [])) { expect(f.events[index - 1]).toBe("commit_ack"); expect(f.events[index - 2]).toBe("checkpoint:dispatched"); }
    expect(f.calls.filter(call => /^(?:INSERT|UPDATE)/u.test(call.sql)).every(call => /(?:ai_jobs|ai_artifacts|security_audit_logs)/u.test(call.sql))).toBe(true);
  });
  it.each([[0, 0], [4, 1], [7, 2], [12, 3]])("%i matching entries use at most %i calls without pretending selectors ran", async (count, paid) => {
    const f = createKnowledgeQaTestFixture(count), { input } = await f.submitted(); await f.process(input); const run = await f.check(input);
    expect(run?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(paid); expect(run?.answer?.searchPath).toHaveLength(3);
    if (!count) expect(run?.answer?.references).toEqual([]);
  });
  it.each(["missingApproval", "unavailableCredential"] as const)("%s is unavailable before any model or persistent reservation", async field => {
    const f = createKnowledgeQaTestFixture(); f.control[field] = true; await expect(f.submitted()).rejects.toThrow(); expect(f.control.paidCalls).toBe(0); expect(f.state.jobs).toEqual([]);
  });
  it("does not offer an available preview above the whole-request confirmation cap", async () => {
    const f = createKnowledgeQaTestFixture(), source = await f.repository.source(f.identity, f.previewInput);
    const runtime = createKnowledgeQaRuntime({ approvalResolver: async input => ({ ...f.approvals.find(value => value.stage === input.stage)!, maxCostCents: 1000000 }), credentialResolver: () => "SYNTHETIC" });
    await expect(runtime.prepare({ executor: f.tx, source, operationId: qaOperation, configuration: f.configuration })).rejects.toThrow("COST_BUDGET_EXCEEDED"); expect(f.control.paidCalls).toBe(0);
  });
  it("runtime refuses a changed full source body retaining an old advertised hash", async () => {
    const f = createKnowledgeQaTestFixture(), source = await f.repository.source(f.identity, f.previewInput);
    await expect(f.runtime.prepare({ executor: f.tx, source: { ...source, question: "altered without rehash" }, operationId: qaOperation, configuration: f.configuration })).rejects.toThrow(); expect(f.control.paidCalls).toBe(0);
  });
  it("raw original content and hashes are retained while L2 declares its summary truncation", async () => {
    const f = createKnowledgeQaTestFixture(1), source = await f.repository.source(f.identity, f.previewInput);
    expect(source.items[0].summaryCoverage).toEqual({ charactersAvailable: 625, charactersIncluded: 400, truncated: true });
    expect(source.items[0].aiAnalysis.length).toBe(625); expect(source.items[0].fullContent).toContain("FULL ORIGINAL"); expect(source.items[0].aiAnalysis).not.toContain("OLD_AI");
    expect(f.calls.filter(value => value.sql.includes("FROM `kb_")).every(value => value.sql.includes("workspaceId=? AND status='confirmed' AND visibility IN ('team','public')") && value.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it("does not include other workspace/private/unconfirmed knowledge", async () => {
    const f = createKnowledgeQaTestFixture(4), items = f.state.sourceTables.kb_product_innovations; items[0].workspaceId = 8; items[1].visibility = "private"; items[2].status = "draft";
    expect((await f.repository.source(f.identity, f.previewInput)).items.map(value => value.id)).toEqual([4]);
  });
  it.each(["oversize", "count", "engine"])("%s source rejection does not silently return a partial corpus", async mode => {
    const f = createKnowledgeQaTestFixture(mode === "count" ? 1001 : 1);
    if (mode === "oversize") f.state.sourceTables.kb_product_innovations[0].crawledData = "x".repeat(262145);
    if (mode === "engine") f.control.nonTransactionalTable = "kb_product_innovations";
    await expect(f.repository.source(f.identity, f.previewInput)).rejects.toThrow(); expect(f.control.paidCalls).toBe(0);
  });
  it("submission ACK loss is recovered from the same UUID without another start or fee", async () => {
    const f = createKnowledgeQaTestFixture(); f.control.ackLostOn = "INSERT INTO ai_jobs"; await expect(f.submitted()).rejects.toThrow("OUTCOME_UNVERIFIED");
    const recovered = await f.repository.check(f.identity, { ...f.scope, operationId: qaOperation }); expect(recovered.run?.state).toBe("queued");
    const run = recovered.run!; expect((await f.repository.reserve(f.identity, run.request, f.prepare())).runId).toBe(run.runId); expect(f.state.jobs).toHaveLength(1); expect(f.control.paidCalls).toBe(0);
  });
  it("failed transaction rolls back the thread, source, job and start journal together", async () => {
    const f = createKnowledgeQaTestFixture(); f.control.failWrite = "INSERT INTO security_audit_logs"; await expect(f.submitted()).rejects.toThrow("OUTCOME_UNVERIFIED");
    expect(f.state.jobs).toEqual([]); expect(f.state.artifacts).toEqual([]); expect(f.state.audits).toEqual([]); expect(f.control.paidCalls).toBe(0);
  });
  it("cancel before a delayed start is a durable original-UUID fence even with writes off", async () => {
    const f = createKnowledgeQaTestFixture(); f.control.enabled = false; expect((await f.repository.cancel(f.identity, { ...f.scope, operationId: qaOperation })).canceled).toBe(true);
    f.control.enabled = true; await expect(f.submitted()).rejects.toThrow("OPERATION_CANCELED"); expect(f.state.jobs).toEqual([]);
  });
  it("paid checkpoint ACK loss is observed locally without repeating the completed selector", async () => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted(); f.control.afterPaid = async () => { f.control.ackLostOn = "UPDATE ai_jobs"; };
    await f.process(input); expect((await f.check(input))?.checkpoints[0].result).toHaveLength(10); expect(f.control.paidCalls).toBe(1);
    f.control.afterPaid = null; f.control.now += 200; await f.process(input); expect((await f.check(input))?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(3);
  });
  it("malformed model output is unknown, never an automatic first-five fallback", async () => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted(); f.control.malformed = true; await f.process(input);
    expect((await f.check(input))?.state).toBe("outcome_unknown"); expect(f.control.paidCalls).toBe(1); expect(f.state.artifacts).toHaveLength(2);
  });
  it("a durable dispatched but uncertain model becomes unknown and is never called again", async () => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted(); f.control.modelThrows = true; await f.process(input);
    expect((await f.check(input))?.state).toBe("outcome_unknown"); expect(f.control.paidCalls).toBe(1); f.control.now += 200; await f.process(input); expect(f.control.paidCalls).toBe(1);
    await expect(f.submitted(nextOperation)).rejects.toThrow("ACTIVE_OPERATION_EXISTS"); f.control.enabled = false;
    expect((await f.repository.cancel(f.identity, knowledgeQaOperation(input))).canceled).toBe(true); expect((await f.check(input))?.state).toBe("canceled");
  });
  it.each(["gate", "abort"])("a valid paid intermediate survives %s and resumes at the next stage only", async mode => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted(), controller = new AbortController();
    f.control.afterPaid = async () => { if (mode === "gate") f.control.enabled = false; else controller.abort(); };
    await f.process(input, controller.signal); const pending = await f.check(input); expect(pending?.state).toBe("running"); expect(pending?.checkpoints[0].result).toHaveLength(10); expect(f.control.paidCalls).toBe(1);
    f.control.afterPaid = null; f.control.enabled = true; f.control.now += 200; await f.process(input); expect((await f.check(input))?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(3);
  });
  it("a valid paid final answer survives gate-off without repeating provider", async () => {
    const f = createKnowledgeQaTestFixture(2), { input } = await f.submitted(); f.control.afterPaid = async () => { f.control.enabled = false; };
    await f.process(input); expect((await f.check(input))?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(1);
  });
  it("cancel while provider is slow fences late paid publication", async () => {
    const f = createKnowledgeQaTestFixture(2), { input } = await f.submitted(); f.control.afterPaid = async () => { await f.repository.cancel(f.identity, knowledgeQaOperation(input)); };
    await f.process(input); expect((await f.check(input))?.state).toBe("canceled"); expect(f.state.artifacts.some(row => row.artifactKey === "knowledge.qa.answer.v1")).toBe(false);
  });
  it("permission withdrawal rejects paid persistence, and no raw result is exposed", async () => {
    const f = createKnowledgeQaTestFixture(2), { input } = await f.submitted(); f.control.afterPaid = async () => { f.control.actorStatus = "inactive"; };
    await f.process(input); expect(f.state.jobs[0].status).toBe("running"); expect(f.state.artifacts).toHaveLength(2); await expect(f.check(input)).rejects.toThrow("ACCESS_DENIED");
  });
  it("source or configuration changes before dispatch cannot reuse old pins", async () => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted(); f.state.sourceTables.kb_product_innovations[0].userEditedAnalysis = "changed";
    await f.process(input); expect((await f.check(input))?.state).toBe("failed"); expect(f.control.paidCalls).toBe(0);
    const g = createKnowledgeQaTestFixture(), second = await g.submitted(); g.configuration.config.instructions = "changed"; g.configuration.hash = knowledgeQaHash(g.configuration.config);
    await g.process(second.input); expect(g.control.paidCalls).toBe(0);
  });
  it("immutable artifact tamper fails closed rather than returning a cached answer", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input); f.state.artifacts[2].contentHash = "0".repeat(64); await expect(f.check(input)).rejects.toThrow("ARTIFACT_INVALID");
  });
  it("same actor in another workspace and malformed identity cannot recover private results", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input);
    await expect(f.repository.check({ userId: 3, workspaceId: 8 }, { ...knowledgeQaOperation(input), expectedWorkspaceId: 8 })).rejects.toThrow("ACCESS_DENIED");
    await expect(f.repository.check({ userId: 4, workspaceId: 7 }, knowledgeQaOperation(input))).rejects.toThrow("ACCESS_DENIED");
  });
  it("history and follow-up context retain full answers but explicitly bound six messages", async () => {
    const f = createKnowledgeQaTestFixture(1); for (let n = 0; n < 4; n++) { const operationId = `${String(n + 1).repeat(8)}-1111-4111-8111-111111111111`; const { input } = await f.submitted(operationId); await f.process(input); }
    const source = await f.repository.source(f.identity, { ...f.previewInput, operationId: nextOperation }); expect(source.history).toHaveLength(6); expect(source.coverage.historyAvailable).toBe(8);
    const page = await f.repository.history(f.identity, { ...f.scope, limit: 2 }); expect(page.runs).toHaveLength(2); expect(page.nextBeforeId).toBe(3);
    const next = await f.repository.history(f.identity, { ...f.scope, limit: 2, beforeId: page.nextBeforeId! }); expect(next.runs).toHaveLength(2); expect(next.nextBeforeId).toBeNull();
  });
  it("a different-question follow-up cannot carry revoked ancestral knowledge through history", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input);
    f.state.sourceTables.kb_videos.push({ id: 1, userId: 3, workspaceId: 7, status: "confirmed", visibility: "team", updatedAt: "2026-10-19T00:00:00.000000Z", asin: "SYNTHETIC", videoTitle: "SYNTHETIC VIDEO", category: "SYNTHETIC", tags: "[]", score: 8, oversized: 0, transcriptText: "full transcript", userEditedAnalysis: "human video analysis", aiAnalysis: "old" });
    const next = { ...f.previewInput, operationId: nextOperation, question: "视频" }, preview = await f.repository.preview(f.identity, next, f.prepare(nextOperation));
    expect(preview.source.items.map(value => value.key)).toEqual(["video:1"]); expect(preview.source.historySourceKeys).toEqual(["product:1"]);
    const request = { ...next, expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: 100, chargeConfirmed: true as const };
    await f.repository.reserve(f.identity, request, f.prepare(nextOperation)); f.state.sourceTables.kb_product_innovations[0].visibility = "private";
    await expect(f.repository.check(f.identity, knowledgeQaOperation(request))).rejects.toThrow("SOURCE_ACCESS_CHANGED"); expect(f.control.paidCalls).toBe(1);
  });
  it("clear hides only owned current-workspace private threads and preserves all originals", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input);
    expect(await f.repository.clear(f.identity, { expectedWorkspaceId: 7, confirmAll: true })).toEqual({ cleared: 1 });
    expect(await f.repository.clear(f.identity, { expectedWorkspaceId: 7, confirmAll: true })).toEqual({ cleared: 0 }); expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(3);
  });
  it("rename/delete use the private thread revision without deleting original jobs/artifacts", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input);
    const renamed = await f.repository.rename(f.identity, { ...f.scope, title: "SYNTHETIC renamed", expectedVersion: 1 }); expect(renamed.version).toBe(2);
    await expect(f.repository.delete(f.identity, { ...f.scope, expectedVersion: 1 })).rejects.toThrow("THREAD_VERSION_CHANGED");
    expect(await f.repository.delete(f.identity, { ...f.scope, expectedVersion: 2 })).toEqual({ deleted: true }); expect((await f.repository.threads(f.identity, { expectedWorkspaceId: 7, limit: 20 })).items).toEqual([]); expect(f.state.jobs).toHaveLength(1); expect(f.state.artifacts).toHaveLength(3);
  });
  it("feedback only records a real reference and never writes knowledge", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input);
    await expect(f.repository.feedback(f.identity, { ...knowledgeQaOperation(input), itemKey: "product:999", rating: "wrong", comment: "" })).rejects.toThrow("REFERENCE_UNAVAILABLE");
    expect(await f.repository.feedback(f.identity, { ...knowledgeQaOperation(input), itemKey: "product:1", rating: "helpful", comment: "" })).toEqual({ recorded: true });
    expect(f.state.audits.at(-1)?.action).toBe("knowledge.qa.feedback");
  });
  it("changed content reports sourceChanged; revoked source hides even a same-UUID start replay", async () => {
    const f = createKnowledgeQaTestFixture(1), { input } = await f.submitted(); await f.process(input); f.state.sourceTables.kb_product_innovations[0].userEditedAnalysis = "new";
    const run = await f.check(input); expect(knowledgeQaView(f.identity, input, run).sourceChanged).toBe(true);
    f.state.sourceTables.kb_product_innovations[0].visibility = "private"; await expect(f.check(input)).rejects.toThrow("SOURCE_ACCESS_CHANGED"); await expect(f.repository.reserve(f.identity, input, f.prepare())).rejects.toThrow("SOURCE_ACCESS_CHANGED");
    expect((await f.repository.cancel(f.identity, knowledgeQaOperation(input))).run?.state).toBe("succeeded");
  });
  it("flag off preview remains honest and explicit null ctx workspace never falls back", async () => {
    const f = createKnowledgeQaTestFixture(1), ctx = { user: { id: 3, defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext; f.control.enabled = false;
    const preview = await f.service.preview(ctx, f.previewInput); expect(preview.capability.available).toBe(false); expect(preview.budget).toBeNull(); expect(preview.matchedCount).toBe(1);
    await expect(f.service.preview({ ...ctx, workspaceId: null }, f.previewInput)).rejects.toThrow("ACCESS_DENIED");
  });
  it("queue is gated, bounded, ordered and contains only lightweight private hints", async () => {
    const f = createKnowledgeQaTestFixture(), queue = createKnowledgeQaQueue({ database: async () => f.database, enabled: () => f.control.enabled });
    f.control.enabled = false; expect(await queue()).toEqual([]); expect(f.calls).toHaveLength(0); f.control.enabled = true; await f.submitted();
    expect(await queue()).toEqual([{ id: 1, ...f.identity, threadId: qaThread, operationId: qaOperation }]); await expect(queue(0, 26)).rejects.toThrow();
    expect(f.calls.at(-1)?.sql).not.toContain("SELECT input");
  });
  it("worker tick coalesces and stop prevents more discovery", async () => {
    let release!: () => void, calls = 0; const wait = new Promise<void>(resolve => { release = resolve; });
    const worker = createKnowledgeQaWorker({ enabled: () => true, discover: async () => { calls++; await wait; return []; }, intervalMs: 60000 });
    const a = worker.tick(), b = worker.tick(); expect(a).toBe(b); release(); await a; await worker.stop(); await worker.tick(); expect(calls).toBe(1);
  });
});
