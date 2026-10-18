import { z } from "zod";
import {
  SaihuReportIdentitySchema,
  SaihuReportId,
  SaihuReportUuid,
  SaihuReportHash,
  SaihuReportShopSchema,
  SaihuReportScopeSchema,
  saihuReportHash,
} from "./saihuReportSync";
export const SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY =
  "ops.saihu_report.schedule_occurrence.v1";

const timestamp = z
  .number()
  .int()
  .min(Date.UTC(2000, 0, 1))
  .max(Date.UTC(2100, 0, 1) - 1);
/** Null is an explicit unconfigured policy, never a default or permission. */
export const SaihuReportSchedulePolicySchema = z
  .object({
    period: z
      .enum(["previous_day", "last_complete_sat_fri_week", "previous_month"])
      .nullable(),
    timezone: z.enum(["UTC", "Asia/Shanghai"]).nullable(),
    hour: z.number().int().min(0).max(23).nullable(),
    minute: z.number().int().min(0).max(59).nullable(),
    weekday: z.number().int().min(1).max(7).nullable(),
    monthDay: z.number().int().min(1).max(28).nullable(),
    monthlyNotBeforeDay: z.number().int().min(1).max(28).nullable(),
    firstScheduledFor: timestamp.nullable(),
    maxLatenessMinutes: z.number().int().min(0).max(44640).nullable(),
    compensation: z
      .object({
        type: z.enum(["none", "bounded"]).nullable(),
        maxOccurrences: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    pendingPreviewLimit: z.number().int().min(1).max(100).nullable(),
  })
  .strict();
export type SaihuReportSchedulePolicy = z.infer<
  typeof SaihuReportSchedulePolicySchema
>;
export const SaihuReportScheduleTargetSchema = z
  .object({
    kind: z.enum(["daily", "monthly"]),
    shops: z.array(SaihuReportShopSchema).min(1).max(100),
    configurationHash: SaihuReportHash,
  })
  .strict();
export const SaihuReportScheduleOccurrenceSchema = z
  .object({
    scheduledFor: timestamp,
    operationId: SaihuReportUuid,
    scope: SaihuReportScopeSchema,
  })
  .strict();
export const SaihuReportScheduleRecordSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    planId: SaihuReportUuid,
    revision: z.number().int().positive(),
    status: z.enum(["paused", "active", "attention"]),
    policy: SaihuReportSchedulePolicySchema,
    target: SaihuReportScheduleTargetSchema.nullable(),
    nextScheduledFor: timestamp.nullable(),
    outstanding: z.array(SaihuReportScheduleOccurrenceSchema).max(100),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,99}$/u)
      .nullable(),
  })
  .strict();
export type SaihuReportScheduleRecord = z.infer<
  typeof SaihuReportScheduleRecordSchema
>;
export const SaihuReportScheduleViewSchema =
  SaihuReportScheduleRecordSchema.extend({
    versionHash: SaihuReportHash,
  }).strict();
export type SaihuReportScheduleView = z.infer<
  typeof SaihuReportScheduleViewSchema
>;
const scope = z
  .object({ expectedWorkspaceId: SaihuReportId, planId: SaihuReportUuid })
  .strict();
export const SaihuReportScheduleReadInputSchema = scope;
export const SaihuReportScheduleListInputSchema = z
  .object({
    expectedWorkspaceId: SaihuReportId,
    cursor: SaihuReportUuid.nullable(),
    limit: z.number().int().min(1).max(20),
  })
  .strict();
export const SaihuReportScheduleListSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    plans: z.array(SaihuReportScheduleViewSchema).max(20),
    nextCursor: SaihuReportUuid.nullable(),
  })
  .strict();
export const SaihuReportScheduleSaveInputSchema = scope
  .extend({
    operationId: SaihuReportUuid,
    expectedVersionHash: SaihuReportHash.nullable(),
    policy: SaihuReportSchedulePolicySchema,
    target: SaihuReportScheduleTargetSchema.nullable(),
  })
  .strict();
