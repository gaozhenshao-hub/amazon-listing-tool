import { describe, expect, it } from "vitest";
import { competitorDeepAdoptionHash, competitorDeepAdoptionSourceFingerprint } from "../../../shared/competitorDeepAdoption";
import { createDeepAdoptionSqlFixture } from "./competitorDeepAdoption.testFixture";
import { deepAdoptionArtifactId } from "./competitorDeepAdoptionRepository";

describe("human deep adoption transaction protocol (synthetic SQL, no native DB)", () => {
  it("writes one full immutable artifact, tiny raw ref, comparison invalidation and full before/after receipt atomically", async () => {
    const f = await createDeepAdoptionSqlFixture(), before = structuredClone(f.state), input = f.input();
    const saved = await f.service.adopt(f.ctx, input);
    expect(saved).toMatchObject({ status: "committed", currentActive: true, currentRevision: saved.committedRevision });
    expect(f.state.artifacts).toHaveLength(1); expect(f.state.audits).toHaveLength(1); expect(f.state.comparisonInvalidations).toBe(1);
    expect(f.state.job).toEqual(before.job); expect(f.state.artifact).toEqual(before.artifact);
    const raw = JSON.parse(f.state.analysis.rawData!); delete raw.deepAdoptionRef;
    expect(raw).toEqual(JSON.parse(before.analysis.rawData!)); expect(raw.analysisStale).toBe(true); expect(raw.deepAnalysisStale).toBe(true);
    expect(f.state.analysis).toMatchObject({ summary: input.summary, summaryStatus: "confirmed", summaryVersion: 3,
      summaryConfirmedBy: 3, aiSummary: before.analysis.aiSummary, reviewAnalysis: before.analysis.reviewAnalysis });
    const artifact = JSON.parse(String(f.state.artifacts[0].contentText)); expect(artifact.result).toEqual(f.result);
    expect(artifact.summary).toBe(input.summary); expect(competitorDeepAdoptionHash(artifact)).toBe(saved.ref!.projectionHash);
    expect(f.state.artifacts[0]).toMatchObject({ sourceType: "user_edit", status: "final", isCurrent: 0 });
    const final = f.state.audits[0]; expect(JSON.parse(String(final.beforeText)).rawData).toBe(before.analysis.rawData);
    expect(JSON.parse(String(final.afterText)).rawData).toBe(f.state.analysis.rawData);
    expect(JSON.parse(String(final.metadataText)).receipt).toMatchObject({ committedRevision: saved.committedRevision });
    expect(competitorDeepAdoptionSourceFingerprint(f.state.analysis)).toBe(competitorDeepAdoptionSourceFingerprint(before.analysis));
    const businessReads = f.calls.filter(call => call.tx === 1 && call.sql.startsWith("SELECT") && !call.sql.includes("information_schema"));
    expect(businessReads.slice(0,6).map(call => call.sql.match(/FROM (\w+)/u)?.[1]))
      .toEqual(["ai_jobs", "users", "workspaces", "workspace_memberships", "projects", "competitorAnalyses"]);
    expect(businessReads[0].sql).toMatch(/FOR UPDATE$/u); expect(f.calls.every(call => !call.sql.includes("SELECT *"))).toBe(true);
    expect(f.permissions.every(permission => permission.resource === "project" && permission.action === "update" && !Object.hasOwn(permission, "ownerUserId"))).toBe(true);
    expect(f.calls.filter(call => /^(?:INSERT|UPDATE|DELETE)/u.test(call.sql)).every(call => call.tx === 1)).toBe(true);
  });
  it.each(["artifact", "analysis", "comparison", "audit", "warning", "zeroRows", "readback"])("rolls back every related change on %s failure", async failure => {
    const f = await createDeepAdoptionSqlFixture(), before = structuredClone(f.state);
    if (failure === "artifact") f.control.throwSql = "INSERT INTO ai_artifacts";
    if (failure === "analysis") f.control.throwSql = "UPDATE competitorAnalyses";
    if (failure === "comparison") f.control.invalidateFailure = true;
    if (failure === "audit") f.control.throwSql = "INSERT INTO security_audit_logs";
    if (failure === "warning") f.control.warningStatus = 1;
    if (failure === "zeroRows") f.control.affectedRows = 0;
    if (failure === "readback") f.control.afterWrite = query => { if (query.startsWith("UPDATE")) f.state.analysis.summary += "unexpected trigger"; };
    const result = await f.service.adopt(f.ctx, f.input()).catch(error => error);
    expect(result.status === "committed").toBe(false); expect(f.state).toEqual(before);
  });
  it.each(["title", "raw.research", "manualSales", "unknownRaw", "oldAI", "reviews"])("rejects an unpublished %s change rather than reviving old research", async field => {
    const f = await createDeepAdoptionSqlFixture();
    if (field === "title") f.state.analysis.title = "Updated title";
    else if (field === "oldAI") f.state.analysis.aiSummary = "changed";
    else if (field === "reviews") f.state.analysis.reviewAnalysis = "changed";
    else { const raw = JSON.parse(f.state.analysis.rawData!); raw[field] = { changed: true }; f.state.analysis.rawData = JSON.stringify(raw); }
    await expect(f.service.adopt(f.ctx, f.input())).rejects.toThrow("SOURCE_CHANGED");
    expect(f.state.artifacts).toHaveLength(0); expect(f.state.audits).toHaveLength(0);
  });
  it.each(["resultHash", "evidenceHash", "revision"])("requires exact expected %s", async field => {
    const f = await createDeepAdoptionSqlFixture(), input = f.input();
    if (field === "resultHash") input.expectedResultHash = "a".repeat(64);
    if (field === "evidenceHash") input.expectedEvidenceHash = "a".repeat(64);
    if (field === "revision") input.expectedRevision = "a".repeat(64);
    await expect(f.service.adopt(f.ctx, input)).rejects.toThrow("SOURCE_CHANGED"); expect(f.state.artifacts).toHaveLength(0);
  });
  it.each(["engine", "unique", "auditMetadata"])("refuses missing schema evidence: %s", async field => {
    const f = await createDeepAdoptionSqlFixture();
    if (field === "engine") f.control.engine = "MyISAM";
    if (field === "unique") f.control.unique = false;
    if (field === "auditMetadata") f.columns.find(row => row.columnName === "metadata")!.dataType = "text";
    await f.service.adopt(f.ctx, f.input()).catch(() => undefined);
    expect(f.calls.every(call => call.sql.includes("information_schema"))).toBe(true); expect(f.state.artifacts).toHaveLength(0);
  });
  it.each(["actor", "member", "workspace", "policy", "owner", "scope"])("freshly denies %s without writes", async field => {
    const f = await createDeepAdoptionSqlFixture();
    if (field === "actor") f.state.user.status = "disabled";
    if (field === "member") f.control.memberActive = false;
    if (field === "workspace") f.control.workspaceActive = false;
    if (field === "policy") f.control.deny = true;
    if (field === "owner") f.state.project.userId = 4;
    if (field === "scope") f.state.project.workspaceId = 8;
    await expect(f.service.adopt(f.ctx, f.input())).rejects.toBeDefined(); expect(f.state.artifacts).toHaveLength(0);
  });
  it("preserves explicitly authorized legacy null parent and null workspace without default fallback", async () => {
    for (const workspaceId of [null, 7]) {
      const f = await createDeepAdoptionSqlFixture({ workspaceId, sourceWorkspaceId: null });
      expect(await f.service.adopt(f.ctx, f.input())).toMatchObject({ status: "committed", identity: { userId: 3, workspaceId }, currentActive: true });
    }
  });
  it("binds the UUID namespace to actor/workspace but not target and remains under auditId length", () => {
    const value = { userId: 3, workspaceId: 7, operationId: "a0000000-0000-4000-8000-000000000001" };
    expect(deepAdoptionArtifactId(value)).toHaveLength(75);
    expect(deepAdoptionArtifactId({ ...value, userId: 4 })).not.toBe(deepAdoptionArtifactId(value));
    expect(deepAdoptionArtifactId({ ...value, workspaceId: null })).not.toBe(deepAdoptionArtifactId(value));
  });
  it("rejects a clock before the current persisted row", async () => {
    const f = await createDeepAdoptionSqlFixture(); f.control.now = new Date("2025-01-01T00:00:00Z");
    await expect(f.service.adopt(f.ctx, f.input())).rejects.toThrow("TIME_INVALID"); expect(f.state.artifacts).toHaveLength(0);
  });
  it("keeps a valid envelope larger than TEXT in the immutable artifact, never truncating original review text", async () => {
    const reviewBody = "完整原始评论".repeat(300), f = await createDeepAdoptionSqlFixture({ reviewBody });
    const result = await f.service.adopt(f.ctx, { ...f.input(), summary: "人工核验".repeat(4500) });
    expect(result.status).toBe("committed"); expect(Number(f.state.artifacts[0].fileSizeBytes)).toBeGreaterThan(65535);
    expect(Buffer.byteLength(f.state.analysis.rawData!)).toBeLessThan(65535);
    expect(JSON.parse(String(f.state.artifacts[0].contentText)).result.deepAnalysis.buyers.groups[0].evidence[0].body).toBe(reviewBody);
  });
});
