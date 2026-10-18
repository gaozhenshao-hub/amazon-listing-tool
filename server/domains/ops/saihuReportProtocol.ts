import { z } from "zod";
import {
  SaihuReportIdentitySchema,
  SaihuReportUuid,
  SaihuReportHash,
  SaihuReportScopeSchema,
  SaihuReportStartInputSchema,
  SAIHU_REPORT_KIND,
  SAIHU_REPORT_SOURCE_KEY,
  SAIHU_REPORT_PREVIEW_KEY,
  SaihuReportSourceSchema,
  SaihuReportCapturePreviewSchema,
  SaihuReportReceiptSchema,
  saihuReportHash,
  type SaihuReportIdentity,
} from "../../../shared/saihuReportSync";
import {
  SaihuReportContractSchema,
  saihuReportFail,
} from "./saihuReportContract";
import {
  saihuReportRows,
  saihuReportJson,
  type SaihuReportExecutor,
} from "./saihuReportStore";
import { validateSaihuReportSource } from "./saihuReportCoverage";

export const SaihuReportFrozenInputSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    request: SaihuReportStartInputSchema,
    requestHash: SaihuReportHash,
    connectionVersion: SaihuReportHash,
    contractHash: SaihuReportHash,
    contract: SaihuReportContractSchema,
  })
  .strict();
export const SaihuReportOutputSchema = z
  .object({
    version: z.literal(1),
    state: z.enum([
      "queued",
      "running",
      "preview",
      "failed",
      "cancelled",
      "unknown",
    ]),
    dispatched: z.boolean(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,99}$/u)
      .nullable(),
    previewHash: SaihuReportHash.nullable(),
    sourceHash: SaihuReportHash.nullable(),
    batchId: z.number().int().positive().nullable(),
    applied: z.boolean(),
    revoked: z.boolean(),
  })
  .strict();
export type SaihuReportFrozenInput = z.infer<
  typeof SaihuReportFrozenInputSchema
>;
export type SaihuReportOutput = z.infer<typeof SaihuReportOutputSchema>;
export const saihuReportOperationKey = (
  identity: SaihuReportIdentity,
  operationId: string
) =>
  saihuReportHash({
    identity: SaihuReportIdentitySchema.parse(identity),
    operationId: SaihuReportUuid.parse(operationId),
  });
export const saihuReportRunId = (
  identity: SaihuReportIdentity,
  operationId: string
) => `saihur_${saihuReportOperationKey(identity, operationId)}`;
export const saihuReportArtifactId = (
  identity: SaihuReportIdentity,
  operationId: string,
  kind: "source" | "preview"
) =>
  `${kind === "source" ? "saihus" : "saihup"}_${saihuReportOperationKey(identity, operationId)}`;
export async function readSaihuReportRun(
  tx: SaihuReportExecutor,
  identity: SaihuReportIdentity,
  operationId: string
) {
  const runId = saihuReportRunId(identity, operationId),
    rows = await saihuReportRows(
      tx,
      "SELECT id,workspaceId,userId,runId,kind,module,`procedure`,projectId,status,maxAttempts,IF(OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=262144,CAST(input AS CHAR CHARACTER SET utf8mb4),NULL) AS input,IF(OCTET_LENGTH(CAST(output AS CHAR CHARACTER SET utf8mb4))<=65536,CAST(output AS CHAR CHARACTER SET utf8mb4),NULL) AS output,lockedBy,UNIX_TIMESTAMP(leaseUntil)*1000 AS leaseUntil FROM ai_jobs WHERE runId=? LIMIT 2 FOR UPDATE",
      [runId],
      2
    );
  if (!rows.length) return null;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    typeof row.id !== "number" ||
    row.id < 1 ||
    row.workspaceId !== identity.workspaceId ||
    row.userId !== identity.userId ||
    row.runId !== runId ||
    row.kind !== SAIHU_REPORT_KIND ||
    row.module !== "ops" ||
    !["opsSaihuReport.start", "opsSaihuSchedule.occurrence"].includes(
      String(row.procedure)
    ) ||
    row.projectId !== null ||
    row.maxAttempts !== 1
  )
    return saihuReportFail("JOB_SCOPE_INVALID");
  const input = SaihuReportFrozenInputSchema.parse(
      saihuReportJson(row.input, 262144)
    ),
    output = SaihuReportOutputSchema.parse(saihuReportJson(row.output, 65536));
  if (
    input.identity.workspaceId !== identity.workspaceId ||
    input.identity.userId !== identity.userId ||
    input.operationId !== operationId ||
    input.request.operationId !== operationId ||
    input.request.expectedWorkspaceId !== identity.workspaceId ||
    input.requestHash !==
      saihuReportHash({ identity, request: input.request }) ||
    input.contractHash !== saihuReportHash(input.contract) ||
    input.request.expectedConfigurationHash !==
      saihuReportHash({
        connectionVersion: input.connectionVersion,
        contractHash: input.contractHash,
      }) ||
    input.contract.kind !== input.request.scope.kind ||
    input.contract.workspaceId !== identity.workspaceId ||
    !SaihuReportScopeSchema.safeParse(input.request.scope).success ||
    row.status !==
      (
        {
          queued: "queued",
          running: "running",
          preview: "succeeded",
          failed: "failed",
          unknown: "failed",
          cancelled: "canceled",
        } as const
      )[output.state]
  )
    return saihuReportFail("JOB_BINDING_INVALID");
  return {
    id: row.id,
    runId,
    procedure: row.procedure as
      | "opsSaihuReport.start"
      | "opsSaihuSchedule.occurrence",
    input,
    output,
    lockedBy: row.lockedBy,
    leaseUntil: row.leaseUntil,
  };
}
/** Small durable identity/scope proof for complete metadata window scans.
 * The original start journal, not a mutable scope hint, binds frozen input. */
