import { describe, expect, it } from "vitest";
import {
  nextSaihuReportOccurrence,
  saihuReportOccurrence,
  saihuReportOccurrenceId,
  saihuScheduleDueReason,
  saihuSchedulePolicyReason,
  SaihuReportSchedulePolicySchema,
} from "../../../shared/saihuReportSchedule";
const planId = "11111111-1111-4111-8111-111111111111",
  identity = { workspaceId: 7, userId: 3 };
const policy = () => ({
  period: "previous_day" as const,
  timezone: "Asia/Shanghai" as const,
  hour: 9,
  minute: 0,
  weekday: null,
  monthDay: null,
  monthlyNotBeforeDay: null,
  firstScheduledFor: Date.parse("2026-01-01T01:00:00Z"),
  maxLatenessMinutes: 30,
  compensation: { type: "none" as const, maxOccurrences: 0 },
  pendingPreviewLimit: 1,
});
describe("explicit Saihu occurrence policy, no invented calendar defaults", () => {
  it("all policy keys are mandatory and null remains unavailable", () => {
    const p = policy();
    expect(saihuSchedulePolicyReason(p)).toBeNull();
    expect(SaihuReportSchedulePolicySchema.safeParse({}).success).toBe(false);
    expect(saihuSchedulePolicyReason({ ...p, timezone: null })).toBe(
      "POLICY_INCOMPLETE"
    );
    expect(
      saihuSchedulePolicyReason({
        ...p,
        compensation: { type: "none", maxOccurrences: 1 },
      })
    ).toBe("COMPENSATION_POLICY_INCONSISTENT");
  });
  it("uses original occurrence across a delayed new year rather than execution date", () => {
    const at = Date.parse("2026-01-01T01:00:00Z");
    expect(saihuReportOccurrence(identity, planId, policy(), at).scope).toEqual(
      { kind: "daily", start: "2025-12-31", end: "2025-12-31" }
    );
    expect(nextSaihuReportOccurrence(policy(), at)).toBe(at + 86400000);
  });
  it("preserves UTC vs Shanghai boundary instead of conflating day labels", () => {
    const at = Date.parse("2026-01-01T00:00:00Z"),
      p = {
        ...policy(),
        timezone: "UTC" as const,
        hour: 0,
        firstScheduledFor: at,
      };
    expect(saihuReportOccurrence(identity, planId, p, at).scope.end).toBe(
      "2025-12-31"
    );
    expect(saihuSchedulePolicyReason({ ...p, timezone: "Asia/Shanghai" })).toBe(
      "INITIAL_OCCURRENCE_NOT_ON_POLICY"
    );
  });
  it("weekly Friday uses the previous fully elapsed Friday and never an incomplete current week", () => {
    const at = Date.parse("2026-10-16T01:00:00Z"),
      p = {
        ...policy(),
        period: "last_complete_sat_fri_week" as const,
        weekday: 5,
        firstScheduledFor: at,
      };
    expect(saihuReportOccurrence(identity, planId, p, at).scope).toEqual({
      kind: "daily",
      start: "2026-10-03",
      end: "2026-10-09",
    });
    expect(nextSaihuReportOccurrence(p, at)).toBe(at + 7 * 86400000);
  });
  it("monthly collection day is explicit and cannot precede the separately approved not-before day", () => {
    const at = Date.parse("2026-03-07T01:00:00Z"),
      p = {
        ...policy(),
        period: "previous_month" as const,
        monthDay: 7,
        monthlyNotBeforeDay: 6,
        firstScheduledFor: at,
      };
    expect(saihuReportOccurrence(identity, planId, p, at).scope).toEqual({
      kind: "monthly",
      start: "2026-02",
      end: "2026-02",
    });
    expect(new Date(nextSaihuReportOccurrence(p, at)).toISOString()).toBe(
      "2026-04-07T01:00:00.000Z"
    );
    expect(saihuSchedulePolicyReason({ ...p, monthlyNotBeforeDay: 8 })).toBe(
      "POLICY_INCONSISTENT"
    );
  });
  it("UUID depends only on workspace, stable plan and original scheduledFor", () => {
    const at = policy().firstScheduledFor;
    expect(saihuReportOccurrenceId(7, planId, at)).toMatch(/^[a-f0-9-]{36}$/u);
    expect(saihuReportOccurrenceId(7, planId, at)).toBe(
      saihuReportOccurrence(identity, planId, policy(), at).operationId
    );
    expect(saihuReportOccurrenceId(8, planId, at)).not.toBe(
      saihuReportOccurrenceId(7, planId, at)
    );
  });
  it("bounded catchup is the whole original outstanding range, not a per-tick cap that silently loops forever", () => {
    const p = {
        ...policy(),
        compensation: { type: "bounded" as const, maxOccurrences: 2 },
      },
      at = p.firstScheduledFor;
    expect(saihuScheduleDueReason(p, at, at + 86400000)).toBeNull();
    expect(saihuScheduleDueReason(p, at, at + 2 * 86400000)).toBe(
      "COMPENSATION_LIMIT_REVIEW_REQUIRED"
    );
    expect(saihuScheduleDueReason(policy(), at, at + 31 * 60000)).toBe(
      "MISSED_OCCURRENCE_REVIEW_REQUIRED"
    );
  });
});
