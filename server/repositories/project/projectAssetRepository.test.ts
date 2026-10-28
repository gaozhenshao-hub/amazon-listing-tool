import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { CompetitorAnalysis, InsertCompetitorAnalysis } from "../../../drizzle/schema/project";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../dbClient", () => ({ getDb: dbMock.getDb }));

import {
  createCompetitorAnalysis, deleteCompetitorAnalysis, updateCompetitorAnalysisReviews,
  updateCompetitorAnalysisSummary, upsertCompetitorAnalysis,
  assertLegacyCompetitorAcquisitionWritable,
  saveCollectedCompetitorAnalysis,
} from "./projectAssetRepository";
import { competitorRevision } from "./competitorWritePolicy";

const now = new Date("2026-10-16T00:00:00.000Z");
describe("late legacy automatic acquisition results", () => {
  it("cannot overwrite a capture-only source even with a completed model result", async () => {
    const initial = row({ rawData: JSON.stringify({ acquisitionCapture: { version: 1 }, captureOnly: true }) });
    const f = database([initial]); dbMock.getDb.mockResolvedValue(f.db);
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: initial.asin, title: "late old title", summary: "late AI" },
      { userId: 7, workspaceId: 9, rejectCapturedSource: true })).rejects.toThrow("COMPETITOR_LEGACY_CAPTURE_PROTECTED");
    expect(f.rows()).toEqual([initial]);
    expect(f.events.some(event => event.type === "update")).toBe(false);
    await expect(assertLegacyCompetitorAcquisitionWritable(1, initial.asin,
      { userId: 7, workspaceId: 9, rejectCapturedSource: true })).rejects.toThrow("COMPETITOR_LEGACY_CAPTURE_PROTECTED");
  });
  it("rechecks the old job's owner and exact workspace under the parent lock", async () => {
    const f = database([row()], [1], { userId: 8, workspaceId: 9 }); dbMock.getDb.mockResolvedValue(f.db);
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" },
      { userId: 7, workspaceId: 9, rejectCapturedSource: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.events.some(event => event.type === "update")).toBe(false);
  });
});
function row(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return {
    id: 10, projectId: 1, asin: "B000000001", title: "Current title", bulletPoints: null,
    imageUrls: null, price: "0", rating: "4.0", reviewCount: "0", reviewAnalysis: null,
    keywords: null, rawData: null, aiSummary: "AI draft", summary: "Human draft",
    summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null,
    summaryConfirmedAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}
type Event = { type: string; table?: string; lock?: string; sql?: string; values?: unknown };

/** Stateful rollback/serialization fixture; it does not claim to emulate InnoDB locks. */
function database(initial: CompetitorAnalysis[] = [row()], parentIds = [1], parentScope = { userId: 7, workspaceId: 9 as number | null }) {
  let state = structuredClone(initial);
  let nextId = Math.max(10, ...state.map(item => item.id)) + 1;
  let tail: Promise<unknown> = Promise.resolve();
  const events: Event[] = [];
  const dialect = new MySqlDialect();
  const hooks: { beforeRead?: (event: Event, state: CompetitorAnalysis[]) => void; afterWrite?: () => void } = {};
  function matches(value: Record<string, unknown>, expression: SQL) {
    const compiled = dialect.sqlToQuery(expression);
    const keys = [...compiled.sql.matchAll(/`[^`]+`\.`([^`]+)` = \?/gu)].map(match => match[1]);
    if (keys.length !== compiled.params.length || keys.length === 0) throw new Error("Unexpected predicate in fixture");
    return keys.every((key, index) => value[key] === compiled.params[index]);
  }
  const tx = {
    select(projection?: Record<string, unknown>) {
      let table: string, where: SQL, limit = Infinity, lock: string | undefined;
      const query = {
        from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return query; },
        where(value: SQL) { where = value; return query; },
        limit(value: number) { limit = value; return query; },
        for(value: string) { lock = value; return query; },
        then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            const event = { type: "read", table, lock, sql: dialect.sqlToQuery(where).sql };
            events.push(event); hooks.beforeRead?.(event, state);
            const values = table === "projects" ? parentIds.map(id => ({ id, ...parentScope })) : state;
            const selected = values.filter(value => matches(value, where)).slice(0, limit);
            return structuredClone(projection ? selected.map(value => Object.fromEntries(
              Object.keys(projection).map(key => [key, (value as Record<string, unknown>)[key]]),
            )) : selected);
          }).then(resolve, reject);
        },
      };
      return query;
    },
    update(table: Parameters<typeof getTableName>[0]) {
      return { set: (values: Partial<CompetitorAnalysis>) => ({ where: async (where: SQL) => {
        events.push({ type: "update", table: getTableName(table), values: structuredClone(values), sql: dialect.sqlToQuery(where).sql });
        let affectedRows = 0;
        state = state.map(item => matches(item, where) ? (affectedRows++, { ...item, ...values, updatedAt: new Date(item.updatedAt.getTime() + 1000) }) : item);
        hooks.afterWrite?.();
        return [{ affectedRows }];
      } }) };
    },
    insert(table: Parameters<typeof getTableName>[0]) {
      return { values: async (value: InsertCompetitorAnalysis) => {
        events.push({ type: "insert", table: getTableName(table), values: structuredClone(value) });
        const insertId = nextId++;
        state.push(row({ ...value, id: insertId }));
        hooks.afterWrite?.();
        return [{ insertId, affectedRows: 1 }];
      } };
    },
    delete(table: Parameters<typeof getTableName>[0]) {
      return { where: async (where: SQL) => {
        events.push({ type: "delete", table: getTableName(table), sql: dialect.sqlToQuery(where).sql });
        state = state.filter(item => !matches(item, where));
        hooks.afterWrite?.();
        return [{ affectedRows: 1 }];
      } };
    },
  };
  const db = { transaction: vi.fn(<T>(callback: (executor: typeof tx) => Promise<T>) => {
    const result = tail.then(async () => {
      events.push({ type: "begin" });
      const before = structuredClone(state);
      try { const value = await callback(tx); events.push({ type: "commit" }); return value; }
      catch (error) { state = before; events.push({ type: "rollback" }); throw error; }
    });
    tail = result.catch(() => undefined);
    return result;
  }) };
  return { db, events, hooks, rows: () => structuredClone(state) };
}

