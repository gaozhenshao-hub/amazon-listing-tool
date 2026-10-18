import { sql, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { securityAuditLogs } from "../../../../drizzle/schema/auth";
import { assertResourceAction } from "../../../services/securityGovernance";
import {
  supplementCanonical,
  supplementHash,
  SupplementIdentitySchema,
  SupplementScopeSchema,
  type SupplementIdentity,
  type SupplementScope,
  type SupplementKind,
  type SupplementTarget,
} from "../../../../shared/listingSupplementSources";
import { supplementFail } from "./protocol";
export interface SupplementExecutor {
  execute(query: SQL): Promise<unknown>;
}
export const supplementStatement = (
  text: string,
  values: unknown[] = []
): SQL => {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) return supplementFail("SQL_INVALID");
  return sql.join(
    parts.flatMap((part, i) =>
      i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]
    ),
    sql.raw("")
  );
};
export async function supplementRows(
  tx: SupplementExecutor,
  text: string,
  values: unknown[] = [],
  maximum = 301
): Promise<Record<string, unknown>[]> {
  const result = await tx.execute(supplementStatement(text, values));
  if (
    !Array.isArray(result) ||
    !Array.isArray(result[0]) ||
    result[0].length > maximum ||
    result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))
  )
    supplementFail("READ_INVALID");
  return result[0];
}
export async function supplementWrite(
  tx: SupplementExecutor,
  text: string,
  values: unknown[]
) {
  const packet = await supplementRows(
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
          (n, v) => n + (typeof v === "string" ? Buffer.byteLength(v) : 64),
          0
        )
  )
    supplementFail("PACKET_LIMIT");
  const result = await tx.execute(supplementStatement(text, values));
  if (
    !Array.isArray(result) ||
    !result[0] ||
    result[0].affectedRows !== 1 ||
    result[0].warningStatus !== 0
  )
    supplementFail("WRITE_UNCONFIRMED");
}
export function supplementJson(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32 * 1024 * 1024)
    return supplementFail("JSON_INVALID");
  try {
    const parsed: unknown = JSON.parse(value);
    supplementCanonical(parsed);
    return parsed;
  } catch {
    return supplementFail("JSON_INVALID");
  }
}
const normalizeType = (value: string) =>
  value.toLowerCase().replace(/int\(\d+\)/gu, "int");
type Column = { name: string; type: string; nullable: boolean; extra: string };
const col = (name: string, type: string, nullable = false): Column => ({
  name,
  type,
  nullable,
  extra: name === "updated_at" ? "on update CURRENT_TIMESTAMP(6)" : "",
});
export const SUPPLEMENT_TABLES = {
  listing_supplement_sources: {
    columns: [
      col("source_id", "char(36)"),
      ...["workspace_id", "project_id", "user_id"].map(name =>
        col(name, "int")
      ),
      col("kind", "varchar(20)"),
      col("original_type", "varchar(20)"),
      col("file_name", "varchar(255)"),
      col("content_type", "varchar(160)"),
      col("byte_size", "int"),
      col("content_hash", "char(64)"),
      col("provider", "varchar(8)"),
      col("domain_hash", "char(64)"),
      col("object_key", "varchar(500)"),
      col("original_state", "varchar(20)"),
      col("record_state", "varchar(20)"),
      col("manifest_version", "int"),
      col("manifest_hash", "char(64)"),
      col("preview_status", "varchar(20)"),
      col("reason_code", "varchar(120)", true),
      col("created_at", "timestamp(6)"),
      col("updated_at", "timestamp(6)"),
    ],
    indexes: {
      PRIMARY: [0, "source_id"],
      supplement_history: [
        1,
        "workspace_id,user_id,project_id,created_at,source_id",
      ],
      supplement_content_fence: [
        1,
        "workspace_id,user_id,project_id,kind,original_type,content_hash,original_state",
      ],
    },
  },
  listing_supplement_manifests: {
    columns: [
      col("source_id", "char(36)"),
      col("version", "int"),
      ...["workspace_id", "project_id", "user_id"].map(name =>
        col(name, "int")
      ),
      col("manifest_hash", "char(64)"),
      col("previous_hash", "char(64)", true),
      col("manifest_json", "longtext"),
      col("created_at", "timestamp(6)"),
    ],
    indexes: { PRIMARY: [0, "source_id,version"] },
  },
  listing_supplement_operations: {
    columns: [
      col("operation_key", "char(64)"),
      col("operation_id", "char(36)"),
      ...["workspace_id", "project_id", "user_id"].map(name =>
        col(name, "int")
      ),
      col("source_id", "char(36)", true),
      col("action", "varchar(20)", true),
      col("request_hash", "char(64)", true),
      col("state", "varchar(20)"),
      col("prepared_json", "longtext", true),
      col("receipt_json", "longtext", true),
      col("created_at", "timestamp(6)"),
      col("updated_at", "timestamp(6)"),
    ],
    indexes: {
      PRIMARY: [0, "operation_key"],
      supplement_operation_identity: [0, "workspace_id,user_id,operation_id"],
      supplement_pending_source: [
        1,
        "workspace_id,user_id,project_id,source_id,state",
      ],
    },
  },
} as const;
/** Exact candidate shape, keys, engine, absence of triggers/FKs and audit write
 * dependency are admitted before an original is ever PUT. No DDL is executed. */
