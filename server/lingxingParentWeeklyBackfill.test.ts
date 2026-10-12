import { describe, expect, it, vi } from "vitest";
import {
  assertStrictWeeklyBackfillBatch, assertApprovedWeeklyBackfillSchedule, verifiedAppliedWeeklyBatch, parseBackfillOptions, runParentWeeklyBackfill,
  type BackfillDependencies, type BackfillOptions,
} from "../scripts/backfillLingxingParentWeekly";
import { validateParentAsinWeeklyMcpAutoApplyIntegrity } from "./domains/ops/lingxingScheduledDrafts";
import * as weeklyHelpers from "./domains/ops/lingxingScheduledDrafts";

const now = new Date("2026-10-12T01:00:00Z");
const args = ["--user-id", "81", "--workspace-id", "37", "--weeks", "2026-09-21,2026-09-28,2026-10-05"];
const options = (execute = true) => parseBackfillOptions([...args, ...(execute ? ["--execute", "--scheduler-quiesced"] : [])], now);

function harness() {
  const trace: string[] = [];
  const created = new Map<number, BackfillOptions["weeks"][number]>();
  let id = 500;
  const deps: BackfillDependencies = {
    loadActor: vi.fn(async () => ({ id: 81, role: "super_admin", status: "active", defaultWorkspaceId: 37 })),
    acquireSchedulerLock: vi.fn(async () => ({ acquired: true, lockName: "same-scheduler-lock" })),
    assertLockHeld: vi.fn(), releaseSchedulerLock: vi.fn(async () => undefined),
    assertNoRunningSchedule: vi.fn(async () => undefined),
    findAppliedWeek: vi.fn(async () => null),
    createPreview: vi.fn(async (_options, week) => {
      trace.push(`preview:${week.startDate}`); created.set(++id, week); return { batchId: id };
    }),
    loadBatch: vi.fn(async (_workspaceId, batchId) => {
      const week = created.get(batchId)!;
      return {
        batch: { id: batchId, workspaceId: 37, userId: 81, dataDomain: "parent_asin_weekly_mcp", source: "lingxing_mcp", status: "ready_for_review",
          scope: { storeId: "ALL_US", marketplace: "US", ...week },
          summary: { totalRead: 1, needsReview: 0, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 1, storeDateWindowsRead: 1,
            datesRead: 7, capped: false, pageTruncations: 0, failedStoreDateWindows: [] } },
        rows: [{ id: batchId + 1000, workspaceId: 37, batchId, entityKey: `store|US|parent|child|${week.startDate}`,
          rowStatus: "new", validationErrors: [], normalizedData: {}, sourceData: { rweek: `${week.startDate}~${week.endDate}` } }],
      };
    }),
    validateIntegrity: vi.fn((batch, rows, week) => {
      trace.push(`validate:${week.startDate}`); validateParentAsinWeeklyMcpAutoApplyIntegrity(batch, rows, week);
    }),
    apply: vi.fn(async (_options, batchId) => {
      trace.push(`apply:${created.get(batchId)!.startDate}`); return { batchId, importedRows: 1, skippedRows: 0, idempotent: false };
    }),
    report: vi.fn(),
  };
  return { deps, trace };
}

