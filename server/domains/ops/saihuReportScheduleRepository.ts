import { z } from "zod";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { opsSaihuReportSchedules } from "../../../drizzle/schema/saihuReportSchedule";
import {
  SaihuReportScheduleRecordSchema,
  SaihuReportScheduleViewSchema,
  SaihuReportScheduleSaveInputSchema,
  SaihuReportSchedulePauseInputSchema,
  SaihuReportScheduleActivateInputSchema,
  SaihuReportScheduleReadInputSchema,
  SaihuReportScheduleOperationSchema,
  SaihuReportScheduleReceiptSchema,
  SaihuReportScheduleActivationSchema,
  SaihuReportScheduleSourceInputSchema,
  SaihuReportScheduleSourceSchema,
  saihuSchedulePolicyReason,
  saihuScheduleCursorReason,
  nextSaihuReportOccurrence,
  saihuReportOccurrence,
  saihuScheduleDueReason,
  type SaihuReportScheduleRecord,
  type SaihuReportScheduleView,
  SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY,
  SaihuReportScheduleListInputSchema,
} from "../../../shared/saihuReportSchedule";
import {
  SaihuReportIdentitySchema,
  saihuReportHash,
  saihuReportCanonical,
  type SaihuReportIdentity,
} from "../../../shared/saihuReportSync";
import { saihuReportRepository } from "./saihuReportRepository";
import {
  saihuReportConfiguration,
  saihuReportFail,
  SaihuReportError,
} from "./saihuReportContract";
import {
  saihuReportRows,
  saihuReportWrite,
  saihuReportJson,
} from "./saihuReportStore";
import { readSaihuReportRun } from "./saihuReportProtocol";
import type { MonthlyFinancialWriteSession } from "./monthlyFinancialWriteRepository";
import type { DbExecutor } from "../../repositories/dbClient";

type Receipt = z.infer<typeof SaihuReportScheduleReceiptSchema>;
type Operation = z.infer<typeof SaihuReportScheduleOperationSchema>;
const wire = (value: unknown) => {
  const text = saihuReportCanonical(value);
  if (Buffer.byteLength(text) > 65536)
    saihuReportFail("SCHEDULE_METADATA_BUDGET");
  return text;
};

/** Admission only: never creates/seeds/updates a physical schema. */
export async function assertSaihuReportScheduleSchema(tx: DbExecutor) {
  const name = "ops_saihu_report_schedules",
    tables = await saihuReportRows(
      tx,
      "SELECT ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
      [name],
      1
    );
  if (
    tables.length !== 1 ||
    tables[0].engine !== "InnoDB" ||
    tables[0].collation !== "utf8mb4_unicode_ci"
  )
    saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
  const columns = await saihuReportRows(
      tx,
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra,COLUMN_DEFAULT AS defaultValue,GENERATION_EXPRESSION AS generationExpression,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
      [name],
      32
    ),
    expected = getTableConfig(opsSaihuReportSchedules).columns;
  const normalize = (v: string) =>
    v.toLowerCase().replace(/int\(\d+\)/gu, "int");
  if (
    columns.length !== expected.length ||
    new Set(columns.map(v => v.name)).size !== expected.length
  )
    saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
  for (const c of expected) {
    const actual = columns.find(v => v.name === c.name);
    if (
      !actual ||
      typeof actual.columnType !== "string" ||
      normalize(actual.columnType) !== normalize(c.getSQLType()) ||
      actual.nullable !== (c.notNull ? "NO" : "YES") ||
      actual.extra !== "" ||
      actual.defaultValue !== null ||
      actual.generationExpression !== "" ||
      actual.collation !==
        (/^(?:char|varchar)/u.test(c.getSQLType())
          ? "utf8mb4_unicode_ci"
          : null)
    )
      saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
  }
  const indexes = await saihuReportRows(
      tx,
      "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX",
      [name],
      32
    ),
    groups = new Map<string, typeof indexes>();
  for (const row of indexes) {
    if (
      typeof row.name !== "string" ||
      row.subPart !== null ||
      ![0, 1].includes(Number(row.nonUnique))
    )
      saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
    groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
  }
  const required = [
    { cols: ["plan_id"], unique: 0 },
    { cols: ["workspace_id", "user_id", "plan_id"], unique: 1 },
    { cols: ["status", "next_run_at", "workspace_id", "plan_id"], unique: 1 },
  ];
  if (
    groups.size !== required.length ||
    required.some(
      key =>
        ![...groups.values()].some(
          rows =>
            rows.length === key.cols.length &&
            rows.every(
              (r, i) =>
                r.columnName === key.cols[i] &&
                Number(r.sequence) === i + 1 &&
                Number(r.nonUnique) === key.unique
            )
        )
    )
  )
    saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
  if (
    (
      await saihuReportRows(
        tx,
        "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=?",
        [name],
        1
      )
    ).length
  )
    saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
  const constraints = await saihuReportRows(
    tx,
    "SELECT CONSTRAINT_TYPE AS type,CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [name],
    8
  );
  if (
    constraints.length !== 1 ||
    constraints[0].type !== "PRIMARY KEY" ||
    constraints[0].name !== "PRIMARY"
  )
    saihuReportFail("SCHEDULE_SCHEMA_UNAVAILABLE");
}

