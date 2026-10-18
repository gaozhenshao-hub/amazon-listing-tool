import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../../../drizzle/schema/project";
const mock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../dbClient", () => ({ getDb: mock.getDb }));
import { calibrateCompetitorSales, captureCompetitorComparisonSources, readCompetitorComparisonReport, reviewCompetitorComparisonReport, createCompetitorComparisonReportFromSnapshot, competitorComparisonRevision } from "./projectAssetRepository";
import { competitorRevision } from "./competitorWritePolicy";

const stamp = new Date("2026-10-19T00:00:00.000Z"), scope = { projectId: 1, userId: 7, workspaceId: 9 as number | null };
const manual = { version: 1 as const, value: 0, sourceNote: "Synthetic evidence", updatedAt: stamp.toISOString(), updatedBy: 7 };
function analysis(id = 10): CompetitorAnalysis {
  return { id, projectId: 1, asin: `B${String(id).padStart(9, "0")}`, title: "Synthetic", bulletPoints: null, imageUrls: null, price: "0", rating: "4", reviewCount: "0",
    reviewAnalysis: "{}", keywords: "[]", rawData: JSON.stringify({ sellerSpriteData: { monthlySales: 400 }, purchaseBadge: "100+", deepAnalysis: { original: true } }),
    aiSummary: "Original AI", summary: "Human summary", summaryStatus: "confirmed", summaryVersion: 4, summaryConfirmedBy: 7, summaryConfirmedAt: stamp, createdAt: stamp, updatedAt: stamp };
}
function report(id = 20, ids = [10, 11], status: "confirmed" | "draft" = "confirmed"): CompetitorComparisonReport {
  return { id, workspaceId: 9, projectId: 1, userId: 7, selectionKey: ids.join("-"), analysisIds: JSON.stringify(ids), analyzedAsins: JSON.stringify(ids.map(value => analysis(value).asin)),
    aiSummary: "Original comparison", summary: "Human comparison", sellingPointRows: "[]", status, version: 2, confirmedBy: status === "confirmed" ? 7 : null,
    confirmedAt: status === "confirmed" ? stamp : null, createdAt: stamp, updatedAt: stamp };
}
type Row = Record<string, unknown>;
/** Transaction/rollback protocol fixture only; no claim of native MySQL locking. */
function fixture() {
  let state: Record<string, Row[]> = { projects: [{ id: 1, userId: 7, workspaceId: 9 }], competitorAnalyses: [analysis(10), analysis(11), analysis(12)], competitorComparisonReports: [report(), report(21, [11, 12]), report(22, [10, 12], "draft")] };
  const events: { kind: string; table?: string; lock?: string }[] = [], dialect = new MySqlDialect();
  const control = { warning: 0, failReadback: false, tamper: false, changed: false };
  function matches(row: Row, expression: SQL) {
    const query = dialect.sqlToQuery(expression), keys = [...query.sql.matchAll(/`[^`]+`\.`([^`]+)` = \?/gu)].map(match => match[1]);
    if (keys.length !== query.params.length || !keys.length) throw new Error("Unsupported fixture predicate");
    return keys.every((key, index) => row[key] === query.params[index]);
  }
  const tx = {
    select(projection?: Record<string, unknown>) {
      let table = "", predicate: SQL, limit = Infinity, lock: string | undefined, ordered = false;
      const q = { from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return q; }, where(value: SQL) { predicate = value; return q; }, limit(value: number) { limit = value; return q; },
        for(value: string) { lock = value; return q; }, orderBy(..._args: unknown[]) { ordered = true; return q; },
        then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            events.push({ kind: "read", table, lock });
            if (control.changed && control.failReadback && table === "competitorComparisonReports" && !projection) throw new Error("synthetic readback failure");
            let rows = state[table].filter(row => matches(row, predicate));
            if (ordered) rows = [...rows].sort((a, b) => Number(b.id) - Number(a.id));
            rows = rows.slice(0, limit);
            return structuredClone(projection ? rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key,
              key === "selectionBytes" ? Buffer.byteLength(String(row.analysisIds), "utf8") : key === "analysisIds" && Buffer.byteLength(String(row.analysisIds), "utf8") > 512 ? null : row[key]]))) : rows);
          }).then(resolve, reject);
        } }; return q;
    },
    update(tableObject: Parameters<typeof getTableName>[0]) { const table = getTableName(tableObject); return { set: (values: Row) => ({ where: async (predicate: SQL) => {
      events.push({ kind: "update", table }); let affectedRows = 0;
      state[table] = state[table].map(row => matches(row, predicate) ? (affectedRows++, { ...row, ...values, ...(control.tamper ? { summary: "trigger changed" } : {}) }) : row);
      control.changed = true; return [{ affectedRows, warningStatus: control.warning }];
    } }) }; },
    insert(tableObject: Parameters<typeof getTableName>[0]) { const table = getTableName(tableObject); return { values: async (value: Row) => {
      const insertId = 100; state[table].push({ ...value, id: insertId }); events.push({ kind: "insert", table }); return [{ insertId, affectedRows: 1, warningStatus: control.warning }];
    } }; },
  };
  const db = { transaction: async <T>(body: (value: typeof tx) => Promise<T>) => {
    const before = structuredClone(state); events.push({ kind: "begin" });
    try { const value = await body(tx); events.push({ kind: "commit" }); return value; }
    catch (error) { state = before; events.push({ kind: "rollback" }); throw error; }
  } };
  mock.getDb.mockResolvedValue(db);
  return { events, control, rows: () => state, guard: () => ({ ...scope, expectedRevision: competitorRevision(state.competitorAnalyses[0] as CompetitorAnalysis) }) };
}
beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe("human sales calibration and selected comparison invalidation", () => {
  it("writes only manual/stale/time and atomically unconfirms only referenced confirmed reports", async () => {
    const f = fixture(), before = structuredClone(f.rows());
    const saved = await calibrateCompetitorSales(10, manual, f.guard());
    expect(JSON.parse(saved.rawData!)).toEqual({ ...JSON.parse(analysis().rawData!), manualSales: manual, analysisStale: true });
    for (const key of Object.keys(analysis()) as (keyof CompetitorAnalysis)[]) if (!["rawData", "updatedAt"].includes(key)) expect(saved[key]).toEqual(analysis()[key]);
    expect(f.rows().competitorComparisonReports[0]).toMatchObject({ ...report(), status: "draft", confirmedBy: null, confirmedAt: null, version: 3, updatedAt: expect.any(Date) });
    expect(f.rows().competitorComparisonReports.slice(1)).toEqual(before.competitorComparisonReports.slice(1));
    expect(f.events.filter(event => event.lock).slice(0, 2)).toEqual([{ kind: "read", table: "projects", lock: "update" }, { kind: "read", table: "competitorAnalyses", lock: "update" }]);
  });
  it("reset removes only override and retains SellerSprite/badge/history", async () => {
    const f = fixture(); f.rows().competitorAnalyses[0].rawData = JSON.stringify({ ...JSON.parse(analysis().rawData!), manualSales: manual });
    const saved = await calibrateCompetitorSales(10, null, f.guard());
    expect(JSON.parse(saved.rawData!)).toEqual({ ...JSON.parse(analysis().rawData!), analysisStale: true });
  });
  it("reset without an override is an exact no-op including confirmations and timestamp", async () => {
    const f = fixture(), before = structuredClone(f.rows());
    expect(await calibrateCompetitorSales(10, null, f.guard())).toEqual(analysis());
    expect(f.rows()).toEqual(before); expect(f.events.some(event => event.kind === "update")).toBe(false);
  });
  it.each(["owner", "workspace", "revision", "actor"])("rejects changed %s without a write", async reason => {
    const f = fixture(), guard = f.guard();
    if (reason === "owner") f.rows().projects[0].userId = 8;
    if (reason === "workspace") guard.workspaceId = null;
    if (reason === "revision") guard.expectedRevision = "a".repeat(64);
    await expect(calibrateCompetitorSales(10, reason === "actor" ? { ...manual, updatedBy: 8 } : manual, guard)).rejects.toBeDefined();
    expect(f.events.some(event => event.kind === "update")).toBe(false);
  });
  it.each(["warning", "tamper", "readback"])("rolls back manual and report changes after %s", async kind => {
    const f = fixture(), before = structuredClone(f.rows());
    if (kind === "warning") f.control.warning = 1; if (kind === "tamper") f.control.tamper = true; if (kind === "readback") f.control.failReadback = true;
    await expect(calibrateCompetitorSales(10, manual, f.guard())).rejects.toBeDefined();
    expect(f.rows()).toEqual(before); expect(f.events.at(-1)?.kind).toBe("rollback");
  });
  it("rejects overlong UTF8 raw without truncating", async () => {
    const f = fixture(); f.rows().competitorAnalyses[0].rawData = JSON.stringify({ kept: "界".repeat(21820) });
    await expect(calibrateCompetitorSales(10, manual, f.guard())).rejects.toThrow("TEXT_LIMIT"); expect(f.events.some(event => event.kind === "update")).toBe(false);
  });
  it.each(["malformed", "oversized", "too many"])("does not let %s reference selections evade invalidation", async kind => {
    const f = fixture();
    if (kind === "malformed") f.rows().competitorComparisonReports[0].analysisIds = "[10,10]";
    if (kind === "oversized") f.rows().competitorComparisonReports[0].analysisIds = " ".repeat(513);
    if (kind === "too many") f.rows().competitorComparisonReports = Array.from({ length: 1001 }, (_, i) => report(i + 100));
    const before = structuredClone(f.rows()); await expect(calibrateCompetitorSales(10, manual, f.guard())).rejects.toBeDefined(); expect(f.rows()).toEqual(before);
  });
});
describe("comparison current-source/report CAS", () => {
  it("read is source-bound and takes locks without writing", async () => {
    const f = fixture(), result = await readCompetitorComparisonReport(scope, [11, 10]);
    expect(result).toMatchObject({ report: report(), reportRevision: competitorComparisonRevision(report()), sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(f.events.some(event => ["update", "insert"].includes(event.kind))).toBe(false);
  });
  it("calibration makes an old confirmation fail even if it is attempted after invalidation", async () => {
    const f = fixture(), initial = (await readCompetitorComparisonReport(scope, [10, 11]))!;
    await calibrateCompetitorSales(10, manual, f.guard());
    await expect(reviewCompetitorComparisonReport(scope, { reportId: 20, action: "confirm", expectedReportRevision: initial.reportRevision, expectedSourceHash: initial.sourceHash, summary: report().summary, sellingPointRows: "[]" })).rejects.toThrow("SOURCE_OR_REPORT_CHANGED");
    expect(f.rows().competitorComparisonReports[0].status).toBe("draft");
  });
  it("a fresh explicit human re-review may confirm, then unlock increments CAS", async () => {
    fixture(); const initial = (await readCompetitorComparisonReport(scope, [10, 12]))!;
    const confirmed = await reviewCompetitorComparisonReport(scope, { reportId: 22, action: "confirm", expectedReportRevision: initial.reportRevision, expectedSourceHash: initial.sourceHash, summary: "Reviewed now", sellingPointRows: "[]" });
    expect(confirmed.report.status).toBe("confirmed"); expect(confirmed.report.version).toBe(3);
    const unlocked = await reviewCompetitorComparisonReport(scope, { reportId: 22, action: "unlock", expectedReportRevision: confirmed.reportRevision, expectedSourceHash: confirmed.sourceHash });
    expect(unlocked.report).toMatchObject({ status: "draft", confirmedBy: null, confirmedAt: null, version: 4, summary: "Reviewed now" });
  });
  it("rejects late generated output after calibration and preserves existing reports", async () => {
    const f = fixture(), capture = await captureCompetitorComparisonSources(scope, [10, 11]);
    await calibrateCompetitorSales(10, manual, f.guard()); const before = structuredClone(f.rows());
    await expect(createCompetitorComparisonReportFromSnapshot(scope, { analysisIds: [10, 11], expectedSourceHash: capture.sourceHash, summary: "Late AI", sellingPointRows: "[]" })).rejects.toThrow("SOURCE_CHANGED_DURING_GENERATION");
    expect(f.rows()).toEqual(before);
  });
  it("publishes a verified unchanged selection as a new draft retaining previous report", async () => {
    const f = fixture(), capture = await captureCompetitorComparisonSources(scope, [10, 11]);
    const saved = await createCompetitorComparisonReportFromSnapshot(scope, { analysisIds: [10, 11], expectedSourceHash: capture.sourceHash, summary: "New AI draft", sellingPointRows: "[]" });
    expect(saved.report).toMatchObject({ id: 100, status: "draft", version: 3, confirmedBy: null, confirmedAt: null });
    expect(f.rows().competitorComparisonReports[0]).toEqual(report());
  });
  it("explicit null is not defaulted and foreign report workspace is not accepted", async () => {
    const f = fixture(); await expect(readCompetitorComparisonReport({ ...scope, workspaceId: null }, [10, 11])).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.rows().competitorComparisonReports[0].workspaceId = 8;
    await expect(readCompetitorComparisonReport(scope, [10, 11])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("legacy null parent and transferred creator remain project-level reports in the current workspace", async () => {
    const f = fixture(); f.rows().projects[0].workspaceId = null; f.rows().competitorComparisonReports[0].userId = 88;
    const read = await readCompetitorComparisonReport(scope, [10, 11]); expect(read?.report.userId).toBe(88);
    await calibrateCompetitorSales(10, manual, f.guard());
    expect(f.rows().competitorComparisonReports[0]).toMatchObject({ userId: 88, status: "draft", version: 3 });
  });
  it("ambiguous legacy project cross-workspace reference aborts all calibration changes", async () => {
    const f = fixture(); f.rows().projects[0].workspaceId = null; f.rows().competitorComparisonReports[0].workspaceId = 8;
    const before = structuredClone(f.rows()); await expect(calibrateCompetitorSales(10, manual, f.guard())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.rows()).toEqual(before);
  });
  it.each(['{"analysisStale":true}', '{"captureOnly":true}', '{"analysisStale":"false"}', '[]', 'not json'])("generation and confirmation reject source state %s but a draft can be saved", async rawData => {
    const f = fixture(); f.rows().competitorAnalyses[0].rawData = rawData;
    await expect(captureCompetitorComparisonSources(scope, [10, 12])).rejects.toMatchObject({ code: expect.stringMatching(/CONFLICT|PRECONDITION_FAILED/u) });
    const read = (await readCompetitorComparisonReport(scope, [10, 12]))!;
    const input = { reportId: 22, expectedReportRevision: read.reportRevision, expectedSourceHash: read.sourceHash, summary: "Preserved draft", sellingPointRows: "[]" };
    await expect(reviewCompetitorComparisonReport(scope, { ...input, action: "confirm" })).rejects.toBeDefined();
    expect((await reviewCompetitorComparisonReport(scope, { ...input, action: "save" })).report.summary).toBe("Preserved draft");
  });
});
