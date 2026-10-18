import { z } from "zod";
import {
  SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY,
  SaihuReportScheduleOccurrenceSchema,
  SaihuReportScheduleViewSchema,
  saihuReportOccurrence,
  saihuScheduleDueReason,
} from "../../../shared/saihuReportSchedule";
import {
  SaihuReportIdentitySchema,
  SaihuReportStartInputSchema,
  SaihuReportReceiptSchema,
  SaihuReportHash,
  saihuReportHash,
  type SaihuReportReceipt,
} from "../../../shared/saihuReportSync";
import type { readSaihuReportRun } from "./saihuReportProtocol";
import { saihuReportFail } from "./saihuReportContract";
import {
  saihuReportJson,
  saihuReportRows,
  type SaihuReportExecutor,
} from "./saihuReportStore";

export const SAIHU_SCHEDULE_PROCEDURE = "opsSaihuSchedule.occurrence";
export const SaihuReportFrozenScheduleSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    plan: SaihuReportScheduleViewSchema,
    occurrence: SaihuReportScheduleOccurrenceSchema,
    activationHash: SaihuReportHash,
    request: SaihuReportStartInputSchema,
    receipt: SaihuReportReceiptSchema,
  })
  .strict();

/** The original scheduled occurrence is immutable. A changed/paused plan is
 * not used to reinterpret a job already in the queue. C1 jobs with a sidecar
 * are verified too; unmarked v1 manual inputs remain byte/hash compatible. */
export async function assertSaihuFrozenScheduleDispatch(
  tx: SaihuReportExecutor,
  run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>,
  now: number,
  startReceipt: SaihuReportReceipt | null
) {
  const { identity, operationId } = run.input;
  const artifactId = `saihuo_${saihuReportHash({ identity, operationId })}`;
  const rows = await saihuReportRows(
    tx,
    "SELECT artifactId,workspaceId,userId,projectId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,status,isCurrent,version,IF(OCTET_LENGTH(CAST(contentJson AS CHAR CHARACTER SET utf8mb4))<=65536,CAST(contentJson AS CHAR CHARACTER SET utf8mb4),NULL) AS contentJson,contentHash FROM ai_artifacts WHERE artifactId=? LIMIT 2 FOR SHARE",
    [artifactId],
    2
  );
  if (!rows.length && run.procedure === "opsSaihuReport.start") return;
  if (rows.length !== 1) saihuReportFail("SCHEDULE_BINDING_REQUIRED");
  const row = rows[0];
  if (
    row.artifactId !== artifactId ||
    row.workspaceId !== identity.workspaceId ||
    row.userId !== identity.userId ||
    row.projectId !== null ||
    row.domain !== "ops" ||
    row.artifactKey !== SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY ||
    row.artifactType !== "json" ||
    row.sourceType !== "tool_output" ||
    row.sourceTable !== "ai_jobs" ||
    row.sourceRowId !== String(run.id) ||
    row.runId !== run.runId ||
    row.status !== "final" ||
    row.isCurrent !== 0 ||
    row.version !== 1
  )
    saihuReportFail("SCHEDULE_BINDING_INVALID");
  const value = saihuReportJson(row.contentJson, 65536);
  if (saihuReportHash(value) !== row.contentHash)
    saihuReportFail("SCHEDULE_BINDING_INVALID");
  const parsed = SaihuReportFrozenScheduleSchema.safeParse(value);
  if (!parsed.success) saihuReportFail("SCHEDULE_BINDING_INVALID");
  const binding = parsed.data;
  const { versionHash, ...record } = binding.plan;
  if (
    versionHash !== saihuReportHash(record) ||
    binding.plan.status !== "active" ||
    binding.plan.reasonCode !== null ||
    saihuReportHash(binding.identity) !== saihuReportHash(identity) ||
    saihuReportHash(binding.plan.identity) !== saihuReportHash(identity) ||
    binding.plan.nextScheduledFor !== binding.occurrence.scheduledFor ||
    saihuReportHash(binding.request) !== saihuReportHash(run.input.request) ||
    !binding.plan.target ||
    binding.plan.target.kind !== binding.request.scope.kind ||
    binding.plan.target.configurationHash !==
      binding.request.expectedConfigurationHash ||
    saihuReportHash(binding.plan.target.shops) !==
      saihuReportHash(run.input.contract.shops) ||
    !startReceipt ||
    startReceipt.status !== "committed" ||
    startReceipt.action !== "start" ||
    startReceipt.resultHash !== saihuReportHash(run.input) ||
    startReceipt.requestHash !== run.input.requestHash ||
    saihuReportHash(binding.receipt) !== saihuReportHash(startReceipt)
  )
    saihuReportFail("SCHEDULE_BINDING_INVALID");
  let expected: z.infer<typeof SaihuReportScheduleOccurrenceSchema>;
  try {
    expected = saihuReportOccurrence(
      identity,
      binding.plan.planId,
      binding.plan.policy,
      binding.occurrence.scheduledFor
    );
  } catch {
    return saihuReportFail("SCHEDULE_BINDING_INVALID");
  }
  if (
    saihuReportHash(expected) !== saihuReportHash(binding.occurrence) ||
    expected.operationId !== operationId ||
    saihuReportHash(expected.scope) !==
      saihuReportHash(binding.request.scope) ||
    binding.activationHash !==
      saihuReportHash({
        plan: binding.plan,
        next: expected,
        available: true,
        reasonCode: null,
        autoApply: false,
        schedulingEnabled: true,
      })
  )
    saihuReportFail("SCHEDULE_BINDING_INVALID");
  const due = saihuScheduleDueReason(
    binding.plan.policy,
    expected.scheduledFor,
    now
  );
  if (due) saihuReportFail(due === "NOT_DUE" ? "SCHEDULE_NOT_DUE" : due);
}