const writes = (events: Event[]) => events.filter(event => ["insert", "update", "delete"].includes(event.type));
const locks = (events: Event[]) => events.filter(event => event.type === "read" && event.lock).map(event => `${event.table}:${event.lock}`);
const guard = (value: CompetitorAnalysis) => ({ projectId: value.projectId, expectedRevision: competitorRevision(value) });

beforeEach(() => vi.clearAllMocks());

describe("explicit analysis completion", () => {
  it("saves a draft without replacing original facts or images", async () => {
    const original = row({ title: "Original product", imageUrls: '["original.jpg"]' });
    const store = database([original]); dbMock.getDb.mockResolvedValue(store.db);
    await saveCollectedCompetitorAnalysis(original.id, { rawData: '{"deepAnalysis":{}}', summary: "New draft" },
      { ...guard(original), userId: 7, workspaceId: 9 });
    expect(store.rows()[0]).toMatchObject({ title: original.title, imageUrls: original.imageUrls,
      summary: "New draft", summaryStatus: "draft", summaryVersion: 2 });
  });
  it("rejects a result after a user edited the source during the model call", async () => {
    const original = row();
    const store = database([row({ title: "Updated by user" })]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(saveCollectedCompetitorAnalysis(original.id, { rawData: '{}', summary: "Late result" },
      { ...guard(original), userId: 7, workspaceId: 9 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toHaveLength(0);
  });
  it.each(["confirmed", "wrong-owner", "wrong-workspace"])("rejects %s completion", async reason => {
    const original = row({ summaryStatus: reason === "confirmed" ? "confirmed" : "draft" });
    const store = database([original]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(saveCollectedCompetitorAnalysis(original.id, { rawData: '{}', summary: "Late result" },
      { ...guard(original), userId: reason === "wrong-owner" ? 8 : 7, workspaceId: reason === "wrong-workspace" ? 10 : 9 })).rejects.toThrow();
    expect(writes(store.events)).toHaveLength(0);
  });
});

describe("competitor repository transaction and lock contract", () => {
  it.each([null, {}, { select: vi.fn() }])("refuses a missing real transaction: %j", async db => {
    dbMock.getDb.mockResolvedValue(db);
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    if (db && "select" in db) expect(db.select).not.toHaveBeenCalled();
  });

  it("locks parent before selecting and inserting the same-project ASIN", async () => {
    const store = database([]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001", title: "New" });
    expect(saved.title).toBe("New"); expect(store.rows()).toHaveLength(1);
    expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update", "competitorAnalyses:update"]);
    expect(store.events.filter(event => event.type === "read")[1].sql).toBe("(`competitorAnalyses`.`projectId` = ? and `competitorAnalyses`.`asin` = ?)");
  });

  it("serial model of concurrent same-ASIN upserts observes one insert and one existing row", async () => {
    const store = database([]); dbMock.getDb.mockResolvedValue(store.db);
    const values = await Promise.all(["first", "second"].map(title => upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001", title })));
    expect(new Set(values.map(value => value.id)).size).toBe(1);
    expect(store.rows()).toHaveLength(1); expect(store.rows()[0].title).toBe("second");
    expect(writes(store.events).map(event => event.type)).toEqual(["insert", "update"]);
    expect(store.db.transaction).toHaveBeenCalledTimes(2);
  });

  it("does not merge the same ASIN from another parent", async () => {
    const store = database([row({ projectId: 2 })], [1, 2]); dbMock.getDb.mockResolvedValue(store.db);
    await upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" });
    expect(store.rows().map(value => value.projectId)).toEqual([2, 1]);
  });

  it("requires a real parent before any child read or write", async () => {
    const store = database([], []); dbMock.getDb.mockResolvedValue(store.db);
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.events.filter(event => event.table)).toHaveLength(1); expect(writes(store.events)).toEqual([]);
  });

  it("refuses ambiguous pre-existing duplicate rows rather than choosing one", async () => {
    const store = database([row(), row({ id: 11 })]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("create-only cannot bypass same-ASIN serialization", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    await expect(createCompetitorAnalysis({ projectId: 1, asin: "B000000001" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update"]); expect(writes(store.events)).toEqual([]);
  });

  it("rolls back failed insert readback in the same transaction", async () => {
    const store = database([]); dbMock.getDb.mockResolvedValue(store.db);
    let inserted = false;
    store.hooks.afterWrite = () => { inserted = true; };
    store.hooks.beforeRead = event => { if (inserted && event.table === "competitorAnalyses") throw new Error("readback failed"); };
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001" })).rejects.toThrow("readback failed");
    expect(store.rows()).toEqual([]); expect(store.events.at(-1)?.type).toBe("rollback");
  });

  it("rolls back an update error and propagates the database error", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    store.hooks.afterWrite = () => { throw new Error("database failed"); };
    await expect(upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001", title: "Changed" })).rejects.toThrow("database failed");
    expect(store.rows()).toEqual([row()]);
  });

  it("legacy review writes discover parent without locking then lock parent before child", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    await updateCompetitorAnalysisReviews(10, { reviewCount: "9" });
    const reads = store.events.filter(event => event.type === "read");
    expect(reads[0].lock).toBeUndefined(); expect(reads[0].table).toBe("competitorAnalyses");
    expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update", "competitorAnalyses:update"]);
  });

  it("delete also uses parent-first lock order", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    await expect(deleteCompetitorAnalysis(10)).resolves.toEqual({ success: true });
    expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update"]); expect(store.rows()).toEqual([]);
  });

  it("guarded delete refuses a stale revision without removing the latest row", async () => {
    const store = database([row({ title: "latest" })]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(deleteCompetitorAnalysis(10, guard(row()))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.rows()).toHaveLength(1); expect(writes(store.events)).toEqual([]);
  });
});

describe("locked merge preserves confirmed content and review evidence", () => {
  it("cannot overwrite five confirmed summary fields or aiSummary with an old import", async () => {
    const current = row({ summaryStatus: "confirmed", summaryVersion: 7, summaryConfirmedBy: 99, summaryConfirmedAt: now });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await upsertCompetitorAnalysis({ projectId: 1, asin: current.asin, title: "New source", aiSummary: "stale AI", summary: "stale draft", summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null });
    expect(saved.title).toBe("New source");
    for (const key of ["aiSummary", "summary", "summaryStatus", "summaryVersion", "summaryConfirmedBy", "summaryConfirmedAt"] as const) expect(saved[key]).toEqual(current[key]);
  });

  it("uses locked confirmation state, not the caller's previous draft", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    store.hooks.beforeRead = (event, state) => {
      if (event.table === "competitorAnalyses" && event.lock) {
        state[0].summaryStatus = "confirmed"; state[0].summary = "Latest confirmed";
      }
    };
    const saved = await upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001", summary: "old draft", summaryStatus: "draft" });
    expect(saved.summary).toBe("Latest confirmed"); expect(saved.summaryStatus).toBe("confirmed");
  });

  it("null reviewAnalysis means no supplied reviews, not deletion", async () => {
    const store = database([row({ reviewAnalysis: '{"painPoints":["existing"]}' })]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await upsertCompetitorAnalysis({ projectId: 1, asin: "B000000001", reviewAnalysis: null });
    expect(saved.reviewAnalysis).toBe('{"painPoints":["existing"]}');
  });

  it("explicit review lane also preserves existing analysis when none was supplied", async () => {
    const store = database([row({ reviewAnalysis: '{"painPoints":["existing"]}' })]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisReviews(10, { reviewAnalysis: null });
    expect(saved.reviewAnalysis).toBe('{"painPoints":["existing"]}');
  });

  it.each([undefined, "a".repeat(64)])("rejects an unverified or different review source without partially updating title/source: %s", async sourceHash => {
    const current = row({ reviewAnalysis: '{"painPoints":["current"]}', rawData: JSON.stringify({ sellerSpriteData: { title: "current" }, reviewImport: { runId: "new", sourceHash: "b".repeat(64) }, importedReviews: ["new"], untouched: false }) });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(upsertCompetitorAnalysis({
      projectId: 1, asin: current.asin, title: "Must not be saved", reviewAnalysis: '{"painPoints":["stale"]}',
      rawData: JSON.stringify({ sellerSpriteData: { title: "source v2" }, reviewImport: { runId: "old", sourceHash }, importedReviews: ["old"] }),
    })).rejects.toMatchObject({ code: "CONFLICT", message: "COMPETITOR_REVIEW_SOURCE_CHANGED" });
    expect(writes(store.events)).toEqual([]);
    expect(store.rows()).toEqual([current]);
    expect(store.events.at(-1)?.type).toBe("rollback");
  });

  it("reuses the locked review pair for the same source hash while allowing source/title updates", async () => {
    const sourceHash = "b".repeat(64);
    const current = row({ reviewAnalysis: '{"painPoints":["current"]}', rawData: JSON.stringify({ sellerSpriteData: { title: "current" }, reviewImport: { runId: "new", sourceHash }, importedReviews: ["new"], untouched: false }) });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await upsertCompetitorAnalysis({
      projectId: 1, asin: current.asin, title: "New source title", reviewAnalysis: '{"painPoints":["stale"]}',
      rawData: JSON.stringify({ sellerSpriteData: { title: "source v2" }, reviewImport: { runId: "old", sourceHash }, importedReviews: ["old"] }),
    });
    expect(saved.title).toBe("New source title");
    expect(saved.reviewAnalysis).toBe(current.reviewAnalysis);
    expect(JSON.parse(saved.rawData!)).toMatchObject({ sellerSpriteData: { title: "source v2" }, reviewImport: { runId: "new", sourceHash }, importedReviews: ["new"], untouched: false });
    expect(writes(store.events).map(event => event.type)).toEqual(["update"]);
    expect(store.events.at(-1)?.type).toBe("commit");
  });

  it("review-intent updates review evidence but cannot revert other top-level source data", async () => {
    const store = database([row({ rawData: JSON.stringify({ title: "latest source", reviewImport: { runId: "old", sourceHash: "a".repeat(64) }, unknown: 0 }) })]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisReviews(10, { reviewAnalysis: '{"new":true}', rawData: JSON.stringify({ title: "stale source", reviewImport: { runId: "new", sourceHash: "b".repeat(64) }, importedReviews: ["new"] }) });
    expect(JSON.parse(saved.rawData!)).toEqual({ title: "latest source", reviewImport: { runId: "new", sourceHash: "b".repeat(64) }, importedReviews: ["new"], unknown: 0, analysisStale: true });
    expect(saved.reviewAnalysis).toBe('{"new":true}');
  });
});

describe("summary version compare-and-set under the same locks", () => {
  it("a stale revision refuses all writes", async () => {
    const current = row({ summaryVersion: 2 }); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edit", incrementVersion: true }, guard(row()))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("guard compares the newly locked row rather than a previous unlocked copy", async () => {
    const current = row(); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    store.hooks.beforeRead = (event, state) => { if (event.lock && event.table === "competitorAnalyses") state[0].title = "concurrent source"; };
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edit" }, guard(current))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]); expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update"]);
  });

  it("does not mutate another parent's child", async () => {
    const store = database([row({ projectId: 2 })], [1, 2]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edit" }, guard(row()))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writes(store.events)).toEqual([]);
  });

  it("increments a guarded draft edit and invalidates its previous revision", async () => {
    const current = row(); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summary: "edited", incrementVersion: true }, guard(current));
    expect(saved.summary).toBe("edited"); expect(saved.summaryVersion).toBe(2);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "late" }, guard(current))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toHaveLength(1);
  });

  it("confirmation increments even when incrementVersion was omitted", async () => {
    const current = row(); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summaryStatus: "confirmed", summary: "approved", summaryConfirmedBy: 9, summaryConfirmedAt: now }, guard(current));
    expect(saved).toMatchObject({ summaryStatus: "confirmed", summaryVersion: 2, summary: "approved", summaryConfirmedBy: 9 });
  });

  it("same-content confirmed request is a true no-op preserving original approver and time", async () => {
    const current = row({ summaryStatus: "confirmed", summaryVersion: 8, summaryConfirmedBy: 9, summaryConfirmedAt: now });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summaryStatus: "confirmed", summary: current.summary,
      summaryConfirmedBy: 100, summaryConfirmedAt: new Date("2026-10-17T00:00:00Z"), incrementVersion: false }, guard(current));
    expect(saved).toEqual(current); expect(writes(store.events)).toEqual([]);
  });

  it("same human summary cannot hide an aiSummary overwrite in repeated confirmation", async () => {
    const current = row({ summaryStatus: "confirmed" }); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summaryStatus: "confirmed", summary: current.summary, aiSummary: "changed" }, guard(current))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("a repeated confirmation still checks its expected revision before the no-op", async () => {
    const current = row({ summaryStatus: "confirmed", summaryVersion: 2 }); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summaryStatus: "confirmed", summary: current.summary }, guard(row()))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("two clients with one expected revision cannot both commit an edit", async () => {
    const current = row(); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const outcomes = await Promise.allSettled(["first", "second"].map(summary => updateCompetitorAnalysisSummary(10, { summary, incrementVersion: true }, guard(current))));
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(store.rows()[0].summary).toBe("first"); expect(writes(store.events)).toHaveLength(1);
  });

  it("refuses to overflow the persisted MySQL INT summary version", async () => {
    const current = row({ summaryVersion: 2147483647 }); const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edited", incrementVersion: true }, guard(current))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(writes(store.events)).toEqual([]);
  });

  it.each([{ summary: "overwrite" }, { aiSummary: "overwrite" }, { summaryStatus: "draft" as const }, { summaryStatus: "draft" as const, summaryConfirmedBy: null }, { summaryStatus: "draft" as const, summaryConfirmedBy: null, summaryConfirmedAt: null, summary: "overwrite" }])("confirmed content rejects a non-unlock mutation %j", async data => {
    const current = row({ summaryStatus: "confirmed", summaryConfirmedBy: 9, summaryConfirmedAt: now });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, data, guard(current))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("explicit unlock clears only confirmation markers and increments version", async () => {
    const current = row({ summaryStatus: "confirmed", summaryVersion: 4, summaryConfirmedBy: 9, summaryConfirmedAt: now });
    const store = database([current]); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summaryStatus: "draft", summaryConfirmedBy: null, summaryConfirmedAt: null }, guard(current));
    expect(saved).toMatchObject({ summaryStatus: "draft", summaryConfirmedBy: null, summaryConfirmedAt: null, summaryVersion: 5, summary: current.summary, aiSummary: current.aiSummary });
  });

  it("legacy no-guard calls still cannot edit a confirmed row", async () => {
    const store = database([row({ summaryStatus: "confirmed" })]); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "overwrite" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes(store.events)).toEqual([]);
  });

  it("legacy no-guard draft edit remains supported with parent-first locks", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summary: "edit", incrementVersion: true });
    expect(saved.summaryVersion).toBe(2); expect(saved.summary).toBe("edit");
    expect(locks(store.events)).toEqual(["projects:update", "competitorAnalyses:update", "competitorAnalyses:update"]);
  });
});

