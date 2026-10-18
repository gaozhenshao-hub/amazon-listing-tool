import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { discoverSaihuReportCaptures } from "./saihuReportQueueDiscovery";
import { SAIHU_REPORT_KIND } from "../../../shared/saihuReportSync";
import { fixtureUuid } from "./saihuReportTestFixture";

type Job = {
  id: number;
  workspaceId: number;
  userId: number;
  kind: string;
  projectId: number | null;
  status: string;
  leaseUntil: number | null;
  startedAt: number | null;
  input: string;
};
function fixture() {
  const jobs: Job[] = [],
    calls: Array<{ sql: string; params: unknown[] }> = [];
  const add = (id: number, workspaceId: number, patch: Partial<Job> = {}) =>
    jobs.push({
      id,
      workspaceId,
      userId: 3,
      kind: SAIHU_REPORT_KIND,
      projectId: null,
      status: "queued",
      leaseUntil: null,
      startedAt: null,
      input: JSON.stringify({ operationId: fixtureUuid(id) }),
      ...patch,
    });
  const tx = {
    execute: async (statement: SQL) => {
      const q = new MySqlDialect().sqlToQuery(statement);
      calls.push(q);
      expect(q.params.slice(0, 3)).toEqual([
        SAIHU_REPORT_KIND,
        SAIHU_REPORT_KIND,
        SAIHU_REPORT_KIND,
      ]);
      expect(q.sql).toContain("MIN(id) AS firstId");
      expect(q.sql).toContain("MAX(startedAt) AS lastServed");
      expect(q.sql.indexOf("GROUP BY workspaceId")).toBeLessThan(
        q.sql.indexOf("LIMIT ?")
      );
      const exact = jobs.filter(
        job => job.kind === q.params[0] && job.projectId === null
      );
      const workspaces = [...new Set(exact.map(job => job.workspaceId))];
      const grouped = workspaces
        .flatMap(workspaceId => {
          const own = exact.filter(job => job.workspaceId === workspaceId);
          const first = own
            .filter(
              job =>
                job.status === "queued" ||
                (job.status === "running" &&
                  job.leaseUntil !== null &&
                  job.leaseUntil < 1000)
            )
            .sort((a, b) => a.id - b.id)[0];
          if (!first) return [];
          const served = own.flatMap(job =>
            job.startedAt === null ? [] : [job.startedAt]
          );
          return [
            {
              ...first,
              lastServed: served.length ? Math.max(...served) : null,
            },
          ];
        })
        .sort(
          (a, b) =>
            (a.lastServed === null ? -1 : a.lastServed) -
              (b.lastServed === null ? -1 : b.lastServed) || a.id - b.id
        )
        .slice(0, Number(q.params[3]));
      return [
        grouped.map(job => ({
          id: job.id,
          workspaceId: job.workspaceId,
          userId: job.userId,
          operationId: JSON.parse(job.input).operationId,
        })),
        [],
      ];
    },
  };
  return { jobs, calls, add, tx };
}
describe("native fair Saihu queue work quanta", () => {
  it("a thousand old jobs in one workspace cannot hide another workspace behind LIMIT", async () => {
    const f = fixture();
    for (let id = 1; id <= 1000; id++) f.add(id, 7);
    f.add(1001, 8);
    f.add(1002, 9);
    const hints = await discoverSaihuReportCaptures(f.tx, 3);
    expect(hints.map(hint => hint.identity.workspaceId)).toEqual([7, 8, 9]);
    expect(hints[0].operationId).toBe(fixtureUuid(1));
  });
  it("committed claim timestamps rotate limited quanta across new worker instances and preserve oldest job per workspace", async () => {
    const f = fixture();
    for (let ws = 7; ws <= 10; ws++) f.add(ws, ws);
    expect(
      (await discoverSaihuReportCaptures(f.tx, 2)).map(
        h => h.identity.workspaceId
      )
    ).toEqual([7, 8]);
    f.jobs[0].startedAt = 100;
    f.jobs[0].status = "succeeded";
    f.add(100, 7);
    f.jobs[1].startedAt = 200;
    f.jobs[1].status = "failed";
    f.add(101, 8);
    expect(
      (await discoverSaihuReportCaptures(f.tx, 2)).map(
        h => h.identity.workspaceId
      )
    ).toEqual([9, 10]);
    f.jobs[2].startedAt = 300;
    f.jobs[3].startedAt = 400;
    expect(
      (await discoverSaihuReportCaptures(f.tx, 2)).map(
        h => h.identity.workspaceId
      )
    ).toEqual([7, 8]);
  });
  it("only exact dedicated kind/project-null queued or expired leases are hints, never generic jobs or active leases", async () => {
    const f = fixture();
    f.add(1, 7, { kind: "ordinary" });
    f.add(2, 8, { projectId: 12 });
    f.add(3, 9, { status: "running", leaseUntil: 2000 });
    f.add(4, 10, { status: "running", leaseUntil: 1 });
    expect(await discoverSaihuReportCaptures(f.tx)).toEqual([
      { identity: { userId: 3, workspaceId: 10 }, operationId: fixtureUuid(4) },
    ]);
  });
});
