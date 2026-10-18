import { describe, expect, it } from "vitest";
import { createListingConfiguredTestFixture, listingApplyId, listingOperationId } from "./listingConfigured.testFixture";
import { createListingConfiguredProcessor } from "./listingConfiguredWorker";
import { listingConfiguredOperationScope, listingConfiguredCandidate } from "./listingConfiguredRepository";
import { listingConfiguredHash as hash } from "../../../../shared/listingConfiguredWorkflow";
const processor = (f: ReturnType<typeof createListingConfiguredTestFixture>) => createListingConfiguredProcessor({ repository: f.repository, runtime: f.runtime,
  loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled, heartbeatMs: 100000 });
const hint = (f: ReturnType<typeof createListingConfiguredTestFixture>) => ({ id: Number(f.state.jobs[0].id), ...f.identity, projectId: 8, operationId: listingOperationId });
async function finished() { const f = createListingConfiguredTestFixture(); const input = await f.submitted(); await processor(f)(hint(f));
  const result = await f.repository.check(f.identity, listingConfiguredOperationScope(input)); expect(result.run?.state).toBe("succeeded"); return { f, input, run: result.run! }; }
describe("configured Listing durable SQL protocol, synthetic transactions only", () => {
  it.each(["sellingPoints", "singleBullet", "bullets", "description", "searchTerms", "qa", "batch"] as const)("%s preserves complete original output and applies through the original draft/review ledger", async operation => {
    const f = createListingConfiguredTestFixture(operation), input = await f.submitted(); await processor(f)(hint(f));
    const { run } = await f.repository.check(f.identity, listingConfiguredOperationScope(input)); expect(run?.state).toBe("succeeded");
    const candidate = listingConfiguredCandidate(run!)!; expect(Object.keys(candidate.outputs)).toEqual(f.operations);
    const receipt = await f.repository.apply(f.identity, { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId, expectedSourceHash: run!.sourceHash,
      expectedResultHash: run!.resultHash!, expectedDraftHash: run!.source.draftHash, titleIndex: operation === "batch" ? 0 : null, confirmHumanReview: true });
    expect(receipt.status).toBe("committed"); expect(f.state.sourceTables.listings[0].lockedSteps).toBe("[]");
    if (["singleBullet", "bullets", "batch"].includes(operation)) {
      expect(receipt.candidateIds).toHaveLength(1); expect(f.state.sourceTables.listing_bullet_candidates[0]).toMatchObject({ coreRevisionId: 12, status: "review_required", jobId: run!.id, inputHash: "d".repeat(64) });
      expect(f.state.sourceTables.listings[0].bulletPoints).toBeNull();
    }
    if (["sellingPoints", "batch"].includes(operation)) { expect(candidate.outputs.sellingPoints.sellingPoints).toHaveLength(7); expect(f.state.sourceTables.listing_core_revisions).toHaveLength(1); }
  });
  it("reserves once without a model, replays original UUID before reading changed configuration", async () => {
    const f = createListingConfiguredTestFixture(), input = await f.submitted(); f.configuration.config.enabled = false;
    await f.repository.reserve(f.identity, input, async () => { throw new Error("MUST_NOT_RESOLVE_AGAIN"); });
    expect(f.state.jobs).toHaveLength(1); expect(f.providerInputs).toHaveLength(0);
    await expect(f.repository.reserve(f.identity, { ...input, maxCostCents: input.maxCostCents + 1 }, f.prepare)).rejects.toMatchObject({ code: "OPERATION_CONTENT_CONFLICT" });
  });
  it("commits dispatch before provider and complete original candidate before human apply", async () => {
    const { f, run } = await finished(); expect(f.providerInputs).toHaveLength(1); expect(listingConfiguredCandidate(run)?.outputs.title).toMatchObject({ extra: "PRESERVED" });
    expect(f.events.indexOf("checkpoint:dispatched")).toBeLessThan(f.events.indexOf("provider")); expect(f.events.slice(0, f.events.indexOf("provider"))).toContain("commit_ack");
    expect(f.state.sourceTables.listings[0].title).toBe("OLD DRAFT");
  });
  it("canonical JSON scalar storage preserves candidate numbers and supports metadata-only history", async () => {
    const f = createListingConfiguredTestFixture(); const exact = 0.30000000000000004;
    Object.assign(f.good.title, { originalNumber: exact }); const input = await f.submitted(); await processor(f)(hint(f));
    const { run } = await f.repository.check(f.identity, listingConfiguredOperationScope(input));
    expect(listingConfiguredCandidate(run!)?.outputs.title.originalNumber).toBe(exact);
    expect(typeof f.state.jobs[0].input).toBe("string"); expect(typeof f.state.jobs[0].output).toBe("string");
    expect(f.state.artifacts.every(row => typeof row.contentJson === "string")).toBe(true);
    expect(await f.repository.history(f.identity, { ...f.scope, beforeId: null, limit: 10 })).toMatchObject({ items: [{ operationId: listingOperationId, state: "succeeded" }], nextBeforeId: null });
    expect(f.calls.some(call => call.sql.includes("CAST(JSON_UNQUOTE(input) AS JSON)") && call.sql.includes("ORDER BY id DESC"))).toBe(true);
  });
  it("known quality return allows exactly two repair attempts, preserving prior paid receipts", async () => {
    const f = createListingConfiguredTestFixture(); f.responses.splice(0, 1, { titles: [{ title: "x".repeat(90), itemHighlights: "Valid" }] }, { titles: [{ title: "x".repeat(90), itemHighlights: "Valid" }] }, f.good.title);
    const input = await f.submitted(); await processor(f)(hint(f)); const { run } = await f.repository.check(f.identity, listingConfiguredOperationScope(input));
    expect(run?.state).toBe("succeeded"); expect(run?.steps.map(step => step.attempt.qualityAttempt)).toEqual([0, 1, 2]); expect(f.providerInputs).toHaveLength(3);
    expect(f.providerInputs[1].context).toContain("previousKnownResponse");
  });
  it("quality exhaustion stops at original bound without fallback outside the approved plan", async () => {
    const f = createListingConfiguredTestFixture(); f.responses[0] = { titles: [{ title: "x".repeat(90), itemHighlights: "Valid" }] };
    const input = await f.submitted(); await processor(f)(hint(f)); expect((await f.repository.check(f.identity, listingConfiguredOperationScope(input))).run?.state).toBe("failed"); expect(f.providerInputs).toHaveLength(3);
  });
  it("unknown paid call becomes outcome_unknown and restart never sends again", async () => {
    const f = createListingConfiguredTestFixture(); f.control.providerThrows = true; const input = await f.submitted(); await processor(f)(hint(f));
    expect((await f.repository.check(f.identity, listingConfiguredOperationScope(input))).run?.state).toBe("outcome_unknown"); await processor(f)(hint(f)); expect(f.providerInputs).toHaveLength(1);
  });
  it("dispatch commit ACK loss never reaches provider and expired lease becomes unknown", async () => {
    const f = createListingConfiguredTestFixture(); const input = await f.submitted(); f.control.ackLostOn = "UPDATE ai_jobs SET output";
    await processor(f)(hint(f)); expect(f.providerInputs).toHaveLength(0); f.control.now += 121; await processor(f)(hint(f));
    expect((await f.repository.check(f.identity, listingConfiguredOperationScope(input))).run?.state).toBe("outcome_unknown");
  });
  it("paid checkpoint lost ACK recovers succeeded without another model call", async () => {
    const f = createListingConfiguredTestFixture(); const input = await f.submitted(); f.control.afterPaid = async () => { f.control.ackLostOn = "UPDATE ai_jobs SET output"; };
    await processor(f)(hint(f)); expect((await f.repository.check(f.identity, listingConfiguredOperationScope(input))).run?.state).toBe("succeeded"); await processor(f)(hint(f)); expect(f.providerInputs).toHaveLength(1);
  });
  it("paid output is retained when writes turn off after provider returns", async () => {
    const f = createListingConfiguredTestFixture(); const input = await f.submitted(); f.control.afterPaid = async () => { f.control.enabled = false; };
    await processor(f)(hint(f)); expect((await f.repository.check(f.identity, listingConfiguredOperationScope(input))).run?.state).toBe("succeeded");
  });
  it("cancel-before-seen fences the UUID with flags off", async () => {
    const f = createListingConfiguredTestFixture(), input = await f.submitted(); const other = { ...listingConfiguredOperationScope(input), operationId: listingApplyId }; f.control.enabled = false;
    await f.repository.cancel(f.identity, other); f.control.enabled = true; await f.repository.reserve(f.identity, { ...input, operationId: listingApplyId }, f.prepare); expect(f.state.jobs).toHaveLength(1);
  });
  it("fresh source or authority changes before dispatch make no provider call", async () => {
    for (const kind of ["source", "authority"]) { const f = createListingConfiguredTestFixture(); await f.submitted();
      if (kind === "source") f.state.sourceTables.projects[0].name = "CHANGED"; else f.control.deny = true;
      await processor(f)(hint(f)).catch(() => undefined); expect(f.providerInputs).toHaveLength(0); }
  });
  it("explicit title application uses full draft CAS, leaves locks unconfirmed and journals full before/after", async () => {
    const { f, input, run } = await finished(); const apply = { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId,
      expectedSourceHash: run.sourceHash, expectedResultHash: run.resultHash!, expectedDraftHash: run.source.draftHash, titleIndex: 0, confirmHumanReview: true as const };
    const receipt = await f.repository.apply(f.identity, apply); expect(receipt.status).toBe("committed"); expect(f.state.sourceTables.listings[0]).toMatchObject({ title: "Synthetic Storage Bag", version: 2, lockedSteps: "[]" });
    expect(JSON.parse(String(f.state.artifacts.find(row => row.artifactKey === "listing.generation.apply.v1")?.contentJson))).toMatchObject({ before: { listings: [{ title: "OLD DRAFT" }] }, after: { listings: [{ title: "Synthetic Storage Bag" }] } });
    f.control.enabled = false; expect(await f.repository.applyCheck(f.identity, { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId })).toEqual(receipt);
    expect(receipt.requestHash).toBe(hash({ identity: f.identity, request: apply }));
  });
  it("final audit failure rolls original draft and immutable artifact back atomically", async () => {
    const { f, input, run } = await finished(); f.control.failWrite = "INSERT INTO security_audit_logs";
    await expect(f.repository.apply(f.identity, { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId, expectedSourceHash: run.sourceHash,
      expectedResultHash: run.resultHash!, expectedDraftHash: run.source.draftHash, titleIndex: 0, confirmHumanReview: true })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN_CHECK_SAME_UUID" });
    expect(f.state.sourceTables.listings[0].title).toBe("OLD DRAFT"); expect(f.state.artifacts.some(row => row.artifactKey === "listing.generation.apply.v1")).toBe(false);
  });
  it("apply ACK loss is recovered by the same apply UUID; changed run/scope is rejected", async () => {
    const { f, input, run } = await finished(); const op = { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId };
    f.control.ackLostOn = "INSERT INTO security_audit_logs"; await expect(f.repository.apply(f.identity, { ...op, expectedSourceHash: run.sourceHash,
      expectedResultHash: run.resultHash!, expectedDraftHash: run.source.draftHash, titleIndex: 0, confirmHumanReview: true })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN_CHECK_SAME_UUID" });
    expect((await f.repository.applyCheck(f.identity, op))?.status).toBe("committed");
    await expect(f.repository.applyCheck(f.identity, { ...op, operationId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ code: "OPERATION_SCOPE_CONFLICT" });
  });
  it("source drift, locked title, bad driver warnings or canceled application cannot overwrite", async () => {
    for (const mode of ["drift", "warning", "cancel"]) { const { f, input, run } = await finished(); const op = { ...listingConfiguredOperationScope(input), applyOperationId: listingApplyId };
      if (mode === "drift") f.state.sourceTables.listings[0].title = "HUMAN EDIT"; if (mode === "warning") f.control.warnings = 1; if (mode === "cancel") await f.repository.applyCancel(f.identity, op);
      const request = { ...op, expectedSourceHash: run.sourceHash, expectedResultHash: run.resultHash!, expectedDraftHash: run.source.draftHash, titleIndex: 0, confirmHumanReview: true as const };
      if (mode === "cancel") expect((await f.repository.apply(f.identity, request)).status).toBe("cancelled"); else await expect(f.repository.apply(f.identity, request)).rejects.toBeDefined();
      expect(f.state.sourceTables.listings[0].title).not.toBe("Synthetic Storage Bag"); }
  });
  it("batch requires preexisting confirmed cores before any reservation/payment", async () => {
    const f = createListingConfiguredTestFixture("batch"); f.state.sourceTables.listing_core_revisions[0].status = "draft";
    await expect(f.submitted()).rejects.toMatchObject({ code: "CONFIRMED_CORE_CHANGED" }); expect(f.state.jobs).toHaveLength(0); expect(f.providerInputs).toHaveLength(0);
  });
});
