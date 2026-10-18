import { createHash } from "node:crypto";
import { getTableColumns, type SQL } from "drizzle-orm";
import { getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { emperorAgentRuns, emperorAgentCheckpoints, emperorAgentArtifacts } from "../../../../drizzle/schema/ai_os";
import { listingConfiguredCanonical as canonical, listingConfiguredHash as hash, LISTING_CONFIGURED_KIND } from "../../../../shared/listingConfiguredWorkflow";
import { listingConfiguredProjectionDag, listingConfiguredProjectionAffected, projectListingConfiguredApplied, withListingLegacyJobEnqueueFence, withListingLegacyProjectionFence } from "./listingConfiguredAgentProjection";
import type { ListingConfiguredExecutor } from "./listingConfiguredSource";
import { checkpointPayload, parseJson } from "../../ai_os/services/agentRunner/runtimeCore";

type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
// This is the existing runtimeCore.hashJson formula, not the new canonical hash.
const legacyDagHash = (dag: unknown) => createHash("sha256").update(JSON.stringify(dag)).digest("hex").slice(0, 16);
const slug = "listing.full.workflow", identity = { userId: 3, workspaceId: 7 }, scope = { ...identity, projectId: 8 };
const input = { identity, projectId: 8, operation: "title" as const, outputs: { title: { titles: [{ title: "SYNTHETIC complete title", itemHighlights: "Full highlights" }], preserved: "Original metadata" } },
  listingId: 19, candidateIds: [], sourceHash: "a".repeat(64), resultHash: "b".repeat(64), applyOperationId: "11111111-1111-4111-8111-111111111111" };
const dag = () => ({ edges: [{ from: "G1", to: "G2" }, { source: "G2", target: "G3" }, { from: "G3", to: "G4" }], nodes: ["G1", "G2", "G3", "G4", "G5"].map(id => ({ id })) });
function stored(d = dag()) { const dagHash = legacyDagHash(d); return { dagHash, inputs: { __agentRun: { agentSlug: slug, dagHash, dagSnapshot: d }, payload: {} } }; }
const empty = (table: typeof emperorAgentRuns | typeof emperorAgentCheckpoints | typeof emperorAgentArtifacts) => Object.fromEntries(Object.keys(getTableColumns(table)).map(key => [key, null]));
function split(value: string) { const items: string[] = []; let start = 0, depth = 0, quote = false; for (let i = 0; i < value.length; i++) { const ch = value[i]; if (ch === "'") quote = !quote; if (!quote) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { items.push(value.slice(start, i).trim()); start = i + 1; } } } return [...items, value.slice(start).trim()]; }
/** Pure SQL/transaction fixture. It verifies the actual production statements,
 * not native engine admission or an external database. */
