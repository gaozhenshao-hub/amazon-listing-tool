import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { opsSaihuDailyReportBatches } from "../../../drizzle/schema/saihuReport";
import { assertAssistantRuleConfirmationJournalSchema } from "../ai_os/repositories/assistantRuleConfirmationJournal";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  strictMonthlyFinancialDirectory,
  type MonthlyFinancialWriteSession,
} from "./monthlyFinancialWriteRepository";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  SaihuReportIdentitySchema,
  saihuReportCanonical,
  type SaihuReportIdentity,
} from "../../../shared/saihuReportSync";
import { saihuReportFail } from "./saihuReportContract";

export type SaihuReportExecutor = DbExecutor;
export const saihuReportStatement = (
  text: string,
  values: unknown[] = []
): SQL => {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) return saihuReportFail("SQL_INVALID");
  return sql.join(
    parts.flatMap((part, i) =>
      i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]
    ),
    sql.raw("")
  );
};
export async function saihuReportRows(
  tx: SaihuReportExecutor,
  text: string,
  values: unknown[] = [],
  limit = 201
): Promise<Record<string, unknown>[]> {
  const result = await tx.execute(saihuReportStatement(text, values));
  if (
    !Array.isArray(result) ||
    !Array.isArray(result[0]) ||
    result[0].length > limit ||
    result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))
  )
    return saihuReportFail("READ_INVALID");
  return result[0];
}
export async function saihuReportWrite(
  tx: SaihuReportExecutor,
  text: string,
  values: unknown[]
): Promise<number | null> {
  const packet = await saihuReportRows(
    tx,
    "SELECT @@max_allowed_packet AS maximumPacket",
    [],
    1
  );
  if (
    packet.length !== 1 ||
    !Number.isSafeInteger(Number(packet[0].maximumPacket)) ||
    Number(packet[0].maximumPacket) <
      4096 +
        Buffer.byteLength(text) +
        values.reduce<number>(
          (sum, value) =>
            sum + (typeof value === "string" ? Buffer.byteLength(value) : 64),
          0
        )
  )
    return saihuReportFail("PACKET_LIMIT");
  const result = await tx.execute(saihuReportStatement(text, values));
  if (
    !Array.isArray(result) ||
    !result[0] ||
    result[0].affectedRows !== 1 ||
    result[0].warningStatus !== 0
  )
    return saihuReportFail("WRITE_UNCONFIRMED");
  return typeof result[0].insertId === "number" && result[0].insertId > 0
    ? result[0].insertId
    : null;
}
export function saihuReportJson(
  value: unknown,
  maximum = 24 * 1024 * 1024
): unknown {
  try {
    const text =
      typeof value === "string" ? value : saihuReportCanonical(value);
    if (Buffer.byteLength(text) > maximum)
      return saihuReportFail("SOURCE_BUDGET");
    return JSON.parse(text);
  } catch {
    return saihuReportFail("SOURCE_INVALID");
  }
}
export async function authorizeSaihuReport(
  tx: SaihuReportExecutor,
  raw: SaihuReportIdentity,
  action: "read" | "create" | "update" | "delete",
  permission = assertResourceAction,
  scopedReader = false
): Promise<MonthlyFinancialWriteSession> {
  const identity = SaihuReportIdentitySchema.parse(raw),
    spaces = await saihuReportRows(
      tx,
      "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE",
      [identity.workspaceId],
      1
    ),
    users = await saihuReportRows(
      tx,
      "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE",
      [identity.userId],
      1
    ),
    actor = users[0],
    members = await saihuReportRows(
      tx,
      "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE",
      [identity.workspaceId, identity.userId],
      2
    );
  if (
    spaces.length !== 1 ||
    spaces[0].id !== identity.workspaceId ||
    spaces[0].status !== "active" ||
    users.length !== 1 ||
    actor.id !== identity.userId ||
    actor.defaultWorkspaceId !== identity.workspaceId ||
    actor.status !== "active" ||
    typeof actor.role !== "string" ||
    (!["super_admin", "admin", "ops_manager"].includes(actor.role) &&
      !(scopedReader && action === "read")) ||
    members.length !== 1 ||
    typeof members[0].id !== "number" ||
    members[0].workspaceId !== identity.workspaceId ||
    members[0].userId !== identity.userId ||
    members[0].status !== "active"
  )
    return saihuReportFail("ACCESS_DENIED");
  const current = {
    tx,
    identity,
    actor: {
      id: identity.userId,
      role: actor.role,
      defaultWorkspaceId: identity.workspaceId,
    },
    role: actor.role,
  };
  await strictMonthlyFinancialDirectory(
    tx,
    actor.role,
    identity.workspaceId,
    action === "delete" ? "delete" : action === "read" ? "read" : "edit"
  );
  const common = {
    actor: current.actor,
    workspaceId: identity.workspaceId,
    authorizationRead: {
      executor: tx,
      strict: true as const,
      lock: true as const,
    },
  };
  await permission({ ...common, resource: "ops_data", action: "read" });
  if (action !== "read")
    await permission({
      ...common,
      resource: "ops_data",
      action:
        action === "create"
          ? "sync"
          : action === "update"
            ? "import"
            : "update",
    });
  return current;
}
/** Full physical shape admission of only this dedicated protocol. No DDL. */
export async function assertSaihuReportSchema(
  tx: SaihuReportExecutor,
  daily = true
) {
  const writes = [
      aiJobs,
      aiArtifacts,
      ...(daily ? [opsSaihuDailyReportBatches] : []),
    ] as AnyMySqlTable[],
    names = [
      ...writes.map(table => getTableConfig(table).name),
      "users",
      "workspaces",
      "workspace_memberships",
      "role_permissions",
      "security_access_policies",
      "security_audit_logs",
    ];
  const tables = await saihuReportRows(
    tx,
    `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`,
    names,
    names.length + 1
  );
  if (
    tables.length !== names.length ||
    new Set(tables.map(row => row.name)).size !== names.length ||
    tables.some(
      row => !names.includes(String(row.name)) || row.engine !== "InnoDB"
    )
  )
    return saihuReportFail("SCHEMA_UNAVAILABLE");
  for (const table of writes) {
    const config = getTableConfig(table),
      columns = await saihuReportRows(
        tx,
        "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        [config.name],
        200
      ),
      normalize = (value: string) =>
        value
          .toLowerCase()
          .replace(/int\(\d+\)/gu, "int")
          .replace(/,\s+/gu, ",");
    if (
      columns.length !== config.columns.length ||
      new Set(columns.map(row => row.name)).size !== columns.length
    )
      return saihuReportFail("SCHEMA_UNAVAILABLE");
    for (const expected of config.columns) {
      const actual = columns.find(row => row.name === expected.name);
      if (
        !actual ||
        typeof actual.columnType !== "string" ||
        normalize(actual.columnType) !== normalize(expected.getSQLType()) ||
        actual.nullable !== (expected.notNull ? "NO" : "YES") ||
        typeof actual.extra !== "string" ||
        /(?:virtual|stored)\s+generated/iu.test(actual.extra) ||
        (expected.name === "id" && actual.extra !== "auto_increment") ||
        (!["id", "createdAt", "updatedAt"].includes(expected.name) &&
          actual.extra !== "")
      )
        return saihuReportFail("SCHEMA_UNAVAILABLE");
    }
    const indexes = await saihuReportRows(
        tx,
        "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX",
        [config.name],
        256
      ),
      groups = new Map<string, Record<string, unknown>[]>();
    for (const row of indexes) {
      if (
        typeof row.name !== "string" ||
        ![0, 1].includes(Number(row.nonUnique)) ||
        row.subPart !== null
      )
        return saihuReportFail("SCHEMA_UNAVAILABLE");
      groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
    }
    const expectedKeys = [
        "id",
        config.name === "ai_jobs"
          ? "runId"
          : config.name === "ai_artifacts"
            ? "artifactId"
            : "run_id",
      ],
      keys = [...groups.values()]
        .filter(group => Number(group[0].nonUnique) === 0)
        .map(group => {
          if (
            group.some(
              (row, i) =>
                Number(row.sequence) !== i + 1 || Number(row.nonUnique) !== 0
            )
          )
            return saihuReportFail("SCHEMA_UNAVAILABLE");
          return group.map(row => row.columnName).join(",");
        });
    if (
      keys.length !== expectedKeys.length ||
      expectedKeys.some(key => !keys.includes(key))
    )
      return saihuReportFail("SCHEMA_UNAVAILABLE");
  }
  await assertAssistantRuleConfirmationJournalSchema(tx);
  if (
    (
      await saihuReportRows(
        tx,
        `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (${[...writes.map(table => getTableConfig(table).name), "security_audit_logs"].map(() => "?").join(",")}) LIMIT 1`,
        [
          ...writes.map(table => getTableConfig(table).name),
          "security_audit_logs",
        ],
        1
      )
    ).length
  )
    return saihuReportFail("SCHEMA_UNAVAILABLE");
}