describe("explicit bounded parent weekly backfill CLI", () => {
  it("defaults to database-only preview and calculates three complete Shanghai natural weeks", async () => {
    const input = options(false);
    expect(input.weeks).toEqual([
      { startDate: "2026-09-21", endDate: "2026-09-27" },
      { startDate: "2026-09-28", endDate: "2026-10-04" },
      { startDate: "2026-10-05", endDate: "2026-10-11" },
    ]);
    const { deps } = harness();
    const result = await runParentWeeklyBackfill(input, deps);
    expect(result.mode).toBe("preview");
    expect(result.outcomes).toHaveLength(3);
    for (const fn of [deps.acquireSchedulerLock, deps.createPreview, deps.validateIntegrity, deps.apply, deps.releaseSchedulerLock]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    [], ["--user-id", "81"], [...args, "--execute"], [...args, "--execute", "--preview", "--scheduler-quiesced"],
    ["--user-id", "0", ...args.slice(2)],
    [...args.slice(0, 4), "--weeks", "2026-09-22"],
    [...args.slice(0, 4), "--weeks", "2026-02-30"],
    [...args.slice(0, 4), "--weeks", "2026-10-12"],
    [...args.slice(0, 4), "--weeks", "2026-09-21,2026-09-21"],
    [...args.slice(0, 4), "--weeks", "2026-09-14,2026-09-21,2026-09-28,2026-10-05"],
  ])("rejects missing, ambiguous, invalid or excessive scope: %j", bad => {
    expect(() => parseBackfillOptions(bad, now)).toThrow();
  });

  it("uses Shanghai completion boundary rather than UTC day", () => {
    const one = [...args.slice(0, 4), "--weeks", "2026-10-05"];
    expect(() => parseBackfillOptions(one, new Date("2026-10-11T15:59:00Z"))).toThrow("not yet complete");
    expect(parseBackfillOptions(one, new Date("2026-10-11T16:00:00Z")).weeks[0].endDate).toBe("2026-10-11");
  });

  it.each([null, { id: 81, role: "admin", status: "active", defaultWorkspaceId: 37 },
    { id: 81, role: "super_admin", status: "disabled", defaultWorkspaceId: 37 },
    { id: 81, role: "super_admin", status: "active", defaultWorkspaceId: 38 },
    { id: 82, role: "super_admin", status: "active", defaultWorkspaceId: 37 },
  ])("rejects invalid actual operator before acquiring lock or reading MCP", async actor => {
    const { deps } = harness();
    vi.mocked(deps.loadActor).mockResolvedValue(actor as Awaited<ReturnType<BackfillDependencies["loadActor"]>>);
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("active super_admin");
    expect(deps.acquireSchedulerLock).not.toHaveBeenCalled(); expect(deps.createPreview).not.toHaveBeenCalled();
  });

  it("refuses a busy existing scheduler lock and always closes the attempted lock connection", async () => {
    const { deps } = harness();
    vi.mocked(deps.acquireSchedulerLock).mockResolvedValue({ acquired: false, lockName: "same-scheduler-lock" });
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("lock is busy");
    expect(deps.createPreview).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
  });

  it("does not run against missing approval or an in-flight schedule", async () => {
    const { deps } = harness();
    vi.mocked(deps.assertNoRunningSchedule).mockRejectedValue(new Error("approval disabled or running"));
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("approval disabled");
    expect(deps.createPreview).not.toHaveBeenCalled(); expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
  });

  it("runs the existing preview → real source-period validator → apply sequentially", async () => {
    const { deps, trace } = harness();
    const result = await runParentWeeklyBackfill(options(), deps);
    expect(trace).toEqual(options().weeks.flatMap(week => [`preview:${week.startDate}`, `validate:${week.startDate}`, `apply:${week.startDate}`]));
    expect(result.outcomes.every(outcome => outcome.status === "applied")).toBe(true);
    expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("sourceData");
  });

  it("skips a verified already-applied week without reading or applying it again", async () => {
    const { deps } = harness();
    vi.mocked(deps.findAppliedWeek).mockResolvedValueOnce({ batchId: 99 });
    const result = await runParentWeeklyBackfill(options(), deps);
    expect(result.outcomes[0]).toMatchObject({ status: "already_applied", batchId: 99 });
    expect(deps.createPreview).toHaveBeenCalledTimes(2); expect(deps.apply).toHaveBeenCalledTimes(2);
  });

  it("stops on the second week's conflict and never starts a third week or retries", async () => {
    const { deps } = harness();
    vi.mocked(deps.apply).mockResolvedValueOnce({ batchId: 501, importedRows: 1, skippedRows: 0, idempotent: false }).mockRejectedValueOnce(new Error("historical conflict; unchanged"));
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("historical conflict");
    expect(deps.createPreview).toHaveBeenCalledTimes(2); expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(deps.report).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed_stopped_no_retry", batchId: 502 }));
    expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
  });

  it("refuses apply after leader lock loss during the external read", async () => {
    const { deps } = harness();
    const create = deps.createPreview;
    deps.createPreview = vi.fn(async (input, week) => {
      const result = await create(input, week);
      vi.mocked(deps.assertLockHeld).mockImplementation(() => { throw new Error("leader lock lost"); });
      return result;
    });
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("leader lock lost");
    expect(deps.apply).not.toHaveBeenCalled(); expect(deps.createPreview).toHaveBeenCalledOnce();
    expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
  });

  it("does not start another week if the lock is lost during the preceding apply", async () => {
    const { deps } = harness();
    const apply = deps.apply;
    deps.apply = vi.fn(async (input, batchId) => {
      const result = await apply(input, batchId);
      vi.mocked(deps.assertLockHeld).mockImplementation(() => { throw new Error("leader lock lost"); });
      return result;
    });
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("leader lock lost");
    expect(deps.apply).toHaveBeenCalledOnce(); expect(deps.createPreview).toHaveBeenCalledOnce();
    expect(deps.report).toHaveBeenCalledWith(expect.objectContaining({ status: "applied", batchId: 501 }));
  });

  it("rechecks operator authorization after the external read", async () => {
    const { deps } = harness();
    vi.mocked(deps.loadActor).mockResolvedValueOnce({ id: 81, role: "super_admin", status: "active", defaultWorkspaceId: 37 })
      .mockResolvedValueOnce({ id: 81, role: "super_admin", status: "active", defaultWorkspaceId: 37 }).mockResolvedValueOnce(null);
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow("active super_admin");
    expect(deps.createPreview).toHaveBeenCalledOnce(); expect(deps.apply).not.toHaveBeenCalled();
  });

  it.each(["foreignWorkspace", "foreignOwner", "wrongScope", "wrongStatus", "missingWindow", "capped", "failedWindow", "missingRow", "rowError", "skippedRow", "sourcePeriod", "duplicateIdentity"])("blocks %s before any business apply", async issue => {
    const { deps } = harness();
    const load = deps.loadBatch;
    deps.loadBatch = vi.fn(async (workspaceId, batchId) => {
      const loaded = await load(workspaceId, batchId);
      const batch = loaded.batch!;
      const summary = batch.summary as Record<string, unknown>;
      if (issue === "foreignWorkspace") batch.workspaceId = 38;
      if (issue === "foreignOwner") batch.userId = 82;
      if (issue === "wrongScope") batch.scope = { storeId: "ONE_STORE", marketplace: "US", ...options().weeks[0] };
      if (issue === "wrongStatus") batch.status = "confirmed";
      if (issue === "missingWindow") summary.storeDateWindowsRead = 0;
      if (issue === "capped") summary.capped = true;
      if (issue === "failedWindow") summary.failedStoreDateWindows = [{ error: "timeout" }];
      if (issue === "missingRow") summary.totalRead = 2;
      if (issue === "rowError") loaded.rows[0].validationErrors = ["invalid identity"];
      if (issue === "skippedRow") loaded.rows[0].rowStatus = "skipped";
      if (issue === "sourcePeriod") loaded.rows[0].sourceData = { rweek: "2026-09-14~2026-09-20" };
      if (issue === "duplicateIdentity") { loaded.rows.push({ ...loaded.rows[0], id: 9000 }); summary.totalRead = 2; }
      return loaded;
    });
    await expect(runParentWeeklyBackfill(options(), deps)).rejects.toThrow();
    expect(deps.apply).not.toHaveBeenCalled(); expect(deps.createPreview).toHaveBeenCalledOnce();
    expect(deps.releaseSchedulerLock).toHaveBeenCalledOnce();
  });

  it("rejects a data-domain mismatch even when date coverage is valid", () => {
    expect(() => assertStrictWeeklyBackfillBatch(null, [], options(), options().weeks[0], 500)).toThrow("batch identity");
  });

  it.each(["valid", "blocked", "timeout", "wrongIdentity", "changedMetrics", "duplicateFact", "missingFact", "wrongSourcePeriod"])("only skips a fully verified applied identity set: %s", async issue => {
    const { deps } = harness();
    const week = options().weeks[0];
    const { batchId } = await deps.createPreview(options(), week);
    const { batch, rows } = await deps.loadBatch(37, batchId);
    batch!.status = "applied";
    batch!.summary = { ...batch!.summary as object, sourceSchemaVersion: "lingxing_asin_weekly_source_period_v2", appliedRows: 1, skippedRows: 0 };
    rows[0].rowStatus = "applied";
    rows[0].normalizedData = { parentAsin: "PARENT", asin: "CHILD", storeName: "Synthetic Store", country: "US", weekStartDate: week.startDate, weekEndDate: week.endDate, salesQty: 2 };
    const facts = weeklyHelpers.aggregateParentAsinWeeklyMemberFacts([{ fact: weeklyHelpers.buildWeeklyRollupFact(rows[0].normalizedData as Record<string, unknown>, {
      workspaceId: 37, importId: 0, userId: 81, sourceKind: "lingxing_mcp_parent_asin_weekly",
    }) }]).map(item => item.fact);
    if (issue === "blocked") (batch!.summary as Record<string, unknown>).applyBlocked = true;
    if (issue === "timeout") (batch!.summary as Record<string, unknown>).timeoutBeforePreview = true;
    if (issue === "wrongIdentity") facts[0].parentAsin = "ANOTHER";
    if (issue === "changedMetrics") facts[0].salesQty = 100;
    if (issue === "duplicateFact") facts.push({ ...facts[0] });
    if (issue === "missingFact") facts.length = 0;
    if (issue === "wrongSourcePeriod") rows[0].sourceData = { rweek: "2026-09-14~2026-09-20" };
    expect(verifiedAppliedWeeklyBatch(batch!, rows, facts, 37, week, weeklyHelpers)).toBe(issue === "valid");
  });

  it.each(["valid", "disabled", "approvalOff", "wrongWorkspace", "wrongLink", "taskInactive", "taskApprovalOff", "running", "multiple"])("requires existing schedule and task approval: %s", issue => {
    const schedules = [{ id: 8, workspaceId: 37, dataDomain: "parent_asin_weekly_mcp", enabled: 1, autoApply: 1, scheduleCronTaskUid: "approved-task", lastStatus: "failed" }];
    const tasks = [{ workspaceId: 37, dataDomain: "parent_asin_weekly_mcp", systemManaged: 1, externalScheduleId: 8, externalTaskUid: "approved-task", isActive: 1, triggerMode: "heartbeat", inputTemplate: { autoApply: true }, lastRunStatus: "failed" }];
    if (issue === "disabled") schedules[0].enabled = 0;
    if (issue === "approvalOff") schedules[0].autoApply = 0;
    if (issue === "wrongWorkspace") schedules[0].workspaceId = 38;
    if (issue === "wrongLink") tasks[0].externalScheduleId = 9;
    if (issue === "taskInactive") tasks[0].isActive = 0;
    if (issue === "taskApprovalOff") tasks[0].inputTemplate.autoApply = false;
    if (issue === "running") tasks[0].lastRunStatus = "running";
    if (issue === "multiple") schedules.push({ ...schedules[0], id: 9 });
    const check = () => assertApprovedWeeklyBackfillSchedule(schedules, tasks, 37);
    if (issue === "valid") expect(check).not.toThrow(); else expect(check).toThrow();
  });
});