describe("transactional parent ownership recheck", () => {
  const scoped = (current = row()) => ({ ...guard(current), userId: 7, workspaceId: 9 as number | null });

  it.each([9, null])("allows the original owner with an explicit workspace %j", async workspaceId => {
    const store = database([row()], [1], { userId: 7, workspaceId }); dbMock.getDb.mockResolvedValue(store.db);
    const saved = await updateCompetitorAnalysisSummary(10, { summary: "edited", incrementVersion: true }, { ...scoped(), workspaceId });
    expect(saved.summary).toBe("edited");
  });

  it("allows an owned legacy NULL project under an authenticated positive workspace", async () => {
    const store = database([row()], [1], { userId: 7, workspaceId: null }); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edited" }, scoped())).resolves.toMatchObject({ summary: "edited" });
  });

  it.each([
    { userId: 8, workspaceId: 9 }, { userId: 7, workspaceId: 10 }, { userId: 8, workspaceId: null },
  ])("rejects a parent whose locked ownership/scope changed: %j", async parent => {
    const store = database([row()], [1], parent); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edited" }, scoped())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writes(store.events)).toEqual([]); expect(locks(store.events)).toEqual(["projects:update"]);
  });

  it("authenticated NULL scope cannot access an explicit positive-workspace parent", async () => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edited" }, { ...scoped(), workspaceId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writes(store.events)).toEqual([]);
  });

  it.each([
    { ...guard(row()), userId: 7 }, { ...guard(row()), userId: 7, workspaceId: undefined },
    { ...guard(row()), workspaceId: 9 }, { ...guard(row()), userId: 0, workspaceId: null },
    { ...guard(row()), userId: 7, workspaceId: 0 }, { ...guard(row()), userId: 7, workspaceId: NaN },
  ])("rejects an incomplete or invalid actor scope before any database access %j", async invalidGuard => {
    const store = database(); dbMock.getDb.mockResolvedValue(store.db);
    await expect(updateCompetitorAnalysisSummary(10, { summary: "edited" }, invalidGuard)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMock.getDb).not.toHaveBeenCalled(); expect(store.events).toEqual([]);
  });

  it("delete rechecks owner/scope under the same parent lock", async () => {
    const store = database([row()], [1], { userId: 8, workspaceId: 9 }); dbMock.getDb.mockResolvedValue(store.db);
    await expect(deleteCompetitorAnalysis(10, scoped())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.rows()).toHaveLength(1); expect(writes(store.events)).toEqual([]);
  });
});