function fixture(withRun = true) {
  const dialect = new MySqlDialect(), tables = [emperorAgentRuns, emperorAgentCheckpoints, emperorAgentArtifacts];
  const run: Row = { ...empty(emperorAgentRuns), id: 50, runId: "SYNTHETIC-agent-run", ...scope, agentSlug: slug, status: "waiting_human", stateVersion: 4,
    ...stored(), outputs: { G1: "retained earlier result", G2: "old title", G3: "old description", G4: "old terms", G5: "independent QA" } };
  const state: Record<"projects" | "jobs" | "fences" | "runs" | "checkpoints" | "artifacts" | "events", Row[]> = { projects: [{ id: 8, workspaceId: 7 }], jobs: [{ id: 40, runId: "SYNTHETIC-legacy-job", ...scope, kind: "listing.generation", module: "listing", procedure: "listing.startGenerationJob" }], fences: [],
    runs: withRun ? [run] : [], checkpoints: withRun ? ["G1", "G2", "G3", "G4", "G5"].map((nodeId, i) => ({ ...empty(emperorAgentCheckpoints), id: 60 + i, workspaceId: 7, runId: run.runId, agentSlug: slug, nodeId, status: "confirmed", metadata: { original: "retained" }, output: { old: nodeId }, reviewerUserId: 3, confirmedAt: "2026-10-19T00:00:00Z" })) : [],
    artifacts: withRun ? ["G1", "G2", "G3", "G4", "G5"].map((nodeId, i) => ({ ...empty(emperorAgentArtifacts), id: 70 + i, workspaceId: 7, userId: 3, projectId: 8, runId: run.runId, agentSlug: slug, nodeId, isCurrent: 1, status: "final", content: { old: nodeId } })) : [], events: [] as Row[] };
  const control = { fail: "", omitTable: "", corruptCheckpointReadback: false, corruptRunReadback: false, runsUpdated: false, mismatchRunVersion: false, simulateNativeFloatDrift: false };
  // Stored values model mysql2's native JSON decoding: JSON_QUOTE(?) produces
  // a JS string, not the object contained in that string. The drift below is a
  // regression sentinel, not a claim to emulate every native MySQL double.
  const jsonWrite = (value: unknown, quoted: boolean) => value === null ? null : quoted ? String(value)
    : JSON.parse(String(value), (_key, item: unknown) => control.simulateNativeFloatDrift && item === 109.99999999999999 ? 110 : item);
  const calls: Array<{ sql: string; params: unknown[]; tx: number }> = [], transactions: string[] = []; let active = 0, sequence = 0;
  const rows = (value: Row[]) => [clone(value), []], ok = (id = 0) => [{ affectedRows: 1, warningStatus: 0, insertId: id }, []];
  const collections: Record<string, Row[]> = { emperor_agent_runs: state.runs, emperor_agent_checkpoints: state.checkpoints, emperor_agent_artifacts: state.artifacts, emperor_agent_events: state.events };
  const tx: ListingConfiguredExecutor = { execute: async (statement: SQL) => {
    if (!active) throw new Error("SYNTHETIC_SQL_OUTSIDE_TRANSACTION"); const { sql, params } = dialect.sqlToQuery(statement); calls.push({ sql, params, tx: active });
    if (control.fail && sql.startsWith(control.fail)) throw new Error("SYNTHETIC_WRITE_FAILURE");
    if (sql.includes("FROM projects WHERE")) return rows(state.projects.filter(row => row.id === params[0]));
    if (sql.includes("information_schema.TABLES")) return rows(params.filter(name => name !== control.omitTable).map(name => ({ name, engine: "InnoDB" })));
    if (sql.includes("COALESCE(MAX(id),0)")) return rows([{ maximum: Math.max(0, ...state.jobs.filter(row => row.workspaceId === params[0] && row.projectId === params[1] && row.module === "listing" && row.procedure === "listing.startGenerationJob" && row.kind !== params[2]).map(row => Number(row.id))) }]);
    if (sql.includes("FROM ai_jobs WHERE runId")) return rows(state.jobs.filter(row => row.runId === params[0] && row.runId === params[1]));
    if (sql.includes("FROM ai_artifacts")) return rows(state.fences.filter(row => row.workspaceId === params[0] && row.projectId === params[1] && (JSON.parse(String(row.contentJson)).agentProjection.fencedNodeIds as string[]).includes(String(params[2]))).slice(-1));
    if (sql.startsWith("SELECT id,stateVersion FROM emperor_agent_runs")) return rows(state.runs.filter(row => row.id === params[0]).map(row => ({ id: row.id, stateVersion: Number(row.stateVersion) + (control.mismatchRunVersion ? 1 : 0) })));
    const tableSelect = /FROM `([^`]+)` WHERE (.+) ORDER BY/u.exec(sql);
    if (tableSelect) {
      let found = collections[tableSelect[1]];
      if (!found) throw new Error(`SYNTHETIC_UNKNOWN_TABLE:${tableSelect[1]}`);
      if (tableSelect[2].startsWith("workspaceId=?")) found = found.filter(row => row.workspaceId === params[0] && row.projectId === params[1] && row.agentSlug === params[2] && ["running", "waiting_human", "failed"].includes(String(row.status)));
      else if (tableSelect[2].startsWith("id=?")) found = found.filter(row => row.id === params[0]);
      else found = found.filter(row => row.runId === params[0] && (!sql.includes("isCurrent=1") || row.isCurrent === 1));
      const table = tables.find(table => getTableConfig(table).name === tableSelect[1]);
      const result: Row[] = found.map(row => {
        const projected = { ...clone(row), __bytes: Buffer.byteLength(canonical(row)) } as Row;
        for (const [key, column] of Object.entries(table ? getTableColumns(table) : {})) {
          if (column.getSQLType() !== "json" || row[key] === null) continue;
          const name = `\`${column.name}\``;
          if (!sql.includes(`CAST(CASE WHEN JSON_TYPE(${name})='STRING'`)) continue;
          if (!sql.includes(`JSON_VALID(JSON_UNQUOTE(${name})) THEN JSON_UNQUOTE(${name}) ELSE CAST(${name} AS CHAR CHARACTER SET utf8mb4) END AS CHAR CHARACTER SET utf8mb4)`)) throw new Error("SYNTHETIC_UNSUPPORTED_JSON_PROJECTION");
          let validInner = false; if (typeof row[key] === "string") { try { JSON.parse(row[key]); validInner = true; } catch { /* An original ordinary JSON string stays a string. */ } }
          projected[key] = validInner ? row[key] : JSON.stringify(row[key]);
        }
        return projected;
      });
      if (control.corruptCheckpointReadback && calls.some(call => call.sql.startsWith("UPDATE emperor_agent_checkpoints")) && tableSelect[1] === "emperor_agent_checkpoints") result[1].confirmedAt = "unexpected still confirmed";
      if (control.corruptRunReadback && control.runsUpdated && tableSelect[1] === "emperor_agent_runs") result[0].stateVersion = 99;
      return rows(result);
    }
    if (sql.startsWith("UPDATE emperor_agent_artifacts")) { const row = state.artifacts.find(row => row.id === params[0] && row.isCurrent === 1); if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []]; Object.assign(row, { isCurrent: 0, status: "superseded" }); return ok(); }
    if (sql.startsWith("UPDATE emperor_agent_checkpoints")) { const row = state.checkpoints.find(row => row.id === params[3] && row.status === params[4] && row.lockToken === null); if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: params[0], output: jsonWrite(params[1], sql.includes("output=JSON_QUOTE(?)")), metadata: JSON.parse(String(params[2])), userEdit: null, aiJobRunId: null, aiJobAttempt: 0, aiJobClaimedAt: null, skillRunId: null, lockToken: null, lockedAt: null, timeoutAt: null, retryScheduledAt: null, lastFailureKind: null, reviewerUserId: null, confirmedAt: null, errorMessage: null, completedAt: null }); return ok(); }
    if (sql.startsWith("UPDATE emperor_agent_runs")) { const row = state.runs.find(row => row.id === params[3] && row.stateVersion === params[4]); if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []]; Object.assign(row, { status: "waiting_human", currentNodeId: params[0], progress: params[1], outputs: jsonWrite(params[2], sql.includes("outputs=JSON_QUOTE(?)")), stateVersion: Number(row.stateVersion) + 1, recoverySnapshotId: null, errorMessage: null, completedAt: null }); control.runsUpdated = true; return ok(); }
    const insert = /^INSERT INTO (\w+) \((.+)\) VALUES \((.+)\)$/u.exec(sql);
    if (insert) { const fields = insert[2].split(",").map(x => x.trim()), values = split(insert[3]); if (fields.length !== values.length) throw new Error("SYNTHETIC_INSERT_ARITY");
      const table = tables.find(table => getTableConfig(table).name === insert[1]), columns: Record<string, { getSQLType(): string }> = table ? getTableColumns(table) : {}, collection = collections[insert[1]];
      if (!collection) throw new Error("SYNTHETIC_UNKNOWN_INSERT"); const row: Row = { ...(table ? empty(table) : {}), id: 100 + collection.length }; let index = 0;
      fields.forEach((field, i) => { const quoted = values[i] === "JSON_QUOTE(?)", value = values[i] === "?" || quoted ? params[index++] : values[i] === "NULL" ? null : values[i].startsWith("'") ? values[i].slice(1, -1) : Number(values[i]); row[field] = (columns[field]?.getSQLType() === "json" || field === "payload") && typeof value === "string" ? jsonWrite(value, quoted) : value; });
      if (index !== params.length) throw new Error("SYNTHETIC_INSERT_PARAMS"); collection.push(row); return ok(Number(row.id)); }
    throw new Error(`SYNTHETIC_UNHANDLED_SQL:${sql}`);
  } };
  const database = { transaction: async <T>(work: (executor: ListingConfiguredExecutor) => Promise<T>) => { if (active) throw new Error("SYNTHETIC_NESTED_TX"); const before = clone(state); active = ++sequence; transactions.push("begin");
    try { const result = await work(tx); transactions.push("commit"); return result; } catch (error) { for (const key of Object.keys(state) as Array<keyof typeof state>) { state[key].splice(0, state[key].length, ...before[key]); } transactions.push("rollback"); throw error; } finally { active = 0; } } };
  return { state, control, calls, transactions, tx, database, apply: () => database.transaction(executor => projectListingConfiguredApplied(executor, input)), db: async () => database };
}
function fence(f: ReturnType<typeof fixture>, maximum = 40) { const value = { version: 1, identity, projectId: 8, legacyJobFence: maximum, agentProjection: { version: 1, fencedNodeIds: ["G2", "G3", "G4"] } };
  f.state.fences.push({ workspaceId: 7, userId: 3, projectId: 8, artifactKey: "listing.generation.apply.v1", sourceTable: "projects", sourceRowId: "8", domain: "listing", status: "draft", isCurrent: 0, version: 1, contentJson: canonical(value), contentHash: hash(value) }); }

