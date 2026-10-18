import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../../../drizzle/schema/project";
const mock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../dbClient", () => ({ getDb: mock.getDb }));
import { createDeepAdoptionSqlFixture } from "../listing/competitorDeepAdoption.testFixture";
import { captureCompetitorComparisonSources, createCompetitorComparisonReportFromSnapshot, readCompetitorComparisonReport,
  reviewCompetitorComparisonReport } from "./projectAssetRepository";
import { readActiveCompetitorResearch } from "../../services/competitorActiveResearch";

type Row = Record<string, unknown>;
const dialect = new MySqlDialect(), scope = { userId: 3, workspaceId: 7, projectId: 11 };
const stamp = new Date("2026-10-19T00:00:00Z");
/** Real adoption, artifact replay and comparison functions over synthetic SQL
 * protocol adapters. No model or native MySQL transaction claim. */
async function fixture(adopt = true, legacyParent = false) {
  const deep = await createDeepAdoptionSqlFixture(legacyParent ? { sourceWorkspaceId: null } : {});
  if (adopt) expect((await deep.service.adopt(deep.ctx, deep.input())).status).toBe("committed");
  const other: CompetitorAnalysis = { ...structuredClone(deep.state.analysis), id: 22, asin: "B000000002", rawData: "{}", summary: "Other current legacy summary" };
  const report: CompetitorComparisonReport = { id: 51, workspaceId: 7, projectId: 11, userId: 3, selectionKey: "21-22", analysisIds: "[21,22]",
    analyzedAsins: '["B000000001","B000000002"]', aiSummary: "Original comparison", summary: "Original human draft", sellingPointRows: "[]",
    status: "draft", version: 1, confirmedBy: null, confirmedAt: null, createdAt: stamp, updatedAt: stamp };
  let state: Record<string, Row[]> = { projects: [structuredClone(deep.state.project)],
    competitorAnalyses: [structuredClone(deep.state.analysis), other], competitorComparisonReports: [report] };
  const events: { kind: string; table?: string; lock?: string; query?: string }[] = [];
  let running = false;
  function matches(row: Row, expression: SQL) {
    const query = dialect.sqlToQuery(expression), fields = [...query.sql.matchAll(/`[^`]+`\.`([^`]+)` = \?/gu)].map(match => match[1]);
    if (!fields.length || fields.length !== query.params.length) throw new Error("Unsupported synthetic predicate");
    return fields.every((key, index) => row[key] === query.params[index]);
  }
  const tx = {
    execute: async (query: SQL) => {
      const q = dialect.sqlToQuery(query); events.push({ kind: "proof", query: q.sql });
      // This transaction's non-locking snapshot may predate adoption. The
      // current authoritative row/parent already came from FOR UPDATE above.
      if (/FROM (?:projects|competitorAnalyses)\b/u.test(q.sql)) throw new Error("Old snapshot re-read is not a current row proof");
      if (/FOR (?:UPDATE|SHARE)/u.test(q.sql)) throw new Error("No inverse job/artifact lock after parent");
      return deep.execute(query);
    },
    select(projection?: Record<string, unknown>) {
      let table = "", predicate: SQL, limit = Infinity, lock: string | undefined, ordered = false;
      const q = { from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return q; }, where(value: SQL) { predicate = value; return q; },
        limit(value: number) { limit = value; return q; }, for(value: string) { lock = value; return q; }, orderBy(..._args: unknown[]) { ordered = true; return q; },
        then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (projection) throw new Error("Unexpected comparison projection");
            events.push({ kind: "read", table, lock });
            let rows = state[table].filter(row => matches(row, predicate));
            if (ordered) rows = [...rows].sort((left, right) => Number(right.id) - Number(left.id));
            return structuredClone(rows.slice(0, limit));
          }).then(resolve, reject);
        } }; return q;
    },
    update(tableObject: Parameters<typeof getTableName>[0]) { const table = getTableName(tableObject); return { set: (values: Row) => ({ where: async (predicate: SQL) => {
      events.push({ kind: "update", table }); let affectedRows = 0;
      state[table] = state[table].map(row => matches(row, predicate) ? (affectedRows++, { ...row, ...values }) : row);
      return [{ affectedRows, warningStatus: 0 }];
    } }) }; },
    insert(tableObject: Parameters<typeof getTableName>[0]) { const table = getTableName(tableObject); return { values: async (value: Row) => {
      const insertId = 100; state[table].push({ ...value, id: insertId }); events.push({ kind: "insert", table });
      return [{ insertId, affectedRows: 1, warningStatus: 0 }];
    } }; },
  };
  mock.getDb.mockResolvedValue({ transaction: async <T>(body: (executor: typeof tx) => Promise<T>): Promise<T> => {
    if (running) throw new Error("No nested transaction"); running = true; events.push({ kind: "begin" });
    const before = structuredClone(state);
    try { const value = await body(tx); events.push({ kind: "commit" }); return value; }
    catch (error) { state = before; events.push({ kind: "rollback" }); throw error; }
    finally { running = false; }
  } });
  return { deep, events, rows: () => state };
}
beforeEach(() => vi.clearAllMocks());

