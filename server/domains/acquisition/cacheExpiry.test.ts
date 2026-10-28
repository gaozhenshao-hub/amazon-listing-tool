import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
vi.mock("../../repositories/dbClient", () => ({ requireDb: vi.fn() }));
import {
  expireKnowledgeCache,
  retainedCacheReferenceRows,
  lockAcquisitionCache,
  ownsCacheReference,
} from "./cacheExpiry";
const dialect = new MySqlDialect();
let queries: Array<{ sql: string; params: unknown[] }>,
  job: Record<string, unknown>,
  protectedUse: boolean;
const source = {
  id: 7,
  job_id: 4,
  workspace_id: 2,
  status: "confirmed",
  normalized_data: {},
  completeness: {},
};
const db = {
  execute: vi.fn(async input => {
    const query = dialect.sqlToQuery(input);
    queries.push(query);
    if (query.sql.startsWith("SELECT *,NOW()")) return [[job]];
    if (query.sql.startsWith("SELECT j.cache_expired_at")) return [[job]];
    if (query.sql.startsWith("SELECT * FROM acquisition_source_snapshots"))
      return [[source]];
    if (query.sql.startsWith("SELECT * FROM acquisition_confirmed_snapshots"))
      return [[{ id: 9, confirmed_data: {} }]];
    if (query.sql.startsWith("SELECT * FROM acquisition_asset_candidates"))
      return [
        [
          {
            id: 12,
            storage_key: "storage://local/acquisition/2/snapshots/7/main.jpg",
          },
        ],
      ];
    if (query.sql.startsWith("SELECT 1 WHERE") && protectedUse)
      return [[{ found: 1 }]];
    return query.sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  }),
};
beforeEach(() => {
  queries = [];
  protectedUse = false;
  job = {
    id: 4,
    consumer_type: "kb_images",
    status: "confirmed",
    ingested_set_id: 6,
    cacheNow: new Date("2026-10-27T12:00:00Z"),
    completed_at: new Date("2026-10-20T12:00:00Z"),
  };
});
describe("cache expiry preserves evidence and business references", () => {
  it("only queues objects in the exact job's workspace and snapshot/run paths", () => {
    expect(ownsCacheReference("storage://local/acquisition/2/snapshots/7/main/a.jpg", 2, [7], [9])).toBe(true);
    for (const ref of ["storage://local/acquisition/3/snapshots/7/a.jpg", "storage://local/acquisition/2/snapshots/8/a.jpg", "storage://local/acquisition/2/runs/10/a.json", "storage://local/acquisition/2/snapshots/7/../8/a.jpg", "storage://local/acquisition/2/snapshots/7/%2e%2e/a.jpg"])
      expect(ownsCacheReference(ref, 2, [7], [9])).toBe(false);
  });
  it("queues objects and marks expiry without deleting candidates, raw records or payloads", async () => {
    expect(await expireKnowledgeCache(db, 2, 4, [])).toMatchObject({
      expired: true,
      references: 1,
    });
    expect(
      queries.some(q =>
        /DELETE|SET normalized_data|SET confirmed_data|SET storage_key/.test(
          q.sql
        )
      )
    ).toBe(false);
    expect(
      queries.find(q =>
        q.sql.startsWith("INSERT INTO knowledge_object_cleanup")
      )!.params
    ).toEqual([2, "storage://local/acquisition/2/snapshots/7/main.jpg"]);
    expect(
      queries.find(q => q.sql.startsWith("UPDATE acquisition_jobs"))!.params
    ).toEqual([4, 2]);
  });
  it("protects manually revised and reused evidence before queueing any object", async () => {
    protectedUse = true;
    expect(await expireKnowledgeCache(db, 2, 4, [])).toMatchObject({
      expired: false,
    });
    expect(queries.some(q => /^(INSERT|UPDATE|DELETE)/.test(q.sql))).toBe(
      false
    );
  });
  it("does not expire a job waiting for manual supplementation", async () => {
    job.status = "review_required";
    expect(await expireKnowledgeCache(db, 2, 4, [])).toMatchObject({
      expired: false,
      reason: "unfinished",
    });
    expect(queries).toHaveLength(1);
  });
  it("prevents a cache reuse admitted after expiry", async () => {
    job.cache_expired_at = new Date();
    await expect(lockAcquisitionCache(db, 2, 9)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(queries[0].sql).toContain("FOR UPDATE");
  });
  it("does not weaken the file reference check for business, recycle or other upload rows", () => {
    for (const table of [
      "kb_images",
      "kb_image_sets",
      "kb_videos",
      "image_assets",
      "acquisition_snapshot_revisions",
    ])
      expect(
        dialect.sqlToQuery(
          retainedCacheReferenceRows(
            table,
            "storage://local/acquisition/2/a.jpg"
          )
        ).sql
      ).toBe("TRUE");
    expect(
      dialect.sqlToQuery(
        retainedCacheReferenceRows(
          "acquisition_asset_candidates",
          "storage://local/knowledge/a.jpg"
        )
      ).sql
    ).toBe("TRUE");
    for (const table of [
      "acquisition_asset_candidates",
      "acquisition_source_snapshots",
      "acquisition_raw_artifacts",
      "acquisition_confirmed_snapshots",
    ]) {
      const query = dialect.sqlToQuery(
        retainedCacheReferenceRows(table, "storage://local/acquisition/2/a.jpg")
      ).sql;
      expect(query).toContain("cache_expired_at IS NOT NULL");
      expect(query).toContain("workspace_id");
      expect(query).toContain("NOT EXISTS");
    }
  });
});
