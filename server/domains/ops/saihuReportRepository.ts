import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import type { TrpcContext } from "../../_core/context";
import {
  SAIHU_REPORT_KIND,
  SAIHU_REPORT_SOURCE_KEY,
  SAIHU_REPORT_PREVIEW_KEY,
  SaihuReportIdentitySchema,
  SaihuReportStartInputSchema,
  SaihuReportOperationInputSchema,
  SaihuReportInspectInputSchema,
  SaihuReportApplyInputSchema,
  SaihuReportApplyOperationInputSchema,
  SaihuReportReceiptSchema,
  SaihuReportPublicRunSchema,
  saihuReportHash,
  saihuReportCanonical,
  type SaihuReportIdentity,
  type SaihuReportStartInput,
  type SaihuReportOperationInput,
  type SaihuReportApplyInput,
  type SaihuReportApplyOperationInput,
  type SaihuReportSource,
  type SaihuReportScope,
  type SaihuReportReceipt,
} from "../../../shared/saihuReportSync";
import { monthlyFinancialBatchVersion } from "../../../shared/monthlyFinancialWrite";
import {
  MonthlyFinancialApiPreparedSchema,
  MonthlyFinancialApiManifestSchema,
} from "../../../shared/monthlyFinancialApiSource";
import {
  monthlyFinancialWriteRepository,
  type MonthlyFinancialWriteSession,
} from "./monthlyFinancialWriteRepository";
import {
  saihuReportConfiguration,
  saihuReportCredentials,
  SaihuReportError,
  saihuReportFail,
  type SaihuReportConfiguration,
} from "./saihuReportContract";
import {
  assertSaihuReportSchema,
  authorizeSaihuReport,
  saihuReportRows,
  saihuReportWrite,
  saihuReportJson,
} from "./saihuReportStore";
import {
  SaihuReportFrozenInputSchema,
  SaihuReportOutputSchema,
  readSaihuReportRun,
  readSaihuReportPublication,
  saihuReportRunId,
  saihuReportArtifactId,
  saihuReportOperationKey,
  type SaihuReportOutput,
} from "./saihuReportProtocol";
import { validateSaihuReportSource } from "./saihuReportCoverage";
import {
  saihuMonthlyPayload,
  withSaihuMonthlyTransition,
  assertSaihuMonthlyReplacement,
} from "./saihuReportPublication";
import {
  readSaihuDailyBatches,
  assertSaihuDailyReplacement,
  buildSaihuDailyOverview,
} from "./saihuReportDaily";
import {
  saihuLegacyHistoryHash,
  readControlledSaihuOverview,
} from "./saihuReportLegacy";

export interface SaihuReportDatabase {
  transaction<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T>;
}
export type SaihuReportLease = {
  identity: SaihuReportIdentity;
  operationId: string;
  runId: string;
  token: string;
};
const initial = (): SaihuReportOutput => ({
  version: 1,
  state: "queued",
  dispatched: false,
  reasonCode: null,
  previewHash: null,
  sourceHash: null,
  batchId: null,
  applied: false,
  revoked: false,
});
const publicRun = (
  run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>
) =>
  SaihuReportPublicRunSchema.parse({
    identity: run.input.identity,
    operationId: run.input.operationId,
    scope: run.input.request.scope,
    state: run.output.state,
    previewHash: run.output.previewHash,
    sourceHash: run.output.sourceHash,
    batchId: run.output.batchId,
    applied: run.output.applied,
    revoked: run.output.revoked,
    reasonCode: run.output.reasonCode,
  });
const json = (value: unknown) => {
  const wire = saihuReportCanonical(value);
  if (Buffer.byteLength(wire) > 24 * 1024 * 1024)
    return saihuReportFail("SOURCE_BUDGET");
  return wire;
};
const scopeOverlaps = (a: SaihuReportScope, b: SaihuReportScope) =>
  a.kind === b.kind && a.start <= b.end && a.end >= b.start;
export function saihuReportContextIdentity(
  ctx: TrpcContext,
  expectedWorkspaceId: number
): SaihuReportIdentity {
  if (!ctx.user || ctx.workspaceId === null)
    return saihuReportFail("ACCESS_DENIED");
  const identity = SaihuReportIdentitySchema.parse({
    userId: ctx.user.id,
    workspaceId:
      ctx.workspaceId === undefined
        ? ctx.user.defaultWorkspaceId
        : ctx.workspaceId,
  });
  if (identity.workspaceId !== expectedWorkspaceId)
    return saihuReportFail("WORKSPACE_CHANGED");
  return identity;
}

