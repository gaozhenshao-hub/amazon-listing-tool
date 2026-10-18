import { describe, expect, it } from "vitest";
import {
  createSaihuReportScheduleTestFixture,
  schedulePolicy,
} from "./saihuReportScheduleTestFixture";
import {
  fixtureUuid,
  syntheticSaihuRead,
  syntheticSaihuRow,
} from "./saihuReportTestFixture";
import { collectSaihuReport } from "./saihuReportCoverage";
import {
  SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY,
  saihuReportOccurrenceId,
} from "../../../shared/saihuReportSchedule";

describe("explicit Saihu plan → same-TX existing capture queue, no auto apply", () => {
  it("saves paused only, explicitly previews/activates and commits one frozen original occurrence and v1 capture", async () => {
    const f = createSaihuReportScheduleTestFixture(),
      saved = await f.save();
    expect(saved.status).toBe("paused");
    expect(f.state.jobs).toHaveLength(0);
    await f.activate();
    const queued = await f.schedules.enqueueDueOccurrence(f.identity, f.planId);
    expect(queued.state).toBe("queued");
    expect(f.state.jobs).toHaveLength(1);
    expect(JSON.parse(f.state.jobs[0].input)).toMatchObject({
      version: 1,
      request: {
        scope: { kind: "daily", start: "2026-10-16", end: "2026-10-16" },
      },
    });
    const artifact = f.state.artifacts.find(
      row => row.artifactKey === SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY
    )!;
    expect(JSON.parse(artifact.contentJson)).toMatchObject({
      plan: { status: "active", policy: schedulePolicy() },
      occurrence: { scheduledFor: schedulePolicy().firstScheduledFor },
    });
    const operationId = queued.operationId!,
      lease = await f.repository.claim(f.identity, {
        expectedWorkspaceId: 7,
        operationId,
      });
    const frozen = await f.repository.dispatch(lease!);
    const source = await collectSaihuReport(
      {
        version: 1,
        identity: f.identity,
        operationId,
        scope: frozen.request.scope,
        connectionVersion: frozen.connectionVersion,
        contractHash: frozen.contractHash,
        shops: frozen.contract.shops,
      },
      frozen.contract,
      async period => syntheticSaihuRead([syntheticSaihuRow(period)]),
      new AbortController().signal
    );
    await f.repository.finish(lease!, source.source);
    expect(f.state.daily[0].status).toBe("previewing");
    expect(f.state.monthly).toHaveLength(0);
    expect(
      (await f.schedules.enqueueDueOccurrence(f.identity, f.planId)).state
    ).toBe("not_due");
    expect(f.state.jobs).toHaveLength(1);
  });
  it("never seeds/activates on read, policy null or flag/rollout disabled; pause and original receipt recovery remain available", async () => {
    const f = createSaihuReportScheduleTestFixture();
    expect(await f.schedules.read(f.identity, f.base)).toBeNull();
    expect(f.state.schedules).toHaveLength(0);
    await f.save({ ...schedulePolicy(), maxLatenessMinutes: null });
    expect(
      (await f.schedules.activationPreview(f.identity, f.base)).reasonCode
    ).toBe("POLICY_INCOMPLETE");
    await f.save();
    f.scheduleControl.schedulerEnabled = false;
    expect(
      (await f.schedules.activationPreview(f.identity, f.base)).reasonCode
    ).toBe("SCHEDULER_NOT_ENABLED");
    f.scheduleControl.schedulerEnabled = true;
    f.scheduleControl.rolloutWorkspaceId = 8;
    expect(
      (await f.schedules.activationPreview(f.identity, f.base)).reasonCode
    ).toBe("SCHEDULE_ROLLOUT_SCOPE_NOT_APPROVED");
    expect(f.state.jobs).toHaveLength(0);
  });
  it("lost plan ACK is resolved under its original operation UUID and cancellation fences delayed saves", async () => {
    const f = createSaihuReportScheduleTestFixture(),
      source = await f.schedules.sourceOptions(f.identity, {
        expectedWorkspaceId: 7,
        kind: "daily",
      }),
      input = {
        ...f.base,
        operationId: fixtureUuid(1),
        expectedVersionHash: null,
        policy: schedulePolicy(),
        target: source.target,
      };
    f.control.commitLost = 1;
    await expect(f.schedules.save(f.identity, input)).rejects.toThrow(
      "ACK lost"
    );
    const op = {
      ...f.base,
      operationId: input.operationId,
      action: "save" as const,
    };
    expect(await f.schedules.check(f.identity, op)).toMatchObject({
      status: "committed",
    });
    expect(await f.schedules.save(f.identity, input)).toMatchObject({
      status: "committed",
    });
    expect(f.state.schedules).toHaveLength(1);
    const cancelled = {
      ...f.base,
      operationId: fixtureUuid(2),
      action: "pause" as const,
    };
    await f.schedules.cancel(f.identity, cancelled);
    const saved = await f.schedules.read(f.identity, f.base);
    f.control.enabled = false;
    expect(
      await f.schedules.pause(f.identity, {
        ...f.base,
        operationId: cancelled.operationId,
        expectedVersionHash: saved!.versionHash,
      })
    ).toMatchObject({ status: "cancelled" });
  });
  it("lost queue commit ACK retains one stable slot, complete immutable binding and no new capture on re-tick", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    await f.activate();
    f.control.commitLost = 1;
    await expect(
      f.schedules.enqueueDueOccurrence(f.identity, f.planId)
    ).rejects.toThrow("ACK lost");
    expect(f.state.jobs).toHaveLength(1);
    expect(f.state.artifacts).toHaveLength(1);
    expect(
      (await f.schedules.enqueueDueOccurrence(f.identity, f.planId)).state
    ).toBe("not_due");
    const id = saihuReportOccurrenceId(
      7,
      f.planId,
      schedulePolicy().firstScheduledFor!
    );
    expect(JSON.parse(f.state.jobs[0].input).operationId).toBe(id);
  });
  it("scheduler and manual capture share the actual overlap fence and rollback plan cursor on conflict", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    await f.activate();
    const scope = {
        kind: "daily" as const,
        start: "2026-10-16",
        end: "2026-10-16",
      },
      p = await f.repository.preview(f.identity, scope);
    await f.repository.start(f.identity, {
      expectedWorkspaceId: 7,
      operationId: fixtureUuid(9),
      scope,
      expectedConfigurationHash: p.configurationHash!,
      expectedHistoryHash: p.historyHash,
    });
    const before = await f.schedules.read(f.identity, f.base);
    await expect(
      f.schedules.enqueueDueOccurrence(f.identity, f.planId)
    ).rejects.toThrow("RESOLVE_PENDING_SCOPE_FIRST");
    expect((await f.schedules.read(f.identity, f.base))?.versionHash).toBe(
      before?.versionHash
    );
    expect(f.state.jobs).toHaveLength(1);
  });
  it("stale activation, switched workspace, revoked actor, config drift and wrong table engine do not queue", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    const preview = await f.schedules.activationPreview(f.identity, f.base);
    await f.save({ ...schedulePolicy(), pendingPreviewLimit: 3 });
    await expect(
      f.schedules.activate(f.identity, {
        ...f.base,
        operationId: fixtureUuid(50),
        expectedVersionHash: preview.plan.versionHash,
        expectedActivationHash: preview.activationHash,
        confirmFullScope: true,
        confirmNextOccurrence: true,
      })
    ).rejects.toThrow("VERSION_CHANGED");
    await expect(
      f.schedules.read(f.identity, { ...f.base, expectedWorkspaceId: 8 })
    ).rejects.toThrow("WORKSPACE_CHANGED");
    await f.activate();
    f.control.connectionVersion = "c".repeat(64);
    expect(
      (await f.schedules.enqueueDueOccurrence(f.identity, f.planId)).state
    ).toBe("attention");
    expect(f.state.jobs).toHaveLength(0);
    f.control.actorActive = false;
    await expect(f.schedules.read(f.identity, f.base)).rejects.toThrow(
      "ACCESS_DENIED"
    );
    f.control.actorActive = true;
    f.control.badEngine = "ops_saihu_report_schedules";
    await expect(f.schedules.read(f.identity, f.base)).rejects.toThrow(
      "SCHEDULE_SCHEMA_UNAVAILABLE"
    );
  });
  it("unapproved lateness stops for review without skipping to current date; bounded policy preserves original slot", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    await f.activate();
    f.control.now += 2 * 86400000;
    expect(
      await f.schedules.enqueueDueOccurrence(f.identity, f.planId)
    ).toMatchObject({
      state: "attention",
      reasonCode: "MISSED_OCCURRENCE_REVIEW_REQUIRED",
    });
    expect(f.state.jobs).toHaveLength(0);
    const g = createSaihuReportScheduleTestFixture();
    await g.save({
      ...schedulePolicy(),
      compensation: { type: "bounded", maxOccurrences: 3 },
    });
    await g.activate();
    g.control.now += 2 * 86400000;
    expect(
      await g.schedules.enqueueDueOccurrence(g.identity, g.planId)
    ).toMatchObject({
      state: "queued",
      scheduledFor: schedulePolicy().firstScheduledFor,
    });
  });
  it("forged and expired same-transaction sessions cannot call the new shared queue kernel", async () => {
    const f = createSaihuReportScheduleTestFixture();
    let session:
      | Parameters<typeof f.repository.server.startInTransaction>[0]
      | undefined;
    await f.repository.server.withTransaction(
      f.identity,
      "read",
      async current => {
        session = current;
      }
    );
    await expect(
      f.repository.server.startInTransaction(session!, {
        expectedWorkspaceId: 7,
        operationId: fixtureUuid(1),
        scope: f.scope,
        expectedConfigurationHash: "a".repeat(64),
        expectedHistoryHash: "b".repeat(64),
      })
    ).rejects.toThrow("TRANSACTION_SESSION_REQUIRED");
    expect(f.state.jobs).toHaveLength(0);
  });
  it("changing cadence does not reinterpret an old cursor or mint a replacement occurrence", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    await f.activate();
    await f.schedules.enqueueDueOccurrence(f.identity, f.planId);
    const before = await f.schedules.read(f.identity, f.base);
    expect(before?.nextScheduledFor).toBe(Date.parse("2026-10-18T01:00:00Z"));
    await f.save({
      ...schedulePolicy(),
      period: "last_complete_sat_fri_week",
      weekday: 6,
    });
    const changed = await f.schedules.activationPreview(f.identity, f.base);
    expect(changed.available).toBe(false);
    expect(changed.reasonCode).toBe("CURRENT_OCCURRENCE_NOT_ON_POLICY");
    expect(changed.plan.nextScheduledFor).toBe(before?.nextScheduledFor);
    expect(f.state.jobs).toHaveLength(1);
  });
  it("read-scoped sessions cannot invoke the create-only queue kernel, and unsupported constraints fail closed", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.repository.server.withTransaction(
      f.identity,
      "read",
      async current => {
        await expect(
          f.repository.server.startInTransaction(current, {
            expectedWorkspaceId: 7,
            operationId: fixtureUuid(1),
            scope: f.scope,
            expectedConfigurationHash: "a".repeat(64),
            expectedHistoryHash: "b".repeat(64),
          })
        ).rejects.toThrow("TRANSACTION_SESSION_REQUIRED");
      }
    );
    f.scheduleControl.constraints.push({
      type: "FOREIGN KEY",
      name: "unreviewed",
    });
    await expect(f.schedules.read(f.identity, f.base)).rejects.toThrow(
      "SCHEDULE_SCHEMA_UNAVAILABLE"
    );
  });
  it("schedule list is explicit, complete per page, owner scoped and read-only", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    const before = f.state.schedules.length,
      result = await f.schedules.list(f.identity, {
        expectedWorkspaceId: 7,
        cursor: null,
        limit: 20,
      });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].planId).toBe(f.planId);
    expect(f.state.schedules).toHaveLength(before);
    expect(f.state.jobs).toHaveLength(0);
  });
});