describe("formally adopted deep research through actual comparison entry points", () => {
  it("captures the exact locked adopted source with original stale flags, preserving its verified projection", async () => {
    const f = await fixture(), captured = await captureCompetitorComparisonSources(scope, [22, 21]);
    expect(captured.analysisIds).toEqual([21, 22]);
    expect(readActiveCompetitorResearch(captured.analyses[0])).toMatchObject({ status: "adopted_deep", result: f.deep.result });
    expect(readActiveCompetitorResearch(captured.analyses[1])).toEqual({ status: "legacy" });
    expect(JSON.parse(captured.analyses[0].rawData!)).toMatchObject({ analysisStale: true, deepAnalysisStale: true });
    expect(f.events.filter(event => event.kind === "read").slice(0, 2)).toEqual([
      { kind: "read", table: "projects", lock: "update" }, { kind: "read", table: "competitorAnalyses", lock: "update" }]);
    expect(f.events.some(event => event.kind === "proof")).toBe(true);
    expect(f.events.filter(event => event.kind === "begin")).toHaveLength(1);
    expect(f.events.some(event => ["insert", "update"].includes(event.kind))).toBe(false);
  });
  it("publishes a source-CAS draft and explicitly confirms it without clearing old financial/research history", async () => {
    const f = await fixture(), before = structuredClone(f.rows()), capture = await captureCompetitorComparisonSources(scope, [21, 22]);
    const published = await createCompetitorComparisonReportFromSnapshot(scope, { analysisIds: [21, 22], expectedSourceHash: capture.sourceHash,
      summary: "Reviewed new comparison draft", sellingPointRows: "[]" });
    expect(published.report).toMatchObject({ id: 100, status: "draft", version: 2 });
    const saved = await reviewCompetitorComparisonReport(scope, { reportId: 100, expectedReportRevision: published.reportRevision,
      expectedSourceHash: published.sourceHash, action: "confirm", summary: published.report.summary, sellingPointRows: published.report.sellingPointRows });
    expect(saved.report).toMatchObject({ status: "confirmed", confirmedBy: 3, version: 3 });
    expect(f.rows().competitorAnalyses).toEqual(before.competitorAnalyses); expect(f.rows().competitorComparisonReports[0]).toEqual(before.competitorComparisonReports[0]);
    expect(f.deep.state.artifacts).toHaveLength(1); expect(f.deep.state.audits).toHaveLength(1);
  });
  it("does not reuse an older non-locking row snapshot as the current adoption proof", async () => {
    const f = await fixture(); f.deep.state.analysis.summary = "Older repeatable-read summary snapshot";
    const captured = await captureCompetitorComparisonSources(scope, [21, 22]);
    expect(readActiveCompetitorResearch(captured.analyses[0]).status).toBe("adopted_deep");
    expect(f.events.filter(event => event.kind === "proof").every(event => !/FROM (?:projects|competitorAnalyses)\b/u.test(event.query!))).toBe(true);
  });
  it.each(["not-adopted", "artifact-missing", "artifact-altered", "source-changed", "review-changed"])("refuses %s in capture/confirm/publish but preserves readable editable drafts", async condition => {
    const f = await fixture(condition !== "not-adopted");
    if (condition === "artifact-missing") f.deep.control.artifactMissing = true;
    if (condition === "artifact-altered") f.deep.state.artifacts[0].contentHash = "a".repeat(64);
    if (condition === "source-changed") f.rows().competitorAnalyses[0].price = "19.99";
    if (condition === "review-changed") f.rows().competitorAnalyses[0].summaryConfirmedAt = null;
    await expect(captureCompetitorComparisonSources(scope, [21, 22])).rejects.toThrow("SOURCE_REANALYSIS_REQUIRED");
    const read = (await readCompetitorComparisonReport(scope, [21, 22]))!;
    const review = { reportId: read.report.id, expectedReportRevision: read.reportRevision, expectedSourceHash: read.sourceHash,
      summary: "Preserved manual draft", sellingPointRows: "[]" };
    await expect(reviewCompetitorComparisonReport(scope, { ...review, action: "confirm" })).rejects.toThrow("SOURCE_REANALYSIS_REQUIRED");
    await expect(createCompetitorComparisonReportFromSnapshot(scope, { analysisIds: [21, 22], expectedSourceHash: read.sourceHash,
      summary: "No late model acceptance", sellingPointRows: "[]" })).rejects.toThrow("SOURCE_REANALYSIS_REQUIRED");
    expect((await reviewCompetitorComparisonReport(scope, { ...review, action: "save" })).report.summary).toBe("Preserved manual draft");
    expect(f.rows().competitorComparisonReports).toHaveLength(1);
  });
  it("rejects a late generated draft after source change with no second provider call or report mutation", async () => {
    const f = await fixture(), capture = await captureCompetitorComparisonSources(scope, [21, 22]);
    f.rows().competitorAnalyses[0].price = "changed";
    const before = structuredClone(f.rows());
    await expect(createCompetitorComparisonReportFromSnapshot(scope, { analysisIds: [21, 22], expectedSourceHash: capture.sourceHash,
      summary: "Old result", sellingPointRows: "[]" })).rejects.toThrow("SOURCE_CHANGED_DURING_GENERATION");
    expect(f.rows()).toEqual(before);
  });
  it("does not let a legacy null-workspace project authorize a private adopted job in a different current workspace", async () => {
    const f = await fixture(true, true), changedScope = { ...scope, workspaceId: 8 };
    f.rows().competitorComparisonReports[0].workspaceId = 8;
    await expect(captureCompetitorComparisonSources(changedScope, [21, 22])).rejects.toThrow("SOURCE_SCOPE_CHANGED");
    const read = (await readCompetitorComparisonReport(changedScope, [21, 22]))!;
    expect(read).not.toHaveProperty("analyses"); expect(read).not.toHaveProperty("activeResearch");
    await expect(reviewCompetitorComparisonReport(changedScope, { reportId: read.report.id, expectedReportRevision: read.reportRevision,
      expectedSourceHash: read.sourceHash, action: "confirm", summary: read.report.summary, sellingPointRows: read.report.sellingPointRows })).rejects.toThrow("SOURCE_SCOPE_CHANGED");
    await expect(createCompetitorComparisonReportFromSnapshot(changedScope, { analysisIds: [21, 22], expectedSourceHash: read.sourceHash,
      summary: "Do not reuse another workspace private source", sellingPointRows: "[]" })).rejects.toThrow("SOURCE_SCOPE_CHANGED");
    expect(f.events.some(event => ["insert", "update"].includes(event.kind))).toBe(false);
  });
});
