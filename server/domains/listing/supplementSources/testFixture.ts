import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableConfig } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { securityAuditLogs } from "../../../../drizzle/schema/auth";
import { assertResourceAction } from "../../../services/securityGovernance";
import {
  SUPPLEMENT_TABLES,
  authorizeSupplementScope,
  type SupplementExecutor,
} from "./store";
import { createSupplementSourceRepository } from "./repository";
import { createSupplementOriginalStorage } from "./storage";
import { createListingSupplementSourceService } from "./service";
import { supplementBytesHash } from "./protocol";

/** In-memory SQL protocol fixture. Production repository, physical admission,
 * authorization, parser, service and storage adapters are all exercised; only
 * the database executor and network boundary are synthetic. */
export function createSupplementFixture() {
  const identity = { userId: 3, workspaceId: 7 },
    scope = { expectedWorkspaceId: 7, projectId: 11 },
    context = { user: { id: 3 }, workspaceId: 7 };
  const control = {
    enabled: true,
    allowed: true,
    denyExport: false,
    member: true,
    actor: true,
    badEngine: false,
    badColumn: false,
    badIndex: false,
    trigger: false,
    foreignKey: false,
    packet: 64 * 1024 * 1024,
    putUnknown: false,
    deleteUnknown: false,
    badBytes: false,
    domainChanged: false,
    commitAckLost: "" as "" | "prepare" | "dispatch" | "complete",
    onRead: null as (() => void) | null,
  };
  let state = {
    sources: new Map<string, Record<string, unknown>>(),
    operations: new Map<string, Record<string, unknown>>(),
    manifests: new Map<string, Record<string, unknown>>(),
    audits: new Map<string, Record<string, unknown>>(),
    parent: {
      id: 11,
      workspaceId: 7,
      userId: 3,
      name: "Synthetic product",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      updatedAt: new Date("2026-10-19T00:00:00Z"),
    },
    analyses: [
      {
        id: 21,
        projectId: 11,
        asin: "B000000021",
        title: "Synthetic competitor",
        updatedAt: new Date("2026-10-19T00:00:00Z"),
      },
    ],
  };
  const sqlCalls: Array<{ text: string; values: unknown[] }> = [],
    objects = new Map<string, Buffer>(),
    puts: Array<{ key: string; hash: string; maxAttempts: unknown }> = [],
    deletes: string[] = [];
  let inTransaction = false,
    sequence = 0,
    transactionEvent = "";
  const rowResult = (rows: Record<string, unknown>[]) => [
      structuredClone(rows),
      [],
    ],
    header = () => [{ affectedRows: 1, warningStatus: 0, insertId: 0 }, []];
  const camel = (name: string) =>
    name.replace(/_([a-z])/gu, (_match, character: string) =>
      character.toUpperCase()
    );
  const executor: SupplementExecutor = {
    async execute(query: SQL) {
      const compiled = new MySqlDialect().sqlToQuery(query),
        text = compiled.sql.replace(/\s+/gu, " ").trim(),
        values = compiled.params;
      sqlCalls.push({ text, values });
      if (text.includes("information_schema.TABLES"))
        return rowResult(
          values.map(value => ({
            name: String(value),
            engine:
              control.badEngine && value === "listing_supplement_sources"
                ? "MyISAM"
                : "InnoDB",
          }))
        );
      if (text.includes("information_schema.COLUMNS")) {
        const table = String(values[0]),
          audit = getTableConfig(securityAuditLogs);
        const columns =
          table === "security_audit_logs"
            ? audit.columns.map(column => ({
                name: column.name,
                type: column.getSQLType(),
                nullable: !column.notNull,
                extra: column.name === "id" ? "auto_increment" : "",
              }))
            : SUPPLEMENT_TABLES[table as keyof typeof SUPPLEMENT_TABLES]
                .columns;
        return rowResult(
          columns.map((column, i) => ({
            name: column.name,
            columnType:
              control.badColumn &&
              table === "listing_supplement_sources" &&
              i === 0
                ? "varchar(1)"
                : column.type,
            nullable: column.nullable ? "YES" : "NO",
            extra: column.type.startsWith("timestamp")
              ? `DEFAULT_GENERATED ${column.extra}`.trim()
              : column.extra,
          }))
        );
      }
      if (text.includes("information_schema.STATISTICS")) {
        if (values[0] === "security_audit_logs")
          return rowResult([
            {
              name: "PRIMARY",
              nonUnique: 0,
              sequence: 1,
              columnName: "id",
              subPart: null,
            },
            {
              name: "security_audit_logs_auditId_unique",
              nonUnique: 0,
              sequence: 1,
              columnName: "auditId",
              subPart: null,
            },
          ]);
        const definitions =
          SUPPLEMENT_TABLES[String(values[0]) as keyof typeof SUPPLEMENT_TABLES]
            .indexes;
        const result = Object.entries(definitions).flatMap(
          ([name, [nonUnique, fields]]) =>
            String(fields)
              .split(",")
              .map((columnName, i) => ({
                name,
                nonUnique,
                sequence: i + 1,
                columnName,
                subPart: null,
              }))
        );
        if (control.badIndex)
          result.push({
            name: "unapproved_unique",
            nonUnique: 0,
            sequence: 1,
            columnName: "source_id",
            subPart: null,
          });
        return rowResult(result);
      }
      if (text.includes("information_schema.TRIGGERS"))
        return rowResult(control.trigger ? [{ name: "unexpected" }] : []);
      if (text.includes("information_schema.REFERENTIAL_CONSTRAINTS"))
        return rowResult(control.foreignKey ? [{ name: "unexpected" }] : []);
      if (text === "SELECT @@max_allowed_packet AS maximumPacket")
        return rowResult([{ maximumPacket: control.packet }]);
      if (text.startsWith("SELECT id,status FROM workspaces"))
        return rowResult([{ id: 7, status: "active" }]);
      if (
        text.startsWith("SELECT id,role,status,defaultWorkspaceId FROM users")
      )
        return rowResult([
          {
            id: 3,
            role: "operator",
            status: control.actor ? "active" : "disabled",
            defaultWorkspaceId: 7,
          },
        ]);
      if (text.includes("FROM workspace_memberships"))
        return rowResult(
          control.member
            ? [{ id: 9, workspaceId: 7, userId: 3, status: "active" }]
            : []
        );
      if (text.includes("FROM security_access_policies"))
        return rowResult(
          !control.allowed ||
            (control.denyExport &&
              values[0] === "file" &&
              values[1] === "export")
            ? [{ effect: "deny" }]
            : []
        );
      if (text.includes("FROM role_permissions"))
        return rowResult([
          {
            modules: JSON.stringify(["listing"]),
            detailedPermissions: JSON.stringify([
              {
                moduleId: "listing",
                operations: [
                  "read",
                  "edit",
                  "create",
                  "delete",
                  "export",
                  "upload",
                  "import",
                ],
                subModules: [
                  {
                    subModuleId: "listing_projects",
                    operations: [
                      "read",
                      "edit",
                      "create",
                      "delete",
                      "export",
                      "upload",
                      "import",
                    ],
                  },
                  {
                    subModuleId: "listing_data_files",
                    operations: [
                      "read",
                      "edit",
                      "create",
                      "delete",
                      "export",
                      "upload",
                      "import",
                    ],
                  },
                ],
              },
            ]),
          },
        ]);
      if (text.startsWith("SELECT * FROM projects"))
        return rowResult(values[0] === state.parent.id ? [state.parent] : []);
      if (text.startsWith("SELECT * FROM competitorAnalyses"))
        return rowResult(
          state.analyses.filter(row => row.projectId === values[0])
        );
      if (text.startsWith("INSERT INTO")) {
        const match = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.*)\)$/u.exec(
          text
        );
        if (!match) throw new Error(`Unsupported fixture INSERT: ${text}`);
        const columns = match[2].split(","),
          literals = match[3].split(",");
        let index = 0;
        const row: Record<string, unknown> = {};
        literals.forEach((literal, i) => {
          const value =
            literal === "?"
              ? values[index++]
              : literal === "NULL"
                ? null
                : /^'.*'$/u.test(literal)
                  ? literal.slice(1, -1)
                  : Number(literal);
          row[camel(columns[i])] = value;
        });
        if (index !== values.length || columns.length !== literals.length)
          throw new Error("Fixture insert bind mismatch");
        if (match[1] === "listing_supplement_sources") {
          if (state.sources.has(String(row.sourceId)))
            throw new Error("duplicate");
          row.createdEpoch = `1792368000.${String(++sequence).padStart(6, "0")}`;
          state.sources.set(String(row.sourceId), row);
          transactionEvent = "prepare";
        } else if (match[1] === "listing_supplement_operations") {
          if (state.operations.has(String(row.operationKey)))
            throw new Error("duplicate");
          state.operations.set(String(row.operationKey), row);
          transactionEvent = "prepare";
        } else if (match[1] === "listing_supplement_manifests") {
          const key = `${row.sourceId}:${row.version}`;
          if (state.manifests.has(key)) throw new Error("duplicate");
          state.manifests.set(key, row);
          transactionEvent = "complete";
        } else if (match[1] === "security_audit_logs") {
          if (state.audits.has(String(row.auditId)))
            throw new Error("duplicate");
          state.audits.set(String(row.auditId), row);
        } else throw new Error(`Unexpected fixture table ${match[1]}`);
        return header();
      }
      if (
        text.startsWith("SELECT") &&
        text.includes("FROM listing_supplement_operations")
      ) {
        if (text.startsWith("SELECT operation_key FROM"))
          return rowResult(
            [...state.operations.values()].filter(
              row =>
                row.workspaceId === values[0] &&
                row.userId === values[1] &&
                row.projectId === values[2] &&
                row.sourceId === values[3] &&
                ["prepared", "dispatched"].includes(String(row.state))
            )
          );
        const row = state.operations.get(String(values[0]));
        return rowResult(row ? [row] : []);
      }
      if (
        text.startsWith("SELECT") &&
        text.includes("FROM listing_supplement_sources")
      ) {
        if (text.startsWith("SELECT source_id AS sourceId FROM"))
          return rowResult(
            [...state.sources.values()]
              .filter(
                row =>
                  row.workspaceId === values[0] &&
                  row.userId === values[1] &&
                  row.projectId === values[2] &&
                  row.kind === values[3] &&
                  row.originalType === values[4] &&
                  row.contentHash === values[5] &&
                  ["prepared", "deleting"].includes(String(row.originalState))
              )
              .map(row => ({ sourceId: row.sourceId }))
          );
        if (text.includes("WHERE source_id=?")) {
          const row = state.sources.get(String(values[0]));
          return rowResult(row ? [row] : []);
        }
        let found = [...state.sources.values()].filter(
          row =>
            row.workspaceId === values[0] &&
            row.userId === values[1] &&
            row.projectId === values[2] &&
            row.recordState === "visible"
        );
        if (text.includes("FROM_UNIXTIME"))
          found = found.filter(
            row =>
              String(row.createdEpoch) < String(values[3]) ||
              (row.createdEpoch === values[3] &&
                String(row.sourceId) < String(values[5]))
          );
        found.sort(
          (a, b) =>
            String(b.createdEpoch).localeCompare(String(a.createdEpoch)) ||
            String(b.sourceId).localeCompare(String(a.sourceId))
        );
        return rowResult(found.slice(0, Number(values.at(-1))));
      }
      if (
        text.startsWith("SELECT") &&
        text.includes("FROM listing_supplement_manifests")
      ) {
        const row = state.manifests.get(`${values[0]}:${values[1]}`);
        return rowResult(row ? [row] : []);
      }
      if (
        text.startsWith("SELECT") &&
        text.includes("FROM security_audit_logs")
      ) {
        const row = state.audits.get(String(values[0]));
        return rowResult(row ? [row] : []);
      }
      if (text.startsWith("UPDATE listing_supplement_operations")) {
        const key = String(
            text.includes("SET state='dispatched'") ? values[0] : values[1]
          ),
          row = state.operations.get(key);
        if (!row) throw new Error("missing operation");
        if (text.includes("SET state='dispatched'")) {
          if (row.state !== "prepared")
            return [{ affectedRows: 0, warningStatus: 0 }, []];
          row.state = "dispatched";
          transactionEvent = "dispatch";
        } else {
          if (!["prepared", "dispatched"].includes(String(row.state)))
            return [{ affectedRows: 0, warningStatus: 0 }, []];
          row.state = text.includes("state='committed'")
            ? "committed"
            : "cancelled";
          row.receiptJson = values[0];
          if (row.state === "committed") transactionEvent = "complete";
        }
        return header();
      }
      if (text.startsWith("UPDATE listing_supplement_sources")) {
        const withRecord = text.includes("record_state=?"),
          sourceId = String(values[withRecord ? 1 : 0]),
          row = state.sources.get(sourceId);
        if (!row) throw new Error("missing source");
        row.originalState = /SET original_state='([^']+)'/u.exec(text)![1];
        if (withRecord) row.recordState = values[0];
        return header();
      }
      throw new Error(`Unhandled fixture SQL: ${text}`);
    },
  };
  const database = {
    async transaction<T>(
      body: (tx: SupplementExecutor) => Promise<T>
    ): Promise<T> {
      if (inTransaction) throw new Error("Nested transaction");
      const before = structuredClone(state);
      inTransaction = true;
      transactionEvent = "";
      let result: T;
      try {
        result = await body(executor);
      } catch (error) {
        state = before;
        throw error;
      } finally {
        inTransaction = false;
      }
      if (control.commitAckLost && transactionEvent === control.commitAckLost) {
        control.commitAckLost = "";
        throw new Error("Synthetic commit ACK lost");
      }
      return result;
    },
  };
  const repository = createSupplementSourceRepository({
    database: async () => database,
    enabled: () => control.enabled,
    authorize: (tx, i, s, action) =>
      authorizeSupplementScope(tx, i, s, action, assertResourceAction),
  });
  const storage = createSupplementOriginalStorage({
    assertPrivate: () => {},
    provider: () => "s3",
    configuration: () => ({
      region: "test-region",
      bucket: control.domainChanged ? "different-bucket" : "private-bucket",
      endpoint: "https://private.example.test",
      forcePathStyle: true,
      accessKeyId: "synthetic",
      secretAccessKey: "synthetic",
    }),
    put: async (key, bytes, _mime, options) => {
      if (
        inTransaction ||
        ![...state.operations.values()].some(row => row.state === "dispatched")
      )
        throw new Error("PUT before durable ACK");
      const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      puts.push({
        key,
        hash: supplementBytesHash(value),
        maxAttempts: options?.maxAttempts,
      });
      objects.set(key, value);
      if (control.putUnknown) throw new Error("Uncertain PUT");
      return {
        key,
        url: `https://private.example.test/${key}`,
        storageUri: `storage://s3/${key}`,
      };
    },
    get: async key => ({ key, url: `https://private.example.test/${key}` }),
    request: async raw => {
      const url = new URL(raw),
        key = url.pathname.slice(1),
        bytes = objects.get(key);
      control.onRead?.();
      const body = bytes
        ? control.badBytes
          ? Buffer.from("wrong bytes")
          : Buffer.from(bytes)
        : Buffer.alloc(0);
      return {
        ok: !!bytes,
        status: bytes ? 200 : 404,
        statusText: bytes ? "OK" : "Not Found",
        headers: { get: () => null },
        body,
        url: url.href,
        text: async () => body.toString("utf8"),
        json: async () => JSON.parse(body.toString("utf8")),
        arrayBuffer: async () => Uint8Array.from(body).buffer,
      };
    },
    remove: async key => {
      if (inTransaction) throw new Error("DELETE inside TX");
      deletes.push(key);
      objects.delete(key);
      if (control.deleteUnknown) throw new Error("Uncertain DELETE");
    },
  });
  const service = createListingSupplementSourceService({
    repository,
    storage,
    now: () => "2026-10-19T00:00:00.000Z",
  });
  const operationId = (n = 1) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const file = (
    text = "asin,body,rating\nB000000021,Exact synthetic review,5\n",
    fileName = "reviews.csv"
  ) => ({
    originalType: "file" as const,
    fileName,
    contentType: "text/csv" as const,
    base64: Buffer.from(text).toString("base64"),
  });
  async function input(n = 1) {
    const original = file(),
      preview = await service.preview(context, {
        ...scope,
        kind: "reviews",
        original,
      });
    return {
      ...scope,
      kind: "reviews" as const,
      original,
      operationId: operationId(n),
      expectedPreviewHash: preview.previewHash,
      assignments: preview.records.map(row => ({
        recordId: row.recordId,
        target: preview.targets[0],
      })),
      confirmSourceOnly: true as const,
    };
  }
  return {
    identity,
    scope,
    context,
    control,
    get state() {
      return state;
    },
    sqlCalls,
    puts,
    deletes,
    objects,
    repository,
    storage,
    service,
    executor,
    database,
    operationId,
    file,
    input,
  };
}