export async function readSaihuReportStartReceipt(
  tx: SaihuReportExecutor,
  run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>
) {
  const { identity, operationId } = run.input;
  const auditId = `saihu_operation_${saihuReportOperationKey(identity, operationId)}`;
  const rows = await saihuReportRows(
    tx,
    "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadata FROM security_audit_logs WHERE auditId=? LIMIT 2 FOR SHARE",
    [auditId],
    2
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.auditId !== auditId ||
    row.workspaceId !== identity.workspaceId ||
    row.actorUserId !== identity.userId ||
    row.action !== "ops.saihu_report.start" ||
    row.resourceType !== "ops_saihu_report_operation" ||
    row.resourceId !== operationId ||
    row.status !== "success"
  )
    return saihuReportFail("START_RECEIPT_INVALID");
  const parsed = SaihuReportReceiptSchema.safeParse(
    saihuReportJson(row.metadata, 32768)
  );
  if (!parsed.success) return saihuReportFail("START_RECEIPT_INVALID");
  const receipt = parsed.data;
  if (
    receipt.status !== "committed" ||
    receipt.action !== "start" ||
    receipt.operationId !== operationId ||
    receipt.runOperationId !== operationId ||
    saihuReportHash(receipt.identity) !== saihuReportHash(identity) ||
    receipt.requestHash !== run.input.requestHash ||
    receipt.resultHash !== saihuReportHash(run.input)
  )
    return saihuReportFail("START_RECEIPT_INVALID");
  return receipt;
}
async function artifact(
  tx: SaihuReportExecutor,
  run: NonNullable<Awaited<ReturnType<typeof readSaihuReportRun>>>,
  kind: "source" | "preview"
) {
  const artifactId = saihuReportArtifactId(
      run.input.identity,
      run.input.operationId,
      kind
    ),
    key =
      kind === "source" ? SAIHU_REPORT_SOURCE_KEY : SAIHU_REPORT_PREVIEW_KEY;
  const found = await saihuReportRows(
      tx,
      "SELECT artifactId,workspaceId,userId,projectId,domain,artifactKey,sourceType,sourceTable,sourceRowId,runId,status,isCurrent,version,contentHash,IF(OCTET_LENGTH(CAST(contentJson AS CHAR CHARACTER SET utf8mb4))<=33554432,CAST(contentJson AS CHAR CHARACTER SET utf8mb4),NULL) AS contentJson FROM ai_artifacts WHERE artifactId=? LIMIT 2 FOR SHARE",
      [artifactId],
      2
    ),
    row = found[0];
  if (
    found.length !== 1 ||
    row.artifactId !== artifactId ||
    row.workspaceId !== run.input.identity.workspaceId ||
    row.userId !== run.input.identity.userId ||
    row.projectId !== null ||
    row.domain !== "ops" ||
    row.artifactKey !== key ||
    row.sourceType !== "tool_output" ||
    row.sourceTable !== "ai_jobs" ||
    row.sourceRowId !== String(run.id) ||
    row.runId !== run.runId ||
    row.status !== "final" ||
    row.isCurrent !== 0 ||
    row.version !== 1
  )
    return saihuReportFail("ARTIFACT_SCOPE_INVALID");
  const value = saihuReportJson(row.contentJson);
  if (saihuReportHash(value) !== row.contentHash)
    return saihuReportFail("ARTIFACT_HASH_INVALID");
  return value;
}
/** Durable replay is mandatory; a JSON sourceHash is not an authorization or
 * integrity proof. Caller owns the fresh workspace/actor locks in this TX. */
export async function readSaihuReportPublication(
  tx: SaihuReportExecutor,
  identity: SaihuReportIdentity,
  operationId: string
) {
  const run = await readSaihuReportRun(tx, identity, operationId);
  if (!run) return saihuReportFail("RUN_NOT_FOUND");
  const source = SaihuReportSourceSchema.parse(
      await artifact(tx, run, "source")
    ),
    stored = SaihuReportCapturePreviewSchema.parse(
      await artifact(tx, run, "preview")
    ),
    preview = validateSaihuReportSource(source, run.input.contract);
  if (
    source.identity.workspaceId !== identity.workspaceId ||
    source.identity.userId !== identity.userId ||
    source.operationId !== operationId ||
    source.connectionVersion !== run.input.connectionVersion ||
    source.contractHash !== run.input.contractHash ||
    saihuReportHash(source.scope) !==
      saihuReportHash(run.input.request.scope) ||
    saihuReportHash(stored) !== saihuReportHash(preview) ||
    (run.output.sourceHash !== null &&
      run.output.sourceHash !== preview.sourceHash) ||
    (run.output.previewHash !== null &&
      run.output.previewHash !== preview.previewHash)
  )
    return saihuReportFail("PUBLICATION_BINDING_INVALID");
  return { run, source, preview };
}
