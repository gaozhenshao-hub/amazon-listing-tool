import { describe, expect, it } from "vitest";
import { createSaihuReportScheduleTestFixture } from "./saihuReportScheduleTestFixture";
import { saihuReportHash } from "../../../shared/saihuReportSync";
import { fixtureUuid } from "./saihuReportTestFixture";

async function queued() {
  const f = createSaihuReportScheduleTestFixture();
  await f.save();
  await f.activate();
  const result = await f.schedules.enqueueDueOccurrence(f.identity, f.planId);
  if (result.state !== "queued")
    throw new Error("synthetic queue did not commit");
  const input = { expectedWorkspaceId: 7, operationId: result.operationId };
  return { f, input };
}
describe("actual repository frozen scheduled dispatch", () => {
  it("uses the original occurrence/policy after queueing, not a changed current plan", async () => {
    const { f, input } = await queued();
    const run = f.state.jobs[0],
      inputHash = saihuReportHash(JSON.parse(String(run.input)));
    expect(run.procedure).toBe("opsSaihuSchedule.occurrence");
    f.state.schedules[0].body =
      "a changed plan must not be read as dispatch proof";
    const lease = await f.repository.claim(f.identity, input);
    expect(lease).not.toBeNull();
    await f.repository.dispatch(lease!);
    await f.repository.beforeRead(lease!);
    expect(saihuReportHash(JSON.parse(String(run.input)))).toBe(inputHash);
  });
  it("rechecks maxlateness at actual dispatch and again before each HTTP read", async () => {
    const { f, input } = await queued();
    const lease = await f.repository.claim(f.identity, input);
    f.control.now += 46 * 60000;
    f.state.jobs[0].leaseUntil = f.control.now + 120000;
    await expect(f.repository.dispatch(lease!)).rejects.toThrow(
      "MISSED_OCCURRENCE_REVIEW_REQUIRED"
    );
    expect(JSON.parse(String(f.state.jobs[0].output)).dispatched).toBe(false);
    const second = await queued();
    const other = await second.f.repository.claim(
      second.f.identity,
      second.input
    );
    await second.f.repository.dispatch(other!);
    second.f.control.now += 46 * 60000;
    second.f.state.jobs[0].leaseUntil = second.f.control.now + 120000;
    await expect(second.f.repository.beforeRead(other!)).rejects.toThrow(
      "MISSED_OCCURRENCE_REVIEW_REQUIRED"
    );
  });
  it("rejects missing new sidecars and corrupt metadata but keeps unmarked v1 manual requests recoverable", async () => {
    const { f, input } = await queued();
    const lease = await f.repository.claim(f.identity, input);
    f.state.artifacts.length = 0;
    await expect(f.repository.dispatch(lease!)).rejects.toThrow(
      "SCHEDULE_BINDING_REQUIRED"
    );
    const other = await queued();
    const lease2 = await other.f.repository.claim(
      other.f.identity,
      other.input
    );
    other.f.state.artifacts[0].sourceRowId = "999";
    await expect(other.f.repository.dispatch(lease2!)).rejects.toThrow(
      "SCHEDULE_BINDING_INVALID"
    );
    const manual = createSaihuReportScheduleTestFixture();
    const preview = await manual.repository.preview(
      manual.identity,
      manual.scope
    );
    await manual.repository.start(manual.identity, {
      expectedWorkspaceId: 7,
      operationId: fixtureUuid(999),
      scope: manual.scope,
      expectedConfigurationHash: preview.configurationHash!,
      expectedHistoryHash: preview.historyHash,
    });
    const legacyLease = await manual.repository.claim(manual.identity, {
      expectedWorkspaceId: 7,
      operationId: fixtureUuid(999),
    });
    await manual.repository.dispatch(legacyLease!);
    expect(manual.state.artifacts).toHaveLength(0);
  });
  it("verifies C1 unmarked sidecars and full immutable activation/start receipt rather than trusting a hash alone", async () => {
    const { f, input } = await queued();
    f.state.jobs[0].procedure = "opsSaihuReport.start";
    const raw = JSON.parse(String(f.state.artifacts[0].contentJson));
    raw.plan.policy.maxLatenessMinutes = 44640;
    f.state.artifacts[0].contentJson = JSON.stringify(raw);
    f.state.artifacts[0].contentHash = saihuReportHash(raw);
    const lease = await f.repository.claim(f.identity, input);
    await expect(f.repository.dispatch(lease!)).rejects.toThrow(
      "SCHEDULE_BINDING_INVALID"
    );
  });
});