describe("Listing configured Agent projection immutable DAG", () => {
  it("uses the persisted legacy 16-character hash and descendants, not today's generic template", () => { const run = stored(); expect(listingConfiguredProjectionDag(run).nodes.map(row => row.id)).toEqual(["G1", "G2", "G3", "G4", "G5"]); expect(listingConfiguredProjectionAffected(run, ["G2"])).toEqual(["G2", "G3", "G4"]); });
  it("accepts the real legacy insertion-order DAG hash without canonicalizing it into a different hash", () => { const ordered = { nodes: dag().nodes, edges: dag().edges }; expect(listingConfiguredProjectionAffected(stored(ordered), ["G2"])).toEqual(["G2", "G3", "G4"]); });
  it("accepts DB-reordered JSON only as a stored legacy pair and captures an explicit apply-time canonical digest", () => { const original = { nodes: dag().nodes, edges: dag().edges }, run = stored(original), reordered = JSON.parse(canonical(run));
    expect(legacyDagHash(reordered.inputs.__agentRun.dagSnapshot)).not.toBe(run.dagHash);
    const projected = listingConfiguredProjectionDag(reordered); expect(projected).toMatchObject({ legacyDagHash: run.dagHash, canonicalSnapshotHash: hash(original), dagBinding: "legacy_hash_pair_canonical_snapshot_captured_at_apply" });
    expect(listingConfiguredProjectionAffected(reordered, ["G2"])).toEqual(["G2", "G3", "G4"]);
  });
  it.each(["missing-run-hash", "missing-runtime-hash", "missing-snapshot", "wrong-agent", "cycle"])("rejects %s rather than fabricating a historical binding", mode => {
    const d = dag(); if (mode === "cycle") d.edges.push({ from: "G4", to: "G2" });
    const run: Row = stored(d), runtime = (run.inputs as { __agentRun: Row }).__agentRun;
    if (mode === "missing-run-hash") delete run.dagHash; if (mode === "missing-runtime-hash") delete runtime.dagHash; if (mode === "missing-snapshot") delete runtime.dagSnapshot; if (mode === "wrong-agent") runtime.agentSlug = "other.workflow";
    expect(() => listingConfiguredProjectionDag(run)).toThrow();
  });
  it.each(["hash", "duplicate", "unknown-edge", "missing-node"])("rejects corrupt %s DAG rather than silently using defaults", mode => { const d = dag(); if (mode === "duplicate") d.nodes.push({ id: "G1" }); if (mode === "unknown-edge") d.edges.push({ from: "G2", to: "ALIEN" }); const run = stored(d); if (mode === "hash") run.dagHash = "0".repeat(16); expect(() => listingConfiguredProjectionAffected(run, mode === "missing-node" ? ["ALIEN"] : ["G2"])).toThrow(); });
});
describe("Listing legacy project serialization and late callbacks", () => {
  it("runs enqueue only while the exact project lock is held and rolls back a failing callback", async () => { const f = fixture(false), body = vi.fn(async () => { expect(f.transactions).toEqual(["begin"]); expect(f.calls[0].sql).toContain("FOR UPDATE"); return "queued"; }); expect(await withListingLegacyJobEnqueueFence(scope, body, f.db)).toBe("queued"); expect(f.transactions).toEqual(["begin", "commit"]);
    await expect(withListingLegacyJobEnqueueFence(scope, async () => { throw new Error("enqueue failed"); }, f.db)).rejects.toThrow("enqueue failed"); expect(f.transactions.at(-1)).toBe("rollback"); });
  it("rejects a different workspace before invoking legacy enqueue", async () => { const f = fixture(), body = vi.fn(); await expect(withListingLegacyJobEnqueueFence({ ...scope, workspaceId: 99 }, body, f.db)).rejects.toThrow("AGENT_PROJECTION_SCOPE_INVALID"); expect(body).not.toHaveBeenCalled(); });
  it("preserves previously authorized NULL-workspace legacy project enqueue without rewriting its scope", async () => {
    const f = fixture(false), body = vi.fn(async () => "queued"); f.state.projects[0].workspaceId = null;
    expect(await withListingLegacyJobEnqueueFence(scope, body, f.db)).toBe("queued");
    expect(body).toHaveBeenCalledOnce(); expect(f.state.projects[0].workspaceId).toBeNull();
    expect(f.calls).toHaveLength(1); expect(f.calls[0]).toMatchObject({ params: [scope.projectId] }); expect(f.calls[0].sql).toContain("FOR UPDATE");
    expect(f.transactions).toEqual(["begin", "commit"]);
  });
  it("preserves a NULL-project legacy callback with exact actor/job workspace and keeps its configured fence", async () => {
    const f = fixture(), body = vi.fn(async () => "legacy applied"), request = { ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G2" }; f.state.projects[0].workspaceId = null;
    expect(await withListingLegacyProjectionFence(request, body, f.db)).toBe("legacy applied");
    fence(f); expect(await withListingLegacyProjectionFence(request, body, f.db)).toBeUndefined();
    expect(body).toHaveBeenCalledOnce(); expect(f.state.projects[0].workspaceId).toBeNull();
  });
  it("still rejects a non-NULL project in another workspace before invoking a legacy callback", async () => {
    const f = fixture(), body = vi.fn(); f.state.projects[0].workspaceId = 99;
    await expect(withListingLegacyProjectionFence({ ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G2" }, body, f.db)).rejects.toThrow("AGENT_PROJECTION_SCOPE_INVALID");
    expect(body).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(1); expect(f.transactions).toEqual(["begin", "rollback"]);
  });
  it.each(["user", "workspace", "project"])("NULL-project compatibility does not relax the legacy job's %s binding", async mode => {
    const f = fixture(), body = vi.fn(); f.state.projects[0].workspaceId = null;
    if (mode === "user") f.state.jobs[0].userId = 4; if (mode === "workspace") f.state.jobs[0].workspaceId = null; if (mode === "project") f.state.jobs[0].projectId = 9;
    await expect(withListingLegacyProjectionFence({ ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G2" }, body, f.db)).rejects.toThrow("LEGACY_JOB_SCOPE_INVALID");
    expect(body).not.toHaveBeenCalled(); expect(f.transactions).toEqual(["begin", "rollback"]);
  });
  it("accepts legacy callbacks only when no newer configured node fence exists", async () => { const f = fixture(), body = vi.fn(async () => "legacy applied"), request = { ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G2" };
    expect(await withListingLegacyProjectionFence(request, body, f.db)).toBe("legacy applied"); fence(f); expect(await withListingLegacyProjectionFence(request, body, f.db)).toBeUndefined(); expect(body).toHaveBeenCalledTimes(1);
    f.state.jobs[0].id = 41; expect(await withListingLegacyProjectionFence(request, body, f.db)).toBe("legacy applied"); expect(body).toHaveBeenCalledTimes(2); });
  it.each(["user", "project", "workspace", "configured"])("rejects mismatched %s job before invoking a legacy bridge", async mode => { const f = fixture(), body = vi.fn(); if (mode === "user") f.state.jobs[0].userId = 4; if (mode === "project") f.state.jobs[0].projectId = 9; if (mode === "workspace") f.state.jobs[0].workspaceId = 9; if (mode === "configured") f.state.jobs[0].kind = LISTING_CONFIGURED_KIND;
    await expect(withListingLegacyProjectionFence({ ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G2" }, body, f.db)).rejects.toThrow("LEGACY_JOB_SCOPE_INVALID"); expect(body).not.toHaveBeenCalled(); });
  it("rejects a corrupt configured fence instead of falling through to the callback", async () => { const f = fixture(), body = vi.fn(); fence(f); f.state.fences[0].contentHash = "0".repeat(64); await expect(withListingLegacyProjectionFence({ ...scope, aiJobRunId: "SYNTHETIC-legacy-job", nodeId: "G3" }, body, f.db)).rejects.toThrow("AGENT_PROJECTION_FENCE_INVALID"); expect(body).not.toHaveBeenCalled(); });
});
describe("actual SQL configured Agent projection in caller transaction", () => {
  it("never grants configured apply the legacy NULL-project compatibility exception", async () => {
    const f = fixture(); f.state.projects[0].workspaceId = null; const before = clone(f.state);
    await expect(f.apply()).rejects.toThrow("AGENT_PROJECTION_SCOPE_INVALID"); expect(f.state).toEqual(before);
    expect(f.calls).toHaveLength(1); expect(f.calls.some(call => /^(?:INSERT|UPDATE)/u.test(call.sql))).toBe(false); expect(f.transactions).toEqual(["begin", "rollback"]);
  });
  it("without an Agent run records a legacy fence without inventing runs or confirmations", async () => { const f = fixture(false), result = await f.apply(); expect(result).toEqual({ legacyJobFence: 40, agentProjection: { version: 1, fencedNodeIds: ["G2"], runIds: [], history: [] } }); expect(f.calls.some(call => /^(?:INSERT|UPDATE)/u.test(call.sql))).toBe(false); expect(f.transactions).toEqual(["begin", "commit"]); });
  it("updates the existing run and only its pinned descendants, retains history and waits for human review", async () => { const f = fixture(), before = clone(f.state), result = await f.apply(); expect(result.agentProjection.fencedNodeIds).toEqual(["G2", "G3", "G4"]); expect(result.agentProjection.history[0].before).toMatchObject({ run: before.runs[0], checkpoints: before.checkpoints, artifacts: before.artifacts });
    expect(f.state.checkpoints.map(row => row.status)).toEqual(["confirmed", "waiting_human", "pending", "pending", "confirmed"]); expect(checkpointPayload(f.state.checkpoints[1]).output).toEqual(input.outputs.title); expect(f.state.checkpoints[2].output).toBeNull(); expect(f.state.checkpoints[1].confirmedAt).toBeNull(); expect(f.state.checkpoints[1].reviewerUserId).toBeNull();
    expect(f.state.runs[0]).toMatchObject({ stateVersion: 5, status: "waiting_human", progress: 40, currentNodeId: "G2" }); expect(parseJson(f.state.runs[0].outputs)).toEqual({ G1: "retained earlier result", G5: "independent QA" });
    expect(result.agentProjection.history[0]).toMatchObject({ dagBinding: "legacy_hash_pair_canonical_snapshot_captured_at_apply", legacyDagHash: stored().dagHash, canonicalSnapshotHash: hash(dag()) });
    expect(f.state.artifacts.filter(row => row.status === "superseded").map(row => row.nodeId)).toEqual(["G2", "G3", "G4"]); expect(f.state.artifacts.at(-1)).toMatchObject({ nodeId: "G2", status: "draft", isCurrent: 0, contentHash: hash(input.outputs.title) }); expect(parseJson(f.state.artifacts.at(-1)?.content)).toEqual(input.outputs.title); expect(f.state.events).toHaveLength(1); expect(new Set(f.calls.map(call => call.tx)).size).toBe(1); });
  it.each(["running", "locked", "duplicate", "missing-descendant", "scope", "version", "engine"])("rejects %s projection before partial mutation", async mode => { const f = fixture(); if (mode === "running") f.state.checkpoints[2].status = "running"; if (mode === "locked") f.state.checkpoints[2].lockToken = "other"; if (mode === "duplicate") f.state.checkpoints.push({ ...f.state.checkpoints[1], id: 90 }); if (mode === "missing-descendant") f.state.checkpoints.splice(2, 1); if (mode === "scope") f.state.checkpoints[1].workspaceId = 99; if (mode === "version") f.control.mismatchRunVersion = true; if (mode === "engine") f.control.omitTable = "emperor_agent_events"; const before = clone(f.state);
    await expect(f.apply()).rejects.toThrow(); expect(f.state).toEqual(before); expect(f.transactions).toEqual(["begin", "rollback"]); });
  it.each(["write", "checkpoint-readback", "run-readback"])("rolls back all projection writes on %s failure", async mode => { const f = fixture(), before = clone(f.state); if (mode === "write") f.control.fail = "INSERT INTO emperor_agent_events"; if (mode === "checkpoint-readback") f.control.corruptCheckpointReadback = true; if (mode === "run-readback") f.control.corruptRunReadback = true; await expect(f.apply()).rejects.toThrow(); expect(f.state).toEqual(before); expect(f.transactions.at(-1)).toBe("rollback"); });
});

describe("new projection exact JSON wire envelopes and original Agent readers", () => {
  it.each([109.99999999999999, 0.30000000000000004, 1e-307, 1.2345678901234567])("preserves numeric %s in checkpoint, retained outputs and immutable candidate", async amount => {
    const f = fixture(), output = { ...input.outputs.title, amount, nested: { evidence: [amount, "SYNTHETIC 原文 \\\"\n"] } };
    f.control.simulateNativeFloatDrift = true; f.state.runs[0].outputs = { G1: { amount }, G2: { old: true }, G5: { amount } };
    const result = await f.database.transaction(tx => projectListingConfiguredApplied(tx, { ...input, outputs: { title: output } }));
    expect(typeof f.state.checkpoints[1].output).toBe("string"); expect(typeof f.state.runs[0].outputs).toBe("string"); expect(typeof f.state.artifacts.at(-1)?.content).toBe("string");
    expect(checkpointPayload(f.state.checkpoints[1]).output).toEqual(output); expect(parseJson(f.state.runs[0].outputs)).toEqual({ G1: { amount }, G5: { amount } });
    expect(parseJson(f.state.artifacts.at(-1)?.content)).toEqual(output); expect(hash(parseJson(f.state.artifacts.at(-1)?.content))).toBe(f.state.artifacts.at(-1)?.contentHash);
    expect(result.agentProjection.history[0].after).toMatchObject({ run: { outputs: { G1: { amount }, G5: { amount } } } });
    const writes = f.calls.filter(call => call.sql.startsWith("UPDATE emperor_agent_checkpoints")); expect(writes.every(call => call.sql.includes("output=JSON_QUOTE(?)"))).toBe(true);
    expect(f.state.checkpoints[2].output).toBeNull(); expect(f.calls.some(call => call.sql.includes("JSON_TYPE(`output`)='STRING' AND JSON_VALID(JSON_UNQUOTE(`output`))"))).toBe(true);
  });
  it("retains original ordinary JSON strings, objects and SQL NULL in the complete history", async () => {
    const f = fixture(), text = 'SYNTHETIC ordinary text "quote" \\ newline\n'; f.state.checkpoints[0].output = text; f.state.checkpoints[4].output = null; f.state.artifacts[0].content = text;
    const result = await f.apply(), before = result.agentProjection.history[0].before as { checkpoints: Row[]; artifacts: Row[] };
    expect(before.checkpoints[0].output).toBe(text); expect(before.checkpoints[1].output).toEqual({ old: "G2" }); expect(before.checkpoints[4].output).toBeNull(); expect(before.artifacts[0].content).toBe(text);
    expect(f.state.checkpoints[0].output).toBe(text); expect(f.state.checkpoints[4].output).toBeNull();
  });
  it("can re-read a prior new projection envelope and preserve its exact values in the next apply history", async () => {
    const f = fixture(), amount = 109.99999999999999; f.control.simulateNativeFloatDrift = true;
    f.state.runs[0].outputs = canonical({ G1: { amount }, G5: { amount } }); f.state.checkpoints[1].output = canonical({ amount }); f.state.artifacts[1].content = canonical({ amount });
    const result = await f.apply(), before = result.agentProjection.history[0].before as { run: Row; checkpoints: Row[]; artifacts: Row[] };
    expect(before.run.outputs).toEqual({ G1: { amount }, G5: { amount } }); expect(before.checkpoints[1].output).toEqual({ amount }); expect(before.artifacts[1].content).toEqual({ amount });
    expect(parseJson(f.state.runs[0].outputs)).toEqual({ G1: { amount }, G5: { amount } });
  });
});
