import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { listAcquisitionJobs } from "./repository";

describe("video gap history query", () => {
  it("correlates snapshot lookups to the outer job and prioritizes gaps before pagination", async () => {
    const query = vi.fn(async () => [[], []]);
    await listAcquisitionJobs(drizzle({client:{query} as any}), 12, 50, 7, "knowledge");
    const [statement, params] = (query.mock.calls as unknown as Array<[{sql:string}, unknown[]]>)[0];
    // Unqualified id/workspace names in nested SELECTs bind to the inner table,
    // silently returning zero gaps. Exercise Drizzle's real SELECT serialization.
    expect(statement.sql).toContain("s.job_id=acquisition_jobs.id");
    expect(statement.sql).toContain("a.workspace_id=acquisition_jobs.workspace_id");
    expect(statement.sql).toContain("c.id=acquisition_jobs.cache_hit_snapshot_id");
    expect(statement.sql).toContain("ORDER BY s.id DESC LIMIT 1");
    expect(statement.sql).toMatch(/order by CASE[\s\S]*missingMainVideos[\s\S]*missingAplusVideos[\s\S]*limit \?/);
    expect(statement.sql).toContain("`acquisition_jobs`.`requested_by` = ?");
    expect(statement.sql).toContain("`acquisition_jobs`.`deleted_at` is null");
    expect(params).toEqual(["主图视频", "A+视频", 12, 7, "kb_images", 50]);
  });
});