export function createSaihuReportScheduleRepository(
  deps: {
    capture?: typeof saihuReportRepository;
    configuration?: typeof saihuReportConfiguration;
    schema?: typeof assertSaihuReportScheduleSchema;
    now?: () => number;
    enabled?: () => boolean;
    rolloutWorkspaceId?: () => number | null;
  } = {}
) {
  const capture = deps.capture ?? saihuReportRepository,
    configuration = deps.configuration ?? saihuReportConfiguration,
    schema = deps.schema ?? assertSaihuReportScheduleSchema,
    now = deps.now ?? Date.now,
    enabled =
      deps.enabled ??
      (() => process.env.ENABLE_SAIHU_REPORT_SCHEDULER === "true"),
    rolloutWorkspaceId =
      deps.rolloutWorkspaceId ??
      (() => {
        const raw = process.env.SAIHU_REPORT_SCHEDULE_WORKSPACE_ID;
        return raw &&
          /^[1-9][0-9]*$/u.test(raw) &&
          Number.isSafeInteger(Number(raw))
          ? Number(raw)
          : null;
      });
  async function transaction<T>(
    identity: SaihuReportIdentity,
    action: "read" | "create" | "update",
    body: (current: MonthlyFinancialWriteSession) => Promise<T>
  ) {
    return capture.server.withTransaction(
      SaihuReportIdentitySchema.parse(identity),
      action,
      async current => {
        await schema(current.tx);
        return body(current);
      }
    );
  }
  function scope(identity: SaihuReportIdentity, expected: number) {
    if (identity.workspaceId !== expected) saihuReportFail("WORKSPACE_CHANGED");
  }
  function writes() {
    if (!capture.server.writesEnabled()) saihuReportFail("WRITES_NOT_ENABLED");
  }
  const view = (record: SaihuReportScheduleRecord) =>
    SaihuReportScheduleViewSchema.parse({
      ...record,
      versionHash: saihuReportHash(record),
    });
  async function load(
    current: MonthlyFinancialWriteSession,
    planId: string
  ): Promise<SaihuReportScheduleView | null> {
    const rows = await saihuReportRows(
      current.tx,
      "SELECT plan_id AS planId,workspace_id AS workspaceId,user_id AS userId,revision,status,next_run_at AS nextRunAt,IF(OCTET_LENGTH(CAST(body AS CHAR CHARACTER SET utf8mb4))<=65536,CAST(body AS CHAR CHARACTER SET utf8mb4),NULL) AS body,body_hash AS bodyHash FROM ops_saihu_report_schedules WHERE plan_id=? LIMIT 2 FOR UPDATE",
      [planId],
      2
    );
    if (!rows.length) return null;
    if (
      rows.length !== 1 ||
      rows[0].planId !== planId ||
      rows[0].workspaceId !== current.identity.workspaceId ||
      rows[0].userId !== current.identity.userId
    )
      saihuReportFail("SCHEDULE_SCOPE_DENIED");
    const row = rows[0],
      record = SaihuReportScheduleRecordSchema.parse(
        saihuReportJson(row.body, 65536)
      );
    if (
      record.planId !== planId ||
      saihuReportHash(record.identity) !== saihuReportHash(current.identity) ||
      record.revision !== row.revision ||
      record.status !== row.status ||
      record.nextScheduledFor !== row.nextRunAt ||
      saihuReportHash(record) !== row.bodyHash
    )
      saihuReportFail("SCHEDULE_RECORD_INVALID");
    return view(record);
  }
  async function persist(
    current: MonthlyFinancialWriteSession,
    record: SaihuReportScheduleRecord,
    previous: SaihuReportScheduleView | null
  ) {
    record = SaihuReportScheduleRecordSchema.parse(record);
    const hash = saihuReportHash(record);
    if (previous)
      await saihuReportWrite(
        current.tx,
        "UPDATE ops_saihu_report_schedules SET revision=?,status=?,next_run_at=?,body=?,body_hash=?,updated_at=CURRENT_TIMESTAMP(3) WHERE plan_id=? AND workspace_id=? AND user_id=? AND revision=? AND body_hash=?",
        [
          record.revision,
          record.status,
          record.nextScheduledFor,
          wire(record),
          hash,
          record.planId,
          current.identity.workspaceId,
          current.identity.userId,
          previous.revision,
          previous.versionHash,
        ]
      );
    else
      await saihuReportWrite(
        current.tx,
        "INSERT INTO ops_saihu_report_schedules (plan_id,workspace_id,user_id,revision,status,next_run_at,body,body_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))",
        [
          record.planId,
          current.identity.workspaceId,
          current.identity.userId,
          record.revision,
          record.status,
          record.nextScheduledFor,
          wire(record),
          hash,
        ]
      );
    const saved = await load(current, record.planId);
    if (!saved || saved.versionHash !== hash)
      saihuReportFail("ACK_UNVERIFIABLE");
    return saved;
  }
  async function journal(
    current: MonthlyFinancialWriteSession,
    input: Operation,
    receipt?: Receipt
  ): Promise<Receipt | null> {
    const auditId = `saihu_schedule_${saihuReportHash({ identity: current.identity, operationId: input.operationId })}`;
    const rows = await saihuReportRows(
      current.tx,
      "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadata FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR UPDATE",
      [auditId],
      2
    );
    if (rows.length) {
      const row = rows[0],
        parsed = SaihuReportScheduleReceiptSchema.parse(
          saihuReportJson(row.metadata, 32768)
        );
      if (
        rows.length !== 1 ||
        row.auditId !== auditId ||
        row.workspaceId !== current.identity.workspaceId ||
        row.actorUserId !== current.identity.userId ||
        row.action !== "ops.saihu_report.schedule" ||
        row.resourceType !== "ops_saihu_report_schedule" ||
        row.resourceId !== input.operationId ||
        row.status !== "success" ||
        parsed.planId !== input.planId ||
        parsed.operationId !== input.operationId ||
        parsed.action !== input.action ||
        saihuReportHash(parsed.identity) !==
          saihuReportHash(current.identity) ||
        (receipt && saihuReportHash(parsed) !== saihuReportHash(receipt))
      )
        saihuReportFail("SCHEDULE_OPERATION_CONFLICT");
      return parsed;
    }
    if (!receipt) return null;
    await saihuReportWrite(
      current.tx,
      "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,'ops.saihu_report.schedule','ops_saihu_report_schedule',?,'success','medium',?)",
      [
        auditId,
        current.identity.workspaceId,
        current.identity.userId,
        current.role,
        input.operationId,
        wire(receipt),
      ]
    );
    const saved = await journal(current, input);
    if (!saved || saihuReportHash(saved) !== saihuReportHash(receipt))
      saihuReportFail("ACK_UNVERIFIABLE");
    return saved;
  }
  async function sourceOptions(
    identity: SaihuReportIdentity,
    raw: z.infer<typeof SaihuReportScheduleSourceInputSchema>
  ) {
    const input = SaihuReportScheduleSourceInputSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", async current => {
      let target = null,
        reasonCode: string | null = null;
      try {
        const c = await configuration(
          current.tx,
          identity.workspaceId,
          input.kind
        );
        target = {
          kind: input.kind,
          shops: c.contract.shops,
          configurationHash: c.configurationHash,
        };
      } catch (error) {
        if (error instanceof SaihuReportError) reasonCode = error.code;
        else throw error;
      }
      return SaihuReportScheduleSourceSchema.parse({
        identity,
        target,
        reasonCode,
      });
    });
  }
  async function read(
    identity: SaihuReportIdentity,
    raw: z.infer<typeof SaihuReportScheduleReadInputSchema>
  ) {
    const input = SaihuReportScheduleReadInputSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", current =>
      load(current, input.planId)
    );
  }
  async function activation(
    current: MonthlyFinancialWriteSession,
    plan: SaihuReportScheduleView
  ) {
    let reasonCode = saihuSchedulePolicyReason(plan.policy),
      next = null;
    if (!reasonCode && plan.nextScheduledFor !== null)
      reasonCode = saihuScheduleCursorReason(
        plan.policy,
        plan.nextScheduledFor
      );
    if (!reasonCode && plan.nextScheduledFor !== null)
      next = saihuReportOccurrence(
        current.identity,
        plan.planId,
        plan.policy,
        plan.nextScheduledFor
      );
    if (!reasonCode && (!next || !plan.target))
      reasonCode = "INITIAL_SCOPE_INCOMPLETE";
    if (!reasonCode && next && plan.target) {
      try {
        const config = await configuration(
          current.tx,
          current.identity.workspaceId,
          next.scope.kind
        );
        if (
          plan.target.kind !== next.scope.kind ||
          plan.target.configurationHash !== config.configurationHash ||
          saihuReportHash(plan.target.shops) !==
            saihuReportHash(config.contract.shops)
        )
          reasonCode = "SCHEDULE_SOURCE_OR_SCOPE_CHANGED";
        const preview = await capture.server.previewInTransaction(
          current,
          next.scope
        );
        if (
          !reasonCode &&
          preview.capability.status !== "available" &&
          preview.capability.reasonCode !== "REPORT_PERIOD_NOT_CLOSED"
        )
          reasonCode = preview.capability.reasonCode;
      } catch (error) {
        if (error instanceof SaihuReportError) reasonCode = error.code;
        else throw error;
      }
    }
    if (!reasonCode && !capture.server.writesEnabled())
      reasonCode = "WRITES_NOT_ENABLED";
    if (!reasonCode && !enabled()) reasonCode = "SCHEDULER_NOT_ENABLED";
    if (!reasonCode && rolloutWorkspaceId() !== current.identity.workspaceId)
      reasonCode = "SCHEDULE_ROLLOUT_SCOPE_NOT_APPROVED";
    if (!reasonCode) {
      let pending = 0;
      for (const occurrence of plan.outstanding) {
        const run = await readSaihuReportRun(
          current.tx,
          current.identity,
          occurrence.operationId
        );
        if (!run) {
          reasonCode = "SCHEDULE_PRIOR_OCCURRENCE_UNVERIFIED";
          break;
        }
        if (
          run.output.state === "unknown" ||
          (run.output.state === "running" &&
            (typeof run.leaseUntil !== "number" || run.leaseUntil <= now()))
        ) {
          reasonCode = "CHECK_OR_CANCEL_ORIGINAL_OCCURRENCE";
          break;
        }
        if (
          !run.output.applied &&
          !run.output.revoked &&
          !["cancelled", "failed"].includes(run.output.state)
        )
          pending++;
      }
      if (!reasonCode && pending >= plan.policy.pendingPreviewLimit!)
        reasonCode = "PENDING_PREVIEW_LIMIT_REVIEW_REQUIRED";
    }
    const body = {
      plan,
      next,
      available: !reasonCode,
      reasonCode,
      autoApply: false as const,
      schedulingEnabled: enabled(),
    };
    return SaihuReportScheduleActivationSchema.parse({
      ...body,
      activationHash: saihuReportHash(body),
    });
  }
  async function activationPreview(
    identity: SaihuReportIdentity,
    raw: z.infer<typeof SaihuReportScheduleReadInputSchema>
  ) {
    const input = SaihuReportScheduleReadInputSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", async current => {
      const plan = await load(current, input.planId);
      if (!plan) saihuReportFail("SCHEDULE_NOT_FOUND");
      return activation(current, plan);
    });
  }
  async function mutate(
    identity: SaihuReportIdentity,
    raw: unknown,
    action: "save" | "pause" | "activate"
  ) {
    const input =
      action === "save"
        ? SaihuReportScheduleSaveInputSchema.parse(raw)
        : action === "pause"
          ? SaihuReportSchedulePauseInputSchema.parse(raw)
          : SaihuReportScheduleActivateInputSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    const op = {
        expectedWorkspaceId: input.expectedWorkspaceId,
        planId: input.planId,
        operationId: input.operationId,
        action,
      },
      requestHash = saihuReportHash({ identity, action, request: input });
    return transaction(
      identity,
      action === "pause" ? "update" : "create",
      async current => {
        const previousReceipt = await journal(current, op);
        if (previousReceipt) {
          if (
            previousReceipt.status !== "cancelled" &&
            previousReceipt.requestHash !== requestHash
          )
            saihuReportFail("SCHEDULE_OPERATION_CONFLICT");
          return previousReceipt;
        }
        if (action !== "pause") writes();
        const previous = await load(current, input.planId);
        if (
          (previous?.versionHash ?? null) !== input.expectedVersionHash ||
          (action !== "save" && !previous)
        )
          saihuReportFail("SCHEDULE_VERSION_CHANGED");
        let body: SaihuReportScheduleRecord;
        if ("policy" in input)
          body = {
            version: 1,
            identity,
            planId: input.planId,
            revision: (previous?.revision ?? 0) + 1,
            status: "paused",
            policy: input.policy,
            target: input.target,
            nextScheduledFor:
              previous &&
              previous.policy.firstScheduledFor ===
                input.policy.firstScheduledFor
                ? previous.nextScheduledFor
                : input.policy.firstScheduledFor,
            outstanding: previous?.outstanding ?? [],
            reasonCode: saihuSchedulePolicyReason(input.policy),
          };
        else {
          if (!previous) saihuReportFail("SCHEDULE_NOT_FOUND");
          const { versionHash: _hash, ...record } = previous;
          body = {
            ...record,
            revision: record.revision + 1,
            status: action === "pause" ? "paused" : "active",
            reasonCode: null,
          };
          if (action === "activate" && "expectedActivationHash" in input) {
            const preview = await activation(current, previous);
            if (
              !preview.available ||
              preview.activationHash !== input.expectedActivationHash
            )
              saihuReportFail(
                preview.reasonCode ?? "SCHEDULE_ACTIVATION_CHANGED"
              );
          }
        }
        const saved = await persist(current, body, previous);
        const receipt = await journal(current, op, {
          identity,
          planId: input.planId,
          operationId: input.operationId,
          action,
          status: "committed",
          requestHash,
          revision: saved.revision,
          versionHash: saved.versionHash,
        });
        if (!receipt) saihuReportFail("ACK_UNVERIFIABLE");
        return receipt;
      }
    );
  }
  async function check(identity: SaihuReportIdentity, raw: Operation) {
    const input = SaihuReportScheduleOperationSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", current => journal(current, input));
  }
  async function cancel(identity: SaihuReportIdentity, raw: Operation) {
    const input = SaihuReportScheduleOperationSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", async current => {
      const receipt =
        (await journal(current, input)) ??
        (await journal(current, input, {
          identity,
          planId: input.planId,
          operationId: input.operationId,
          action: input.action,
          status: "cancelled",
          requestHash: null,
          revision: null,
          versionHash: null,
        }));
      if (!receipt) saihuReportFail("ACK_UNVERIFIABLE");
      return receipt;
    });
  }
  async function enqueueDueOccurrence(
    identity: SaihuReportIdentity,
    planId: string
  ) {
    return transaction(identity, "create", async current => {
      writes();
      if (!enabled() || rolloutWorkspaceId() !== identity.workspaceId)
        saihuReportFail("SCHEDULER_NOT_ENABLED");
      const plan = await load(current, planId);
      if (!plan || plan.status !== "active")
        return { state: "not_active" as const, operationId: null };
      const attention = async (reason: string) => {
        const { versionHash: _hash, ...body } = plan;
        await persist(
          current,
          {
            ...body,
            revision: body.revision + 1,
            status: "attention",
            reasonCode: reason,
          },
          plan
        );
        return {
          state: "attention" as const,
          operationId: null,
          reasonCode: reason,
        };
      };
      const ready = await activation(current, plan);
      if (!ready.available || !ready.next)
        return attention(ready.reasonCode ?? "POLICY_INCOMPLETE");
      const due = saihuScheduleDueReason(
        plan.policy,
        ready.next.scheduledFor,
        now()
      );
      if (due === "NOT_DUE")
        return {
          state: "not_due" as const,
          operationId: ready.next.operationId,
        };
      if (due) return attention(due);
      const outstanding: typeof plan.outstanding = [];
      for (const occurrence of plan.outstanding) {
        const run = await readSaihuReportRun(
          current.tx,
          identity,
          occurrence.operationId
        );
        if (!run) return attention("SCHEDULE_PRIOR_OCCURRENCE_UNVERIFIED");
        if (
          run.output.state === "unknown" ||
          (run.output.state === "running" &&
            (typeof run.leaseUntil !== "number" || run.leaseUntil <= now()))
        )
          return attention("CHECK_OR_CANCEL_ORIGINAL_OCCURRENCE");
        if (
          !run.output.applied &&
          !run.output.revoked &&
          !["cancelled", "failed"].includes(run.output.state)
        )
          outstanding.push(occurrence);
      }
      if (outstanding.length >= plan.policy.pendingPreviewLimit!)
        return attention("PENDING_PREVIEW_LIMIT_REVIEW_REQUIRED");
      const preview = await capture.server.previewInTransaction(
        current,
        ready.next.scope
      );
      if (
        preview.capability.status !== "available" ||
        !preview.configurationHash
      )
        return attention(preview.capability.reasonCode ?? "SOURCE_UNAVAILABLE");
      const request = {
        expectedWorkspaceId: identity.workspaceId,
        operationId: ready.next.operationId,
        scope: ready.next.scope,
        expectedConfigurationHash: preview.configurationHash,
        expectedHistoryHash: preview.historyHash,
      };
      const receipt = await capture.server.startInTransaction(current, request);
      if (!receipt || receipt.status !== "committed")
        return attention("OCCURRENCE_CANCELLED_NO_REISSUE");
      const run = await readSaihuReportRun(
        current.tx,
        identity,
        ready.next.operationId
      );
      if (!run) saihuReportFail("ACK_UNVERIFIABLE");
      const binding = {
          version: 1,
          identity,
          plan,
          occurrence: ready.next,
          activationHash: ready.activationHash,
          request,
          receipt,
        },
        artifactId = `saihuo_${saihuReportHash({ identity, operationId: ready.next.operationId })}`,
        bindingHash = saihuReportHash(binding);
      await saihuReportWrite(
        current.tx,
        "INSERT INTO ai_artifacts (artifactId,workspaceId,userId,projectId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,status,isCurrent,version,contentJson,contentHash) VALUES (?,?,?,NULL,'ops',?,'json','tool_output','ai_jobs',?,?,'final',0,1,?,?)",
        [
          artifactId,
          identity.workspaceId,
          identity.userId,
          SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY,
          String(run.id),
          run.runId,
          wire(binding),
          bindingHash,
        ]
      );
      const bound = await saihuReportRows(
        current.tx,
        "SELECT artifactId,workspaceId,userId,projectId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,status,isCurrent,version,IF(OCTET_LENGTH(CAST(contentJson AS CHAR CHARACTER SET utf8mb4))<=65536,CAST(contentJson AS CHAR CHARACTER SET utf8mb4),NULL) AS contentJson,contentHash FROM ai_artifacts WHERE artifactId=? LIMIT 2 FOR SHARE",
        [artifactId],
        2
      );
      if (
        bound.length !== 1 ||
        bound[0].artifactId !== artifactId ||
        bound[0].workspaceId !== identity.workspaceId ||
        bound[0].userId !== identity.userId ||
        bound[0].projectId !== null ||
        bound[0].domain !== "ops" ||
        bound[0].artifactKey !== SAIHU_REPORT_SCHEDULE_OCCURRENCE_KEY ||
        bound[0].artifactType !== "json" ||
        bound[0].sourceType !== "tool_output" ||
        bound[0].sourceTable !== "ai_jobs" ||
        bound[0].sourceRowId !== String(run.id) ||
        bound[0].runId !== run.runId ||
        bound[0].status !== "final" ||
        bound[0].isCurrent !== 0 ||
        bound[0].version !== 1 ||
        bound[0].contentHash !== bindingHash ||
        saihuReportHash(saihuReportJson(bound[0].contentJson, 65536)) !==
          bindingHash
      )
        saihuReportFail("ACK_UNVERIFIABLE");
      const { versionHash: _hash, ...body } = plan;
      await persist(
        current,
        {
          ...body,
          revision: body.revision + 1,
          nextScheduledFor: nextSaihuReportOccurrence(
            plan.policy,
            ready.next.scheduledFor
          ),
          outstanding: [...outstanding, ready.next],
          reasonCode: null,
        },
        plan
      );
      return {
        state: "queued" as const,
        operationId: ready.next.operationId,
        scheduledFor: ready.next.scheduledFor,
        scope: ready.next.scope,
      };
    });
  }
  async function list(
    identity: SaihuReportIdentity,
    raw: z.infer<typeof SaihuReportScheduleListInputSchema>
  ) {
    const input = SaihuReportScheduleListInputSchema.parse(raw);
    scope(identity, input.expectedWorkspaceId);
    return transaction(identity, "read", async current => {
      const found = await saihuReportRows(
          current.tx,
          `SELECT plan_id AS planId FROM ops_saihu_report_schedules WHERE workspace_id=? AND user_id=?${input.cursor === null ? "" : " AND plan_id>?"} ORDER BY plan_id LIMIT ? FOR SHARE`,
          [
            identity.workspaceId,
            identity.userId,
            ...(input.cursor === null ? [] : [input.cursor]),
            input.limit + 1,
          ],
          input.limit + 1
        ),
        plans: SaihuReportScheduleView[] = [];
      for (const row of found.slice(0, input.limit)) {
        const id = SaihuReportScheduleReadInputSchema.shape.planId.parse(
            row.planId
          ),
          plan = await load(current, id);
        if (!plan) saihuReportFail("SCHEDULE_LIST_CHANGED");
        plans.push(plan);
      }
      return {
        identity,
        plans,
        nextCursor: found.length > input.limit ? plans.at(-1)!.planId : null,
      };
    });
  }
  return {
    list,
    sourceOptions,
    read,
    activationPreview,
    save: (
      identity: SaihuReportIdentity,
      input: z.infer<typeof SaihuReportScheduleSaveInputSchema>
    ) => mutate(identity, input, "save"),
    pause: (
      identity: SaihuReportIdentity,
      input: z.infer<typeof SaihuReportSchedulePauseInputSchema>
    ) => mutate(identity, input, "pause"),
    activate: (
      identity: SaihuReportIdentity,
      input: z.infer<typeof SaihuReportScheduleActivateInputSchema>
    ) => mutate(identity, input, "activate"),
    check,
    cancel,
    enqueueDueOccurrence,
  };
}
export const saihuReportScheduleRepository =
  createSaihuReportScheduleRepository();
