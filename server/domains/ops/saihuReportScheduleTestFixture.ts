import { MySqlDialect, getTableConfig } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { opsSaihuReportSchedules } from "../../../drizzle/schema/saihuReportSchedule";
import {
  createSaihuReportTestFixture,
  fixtureUuid,
} from "./saihuReportTestFixture";
import { createSaihuReportScheduleRepository } from "./saihuReportScheduleRepository";
import type { SaihuReportSchedulePolicy } from "../../../shared/saihuReportSchedule";

type Row = Record<string, unknown>;
export const schedulePolicy = (): SaihuReportSchedulePolicy => ({
  period: "previous_day",
  timezone: "Asia/Shanghai",
  hour: 9,
  minute: 0,
  weekday: null,
  monthDay: null,
  monthlyNotBeforeDay: null,
  firstScheduledFor: Date.parse("2026-10-17T01:00:00Z"),
  maxLatenessMinutes: 60,
  compensation: { type: "none", maxOccurrences: 0 },
  pendingPreviewLimit: 2,
});
/** Extends the real capture SQL fixture; its original transaction snapshots
 * include schedules, so rollback and lost-COMMIT-ACK semantics remain atomic. */
export function createSaihuReportScheduleTestFixture() {
  const f = createSaihuReportTestFixture(),
    state = Object.assign(f.state, { schedules: [] as Row[] }),
    control = {
      schedulerEnabled: true,
      rolloutWorkspaceId: 7 as number | null,
      constraints: [{ type: "PRIMARY KEY", name: "PRIMARY" }],
    },
    name = "ops_saihu_report_schedules";
  f.control.now = Date.parse("2026-10-17T01:15:00Z");
  f.cols[name] = getTableConfig(opsSaihuReportSchedules).columns.map(c => ({
    name: c.name,
    columnName: c.name,
    columnType: c.getSQLType(),
    dataType: c.getSQLType().split("(")[0],
    nullable: c.notNull ? "NO" : "YES",
    extra: "",
    defaultValue: null,
    generationExpression: "",
    collation: /^(?:char|varchar)/u.test(c.getSQLType())
      ? "utf8mb4_unicode_ci"
      : null,
  }));
  const keys = [
    { name: "PRIMARY", cols: ["plan_id"], nonUnique: 0 },
    {
      name: "ops_saihu_report_plan_owner_idx",
      cols: ["workspace_id", "user_id", "plan_id"],
      nonUnique: 1,
    },
    {
      name: "ops_saihu_report_plan_due_idx",
      cols: ["status", "next_run_at", "workspace_id", "plan_id"],
      nonUnique: 1,
    },
  ];
  for (const key of keys)
    f.indexes.push(
      ...key.cols.map((columnName, i) => ({
        tableName: name,
        name: key.name,
        indexName: key.name,
        columnName,
        sequence: i + 1,
        nonUnique: key.nonUnique,
        subPart: null,
        prefixLength: null,
      }))
    );
  const original = f.tx.execute.bind(f.tx),
    dialect = new MySqlDialect();
  f.tx.execute = async (statement: SQL) => {
    const q = dialect.sqlToQuery(statement),
      p = q.params,
      sql = q.sql,
      result = (rows: Row[]) => [structuredClone(rows), []],
      write = () => [{ affectedRows: 1, warningStatus: 0, insertId: 0 }, []];
    if (sql.includes("FROM ops_saihu_report_schedules")) {
      f.calls.push(q);
      if (sql.includes("WHERE workspace_id=?"))
        return result(
          state.schedules
            .filter(
              row =>
                row.workspaceId === p[0] &&
                row.userId === p[1] &&
                (p.length < 4 || String(row.planId) > String(p[2]))
            )
            .sort((a, b) => String(a.planId).localeCompare(String(b.planId)))
            .slice(0, Number(p.at(-1)))
        );
      return result(state.schedules.filter(row => row.planId === p[0]));
    }
    if (sql.includes("information_schema.TABLE_CONSTRAINTS") && p[0] === name) {
      f.calls.push(q);
      return result(control.constraints);
    }
    if (sql.startsWith("INSERT INTO ops_saihu_report_schedules")) {
      f.calls.push(q);
      if (state.schedules.some(row => row.planId === p[0]))
        throw new Error("synthetic duplicate plan");
      state.schedules.push({
        planId: p[0],
        workspaceId: p[1],
        userId: p[2],
        revision: p[3],
        status: p[4],
        nextRunAt: p[5],
        body: p[6],
        bodyHash: p[7],
      });
      return write();
    }
    if (sql.startsWith("UPDATE ops_saihu_report_schedules")) {
      f.calls.push(q);
      const row = state.schedules.find(
        row =>
          row.planId === p[5] &&
          row.workspaceId === p[6] &&
          row.userId === p[7] &&
          row.revision === p[8] &&
          row.bodyHash === p[9]
      );
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, {
        revision: p[0],
        status: p[1],
        nextRunAt: p[2],
        body: p[3],
        bodyHash: p[4],
      });
      return write();
    }
    if (
      sql.startsWith("INSERT INTO security_audit_logs") &&
      sql.includes("'ops.saihu_report.schedule'")
    ) {
      f.calls.push(q);
      if (f.control.failAudit) throw new Error("synthetic audit failure");
      state.audits.push({
        auditId: p[0],
        workspaceId: p[1],
        actorUserId: p[2],
        actorRole: p[3],
        action: "ops.saihu_report.schedule",
        resourceType: "ops_saihu_report_schedule",
        resourceId: p[4],
        status: "success",
        metadata: p[5],
      });
      return write();
    }
    const output = await original(statement);
    if (sql.startsWith("INSERT INTO ai_artifacts"))
      state.artifacts.at(-1)!.artifactType = "json";
    return output;
  };
  const repository = createSaihuReportScheduleRepository({
    capture: f.repository,
    configuration: f.configuration,
    now: () => f.control.now,
    enabled: () => control.schedulerEnabled,
    rolloutWorkspaceId: () => control.rolloutWorkspaceId,
  });
  const planId = fixtureUuid(100),
    base = { expectedWorkspaceId: 7, planId };
  async function save(
    policy = schedulePolicy(),
    target?: {
      kind: "daily" | "monthly";
      shops: Array<{ shopId: string; storeName: string; country: string }>;
      configurationHash: string;
    } | null
  ) {
    const source =
        target === undefined
          ? await repository.sourceOptions(f.identity, {
              expectedWorkspaceId: 7,
              kind: policy.period === "previous_month" ? "monthly" : "daily",
            })
          : { target },
      previous = await repository.read(f.identity, base);
    await repository.save(f.identity, {
      ...base,
      operationId: fixtureUuid(101 + (previous?.revision ?? 0)),
      expectedVersionHash: previous?.versionHash ?? null,
      policy,
      target: source.target,
    });
    return (await repository.read(f.identity, base))!;
  }
  async function activate() {
    const preview = await repository.activationPreview(f.identity, base);
    await repository.activate(f.identity, {
      ...base,
      operationId: fixtureUuid(200 + preview.plan.revision),
      expectedVersionHash: preview.plan.versionHash,
      expectedActivationHash: preview.activationHash,
      confirmFullScope: true,
      confirmNextOccurrence: true,
    });
    return (await repository.read(f.identity, base))!;
  }
  return {
    ...f,
    state,
    scheduleControl: control,
    schedules: repository,
    planId,
    base,
    save,
    activate,
  };
}
