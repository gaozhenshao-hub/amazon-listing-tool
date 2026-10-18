import { createHash } from "node:crypto";
import {
  MySqlDialect,
  getTableConfig,
  type AnyMySqlTable,
} from "drizzle-orm/mysql-core";
import { getTableColumns, type SQL } from "drizzle-orm";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../drizzle/schema/auth";
import { saihuProductWeekly } from "../../../drizzle/schema/ops";
import { opsSaihuDailyReportBatches } from "../../../drizzle/schema/saihuReport";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialReadDetails";
import {
  SAIHU_DAILY_FIELDS,
  saihuReportHash,
  type SaihuReportScope,
} from "../../../shared/saihuReportSync";
import {
  SaihuReportContractSchema,
  type SaihuReportContract,
} from "./saihuReportContract";
import { authorizeSaihuReport } from "./saihuReportStore";
import { createSaihuReportRepository } from "./saihuReportRepository";
import { createMonthlyFinancialWriteRepository } from "./monthlyFinancialWriteRepository";
import { verifySaihuMonthlyArtifact } from "./saihuReportPublication";
import type { DbExecutor } from "../../repositories/dbClient";

type Row = Record<string, any>;
export const fixtureIdentity = { userId: 3, workspaceId: 7 };
export const fixtureUuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export function syntheticSaihuContract(
  kind: "daily" | "monthly"
): SaihuReportContract {
  return SaihuReportContractSchema.parse({
    version: 1,
    workspaceId: 7,
    kind,
    reviewedBy: "synthetic-test-only-not-provider-evidence",
    reviewedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
    documentation: [
      {
        url: "https://openapi.sellfox.com/synthetic-test-only",
        sha256: "d".repeat(64),
      },
    ],
    endpoint:
      kind === "daily"
        ? "/api/productAnalyze/V2/pageList.json"
        : "/api/financial/v2/monthProfit/asin.json",
    periodFormat: kind === "daily" ? "YYYY-MM-DD" : "YYYYMM",
    request: {
      staticBody: { syntheticTestOnly: true },
      startField: "startDate",
      endField: "endDate",
      pageField: "pageNo",
      pageSizeField: "pageSize",
      currencyField: "currency",
    },
    shops: [{ shopId: "s1", storeName: "Original Store", country: "US" }],
    response: {
      rows: ["data", "rows"],
      total: ["data", "total"],
      pageNo: ["data", "pageNo"],
      pageCount: ["data", "pageCount"],
      emptyShopIds: ["data", "emptyShops"],
    },
    mapping: {
      period: ["period"],
      currency: ["currency"],
      caliber:
        kind === "monthly"
          ? { path: ["caliber"], expectedValue: "settlement" }
          : null,
      asin: ["asin"],
      parentAsin: ["parent"],
      shopId: ["shopId"],
      storeName: ["store"],
      country: ["country"],
      title: ["title"],
      sku: ["sku"],
      operator: ["operator"],
      metrics: Object.fromEntries(
        (kind === "daily" ? SAIHU_DAILY_FIELDS : MONTHLY_FINANCIAL_METRICS).map(
          key => [key, [{ path: ["metrics", key], multiplier: 1, divisor: 1 }]]
        )
      ),
    },
  });
}
export function syntheticSaihuRow(
  period = "2026-10-01",
  kind: "daily" | "monthly" = "daily",
  patch: Row = {}
) {
  return {
    period: kind === "daily" ? period : period.replace("-", ""),
    currency: "USD",
    caliber: "settlement",
    asin: "B000000002",
    parent: "B000000001",
    shopId: "s1",
    store: "Original Store",
    country: "US",
    title: "Original UTF-8 产品",
    sku: "SKU-1",
    operator: "Alice",
    metrics: Object.fromEntries(
      (kind === "daily" ? SAIHU_DAILY_FIELDS : MONTHLY_FINANCIAL_METRICS).map(
        key => [
          key,
          key === "salesQty"
            ? 2
            : key === "salesAmount"
              ? 50
              : key === "financialProfit" || key === "grossProfit"
                ? 12.5
                : 0,
        ]
      )
    ),
    ...patch,
  };
}
export function syntheticSaihuRead(rows: Row[], extra: Row = {}) {
  const body = {
      code: 0,
      data: {
        rows,
        total: rows.length,
        pageNo: 1,
        pageCount: 1,
        emptyShops: [],
        ...extra,
      },
    },
    originalUtf8 = JSON.stringify(body);
  return {
    body,
    originalUtf8,
    byteLength: Buffer.byteLength(originalUtf8),
    bytesHash: createHash("sha256").update(originalUtf8).digest("hex"),
    receivedAt: 1792300000000,
  };
}
const column = (
  name: string,
  type: string,
  nullable = false,
  extra = "",
  maxLength: number | null = null,
  defaultValue: unknown = null
) => ({
  name,
  columnName: name,
  dataType: type.replace(/\(.*/u, ""),
  columnType: type,
  nullable: nullable ? "YES" : "NO",
  isNullable: nullable ? "YES" : "NO",
  extra,
  maxLength,
  defaultValue,
  collation: /^(?:char|varchar|text|enum)/u.test(type)
    ? "utf8mb4_unicode_ci"
    : null,
});
const metadata = (table: AnyMySqlTable) =>
  getTableConfig(table).columns.map(c =>
    column(
      c.name,
      c.getSQLType(),
      !c.notNull,
      c.name === "id"
        ? "auto_increment"
        : c.name === "updatedAt"
          ? "on update CURRENT_TIMESTAMP"
          : "",
      /^varchar|^char/u.test(c.getSQLType())
        ? Number(c.getSQLType().match(/\((\d+)\)/u)?.[1])
        : null,
      c.name === "createdAt" || c.name === "updatedAt"
        ? "CURRENT_TIMESTAMP"
        : c.default !== undefined &&
            (typeof c.default === "number" || typeof c.default === "string")
          ? c.default
          : null
    )
  );
const index = (
  tableName: string,
  indexName: string,
  names: string[],
  nonUnique = 0
) =>
  names.map((name, i) => ({
    tableName,
    indexName,
    name: indexName,
    columnName: name,
    sequence: i + 1,
    nonUnique,
    prefixLength: null,
    subPart: null,
  }));
export function createSaihuReportTestFixture() {
  const state = {
      jobs: [] as Row[],
      artifacts: [] as Row[],
      daily: [] as Row[],
      monthly: [] as Row[],
      monthlyArtifacts: [] as Row[],
      audits: [] as Row[],
      legacy: [] as Row[],
      board: [] as Row[],
    },
    control = {
      enabled: true,
      monthlyEnabled: true,
      now: 1792300000000,
      commitLost: 0,
      actorActive: true,
      memberActive: true,
      badEngine: "",
      failAudit: false,
      failBoard: false,
      connectionVersion: "a".repeat(64),
    },
    calls: Array<{ sql: string; params: unknown[] }> = [];
  let tail: Promise<unknown> = Promise.resolve(),
    nextJob = 1,
    nextDaily = 100,
    nextMonthly = 200;
  const cols: Record<string, Row[]> = Object.fromEntries(
    [
      aiJobs,
      aiArtifacts,
      securityAuditLogs,
      opsSaihuDailyReportBatches,
      saihuProductWeekly,
    ].map(table => [getTableConfig(table).name, metadata(table)])
  );
  cols.ops_monthly_profit_imports = [
    column("id", "int", false, "auto_increment"),
    ...[
      "workspaceId",
      "userId",
      "totalRows",
      "skippedRows",
      "unallocatedRows",
    ].map(n => column(n, "int")),
    column("fileName", "varchar(512)", false, "", 512),
    column("fileHash", "char(64)", false, "", 64),
    column("fileUrl", "text"),
    column("status", "varchar(20)", false, "", 20),
    column("months", "json"),
    column("payload", "json"),
    column(
      "createdAt",
      "datetime(3)",
      false,
      "DEFAULT_GENERATED",
      null,
      "CURRENT_TIMESTAMP(3)"
    ),
    column("confirmedAt", "datetime(3)", true),
  ];
  cols.ops_monthly_import_artifacts = [
    column("batch_id", "int"),
    column("workspace_id", "int"),
    column("prepared", "json"),
    column("payload_hash", "char(64)", false, "", 64),
    column("manifest", "json"),
    column(
      "created_at",
      "datetime(3)",
      false,
      "DEFAULT_GENERATED",
      null,
      "CURRENT_TIMESTAMP(3)"
    ),
  ];
  const indexes = [
    ...index("ai_jobs", "PRIMARY", ["id"]),
    ...index("ai_jobs", "run", ["runId"]),
    ...index("ai_artifacts", "PRIMARY", ["id"]),
    ...index("ai_artifacts", "artifact", ["artifactId"]),
    ...index("ops_saihu_daily_report_batches", "PRIMARY", ["id"]),
    ...index("ops_saihu_daily_report_batches", "run", ["run_id"]),
    ...index("security_audit_logs", "PRIMARY", ["id"]),
    ...index("security_audit_logs", "audit", ["auditId"]),
    ...index("ops_monthly_profit_imports", "PRIMARY", ["id"]),
    ...index(
      "ops_monthly_profit_imports",
      "scope",
      ["workspaceId", "status", "id"],
      1
    ),
    ...index(
      "ops_monthly_profit_imports",
      "owner",
      ["workspaceId", "userId", "id"],
      1
    ),
    ...index("ops_monthly_import_artifacts", "PRIMARY", ["batch_id"]),
    ...index(
      "ops_monthly_import_artifacts",
      "scope",
      ["workspace_id", "batch_id"],
      1
    ),
  ];
  const execute = async (statement: SQL) => {
    const q = new MySqlDialect().sqlToQuery(statement),
      text = q.sql,
      p = q.params;
    calls.push(q);
    const result = (rows: Row[]) => [structuredClone(rows), []],
      write = (insertId = 0) => [
        { affectedRows: 1, warningStatus: 0, insertId },
        [],
      ];
    if (text.includes("@@max_allowed_packet"))
      return result([{ maximumPacket: 128 * 1024 * 1024 }]);
    if (text.includes("information_schema.TRIGGERS")) return result([]);
    if (text.includes("information_schema.COLUMNS")) {
      const table = String(p[0] ?? text.match(/TABLE_NAME='([^']+)'/u)?.[1]);
      return result(cols[table] ?? []);
    }
    if (text.includes("information_schema.STATISTICS")) {
      const names = p.length
        ? p.map(String)
        : [
            "ops_monthly_profit_imports",
            "ops_monthly_import_artifacts",
            "security_audit_logs",
          ];
      return result(indexes.filter(row => names.includes(row.tableName)));
    }
    if (text.includes("information_schema.TABLES")) {
      const names = p.length
        ? p.map(String)
        : ([text.match(/TABLE_NAME='([^']+)'/u)?.[1]].filter(
            Boolean
          ) as string[]);
      return result(
        names.map(name => ({
          name,
          tableName: name,
          engine: name === control.badEngine ? "MyISAM" : "InnoDB",
          collation: "utf8mb4_unicode_ci",
        }))
      );
    }
    if (text.includes("FROM workspaces"))
      return result(p[0] === 7 ? [{ id: 7, status: "active" }] : []);
    if (text.includes("FROM users"))
      return result(
        p[0] === 3
          ? [
              {
                id: 3,
                role: "super_admin",
                status: control.actorActive ? "active" : "disabled",
                defaultWorkspaceId: 7,
              },
            ]
          : []
      );
    if (text.includes("FROM workspace_memberships"))
      return result(
        control.memberActive && p[0] === 7 && p[1] === 3
          ? [{ id: 13, userId: 3, workspaceId: 7, status: "active" }]
          : []
      );
    if (text.includes("FROM role_permissions")) return result([]);
    if (text.includes("FROM security_audit_logs"))
      return result(
        state.audits
          .filter(row => p.includes(row.auditId))
          .map(row => ({ ...row, metadataText: row.metadata }))
      );
    if (text.startsWith("INSERT INTO security_audit_logs")) {
      if (control.failAudit) throw new Error("synthetic audit failure");
      state.audits.push({
        auditId: p[0],
        workspaceId: p[1],
        actorUserId: p[2],
        actorRole: p[3],
        action: p[4],
        resourceType: text.includes("'ops_saihu_report_operation'")
          ? "ops_saihu_report_operation"
          : "ops_monthly_operation",
        resourceId: p[5],
        status: "success",
        metadata: p[6],
      });
      return write();
    }
    if (text.includes("FROM ai_jobs")) {
      if (text.includes("WHERE runId=?"))
        return result(state.jobs.filter(row => row.runId === p[0]));
      if (text.includes("status IN"))
        return result(
          state.jobs.filter(
            row =>
              row.workspaceId === p[0] &&
              row.kind === p[1] &&
              ["queued", "running", "succeeded", "failed"].includes(row.status)
          )
        );
      return result(
        state.jobs
          .filter(
            row =>
              row.workspaceId === p[0] &&
              row.userId === p[1] &&
              row.kind === p[2] &&
              (p.length < 5 || row.id < Number(p[3]))
          )
          .sort((a, b) => b.id - a.id)
          .slice(0, Number(p.at(-1)))
      );
    }
    if (text.startsWith("INSERT INTO ai_jobs")) {
      const id = nextJob++;
      state.jobs.push({
        id,
        workspaceId: p[0],
        runId: p[1],
        kind: p[2],
        module: "ops",
        projectId: null,
        maxAttempts: 1,
        status: "queued",
        userId: p[3],
        input: p[4],
        output: p[5],
        lockedBy: null,
        leaseUntil: null,
      });
      return write(id);
    }
    if (text.startsWith("UPDATE ai_jobs")) {
      const runId = text.includes("SET status='running'")
          ? p[3]
          : text.includes("SET leaseUntil")
            ? p[1]
            : p[3],
        row = state.jobs.find(row => row.runId === runId);
      if (!row) return [{ affectedRows: 0 }, []];
      if (text.includes("SET status='running'"))
        Object.assign(row, {
          status: "running",
          output: p[0],
          lockedBy: p[1],
          leaseUntil: p[2],
        });
      else if (text.includes("SET leaseUntil")) row.leaseUntil = p[0];
      else {
        Object.assign(row, { status: p[0], output: p[1] });
        if (text.includes("lockedBy=NULL"))
          Object.assign(row, { lockedBy: null, leaseUntil: null });
      }
      return write();
    }
    if (text.includes("FROM ai_artifacts"))
      return result(state.artifacts.filter(row => row.artifactId === p[0]));
    if (text.startsWith("INSERT INTO ai_artifacts")) {
      state.artifacts.push({
        artifactId: p[0],
        workspaceId: p[1],
        userId: p[2],
        projectId: null,
        domain: "ops",
        artifactKey: p[3],
        sourceType: "tool_output",
        sourceTable: "ai_jobs",
        sourceRowId: p[4],
        runId: p[5],
        status: "final",
        isCurrent: 0,
        version: 1,
        contentJson: p[6],
        contentHash: p[7],
      });
      return write();
    }
    if (text.includes("FROM ops_saihu_daily_report_batches"))
      return result(
        state.daily
          .filter(row => row.workspaceId === p[0])
          .sort((a, b) => b.id - a.id)
      );
    if (text.startsWith("INSERT INTO ops_saihu_daily_report_batches")) {
      const id = nextDaily++;
      state.daily.push({
        id,
        workspaceId: p[0],
        userId: p[1],
        runId: p[2],
        operationId: p[3],
        status: "previewing",
        sourceHash: p[4],
        previewHash: p[5],
        scope: p[6],
        coverage: p[7],
        facts: p[8],
      });
      return write(id);
    }
    if (text.startsWith("UPDATE ops_saihu_daily_report_batches")) {
      const row = state.daily.find(
        row =>
          row.workspaceId === p[1] && row.id === p[2] && row.status === p[3]
      );
      if (!row) return [{ affectedRows: 0 }, []];
      row.status = p[0];
      return write();
    }
    if (text.includes("FROM saihu_product_weekly"))
      return result(
        state.legacy
          .filter(row => row.workspaceId === p[0])
          .map(row => ({ id: row.id, content: JSON.stringify(row) }))
      );
    if (text.includes("FROM ops_monthly_import_artifacts"))
      return result(
        state.monthlyArtifacts
          .filter(row => row.workspaceId === p[0] && row.batchId === p[1])
          .map(row => ({
            ...row,
            preparedBytes: Buffer.byteLength(row.prepared),
            manifestBytes: Buffer.byteLength(row.manifest),
            storageReference: state.monthly.find(
              batch => batch.id === row.batchId
            )?.fileUrl,
          }))
      );
    if (text.includes("FROM ops_monthly_profit_imports"))
      return result(
        state.monthly
          .filter(
            row =>
              row.workspaceId === p[0] &&
              (text.includes("status='completed'")
                ? row.status === "completed"
                : row.id === p[1])
          )
          .sort((a, b) => b.id - a.id)
          .map(row => ({
            ...row,
            payloadBytes: Buffer.byteLength(row.payload),
            monthsBytes: Buffer.byteLength(row.months),
          }))
      );
    if (text.startsWith("INSERT INTO ops_monthly_profit_imports")) {
      const id = nextMonthly++;
      state.monthly.push({
        id,
        workspaceId: p[0],
        userId: p[1],
        fileName: p[2],
        fileHash: p[3],
        fileUrl: p[4],
        status: "previewing",
        totalRows: p[5],
        skippedRows: 0,
        unallocatedRows: p[6],
        months: p[7],
        payload: p[8],
        createdAt: "2026-10-18 12:00:00.000000",
        confirmedAt: null,
        fileReferenceKind: "saihu_sync_run",
        sourceRunId: Number(String(p[4]).split(":")[1]),
      });
      return write(id);
    }
    if (text.startsWith("INSERT INTO ops_monthly_import_artifacts")) {
      state.monthlyArtifacts.push({
        batchId: p[0],
        workspaceId: p[1],
        prepared: p[2],
        payloadHash: p[3],
        manifest: p[4],
      });
      return write();
    }
    if (text.startsWith("UPDATE ops_monthly_profit_imports")) {
      const row = state.monthly.find(
        row =>
          row.workspaceId === p[0] &&
          row.id === p[1] &&
          row.status === (p[2] ?? "previewing")
      );
      if (!row) return [{ affectedRows: 0 }, []];
      Object.assign(
        row,
        text.includes("status='completed'")
          ? { status: "completed", confirmedAt: "2026-10-18 12:01:00.000000" }
          : { status: "deleted" }
      );
      return write();
    }
    throw new Error(`Unexpected synthetic SQL ${text}`);
  };
  const tx = { execute } as unknown as DbExecutor;
  async function transaction<T>(
    body: (tx: DbExecutor) => Promise<T>
  ): Promise<T> {
    const run = tail.then(async () => {
      const before = structuredClone(state);
      let value: T;
      try {
        value = await body(tx);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
      if (control.commitLost && --control.commitLost === 0)
        throw new Error("Synthetic COMMIT ACK lost");
      return value;
    });
    tail = run.catch(() => undefined);
    return run;
  }
  const database = async () => ({ transaction }),
    permission = async () => undefined;
  const configuration = async (
    _tx: DbExecutor,
    _workspaceId: number,
    kind: "daily" | "monthly"
  ) => {
    const contract = syntheticSaihuContract(kind),
      contractHash = saihuReportHash(contract);
    return {
      connectionVersion: control.connectionVersion,
      contractHash,
      configurationHash: saihuReportHash({
        connectionVersion: control.connectionVersion,
        contractHash,
      }),
      contract,
    };
  };
  const monthly = createMonthlyFinancialWriteRepository({
    database,
    permission,
    directory: async () => undefined,
    enabled: () => control.monthlyEnabled,
    verifyApiArtifact: (tx, prepared, manifest, rows, purpose) =>
      verifySaihuMonthlyArtifact(
        tx,
        prepared,
        manifest,
        rows,
        purpose,
        configuration
      ),
    synchronizeBoards: async value => {
      state.board.push({
        action: value.action,
        batchId: value.afterBatch.id,
        completedIds: value.completedAfter.map(row => row.id),
      });
      if (control.failBoard) throw new Error("synthetic board failure");
    },
  });
  const repository = createSaihuReportRepository({
    database,
    now: () => control.now,
    enabled: () => control.enabled,
    authorize: (tx, identity, action) =>
      authorizeSaihuReport(tx, identity, action, permission),
    configuration,
    monthly,
  });
  const scope: SaihuReportScope = {
    kind: "daily",
    start: "2026-10-01",
    end: "2026-10-01",
  };
  return {
    state,
    control,
    calls,
    tx,
    transaction,
    database,
    repository,
    monthly,
    configuration,
    cols,
    indexes,
    identity: fixtureIdentity,
    scope,
  };
}