export const SaihuReportSchedulePauseInputSchema = scope
  .extend({
    operationId: SaihuReportUuid,
    expectedVersionHash: SaihuReportHash,
  })
  .strict();
export const SaihuReportScheduleActivateInputSchema =
  SaihuReportSchedulePauseInputSchema.extend({
    expectedActivationHash: SaihuReportHash,
    confirmFullScope: z.literal(true),
    confirmNextOccurrence: z.literal(true),
  }).strict();
export const SaihuReportScheduleOperationSchema = scope
  .extend({
    operationId: SaihuReportUuid,
    action: z.enum(["save", "pause", "activate"]),
  })
  .strict();
export const SaihuReportScheduleReceiptSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    planId: SaihuReportUuid,
    operationId: SaihuReportUuid,
    action: z.enum(["save", "pause", "activate"]),
    status: z.enum(["committed", "cancelled"]),
    requestHash: SaihuReportHash.nullable(),
    revision: z.number().int().positive().nullable(),
    versionHash: SaihuReportHash.nullable(),
  })
  .strict();
export const SaihuReportScheduleActivationSchema = z
  .object({
    plan: SaihuReportScheduleViewSchema,
    next: SaihuReportScheduleOccurrenceSchema.nullable(),
    available: z.boolean(),
    reasonCode: z.string().nullable(),
    activationHash: SaihuReportHash,
    autoApply: z.literal(false),
    schedulingEnabled: z.boolean(),
  })
  .strict();
export const SaihuReportScheduleSourceInputSchema = z
  .object({
    expectedWorkspaceId: SaihuReportId,
    kind: z.enum(["daily", "monthly"]),
  })
  .strict();
export const SaihuReportScheduleSourceSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    target: SaihuReportScheduleTargetSchema.nullable(),
    reasonCode: z.string().nullable(),
  })
  .strict();

