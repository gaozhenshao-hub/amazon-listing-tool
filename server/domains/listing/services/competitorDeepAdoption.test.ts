import { describe, expect, it } from "vitest";
import { createDeepAdoptionSqlFixture } from "../../../repositories/listing/competitorDeepAdoption.testFixture";
import { competitorDeepAdoptionHash } from "../../../../shared/competitorDeepAdoption";

describe("deep adoption public human-only operations", () => {
  it("reads options without starting any job/model or changing data; disabled default is explicit", async () => {
    const f = await createDeepAdoptionSqlFixture(), before = structuredClone(f.state); f.control.enabled = false;
    expect(await f.service.options(f.ctx, f.request())).toMatchObject({ capability: { available: false, reasonCode: "DEEP_ADOPTION_WRITES_DISABLED" }, currentAdoptionValid: false });
    expect(f.state).toEqual(before); expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
    await expect(f.service.adopt(f.ctx, f.input())).rejects.toThrow("WRITES_DISABLED");
  });
  it("replays one UUID despite later review edits without writing another artifact or invalidating comparisons twice", async () => {
    const f = await createDeepAdoptionSqlFixture(), input = f.input(), first = await f.service.adopt(f.ctx, input);
    f.state.analysis.summary = "Later human draft"; f.state.analysis.summaryVersion++; f.state.analysis.summaryStatus = "draft";
    expect(await f.service.adopt(f.ctx, input)).toMatchObject({ status: "committed", committedRevision: first.committedRevision, currentActive: false });
    expect(f.state.artifacts).toHaveLength(1); expect(f.state.audits).toHaveLength(1); expect(f.state.comparisonInvalidations).toBe(1);
    await expect(f.service.adopt(f.ctx, { ...input, summary: "Different request" })).rejects.toThrow("OPERATION_CONTENT_CONFLICT");
  });
  it("permits same-source re-adoption after unlock/save via verified prior immutable proof, without another model job", async () => {
    const f = await createDeepAdoptionSqlFixture(); await f.service.adopt(f.ctx, f.input());
    const job = structuredClone(f.state.job); f.state.analysis.summary = "Edited human draft"; f.state.analysis.summaryVersion++;
    f.state.analysis.summaryStatus = "draft"; f.state.analysis.summaryConfirmedBy = null; f.state.analysis.summaryConfirmedAt = null;
    const options = await f.service.options(f.ctx, { ...f.request(), expectedRevision: f.input().expectedRevision });
    expect(options).toMatchObject({ capability: { available: true, reasonCode: null }, currentAdoptionValid: false, activeAdoption: null, currentSummary: "Edited human draft" });
    expect(await f.service.adopt(f.ctx, f.input("a0000000-0000-4000-8000-000000000002"))).toMatchObject({ status: "committed", currentActive: true });
    expect(f.state.job).toEqual(job); expect(f.state.artifacts).toHaveLength(2); expect(f.state.audits).toHaveLength(2);
  });
  it("returns the exact locked current summary and only a genuinely current active ref", async () => {
    const f = await createDeepAdoptionSqlFixture();
    const initial = await f.service.options(f.ctx, f.request());
    expect(initial).toMatchObject({ currentSummary: f.state.analysis.summary, activeAdoption: null, currentAdoptionValid: false });
    const saved = await f.service.adopt(f.ctx, { ...f.input(), summary: "Human edited summary retained, not overwritten by AI." });
    expect(await f.service.options(f.ctx, { ...f.request(), expectedRevision: f.input().expectedRevision })).toMatchObject({
      currentSummary: "Human edited summary retained, not overwritten by AI.", activeAdoption: saved.ref, currentAdoptionValid: true });
  });
  it("does not mistake a forged prior ref for permission to accept changed unpublished sources", async () => {
    const f = await createDeepAdoptionSqlFixture(); await f.service.adopt(f.ctx, f.input());
    const raw = JSON.parse(f.state.analysis.rawData!); raw.deepAdoptionRef.projectionHash = "a".repeat(64); f.state.analysis.rawData = JSON.stringify(raw);
    await expect(f.service.adopt(f.ctx, f.input("a0000000-0000-4000-8000-000000000002"))).rejects.toThrow("ARTIFACT_INVALID");
    expect(f.state.artifacts).toHaveLength(1);
  });
  it.each([null, new Date("2026-10-19T00:00:01Z")])("does not claim a mismatched confirmation timestamp is active: %s", async timestamp => {
    const f = await createDeepAdoptionSqlFixture(); await f.service.adopt(f.ctx, f.input()); f.state.analysis.summaryConfirmedAt = timestamp;
    expect(await f.service.check(f.ctx, f.operation())).toMatchObject({ status: "committed", currentActive: false });
    expect(await f.service.options(f.ctx, { ...f.request(), expectedRevision: f.input().expectedRevision })).toMatchObject({
      currentAdoptionValid: false, activeAdoption: null, capability: { available: true, reasonCode: null } });
  });
  it("returns unknown on lost commit ACK and checks the original UUID without reapplying", async () => {
    const f = await createDeepAdoptionSqlFixture(), input = f.input(); f.control.lostAck = true;
    const uncertain = await f.service.adopt(f.ctx, input); expect(uncertain).toMatchObject({ status: "unknown", operationId: input.operationId, currentActive: false });
    f.control.enabled = false; const checked = await f.service.check(f.ctx, f.operation());
    expect(checked).toMatchObject({ status: "committed", currentActive: true, operationId: input.operationId,
      requestHash: competitorDeepAdoptionHash({ identity: { userId: 3, workspaceId: 7 }, request: input }) });
    expect(await f.service.cancel(f.ctx, f.operation())).toEqual(checked); expect(f.state.artifacts).toHaveLength(1);
    expect(f.state.comparisonInvalidations).toBe(1);
  });
  it("unknown is never success and permanent cancel fencing works while writes are disabled", async () => {
    const f = await createDeepAdoptionSqlFixture(); f.control.enabled = false;
    expect(await f.service.check(f.ctx, f.operation())).toMatchObject({ status: "unknown", currentActive: false });
    expect(f.state.audits).toHaveLength(0); expect(await f.service.cancel(f.ctx, f.operation())).toMatchObject({ status: "cancelled" });
    f.control.enabled = true; expect(await f.service.adopt(f.ctx, f.input())).toMatchObject({ status: "cancelled", currentActive: false });
    expect(f.state.artifacts).toHaveLength(0); expect(f.state.comparisonInvalidations).toBe(0); expect(f.state.audits).toHaveLength(1);
  });
  it.each(["missing", "altered", "original", "source"])("retains committed receipt but not active authority after %s evidence", async kind => {
    const f = await createDeepAdoptionSqlFixture(), committed = await f.service.adopt(f.ctx, f.input());
    if (kind === "missing") f.control.artifactMissing = true;
    if (kind === "altered") f.state.artifacts[0].contentHash = "a".repeat(64);
    if (kind === "original") f.state.artifact.contentHash = "a".repeat(64);
    if (kind === "source") f.state.analysis.price = "23.00";
    expect(await f.service.check(f.ctx, f.operation())).toMatchObject({ status: "committed", committedRevision: committed.committedRevision, currentActive: false });
  });
  it("does not downgrade revoked current membership to a readable disabled options payload", async () => {
    const f = await createDeepAdoptionSqlFixture(); f.control.memberActive = false;
    await expect(f.service.options(f.ctx, f.request())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.check(f.ctx, f.operation())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks a final UUID's exact scope rather than trusting target-free unique lookup", async () => {
    const f = await createDeepAdoptionSqlFixture(); await f.service.adopt(f.ctx, f.input());
    const metadata = JSON.parse(String(f.state.audits[0].metadataText)); metadata.receipt.analysisId = 22; f.state.audits[0].metadataText = JSON.stringify(metadata);
    await expect(f.service.check(f.ctx, f.operation())).rejects.toThrow("OPERATION_SCOPE_CONFLICT");
  });
  it.each(["workspace", "extra", "summary", "ack"])("rejects invalid %s input before database IO", async field => {
    const f = await createDeepAdoptionSqlFixture(), input = f.input();
    const value = field === "workspace" ? { ...input, expectedWorkspaceId: null } : field === "extra" ? { ...input, result: {} }
      : field === "summary" ? { ...input, summary: "😀".repeat(17000) } : { ...input, confirmLimitations: false };
    await expect(f.service.adopt(f.ctx, value as typeof input)).rejects.toBeDefined(); expect(f.calls).toHaveLength(0);
  });
});
