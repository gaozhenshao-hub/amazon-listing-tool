import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "../dbClient";
vi.mock("../../domains/ai_os/repositories/assistantRuleConfirmationJournal", () => ({ assertAssistantRuleConfirmationJournalSchema: vi.fn(async () => undefined) }));
import { competitorDeepJobSession, deepRunId } from "./competitorDeepJobRepository";
import { decodeCompetitorDeepExecutionInput } from "./competitorDeepExecutionRepository";
import { deepFixture, syntheticIdentity, clone } from "../../domains/listing/services/competitorDeepJob.testFixture";
const dialect = new MySqlDialect();
async function harness() {
  const h = await deepFixture(), scope = { ...syntheticIdentity, projectId: 11, analysisId: 21 };
  let job: Record<string, unknown> | null = null, audit: Record<string, unknown> | null = null, member = "active", duplicateMember = false, limit = 1, badEngine = false, prefix: number | null = null;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const executor = { execute: vi.fn(async (query: SQL) => {
    const q = dialect.sqlToQuery(query); calls.push(q);
    if (q.sql.includes("information_schema.TABLES")) return [q.params.map(name => ({ name, engine: badEngine ? "MyISAM" : "InnoDB" }))];
    if (q.sql.includes("information_schema.STATISTICS")) return [[{ name: "uq_run", seq: 1, columnName: "runId", prefix }]];
    if (q.sql.includes("FROM ai_jobs")) return [job ? [clone(job)] : []];
    if (q.sql.includes("FROM users")) return [[{ id: 3, role: "admin", status: "active", defaultWorkspaceId: 7 }]];
    if (q.sql.includes("FROM workspaces")) return [[{ id: 7, status: "active" }]];
    if (q.sql.includes("FROM workspace_memberships")) return [Array.from({ length: duplicateMember ? 2 : 1 }, () => ({ userId: 3, workspaceId: 7, status: member }))];
    if (q.sql.includes("FROM projects")) return [[{ id: 11, userId: 3, workspaceId: 7 }]];
    if (q.sql.includes("FROM competitorAnalyses")) return [[{ id: 21, projectId: 11, asin: "B000000001", title: "Lamp", bulletPoints: null, imageUrls: null, price: null, rating: null, reviewCount: null,
      reviewAnalysis: null, keywords: null, rawData: null, aiSummary: null, summary: null, summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), columnsWithinLimit: limit }]];
    if (q.sql.includes("FROM security_audit_logs")) return [audit ? [clone(audit)] : []];
    if (q.sql.startsWith("INSERT INTO security_audit_logs")) { const p = q.params; audit = { auditId: p[0], workspaceId: p[1], actorUserId: p[2], action: p[4], resourceType: p[5], resourceId: p[6], body: p[7] }; return [{ affectedRows: 1, warningStatus: 0 }]; }
    if (q.sql.startsWith("INSERT INTO ai_jobs")) { job = { ...h.job, kind: "listing_competitor_deep_v1", module: "listing", maxAttempts: 1, runId: q.params[0], inputText: q.params[8], outputText: null }; return [{ affectedRows: 1, warningStatus: 0 }]; }
    if (q.sql.startsWith("UPDATE ai_jobs")) { job!.status = "canceled"; return [{ affectedRows: 1, warningStatus: 0 }]; }
    throw new Error("UNEXPECTED_SYNTHETIC_SQL");
  }) } as unknown as DbExecutor;
  const permission = vi.fn(async (_input: unknown) => undefined), session = competitorDeepJobSession(executor, permission as never);
  return { h, scope, session, calls, permission, setMember: (status: string) => { member = status; }, duplicate: () => { duplicateMember = true; }, oversized: () => { limit = 0; }, myisam: () => { badEngine = true; }, prefix: () => { prefix = 10; } };
}
describe("deep SQL protocol fixtures (not native database acceptance)", () => {
  it("reserves real complete runtime/evidence and verifies exact readback", async () => {
    const h = await harness(), row = await h.session.reserve(h.h.stored); expect(row.runId).toBe(deepRunId(syntheticIdentity, h.h.input.operationId)); expect(row.input).toEqual(h.h.stored);
  });
  it("old stored inputs remain readable but new reservation requires runtime", async () => {
    const h = await harness(), old = clone(h.h.stored); delete old.reservation; expect(decodeCompetitorDeepExecutionInput(old)).toEqual(old);
    await expect(h.session.reserve(old)).rejects.toThrow("RUNTIME_REQUIRED");
  });
  it("historical v1 config-free reservations replay unchanged but cannot create new jobs", async () => {
    const h = await harness(), old = await deepFixture(1);
    expect(decodeCompetitorDeepExecutionInput(old.stored)).toEqual(old.stored);
    await expect(h.session.reserve(old.stored)).rejects.toThrow("CONFIGURATION_SNAPSHOT_REQUIRED");
    expect(h.calls.some(call => call.sql.startsWith("INSERT"))).toBe(false);
  });
  it("rejects changed logical request hash or Skill binding", async () => {
    const h = await harness(), bad = clone(h.h.stored); bad.reservation!.request.expectedEvidenceHash = "b".repeat(64); expect(() => decodeCompetitorDeepExecutionInput(bad)).toThrow("INPUT_INVALID");
    const other = clone(h.h.stored); other.reservation!.runtime.stages[0].skill.version++; expect(() => decodeCompetitorDeepExecutionInput(other)).toThrow("INPUT_INVALID");
  });
  it("cancel-before-reserve stores a bounded metadata-only permanent fence", async () => {
    const h = await harness(); await h.session.cancel(h.scope, h.h.input.operationId, "admin", null);
    expect(await h.session.fence({ ...h.scope, sourceWorkspaceId: 7 } as typeof h.scope, h.h.input.operationId)).toBe(true);
    const insert = h.calls.find(call => call.sql.startsWith("INSERT INTO security_audit_logs"))!;
    expect(String(insert.params[0]).length).toBeLessThanOrEqual(80); expect(String(insert.params[7])).not.toContain("Lamp"); expect(String(insert.params[7])).not.toContain("manifest");
    await expect(h.session.fence({ ...h.scope, analysisId: 22 }, h.h.input.operationId)).rejects.toThrow("OPERATION_SCOPE_CONFLICT");
  });
  it("cancel preserves input checkpoints and readback status", async () => {
    const h = await harness(), row = await h.session.reserve(h.h.stored); const canceled = await h.session.cancel(h.scope, h.h.input.operationId, "admin", row);
    expect(canceled?.status).toBe("canceled"); expect(canceled?.input).toEqual(row.input);
  });
  it.each(["disabled", "invited"])("fresh %s member cannot read/run/cancel", async state => {
    const h = await harness(); h.setMember(state); await expect(h.session.authorize(h.scope, "run")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.permission).not.toHaveBeenCalled();
  });
  it("duplicate membership refuses authority, no owner bypass", async () => {
    const h = await harness(); h.duplicate(); await expect(h.session.authorize(h.scope, "read")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const good = await harness(); await good.session.authorize(good.scope, "run"); expect(good.permission.mock.calls[0][0]).not.toHaveProperty("ownerUserId");
  });
  it("projects oversized source columns before loading and rejects, never silently truncates", async () => {
    const h = await harness(); h.oversized(); await expect(h.session.authorize(h.scope, "read")).rejects.toThrow("SOURCE_UNAVAILABLE");
    const query = h.calls.find(call => call.sql.includes("FROM competitorAnalyses"))!; expect(query.sql).toContain("OCTET_LENGTH(rawData)<=65535"); expect(query.sql).not.toContain("SELECT *");
  });
  it("requires InnoDB and full unique run ID, never executes DDL", async () => {
    const good = await harness(); await good.session.admit(); expect(good.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
    const bad = await harness(); bad.myisam(); await expect(bad.session.admit()).rejects.toThrow("SCHEMA_UNAVAILABLE");
    const prefix = await harness(); prefix.prefix(); await expect(prefix.session.admit()).rejects.toThrow("SCHEMA_UNAVAILABLE");
  });
});