const DAY = 86400000;
function local(policy: SaihuReportSchedulePolicy, at: number) {
  return new Date(at + (policy.timezone === "Asia/Shanghai" ? 8 * 3600000 : 0));
}
export function saihuSchedulePolicyReason(
  raw: SaihuReportSchedulePolicy
): string | null {
  const p = SaihuReportSchedulePolicySchema.parse(raw);
  if (
    p.period === null ||
    p.timezone === null ||
    p.hour === null ||
    p.minute === null ||
    p.firstScheduledFor === null ||
    p.maxLatenessMinutes === null ||
    p.pendingPreviewLimit === null ||
    p.compensation.type === null ||
    p.compensation.maxOccurrences === null
  )
    return "POLICY_INCOMPLETE";
  if (
    p.period === "last_complete_sat_fri_week"
      ? p.weekday === null ||
        p.monthDay !== null ||
        p.monthlyNotBeforeDay !== null
      : p.period === "previous_month"
        ? p.monthDay === null ||
          p.monthlyNotBeforeDay === null ||
          p.weekday !== null ||
          p.monthDay < p.monthlyNotBeforeDay
        : p.weekday !== null ||
          p.monthDay !== null ||
          p.monthlyNotBeforeDay !== null
  )
    return "POLICY_INCONSISTENT";
  if (
    p.compensation.type === "none"
      ? p.compensation.maxOccurrences !== 0
      : p.compensation.maxOccurrences < 1
  )
    return "COMPENSATION_POLICY_INCONSISTENT";
  const d = local(p, p.firstScheduledFor);
  if (
    d.getUTCSeconds() ||
    d.getUTCMilliseconds() ||
    d.getUTCHours() !== p.hour ||
    d.getUTCMinutes() !== p.minute ||
    (p.period === "last_complete_sat_fri_week" &&
      (d.getUTCDay() || 7) !== p.weekday) ||
    (p.period === "previous_month" && d.getUTCDate() !== p.monthDay)
  )
    return "INITIAL_OCCURRENCE_NOT_ON_POLICY";
  return null;
}
export function nextSaihuReportOccurrence(
  policy: SaihuReportSchedulePolicy,
  after: number
): number {
  const reason = saihuSchedulePolicyReason(policy);
  if (reason) throw new Error(reason);
  const d = local(policy, after),
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    offset = policy.timezone === "Asia/Shanghai" ? 8 * 3600000 : 0;
  for (let i = 0; i < 63; i++) {
    const day = new Date(start + i * DAY),
      at =
        day.getTime() -
        offset +
        policy.hour! * 3600000 +
        policy.minute! * 60000;
    if (
      at > after &&
      (policy.period === "last_complete_sat_fri_week"
        ? (day.getUTCDay() || 7) === policy.weekday
        : policy.period === "previous_month"
          ? day.getUTCDate() === policy.monthDay
          : true)
    )
      return timestamp.parse(at);
  }
  throw new Error("OCCURRENCE_UNAVAILABLE");
}
export function saihuScheduleCursorReason(
  policy: SaihuReportSchedulePolicy,
  at: number
): string | null {
  const reason = saihuSchedulePolicyReason(policy);
  if (reason) return reason;
  const d = local(policy, at);
  return d.getUTCSeconds() ||
    d.getUTCMilliseconds() ||
    d.getUTCHours() !== policy.hour ||
    d.getUTCMinutes() !== policy.minute ||
    (policy.period === "last_complete_sat_fri_week" &&
      (d.getUTCDay() || 7) !== policy.weekday) ||
    (policy.period === "previous_month" && d.getUTCDate() !== policy.monthDay)
    ? "CURRENT_OCCURRENCE_NOT_ON_POLICY"
    : null;
}
/** Stable across edits. A revision must not mint a replacement UUID for a slot. */
export function saihuReportOccurrenceId(
  workspaceId: number,
  planId: string,
  scheduledFor: number
): string {
  const h = saihuReportHash({
    version: 1,
    workspaceId: SaihuReportId.parse(workspaceId),
    planId: SaihuReportUuid.parse(planId),
    scheduledFor: timestamp.parse(scheduledFor),
  });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function saihuReportOccurrence(
  identity: z.infer<typeof SaihuReportIdentitySchema>,
  planId: string,
  policy: SaihuReportSchedulePolicy,
  scheduledFor: number
) {
  const reason = saihuScheduleCursorReason(policy, scheduledFor);
  if (reason) throw new Error(reason);
  const d = local(policy, scheduledFor),
    current = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let scopeValue: z.infer<typeof SaihuReportScopeSchema>;
  if (policy.period === "previous_month") {
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    scopeValue = { kind: "monthly", start: month, end: month };
  } else {
    const end =
      current -
      (policy.period === "previous_day"
        ? 1
        : (d.getUTCDay() - 5 + 7) % 7 || 7) *
        DAY;
    scopeValue = {
      kind: "daily",
      start: new Date(end - (policy.period === "previous_day" ? 0 : 6) * DAY)
        .toISOString()
        .slice(0, 10),
      end: new Date(end).toISOString().slice(0, 10),
    };
  }
  return SaihuReportScheduleOccurrenceSchema.parse({
    scheduledFor,
    operationId: saihuReportOccurrenceId(
      identity.workspaceId,
      planId,
      scheduledFor
    ),
    scope: scopeValue,
  });
}
export function saihuScheduleDueReason(
  policy: SaihuReportSchedulePolicy,
  at: number,
  now: number
): string | null {
  const reason = saihuSchedulePolicyReason(policy);
  if (reason) return reason;
  if (at > now) return "NOT_DUE";
  if (now - at <= policy.maxLatenessMinutes! * 60000) return null;
  if (policy.compensation.type !== "bounded")
    return "MISSED_OCCURRENCE_REVIEW_REQUIRED";
  let n = 0,
    cursor = at;
  while (cursor <= now) {
    if (++n > policy.compensation.maxOccurrences!)
      return "COMPENSATION_LIMIT_REVIEW_REQUIRED";
    cursor = nextSaihuReportOccurrence(policy, cursor);
  }
  return null;
}