export function createSaihuReportRepository(
  dependencies: {
    database?: () => Promise<SaihuReportDatabase | null>;
    enabled?: () => boolean;
    now?: () => number;
    authorize?: typeof authorizeSaihuReport;
    schema?: typeof assertSaihuReportSchema;
    configuration?: typeof saihuReportConfiguration;
    monthly?: typeof monthlyFinancialWriteRepository;
  } = {}
) {
  const database = dependencies.database ?? getDb,
    enabled =
      dependencies.enabled ??
      (() => process.env.ENABLE_SAIHU_REPORT_WRITES === "true"),
    now = dependencies.now ?? Date.now,
    authorize = dependencies.authorize ?? authorizeSaihuReport,
    schema = dependencies.schema ?? assertSaihuReportSchema,
    configuration = dependencies.configuration ?? saihuReportConfiguration,
    monthly = dependencies.monthly ?? monthlyFinancialWriteRepository;
  const activeSessions = new WeakMap<
    MonthlyFinancialWriteSession,
    "read" | "create" | "update" | "delete"
  >();
  function requireSession(
    current: MonthlyFinancialWriteSession,
    create = false
  ) {
    if (
      !activeSessions.has(current) ||
      (create && activeSessions.get(current) !== "create")
    )
      saihuReportFail("TRANSACTION_SESSION_REQUIRED");
  }
  async function transaction<T>(
    identity: SaihuReportIdentity,
    action: "read" | "create" | "update" | "delete",
    body: (current: MonthlyFinancialWriteSession) => Promise<T>
  ) {
    const db = await database();
    if (!db || typeof db.transaction !== "function")
      return saihuReportFail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      const current = await authorize(tx, identity, action);
      await schema(tx);
      activeSessions.set(current, action);
      try {
        return await body(current);
      } finally {
        activeSessions.delete(current);
      }
    });
  }
  async function historyHash(current: MonthlyFinancialWriteSession) {
    const daily = await readSaihuDailyBatches(
        current.tx,
        current.identity.workspaceId
      ),
      completed = await monthly.server.completedInTransaction(current);
    return saihuReportHash({
      legacy: await saihuLegacyHistoryHash(
        current.tx,
        current.identity.workspaceId
      ),
      daily: daily
        .filter(batch => batch.status !== "previewing")
        .map(({ id, status, sourceHash, previewHash }) => ({
          id,
          status,
          sourceHash,
          previewHash,
        })),
      monthly: completed.map(batch => ({
        id: batch.id,
        version: monthlyFinancialBatchVersion(batch),
      })),
    });
  }
  async function configurationFor(
    current: MonthlyFinancialWriteSession,
    scope: SaihuReportScope
  ) {
    const config = await configuration(
      current.tx,
      current.identity.workspaceId,
      scope.kind
    );
    if (
      config.contract.workspaceId !== current.identity.workspaceId ||
      config.contract.kind !== scope.kind ||
      config.contractHash !== saihuReportHash(config.contract) ||
      config.configurationHash !==
        saihuReportHash({
          connectionVersion: config.connectionVersion,
          contractHash: config.contractHash,
        })
    )
      return saihuReportFail("CONFIGURATION_INVALID");
    return config;
  }
  const gate = () => {
    if (!enabled()) saihuReportFail("WRITES_NOT_ENABLED");
  };
  const closedPeriod = (scope: SaihuReportScope) => {
    const today = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    return scope.end < (scope.kind === "daily" ? today : today.slice(0, 7));
  };
  async function audit(
    current: MonthlyFinancialWriteSession,
    operationId: string,
    action: "start" | "apply" | "revoke" | "cancel",
    receipt?: SaihuReportReceipt
  ): Promise<SaihuReportReceipt | null> {
    const auditId = `saihu_${action === "cancel" ? "cancel" : "operation"}_${saihuReportOperationKey(current.identity, operationId)}`,
      receiptAction = action === "cancel" ? "start" : action,
      rows = await saihuReportRows(
        current.tx,
        "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadata FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR UPDATE",
        [auditId],
        2
      );
    if (rows.length) {
      const row = rows[0];
      if (
        rows.length !== 1 ||
        row.auditId !== auditId ||
        row.workspaceId !== current.identity.workspaceId ||
        row.actorUserId !== current.identity.userId ||
        row.action !== `ops.saihu_report.${action}` ||
        row.resourceType !== "ops_saihu_report_operation" ||
        row.resourceId !== operationId ||
        row.status !== "success"
      )
        return saihuReportFail("OPERATION_SCOPE_INVALID");
      const saved = SaihuReportReceiptSchema.parse(
        saihuReportJson(row.metadata, 32768)
      );
      if (
        saved.identity.userId !== current.identity.userId ||
        saved.identity.workspaceId !== current.identity.workspaceId ||
        saved.operationId !== operationId ||
        saved.action !== receiptAction ||
        saved.status === "unknown" ||
        (action === "cancel" && saved.status !== "cancelled")
      )
        return saihuReportFail("OPERATION_BINDING_INVALID");
      if (receipt && saihuReportHash(saved) !== saihuReportHash(receipt))
        return saihuReportFail("OPERATION_CONFLICT");
      return saved;
    }
    if (!receipt) return null;
    await saihuReportWrite(
      current.tx,
      "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'ops_saihu_report_operation',?,'success','medium',?)",
      [
        auditId,
        current.identity.workspaceId,
        current.identity.userId,
        current.role,
        `ops.saihu_report.${action}`,
        operationId,
        json(receipt),
      ]
    );
    const saved = await audit(current, operationId, action);
    if (!saved || saihuReportHash(saved) !== saihuReportHash(receipt))
      return saihuReportFail("ACK_UNVERIFIABLE");
    return saved;
  }
  async function update(
    current: MonthlyFinancialWriteSession,
    run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>,
    output: SaihuReportOutput,
    release = false
  ) {
    const parsed = SaihuReportOutputSchema.parse(output),
      status = (
        {
          queued: "queued",
          running: "running",
          preview: "succeeded",
          failed: "failed",
          unknown: "failed",
          cancelled: "canceled",
        } as const
      )[parsed.state];
    await saihuReportWrite(
      current.tx,
      `UPDATE ai_jobs SET status=?,output=?,progress=?,updatedAt=CURRENT_TIMESTAMP${release ? ",lockedBy=NULL,leaseUntil=NULL,completedAt=CURRENT_TIMESTAMP" : ""} WHERE runId=? AND workspaceId=? AND userId=? AND kind=? AND projectId IS NULL`,
      [
        status,
        json(parsed),
        parsed.state === "preview" ? 100 : 0,
        run.runId,
        current.identity.workspaceId,
        current.identity.userId,
        SAIHU_REPORT_KIND,
      ]
    );
    const saved = await readSaihuReportRun(
      current.tx,
      current.identity,
      run.input.operationId
    );
    if (!saved || saihuReportHash(saved.output) !== saihuReportHash(parsed))
      return saihuReportFail("ACK_UNVERIFIABLE");
    return saved;
  }
  async function preview(
    identity: SaihuReportIdentity,
    scope: SaihuReportScope
  ) {
    return transaction(identity, "read", current =>
      previewInTransaction(current, scope)
    );
  }
  async function previewInTransaction(
    current: MonthlyFinancialWriteSession,
    scope: SaihuReportScope
  ) {
    requireSession(current);
    const identity = current.identity;
    const currentHistoryHash = await historyHash(current);
    let config: SaihuReportConfiguration | null = null,
      reasonCode: string | null = enabled() ? null : "WRITES_NOT_ENABLED";
    try {
      config = await configurationFor(current, scope);
    } catch (error) {
      if (error instanceof SaihuReportError) reasonCode = error.code;
      else throw error;
    }
    if (!closedPeriod(scope)) reasonCode = "REPORT_PERIOD_NOT_CLOSED";
    if (scope.kind === "monthly" && !monthly.server.writesEnabled())
      reasonCode = "MONTHLY_WRITES_NOT_ENABLED";
    return {
      identity,
      scope,
      historyHash: currentHistoryHash,
      configurationHash: config?.configurationHash ?? null,
      shops: config?.contract.shops ?? [],
      capability: {
        status: reasonCode ? ("unavailable" as const) : ("available" as const),
        reasonCode,
      },
      reportingCalendar:
        scope.kind === "daily" ? "saturday_friday" : "settlement_month",
      currency: "USD",
      autoApply: false as const,
    };
  }
  async function start(
    identity: SaihuReportIdentity,
    raw: SaihuReportStartInput
  ) {
    return transaction(identity, "create", current =>
      startInTransaction(current, raw)
    );
  }
  async function startInTransaction(
    current: MonthlyFinancialWriteSession,
    raw: SaihuReportStartInput
  ) {
    requireSession(current, true);
    const identity = current.identity;
    const input = SaihuReportStartInputSchema.parse(raw),
      requestHash = saihuReportHash({ identity, request: input });
    if (input.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    const cancelled = await audit(current, input.operationId, "cancel");
    if (cancelled) return cancelled;
    const previous = await audit(current, input.operationId, "start");
    if (previous) {
      if (
        previous.status !== "cancelled" &&
        previous.requestHash !== requestHash
      )
        saihuReportFail("OPERATION_CONFLICT");
      return previous;
    }
    gate();
    if (!closedPeriod(input.scope)) saihuReportFail("REPORT_PERIOD_NOT_CLOSED");
    if (input.scope.kind === "monthly" && !monthly.server.writesEnabled())
      saihuReportFail("MONTHLY_WRITES_NOT_ENABLED");
    const config = await configurationFor(current, input.scope);
    if (
      config.configurationHash !== input.expectedConfigurationHash ||
      (await historyHash(current)) !== input.expectedHistoryHash
    )
      saihuReportFail("SOURCE_OR_CONFIGURATION_CHANGED");
    const pending = await saihuReportRows(
      current.tx,
      "SELECT runId,userId,IF(OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=262144,CAST(input AS CHAR CHARACTER SET utf8mb4),NULL) AS input,IF(OCTET_LENGTH(CAST(output AS CHAR CHARACTER SET utf8mb4))<=65536,CAST(output AS CHAR CHARACTER SET utf8mb4),NULL) AS output FROM ai_jobs WHERE workspaceId=? AND kind=? AND projectId IS NULL AND status IN ('queued','running','succeeded','failed') ORDER BY id LIMIT 201 FOR UPDATE",
      [identity.workspaceId, SAIHU_REPORT_KIND],
      201
    );
    if (pending.length > 200) saihuReportFail("PENDING_BUDGET");
    for (const row of pending) {
      const frozen = SaihuReportFrozenInputSchema.parse(
          saihuReportJson(row.input, 262144)
        ),
        output = SaihuReportOutputSchema.parse(
          saihuReportJson(row.output, 65536)
        );
      if (
        frozen.identity.workspaceId !== identity.workspaceId ||
        frozen.identity.userId !== row.userId ||
        row.runId !== saihuReportRunId(frozen.identity, frozen.operationId)
      )
        saihuReportFail("JOB_SCOPE_INVALID");
      if (
        !output.applied &&
        !output.revoked &&
        ["queued", "running", "preview", "unknown"].includes(output.state) &&
        scopeOverlaps(frozen.request.scope, input.scope)
      )
        saihuReportFail("RESOLVE_PENDING_SCOPE_FIRST");
    }
    const frozen = SaihuReportFrozenInputSchema.parse({
        version: 1,
        identity,
        operationId: input.operationId,
        request: input,
        requestHash,
        connectionVersion: config.connectionVersion,
        contractHash: config.contractHash,
        contract: config.contract,
      }),
      runId = saihuReportRunId(identity, input.operationId);
    await saihuReportWrite(
      current.tx,
      "INSERT INTO ai_jobs (workspaceId,runId,kind,module,procedure,status,progress,queueName,attempt,maxAttempts,timeoutSeconds,userId,projectId,input,output) VALUES (?,?,?,'ops','opsSaihuReport.start','queued',0,'saihu-report',0,1,3600,?,NULL,?,?)",
      [
        identity.workspaceId,
        runId,
        SAIHU_REPORT_KIND,
        identity.userId,
        json(frozen),
        json(initial()),
      ]
    );
    const run = await readSaihuReportRun(
      current.tx,
      identity,
      input.operationId
    );
    if (!run || saihuReportHash(run.input) !== saihuReportHash(frozen))
      saihuReportFail("ACK_UNVERIFIABLE");
    return audit(current, input.operationId, "start", {
      identity,
      operationId: input.operationId,
      runOperationId: input.operationId,
      action: "start",
      status: "committed",
      requestHash,
      batchId: null,
      resultHash: saihuReportHash(frozen),
    });
  }
  async function check(
    identity: SaihuReportIdentity,
    raw: SaihuReportOperationInput
  ) {
    const input = SaihuReportOperationInputSchema.parse(raw);
    if (input.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    return transaction(identity, "read", async current => {
      const receipt =
          (await audit(current, input.operationId, "cancel")) ??
          (await audit(current, input.operationId, "start")),
        run = await readSaihuReportRun(current.tx, identity, input.operationId);
      return { receipt, run: run ? publicRun(run) : null };
    });
  }
  async function cancel(
    identity: SaihuReportIdentity,
    raw: SaihuReportOperationInput
  ) {
    const input = SaihuReportOperationInputSchema.parse(raw);
    if (input.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    return transaction(identity, "read", async current => {
      const prior = await audit(current, input.operationId, "cancel");
      if (prior) return prior;
      const receipt = await audit(current, input.operationId, "start"),
        run = await readSaihuReportRun(current.tx, identity, input.operationId);
      if (run?.output.applied) saihuReportFail("USE_REVOKE_FOR_APPLIED_REPORT");
      if (run && run.output.state !== "cancelled")
        await update(
          current,
          run,
          { ...run.output, state: "cancelled", reasonCode: "CANCELLED" },
          true
        );
      return audit(current, input.operationId, "cancel", {
        identity,
        operationId: input.operationId,
        runOperationId: input.operationId,
        action: "start",
        status: "cancelled",
        requestHash: receipt?.requestHash ?? null,
        batchId: null,
        resultHash: null,
      });
    });
  }
  async function leased(
    current: MonthlyFinancialWriteSession,
    lease: SaihuReportLease
  ) {
    const run = await readSaihuReportRun(
      current.tx,
      lease.identity,
      lease.operationId
    );
    if (
      !run ||
      run.runId !== lease.runId ||
      run.output.state !== "running" ||
      run.lockedBy !== lease.token ||
      typeof run.leaseUntil !== "number" ||
      run.leaseUntil <= now()
    )
      return saihuReportFail("LEASE_OR_CANCEL_CHANGED");
    return run;
  }
  async function claim(
    identity: SaihuReportIdentity,
    raw: SaihuReportOperationInput
  ) {
    const input = SaihuReportOperationInputSchema.parse(raw);
    return transaction(identity, "create", async current => {
      gate();
      const run = await readSaihuReportRun(
        current.tx,
        identity,
        input.operationId
      );
      if (!run) saihuReportFail("RUN_NOT_FOUND");
      if (run.output.state === "running" && Number(run.leaseUntil) <= now()) {
        await update(
          current,
          run,
          {
            ...run.output,
            state: "unknown",
            reasonCode: "INTERRUPTED_CHECK_OR_CANCEL_SAME_OPERATION",
          },
          true
        );
        return null;
      }
      if (run.output.state !== "queued") return null;
      const config = await configurationFor(current, run.input.request.scope);
      if (
        config.configurationHash !== run.input.request.expectedConfigurationHash
      )
        saihuReportFail("CONFIGURATION_CHANGED");
      const token = randomUUID();
      await saihuReportWrite(
        current.tx,
        "UPDATE ai_jobs SET status='running',output=?,attempt=1,lockedBy=?,leaseUntil=FROM_UNIXTIME(?/1000),startedAt=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status='queued' AND kind=?",
        [
          json({ ...run.output, state: "running" }),
          token,
          now() + 120000,
          run.runId,
          SAIHU_REPORT_KIND,
        ]
      );
      const saved = await readSaihuReportRun(
        current.tx,
        identity,
        input.operationId
      );
      if (
        !saved ||
        saved.lockedBy !== token ||
        saved.output.state !== "running"
      )
        saihuReportFail("ACK_UNVERIFIABLE");
      return {
        identity,
        operationId: input.operationId,
        runId: run.runId,
        token,
      };
    });
  }
  async function heartbeat(lease: SaihuReportLease) {
    return transaction(lease.identity, "create", async current => {
      await leased(current, lease);
      await saihuReportWrite(
        current.tx,
        "UPDATE ai_jobs SET leaseUntil=FROM_UNIXTIME(?/1000),lastHeartbeatAt=CURRENT_TIMESTAMP WHERE runId=? AND lockedBy=? AND kind=? AND status='running'",
        [now() + 120000, lease.runId, lease.token, SAIHU_REPORT_KIND]
      );
    });
  }
  async function dispatch(lease: SaihuReportLease) {
    return transaction(lease.identity, "create", async current => {
      gate();
      const run = await leased(current, lease);
      if (run.output.dispatched) saihuReportFail("ALREADY_DISPATCHED");
      const config = await configurationFor(current, run.input.request.scope);
      if (
        config.configurationHash !== run.input.request.expectedConfigurationHash
      )
        saihuReportFail("CONFIGURATION_CHANGED");
      await update(current, run, { ...run.output, dispatched: true });
      return run.input;
    });
  }
  async function beforeRead(lease: SaihuReportLease) {
    return transaction(lease.identity, "create", async current => {
      gate();
      const run = await leased(current, lease);
      if (!run.output.dispatched) saihuReportFail("NOT_DISPATCHED");
      const config = await configurationFor(current, run.input.request.scope);
      if (
        config.configurationHash !== run.input.request.expectedConfigurationHash
      )
        saihuReportFail("CONFIGURATION_CHANGED");
    });
  }
  async function credentials(lease: SaihuReportLease) {
    return transaction(lease.identity, "create", async current => {
      const run = await leased(current, lease);
      if (!run.output.dispatched) saihuReportFail("NOT_DISPATCHED");
      return saihuReportCredentials(
        current.tx,
        current.identity.workspaceId,
        run.input.connectionVersion
      );
    });
  }
  async function artifact(
    current: MonthlyFinancialWriteSession,
    run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>,
    kind: "source" | "preview",
    value: unknown
  ) {
    await saihuReportWrite(
      current.tx,
      "INSERT INTO ai_artifacts (artifactId,workspaceId,userId,projectId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,status,isCurrent,version,contentJson,contentHash) VALUES (?,?,?,NULL,'ops',?,'json','tool_output','ai_jobs',?,?,'final',0,1,?,?)",
      [
        saihuReportArtifactId(current.identity, run.input.operationId, kind),
        current.identity.workspaceId,
        current.identity.userId,
        kind === "source" ? SAIHU_REPORT_SOURCE_KEY : SAIHU_REPORT_PREVIEW_KEY,
        String(run.id),
        run.runId,
        json(value),
        saihuReportHash(value),
      ]
    );
  }
  async function finish(lease: SaihuReportLease, source: SaihuReportSource) {
    return transaction(lease.identity, "create", async current => {
      const run = await leased(current, lease);
      if (!run.output.dispatched) saihuReportFail("NOT_DISPATCHED");
      const preview = validateSaihuReportSource(source, run.input.contract);
      if (
        source.operationId !== run.input.operationId ||
        source.identity.workspaceId !== current.identity.workspaceId ||
        source.identity.userId !== current.identity.userId ||
        source.connectionVersion !== run.input.connectionVersion ||
        source.contractHash !== run.input.contractHash
      )
        saihuReportFail("SOURCE_BINDING_INVALID");
      await artifact(current, run, "source", source);
      await artifact(current, run, "preview", preview);
      let batchId: number | null = null;
      if (source.scope.kind === "daily") {
        batchId = await saihuReportWrite(
          current.tx,
          "INSERT INTO ops_saihu_daily_report_batches (workspace_id,user_id,run_id,operation_id,status,source_hash,preview_hash,scope,coverage,facts,created_at,confirmed_at) VALUES (?,?,?,?,'previewing',?,?,?,?,?,CURRENT_TIMESTAMP(3),NULL)",
          [
            current.identity.workspaceId,
            current.identity.userId,
            run.runId,
            run.input.operationId,
            preview.sourceHash,
            preview.previewHash,
            json(preview.scope),
            json(preview.coverage),
            json(preview.dailyRows),
          ]
        );
        if (!batchId) saihuReportFail("ACK_UNVERIFIABLE");
      } else if (
        preview.coverage.complete &&
        preview.monthlyRows.length &&
        !preview.coverage.observed.some(value => value.rowCount === 0)
      ) {
        const payload = saihuMonthlyPayload(preview),
          prepared = MonthlyFinancialApiPreparedSchema.parse({
            kind: "saihu_api_v1",
            identity: current.identity,
            operationId: run.input.operationId,
            sourceRunId: run.id,
            runId: run.runId,
            sourceArtifactId: saihuReportArtifactId(
              current.identity,
              run.input.operationId,
              "source"
            ),
            sourceHash: preview.sourceHash,
            contractHash: preview.contractHash,
            connectionVersion: run.input.connectionVersion,
          }),
          manifest = MonthlyFinancialApiManifestSchema.parse({
            kind: "saihu_api_manifest_v1",
            format: "saihu_api_json",
            sourceHash: preview.sourceHash,
            payloadHash: saihuReportHash(payload),
            contractHash: preview.contractHash,
            sourceRunId: run.id,
            coverage: preview.coverage,
            counts: { normalizedRows: payload.length },
            blockingReasons: [],
          });
        batchId = (
          await monthly.server.createApiPreviewInTransaction(
            current,
            prepared,
            manifest,
            payload
          )
        ).record.id;
      }
      const saved = await update(
        current,
        run,
        {
          ...run.output,
          state: "preview",
          sourceHash: preview.sourceHash,
          previewHash: preview.previewHash,
          batchId,
          reasonCode: preview.coverage.complete
            ? batchId
              ? null
              : "MONTH_SCOPE_NOT_REPRESENTABLE"
            : "COVERAGE_INCOMPLETE",
        },
        true
      );
      await readSaihuReportPublication(
        current.tx,
        current.identity,
        run.input.operationId
      );
      return publicRun(saved);
    });
  }
  async function failure(lease: SaihuReportLease, code: string) {
    return transaction(lease.identity, "create", async current => {
      const run = await leased(current, lease);
      return publicRun(
        await update(
          current,
          run,
          {
            ...run.output,
            state: "failed",
            reasonCode: /^[A-Z][A-Z0-9_]{0,99}$/u.test(code)
              ? code
              : "CAPTURE_FAILED",
          },
          true
        )
      );
    });
  }
  async function inspect(
    identity: SaihuReportIdentity,
    raw: SaihuReportOperationInput & { rowOffset?: number; pageSize?: number }
  ) {
    const request = SaihuReportInspectInputSchema.parse(raw);
    if (request.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    return transaction(identity, "read", async current => {
      const proof = await readSaihuReportPublication(
          current.tx,
          identity,
          request.operationId
        ),
        { preview, run } = proof,
        daily = await readSaihuDailyBatches(current.tx, identity.workspaceId),
        state =
          run.input.request.scope.kind === "monthly" && run.output.batchId
            ? await monthly.server.inspectInTransaction(
                current,
                run.output.batchId
              )
            : null,
        offset = request.rowOffset,
        limit = request.pageSize,
        allRows =
          preview.scope.kind === "daily"
            ? preview.dailyRows
            : preview.monthlyRows;
      let applyBlockingReason: string | null = !enabled()
        ? "WRITES_NOT_ENABLED"
        : !preview.coverage.complete
          ? "COVERAGE_INCOMPLETE"
          : run.output.state !== "preview" ||
              run.output.applied ||
              run.output.revoked
            ? "REPORT_NOT_PENDING_APPLICATION"
            : !run.output.batchId
              ? "SOURCE_PREVIEW_NOT_READY"
              : null;
      if (!applyBlockingReason)
        try {
          if (preview.scope.kind === "daily") {
            const target = daily.find(batch => batch.id === run.output.batchId);
            if (!target) saihuReportFail("BATCH_CHANGED");
            assertSaihuDailyReplacement(daily, target);
          } else {
            if (!monthly.server.writesEnabled())
              saihuReportFail("MONTHLY_WRITES_NOT_ENABLED");
            if (
              !state ||
              state.record.status !== "previewing" ||
              state.impact.blockingReasons.length
            )
              saihuReportFail("MONTH_IMPACT_BLOCKED");
            assertSaihuMonthlyReplacement(state.record, state.completed);
          }
        } catch (error) {
          if (error instanceof SaihuReportError)
            applyBlockingReason = error.code;
          else throw error;
        }
      return {
        run: publicRun(run),
        historyHash: await historyHash(current),
        coverage: preview.coverage,
        rows: allRows
          .slice(offset, offset + limit)
          .map(({ raw: _raw, ...row }) => row),
        rowPage: {
          offset,
          limit,
          total: allRows.length,
          hasMore: offset + limit < allRows.length,
        },
        monthlyImpact: state?.impact ?? null,
        monthlyBatchVersion: state
          ? monthlyFinancialBatchVersion(state.record, state.artifact)
          : null,
        dailyOverview:
          preview.scope.kind === "daily" ? buildSaihuDailyOverview(daily) : [],
        canApply: applyBlockingReason === null,
        applyBlockingReason,
        canRevoke:
          enabled() &&
          run.output.applied &&
          !run.output.revoked &&
          (preview.scope.kind !== "monthly" || monthly.server.writesEnabled()),
      };
    });
  }
  async function transition(
    identity: SaihuReportIdentity,
    raw: SaihuReportApplyInput,
    action: "apply" | "revoke"
  ) {
    const input = SaihuReportApplyInputSchema.parse(raw),
      requestHash = saihuReportHash({ identity, action, request: input });
    if (input.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    return transaction(
      identity,
      action === "apply" ? "update" : "delete",
      async current => {
        const previous = await audit(current, input.operationId, action);
        if (previous) {
          if (
            previous.runOperationId !== input.runOperationId ||
            (previous.status !== "cancelled" &&
              previous.requestHash !== requestHash)
          )
            saihuReportFail("OPERATION_CONFLICT");
          return previous;
        }
        gate();
        const proof = await readSaihuReportPublication(
            current.tx,
            identity,
            input.runOperationId
          ),
          { run, preview } = proof;
        if (
          preview.previewHash !== input.expectedPreviewHash ||
          (await historyHash(current)) !== input.expectedHistoryHash
        )
          saihuReportFail("SOURCE_OR_HISTORY_CHANGED");
        if (
          run.output.state !== "preview" ||
          !run.output.batchId ||
          (action === "apply" &&
            (run.output.applied ||
              run.output.revoked ||
              !preview.coverage.complete ||
              preview.coverage.blockingReasons.length)) ||
          (action === "revoke" && (!run.output.applied || run.output.revoked))
        )
          saihuReportFail("TRANSITION_BLOCKED");
        if (action === "apply") {
          const config = await configurationFor(
            current,
            run.input.request.scope
          );
          if (
            config.configurationHash !==
            run.input.request.expectedConfigurationHash
          )
            saihuReportFail("CONFIGURATION_CHANGED");
        }
        if (preview.scope.kind === "daily") {
          const batches = await readSaihuDailyBatches(
              current.tx,
              identity.workspaceId
            ),
            target = batches.find(batch => batch.id === run.output.batchId);
          if (
            !target ||
            target.runId !== run.runId ||
            target.status !== (action === "apply" ? "previewing" : "completed")
          )
            saihuReportFail("BATCH_CHANGED");
          if (action === "apply") assertSaihuDailyReplacement(batches, target);
          await saihuReportWrite(
            current.tx,
            `UPDATE ops_saihu_daily_report_batches SET status=?${action === "apply" ? ",confirmed_at=CURRENT_TIMESTAMP(3)" : ""} WHERE workspace_id=? AND id=? AND status=?`,
            [
              action === "apply" ? "completed" : "revoked",
              identity.workspaceId,
              target.id,
              target.status,
            ]
          );
          const saved = (
            await readSaihuDailyBatches(current.tx, identity.workspaceId)
          ).find(batch => batch.id === target.id);
          if (
            !saved ||
            saved.status !== (action === "apply" ? "completed" : "revoked")
          )
            saihuReportFail("ACK_UNVERIFIABLE");
        } else {
          const state = await monthly.server.inspectInTransaction(
            current,
            run.output.batchId
          );
          if (!state.artifact) saihuReportFail("MONTH_SOURCE_REPLAY_MISMATCH");
          const prepared = MonthlyFinancialApiPreparedSchema.parse(
              state.artifact.prepared
            ),
            receipt = await withSaihuMonthlyTransition(
              current.tx,
              prepared,
              action === "apply" ? "confirm" : "revoke",
              () =>
                monthly.server.transitionInTransaction(
                  current,
                  {
                    expectedWorkspaceId: identity.workspaceId,
                    operationId: input.operationId,
                    batchId: run.output.batchId!,
                    expectedBatchVersion: monthlyFinancialBatchVersion(
                      state.record,
                      state.artifact
                    ),
                    expectedImpactKey: state.impact.key,
                    fullScopeAcknowledged: true,
                  },
                  action === "apply" ? "confirm" : "revoke"
                )
            );
          if (receipt.status !== "committed")
            saihuReportFail("MONTH_TRANSITION_UNCONFIRMED");
        }
        await update(current, run, {
          ...run.output,
          applied: true,
          revoked: action === "revoke",
        });
        const receipt = SaihuReportReceiptSchema.parse({
          identity,
          operationId: input.operationId,
          runOperationId: input.runOperationId,
          action,
          status: "committed",
          requestHash,
          batchId: run.output.batchId,
          resultHash: await historyHash(current),
        });
        return audit(current, input.operationId, action, receipt);
      }
    );
  }
  async function operation(
    identity: SaihuReportIdentity,
    raw: SaihuReportApplyOperationInput,
    action: "apply" | "revoke",
    cancel = false
  ) {
    const input = SaihuReportApplyOperationInputSchema.parse(raw);
    if (input.expectedWorkspaceId !== identity.workspaceId)
      saihuReportFail("WORKSPACE_CHANGED");
    return transaction(identity, "read", async current => {
      const saved = await audit(current, input.operationId, action);
      if (saved) {
        if (saved.runOperationId !== input.runOperationId)
          saihuReportFail("OPERATION_CONFLICT");
        return saved;
      }
      if (!cancel)
        return SaihuReportReceiptSchema.parse({
          identity,
          operationId: input.operationId,
          runOperationId: input.runOperationId,
          action,
          status: "unknown",
          requestHash: null,
          batchId: null,
          resultHash: null,
        });
      return audit(current, input.operationId, action, {
        identity,
        operationId: input.operationId,
        runOperationId: input.runOperationId,
        action,
        status: "cancelled",
        requestHash: null,
        batchId: null,
        resultHash: null,
      });
    });
  }
  async function history(
    identity: SaihuReportIdentity,
    cursor: number | null,
    limit: number
  ) {
    return transaction(identity, "read", async current => {
      const found = await saihuReportRows(
          current.tx,
          `SELECT id,IF(OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=262144,CAST(input AS CHAR CHARACTER SET utf8mb4),NULL) AS input FROM ai_jobs WHERE workspaceId=? AND userId=? AND projectId IS NULL AND kind=? ${cursor ? "AND id<?" : ""} ORDER BY id DESC LIMIT ?`,
          [
            identity.workspaceId,
            identity.userId,
            SAIHU_REPORT_KIND,
            ...(cursor ? [cursor] : []),
            limit + 1,
          ],
          limit + 1
        ),
        records = [];
      for (const row of found.slice(0, limit)) {
        const frozen = SaihuReportFrozenInputSchema.parse(
            saihuReportJson(row.input, 262144)
          ),
          run = await readSaihuReportRun(
            current.tx,
            identity,
            frozen.operationId
          );
        if (!run || run.id !== row.id) saihuReportFail("HISTORY_CHANGED");
        records.push(publicRun(run));
      }
      return {
        identity,
        runs: records,
        nextCursor: found.length > limit ? Number(found[limit - 1].id) : null,
        hasMore: found.length > limit,
      };
    });
  }
  async function dailyOverview(
    identity: SaihuReportIdentity,
    marketplace = "ALL",
    weeks = 12
  ) {
    const db = await database();
    if (!db) saihuReportFail("TRANSACTION_REQUIRED");
    await transaction(identity, "read", async () => undefined);
    const result = await readControlledSaihuOverview(
      db as NonNullable<Awaited<ReturnType<typeof getDb>>>,
      identity,
      marketplace,
      weeks
    );
    return {
      identity,
      products: result?.products ?? [],
      legacyOverlaps: result?.legacyOverlaps ?? [],
      reportingCalendar: "saturday_friday",
      sourceKind: "saihu_daily_controlled",
    };
  }
  return {
    server: {
      withTransaction: transaction,
      previewInTransaction,
      startInTransaction,
      writesEnabled: () => enabled(),
    },
    preview,
    start,
    check,
    cancel,
    inspect,
    history,
    dailyOverview,
    apply: (identity: SaihuReportIdentity, input: SaihuReportApplyInput) =>
      transition(identity, input, "apply"),
    revoke: (identity: SaihuReportIdentity, input: SaihuReportApplyInput) =>
      transition(identity, input, "revoke"),
    applyCheck: (
      identity: SaihuReportIdentity,
      input: SaihuReportApplyOperationInput
    ) => operation(identity, input, "apply"),
    applyCancel: (
      identity: SaihuReportIdentity,
      input: SaihuReportApplyOperationInput
    ) => operation(identity, input, "apply", true),
    revokeCheck: (
      identity: SaihuReportIdentity,
      input: SaihuReportApplyOperationInput
    ) => operation(identity, input, "revoke"),
    revokeCancel: (
      identity: SaihuReportIdentity,
      input: SaihuReportApplyOperationInput
    ) => operation(identity, input, "revoke", true),
    claim,
    heartbeat,
    dispatch,
    beforeRead,
    credentials,
    finish,
    failure,
  };
}
export const saihuReportRepository = createSaihuReportRepository();