export async function assertSupplementSourceSchema(tx: SupplementExecutor) {
  const own = Object.keys(SUPPLEMENT_TABLES),
    names = [
      ...own,
      "security_audit_logs",
      "projects",
      "competitorAnalyses",
      "users",
      "workspaces",
      "workspace_memberships",
      "role_permissions",
      "security_access_policies",
    ];
  const tables = await supplementRows(
    tx,
    `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`,
    names,
    names.length
  );
  if (
    tables.length !== names.length ||
    new Set(tables.map(row => row.name)).size !== names.length ||
    tables.some(
      row => !names.includes(String(row.name)) || row.engine !== "InnoDB"
    )
  )
    supplementFail("SCHEMA_UNAVAILABLE");
  const auditConfig = getTableConfig(securityAuditLogs);
  const entries: Array<
    [
      string,
      {
        columns: readonly Column[];
        indexes?: Record<string, readonly (string | number)[]>;
      },
    ]
  > = Object.entries(SUPPLEMENT_TABLES);
  entries.push([
    "security_audit_logs",
    {
      columns: auditConfig.columns.map(column => ({
        name: column.name,
        type: column.getSQLType(),
        nullable: !column.notNull,
        extra:
          column.name === "id"
            ? "auto_increment"
            : column.name === "createdAt"
              ? ""
              : "",
      })),
    },
  ]);
  for (const [table, expected] of entries) {
    const columns = await supplementRows(
      tx,
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
      [table],
      200
    );
    if (
      columns.length !== expected.columns.length ||
      new Set(columns.map(row => row.name)).size !== columns.length ||
      expected.columns.some(column => {
        const row = columns.find(item => item.name === column.name);
        return (
          !row ||
          typeof row.columnType !== "string" ||
          normalizeType(row.columnType) !== normalizeType(column.type) ||
          row.nullable !== (column.nullable ? "YES" : "NO") ||
          typeof row.extra !== "string" ||
          /(?:virtual|stored)\s+generated/iu.test(row.extra) ||
          row.extra
            .toLowerCase()
            .replace(/default_generated\s*/giu, "")
            .trim() !== column.extra.toLowerCase()
        );
      })
    )
      supplementFail("SCHEMA_UNAVAILABLE");
    if (expected.indexes) {
      const indexes = await supplementRows(
        tx,
        "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX",
        [table],
        100
      );
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of indexes) {
        if (typeof row.name !== "string" || row.subPart !== null)
          supplementFail("SCHEMA_UNAVAILABLE");
        groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
      }
      if (
        groups.size !== Object.keys(expected.indexes).length ||
        Object.entries(expected.indexes).some(([name, [nonUnique, fields]]) => {
          const found = groups.get(name);
          return (
            !found ||
            found.some(
              (row, i) =>
                Number(row.nonUnique) !== nonUnique ||
                Number(row.sequence) !== i + 1
            ) ||
            found.map(row => row.columnName).join(",") !== fields
          );
        })
      )
        supplementFail("SCHEMA_UNAVAILABLE");
    } else if (table === "security_audit_logs") {
      const indexes = await supplementRows(
        tx,
        "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX",
        [table],
        100
      );
      const unique = new Map<string, Record<string, unknown>[]>();
      for (const row of indexes) {
        if (![0, 1].includes(Number(row.nonUnique)))
          supplementFail("SCHEMA_UNAVAILABLE");
        if (Number(row.nonUnique) === 0) {
          if (typeof row.name !== "string" || row.subPart !== null)
            supplementFail("SCHEMA_UNAVAILABLE");
          unique.set(row.name, [...(unique.get(row.name) ?? []), row]);
        }
      }
      const keys = [...unique.values()].map(group => {
        if (group.some((row, i) => Number(row.sequence) !== i + 1))
          supplementFail("SCHEMA_UNAVAILABLE");
        return group.map(row => row.columnName).join(",");
      });
      if (
        keys.length !== 2 ||
        !keys.includes("id") ||
        !keys.includes("auditId")
      )
        supplementFail("SCHEMA_UNAVAILABLE");
    }
  }
  const guarded = [...own, "security_audit_logs"];
  if (
    (
      await supplementRows(
        tx,
        `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (${guarded.map(() => "?").join(",")}) LIMIT 1`,
        guarded,
        1
      )
    ).length ||
    (
      await supplementRows(
        tx,
        `SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${own.map(() => "?").join(",")}) LIMIT 1`,
        own,
        1
      )
    ).length
  )
    supplementFail("SCHEMA_UNAVAILABLE");
}
function jsonSafeRow(row: Record<string, unknown>): unknown {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ])
  );
}
export async function authorizeSupplementScope(
  tx: SupplementExecutor,
  rawIdentity: SupplementIdentity,
  rawScope: SupplementScope,
  action: "read" | "upload" | "delete" | "update" | "export",
  permission = assertResourceAction
) {
  const identity = SupplementIdentitySchema.parse(rawIdentity),
    scope = SupplementScopeSchema.parse(rawScope);
  if (scope.expectedWorkspaceId !== identity.workspaceId)
    supplementFail("ACCESS_DENIED");
  const spaces = await supplementRows(
      tx,
      "SELECT id,status FROM workspaces WHERE id=? FOR SHARE",
      [identity.workspaceId],
      1
    ),
    users = await supplementRows(
      tx,
      "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE",
      [identity.userId],
      1
    ),
    actor = users[0];
  const members = await supplementRows(
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
    typeof actor.role !== "string" ||
    actor.status !== "active" ||
    actor.defaultWorkspaceId !== identity.workspaceId ||
    members.length !== 1 ||
    members[0].workspaceId !== identity.workspaceId ||
    members[0].userId !== identity.userId ||
    members[0].status !== "active"
  )
    supplementFail("ACCESS_DENIED");
  const parents = await supplementRows(
      tx,
      "SELECT * FROM projects WHERE id=? FOR UPDATE",
      [scope.projectId],
      1
    ),
    parent = parents[0];
  if (
    parents.length !== 1 ||
    parent.id !== scope.projectId ||
    parent.workspaceId !== identity.workspaceId ||
    !Number.isInteger(parent.userId) ||
    (parent.userId !== identity.userId &&
      !["super_admin", "admin", "designer"].includes(actor.role))
  )
    supplementFail("ACCESS_DENIED");
  const common = {
    actor: {
      id: identity.userId,
      role: actor.role,
      defaultWorkspaceId: identity.workspaceId,
    },
    workspaceId: identity.workspaceId,
    projectId: scope.projectId,
    resourceId: scope.projectId,
    // The parent owner check above scopes this private source, but must not
    // bypass current file/project policies (including export revocation).
    authorizationRead: {
      executor: tx,
      strict: true as const,
      lock: true as const,
      lockMode: "share" as const,
    },
  };
  try {
    await permission({ ...common, resource: "project", action: "read" });
    await permission({ ...common, resource: "file", action });
  } catch {
    supplementFail("ACCESS_DENIED");
  }
  return { role: actor.role, parent };
}
export async function captureSupplementTargets(
  tx: SupplementExecutor,
  scope: SupplementScope,
  kind: SupplementKind,
  parent: Record<string, unknown>
): Promise<SupplementTarget[]> {
  if (kind === "attributes")
    return [
      {
        type: "product",
        projectId: scope.projectId,
        revisionHash: supplementHash(jsonSafeRow(parent)),
      },
    ];
  const rows = await supplementRows(
    tx,
    "SELECT * FROM competitorAnalyses WHERE projectId=? ORDER BY id LIMIT 301 FOR SHARE",
    [scope.projectId],
    301
  );
  if (
    rows.length > 300 ||
    new Set(rows.map(row => row.id)).size !== rows.length ||
    rows.some(
      row =>
        row.projectId !== scope.projectId ||
        !Number.isInteger(row.id) ||
        typeof row.asin !== "string" ||
        !/^[A-Z0-9]{10}$/u.test(row.asin)
    )
  )
    supplementFail("TARGETS_UNAVAILABLE");
  return rows.map(row => ({
    type: "competitor",
    analysisId: Number(row.id),
    asin: String(row.asin),
    revisionHash: supplementHash(jsonSafeRow(row)),
  }));
}
