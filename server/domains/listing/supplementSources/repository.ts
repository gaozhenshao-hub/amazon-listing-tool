import { z } from "zod";
import { requireDb } from "../../../repositories/dbClient";
import {
  SupplementManifestSchema,
  SupplementReceiptSchema,
  SupplementIdentitySchema,
  SupplementScopeSchema,
  SupplementTargetSchema,
  SupplementHistoryInputSchema,
  supplementCanonical,
  supplementHash,
  supplementTargetKey,
  type SupplementIdentity,
  type SupplementScope,
  type SupplementKind,
  type SupplementOperationInput,
  type SupplementSourceInput,
  type SupplementHistoryInput,
  type SupplementReceipt,
  type SupplementManifest,
} from "../../../../shared/listingSupplementSources";
import {
  SupplementPreparedSchema,
  SupplementOperationSchema,
  SupplementStoredOriginalSchema,
  SupplementSourceError,
  supplementFail,
  supplementOperationKey,
  supplementScope,
  type SupplementPrepared,
  type SupplementPreparedSave,
  type SupplementPreparedDelete,
  type SupplementOperation,
  type SupplementStoredOriginal,
} from "./protocol";
import {
  assertSupplementSourceSchema,
  authorizeSupplementScope,
  captureSupplementTargets,
  supplementRows as rows,
  supplementWrite as write,
  supplementJson as json,
  type SupplementExecutor,
} from "./store";
const enabledByDefault = () =>
  process.env.ENABLE_LISTING_SUPPLEMENT_SOURCE_WRITES === "true";
const sourceProjection =
  "source_id AS sourceId,workspace_id AS workspaceId,project_id AS projectId,user_id AS userId,kind,original_type AS originalType,file_name AS fileName,content_type AS contentType,byte_size AS byteSize,content_hash AS contentHash,provider,domain_hash AS domainHash,object_key AS objectKey,original_state AS originalState,record_state AS recordState,manifest_version AS manifestVersion,manifest_hash AS manifestHash,preview_status AS previewStatus,reason_code AS reasonCode,CAST(UNIX_TIMESTAMP(created_at) AS CHAR) AS createdEpoch";
type Source = {
  original: SupplementStoredOriginal;
  kind: SupplementKind;
  originalState: "prepared" | "stored" | "deleting" | "deleted" | "cancelled";
  recordState: "visible" | "deleted";
  manifestHash: string;
  manifestVersion: 1;
  previewStatus: "ready" | "failed";
  reasonCode: string | null;
  createdAt: string;
};
const sourceShape = z
  .object({
    sourceId: z.string().uuid(),
    workspaceId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    userId: z.number().int().positive(),
    kind: z.enum(["reviews", "questions", "attributes"]),
    originalType: z.enum(["file", "clipboard"]),
    fileName: z.string(),
    contentType: z.string(),
    byteSize: z.number().int().positive(),
    contentHash: z.string(),
    provider: z.enum(["s3", "oss"]),
    domainHash: z.string(),
    objectKey: z.string(),
    originalState: z.enum([
      "prepared",
      "stored",
      "deleting",
      "deleted",
      "cancelled",
    ]),
    recordState: z.enum(["visible", "deleted"]),
    manifestVersion: z.literal(1),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    previewStatus: z.enum(["ready", "failed"]),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/u)
      .nullable(),
    createdEpoch: z.string().regex(/^\d+(?:\.\d{1,6})?$/u),
  })
  .strict();
function epochIso(value: string) {
  const [seconds, fraction = ""] = value.split(".");
  return new Date(Number(seconds) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/u, `.${fraction.padEnd(6, "0")}Z`);
}
function isoEpoch(value: string) {
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!match) return supplementFail("CURSOR_INVALID");
  return `${Date.parse(`${match[1]}Z`) / 1000}.${(match[2] ?? "").padEnd(6, "0")}`;
}
const equal = (a: unknown, b: unknown) =>
  supplementCanonical(a) === supplementCanonical(b);
export function supplementUnknown(
  identity: SupplementIdentity,
  scope: SupplementOperationInput,
  reasonCode = "OUTCOME_UNKNOWN"
): SupplementReceipt {
  return SupplementReceiptSchema.parse({
    identity,
    scope,
    action: null,
    status: "unknown",
    sourceId: null,
    requestHash: null,
    manifestHash: null,
    originalState: null,
    recordState: null,
    reasonCode,
  });
}
export function createSupplementSourceRepository(
  dependencies: {
    database?: () => Promise<{
      transaction<T>(body: (tx: SupplementExecutor) => Promise<T>): Promise<T>;
    } | null>;
    schema?: typeof assertSupplementSourceSchema;
    authorize?: typeof authorizeSupplementScope;
    enabled?: () => boolean;
  } = {}
) {
  const database =
      dependencies.database ?? (() => requireDb("Listing supplement sources")),
    enabled = dependencies.enabled ?? enabledByDefault;
  async function transaction<T>(
    identity: SupplementIdentity,
    scope: SupplementScope,
    action: "read" | "upload" | "update" | "delete" | "export",
    body: (
      tx: SupplementExecutor,
      actor: Awaited<ReturnType<typeof authorizeSupplementScope>>
    ) => Promise<T>
  ): Promise<T> {
    SupplementIdentitySchema.parse(identity);
    const exactScope = SupplementScopeSchema.parse(supplementScope(scope));
    if (identity.workspaceId !== exactScope.expectedWorkspaceId)
      supplementFail("ACCESS_DENIED");
    const db = await database();
    if (!db || typeof db.transaction !== "function")
      supplementFail("TRANSACTION_UNAVAILABLE");
    try {
      return await db.transaction(async tx => {
        await (dependencies.schema ?? assertSupplementSourceSchema)(tx);
        const actor = await (
          dependencies.authorize ?? authorizeSupplementScope
        )(tx, identity, exactScope, action);
        return body(tx, actor);
      });
    } catch (error) {
      if (error instanceof SupplementSourceError) throw error;
      return supplementFail("OUTCOME_UNKNOWN_CHECK_SAME_UUID");
    }
  }
  async function operation(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementOperationInput
  ): Promise<SupplementOperation | null> {
    const key = supplementOperationKey(identity, scope.operationId),
      found = await rows(
        tx,
        "SELECT operation_key AS operationKey,operation_id AS operationId,workspace_id AS workspaceId,project_id AS projectId,user_id AS userId,source_id AS sourceId,action,request_hash AS requestHash,state,IF(prepared_json IS NULL OR OCTET_LENGTH(prepared_json)<=33554432,prepared_json,NULL) AS preparedJson,receipt_json AS receiptJson FROM listing_supplement_operations WHERE operation_key=? FOR UPDATE",
        [key],
        1
      );
    if (!found.length) return null;
    const row = found[0];
    if (
      row.operationKey !== key ||
      row.operationId !== scope.operationId ||
      row.workspaceId !== identity.workspaceId ||
      row.projectId !== scope.projectId ||
      row.userId !== identity.userId
    )
      supplementFail("OPERATION_SCOPE_CHANGED");
    const prepared =
        row.preparedJson === null
          ? null
          : SupplementPreparedSchema.parse(json(row.preparedJson)),
      receipt =
        row.receiptJson === null
          ? null
          : SupplementReceiptSchema.parse(json(row.receiptJson));
    const result = SupplementOperationSchema.parse({
      identity,
      scope: supplementScope(scope),
      operationId: scope.operationId,
      state: row.state,
      prepared,
      receipt,
    });
    if (
      (prepared &&
        (!equal(prepared.identity, identity) ||
          !equal(prepared.scope, supplementScope(scope)) ||
          prepared.operationId !== scope.operationId ||
          row.sourceId !== prepared.sourceId ||
          row.action !== prepared.action ||
          row.requestHash !== prepared.requestHash)) ||
      (!prepared &&
        (row.sourceId !== null ||
          row.action !== null ||
          row.requestHash !== null)) ||
      ["committed", "cancelled"].includes(result.state) !==
        (receipt !== null) ||
      (receipt &&
        (!equal(receipt.identity, identity) ||
          !equal(receipt.scope, scope) ||
          receipt.status !== result.state ||
          (result.state === "committed" &&
            (!prepared ||
              receipt.requestHash !== prepared.requestHash ||
              receipt.sourceId !== prepared.sourceId ||
              receipt.action !== prepared.action ||
              receipt.manifestHash !==
                (prepared.action === "save"
                  ? prepared.manifest.manifestHash
                  : prepared.manifestHash) ||
              receipt.originalState !==
                (prepared.action === "save" ? "stored" : "deleted") ||
              receipt.recordState !==
                (prepared.action === "delete_record"
                  ? "deleted"
                  : prepared.action === "save"
                    ? "visible"
                    : prepared.previousRecordState)))))
    )
      supplementFail("OPERATION_INVALID");
    return result;
  }
  async function source(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementScope,
    sourceId: string
  ): Promise<Source> {
    const found = await rows(
      tx,
      `SELECT ${sourceProjection} FROM listing_supplement_sources WHERE source_id=? FOR UPDATE`,
      [sourceId],
      1
    );
    if (found.length !== 1) supplementFail("SOURCE_UNAVAILABLE");
    const row = sourceShape.parse(found[0]);
    if (
      row.sourceId !== sourceId ||
      row.workspaceId !== identity.workspaceId ||
      row.projectId !== scope.projectId ||
      row.userId !== identity.userId
    )
      supplementFail("SOURCE_UNAVAILABLE");
    const original = SupplementStoredOriginalSchema.parse({
      identity,
      scope: supplementScope(scope),
      sourceId,
      metadata: {
        originalType: row.originalType,
        fileName: row.fileName,
        contentType: row.contentType,
        byteSize: row.byteSize,
        contentHash: row.contentHash,
      },
      provider: row.provider,
      domainHash: row.domainHash,
      objectKey: row.objectKey,
      storageUri: `storage://${row.provider}/${row.objectKey}`,
    });
    return {
      original,
      kind: row.kind,
      originalState: row.originalState,
      recordState: row.recordState,
      manifestHash: row.manifestHash,
      manifestVersion: 1,
      previewStatus: row.previewStatus,
      reasonCode: row.reasonCode,
      createdAt: epochIso(row.createdEpoch),
    };
  }
  async function manifest(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementScope,
    current: Source
  ): Promise<SupplementManifest> {
    const found = await rows(
      tx,
      "SELECT source_id AS sourceId,version,workspace_id AS workspaceId,project_id AS projectId,user_id AS userId,manifest_hash AS manifestHash,previous_hash AS previousHash,IF(OCTET_LENGTH(manifest_json)<=33554432,manifest_json,NULL) AS manifestJson FROM listing_supplement_manifests WHERE source_id=? AND version=? FOR SHARE",
      [current.original.sourceId, current.manifestVersion],
      1
    );
    if (found.length !== 1) supplementFail("MANIFEST_UNAVAILABLE");
    const row = found[0],
      value = SupplementManifestSchema.parse(json(row.manifestJson));
    if (
      row.sourceId !== current.original.sourceId ||
      row.version !== 1 ||
      row.workspaceId !== identity.workspaceId ||
      row.projectId !== scope.projectId ||
      row.userId !== identity.userId ||
      row.manifestHash !== current.manifestHash ||
      row.previousHash !== null ||
      value.manifestHash !== current.manifestHash ||
      value.sourceId !== current.original.sourceId ||
      !equal(value.identity, identity) ||
      !equal(value.scope, supplementScope(scope)) ||
      !equal(value.original, current.original.metadata) ||
      value.kind !== current.kind ||
      value.previewStatus !== current.previewStatus ||
      value.reasonCode !== current.reasonCode
    )
      supplementFail("MANIFEST_INVALID");
    return value;
  }
  async function committedManifest(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementScope,
    current: Source
  ): Promise<SupplementManifest> {
    const value = await manifest(tx, identity, scope, current);
    const originalSave = await operation(tx, identity, {
      ...supplementScope(scope),
      operationId: current.original.sourceId,
    });
    if (
      !originalSave ||
      originalSave.state !== "committed" ||
      originalSave.prepared?.action !== "save" ||
      !originalSave.receipt ||
      originalSave.receipt.manifestHash !== current.manifestHash ||
      !equal(originalSave.prepared.manifest, value) ||
      !equal(originalSave.prepared.original, current.original)
    )
      supplementFail("MANIFEST_ORIGIN_UNAVAILABLE");
    return value;
  }
  async function audit(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementOperationInput,
    role: string,
    event: string,
    value: unknown
  ) {
    const auditId = `lss_${supplementHash({ identity, operationId: scope.operationId, event })}`,
      metadata = supplementCanonical(value, 16_384);
    await write(
      tx,
      "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'listing_supplement_source',?,?,'success','medium',?)",
      [
        auditId,
        identity.workspaceId,
        identity.userId,
        role,
        `listing.supplement.${event}`,
        scope.operationId,
        scope.projectId,
        metadata,
      ]
    );
    const found = await rows(
      tx,
      "SELECT auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata FROM security_audit_logs WHERE auditId=? FOR SHARE",
      [auditId],
      1
    );
    if (
      found.length !== 1 ||
      found[0].auditId !== auditId ||
      found[0].workspaceId !== identity.workspaceId ||
      found[0].actorUserId !== identity.userId ||
      found[0].actorRole !== role ||
      found[0].action !== `listing.supplement.${event}` ||
      found[0].resourceType !== "listing_supplement_source" ||
      found[0].resourceId !== scope.operationId ||
      found[0].projectId !== scope.projectId ||
      found[0].status !== "success" ||
      found[0].riskLevel !== "medium" ||
      !equal(
        typeof found[0].metadata === "string"
          ? json(found[0].metadata)
          : found[0].metadata,
        value
      )
    )
      supplementFail("AUDIT_UNCONFIRMED");
  }
  async function insertOperation(
    tx: SupplementExecutor,
    identity: SupplementIdentity,
    scope: SupplementOperationInput,
    prepared: SupplementPrepared | null,
    receipt: SupplementReceipt | null
  ) {
    await write(
      tx,
      "INSERT INTO listing_supplement_operations (operation_key,operation_id,workspace_id,project_id,user_id,source_id,action,request_hash,state,prepared_json,receipt_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        supplementOperationKey(identity, scope.operationId),
        scope.operationId,
        identity.workspaceId,
        scope.projectId,
        identity.userId,
        prepared?.sourceId ?? null,
        prepared?.action ?? null,
        prepared?.requestHash ?? null,
        receipt ? "cancelled" : "prepared",
        prepared ? supplementCanonical(prepared) : null,
        receipt ? supplementCanonical(receipt) : null,
      ]
    );
    const stored = await operation(tx, identity, scope);
    if (
      !stored ||
      !equal(stored.prepared, prepared) ||
      !equal(stored.receipt, receipt)
    )
      supplementFail("PREPARE_UNCONFIRMED");
    return stored;
  }
  async function finish(
    tx: SupplementExecutor,
    prepared: SupplementPrepared,
    receipt: SupplementReceipt
  ) {
    await write(
      tx,
      "UPDATE listing_supplement_operations SET state='committed',receipt_json=? WHERE operation_key=? AND state IN ('prepared','dispatched') AND request_hash=?",
      [
        supplementCanonical(receipt),
        supplementOperationKey(prepared.identity, prepared.operationId),
        prepared.requestHash,
      ]
    );
    const stored = await operation(tx, prepared.identity, {
      ...prepared.scope,
      operationId: prepared.operationId,
    });
    if (!stored || !equal(stored.receipt, receipt))
      supplementFail("RECEIPT_UNCONFIRMED");
    return receipt;
  }
  const receiptOf = (
    prepared: SupplementPrepared,
    originalState: "stored" | "deleted",
    recordState: "visible" | "deleted"
  ) =>
    SupplementReceiptSchema.parse({
      identity: prepared.identity,
      scope: { ...prepared.scope, operationId: prepared.operationId },
      action: prepared.action,
      status: "committed",
      sourceId: prepared.sourceId,
      requestHash: prepared.requestHash,
      manifestHash:
        prepared.action === "save"
          ? prepared.manifest.manifestHash
          : prepared.manifestHash,
      originalState,
      recordState,
      reasonCode: null,
    });
  return {
    enabled,
    async targets(
      identity: SupplementIdentity,
      scope: SupplementScope,
      kind: SupplementKind
    ) {
      return transaction(identity, scope, "read", async (tx, actor) =>
        captureSupplementTargets(tx, scope, kind, actor.parent)
      );
    },
    async reserve(
      identity: SupplementIdentity,
      raw: SupplementPreparedSave,
      expectedTargetsHash: string
    ) {
      const prepared = SupplementPreparedSchema.parse(raw);
      if (prepared.action !== "save") return supplementFail("INPUT_INVALID");
      const scope = { ...prepared.scope, operationId: prepared.operationId };
      return transaction(identity, scope, "upload", async (tx, actor) => {
        const old = await operation(tx, identity, scope);
        if (old) {
          if (old.prepared && old.prepared.requestHash !== prepared.requestHash)
            supplementFail("UUID_REQUEST_CONFLICT");
          return { created: false, operation: old };
        }
        if (!enabled()) supplementFail("WRITES_DISABLED");
        if (
          !equal(prepared.identity, identity) ||
          supplementHash(prepared.targets) !== expectedTargetsHash ||
          supplementHash(
            await captureSupplementTargets(
              tx,
              scope,
              prepared.manifest.kind,
              actor.parent
            )
          ) !== expectedTargetsHash
        )
          supplementFail("TARGETS_CHANGED");
        const available = (
          await captureSupplementTargets(
            tx,
            scope,
            prepared.manifest.kind,
            actor.parent
          )
        ).map(value => SupplementTargetSchema.parse(value));
        if (
          prepared.manifest.records.some(
            item =>
              !available.some(
                target =>
                  supplementTargetKey(target) ===
                    supplementTargetKey(item.target) &&
                  equal(target, item.target)
              )
          )
        )
          supplementFail("TARGETS_CHANGED");
        const metadata = prepared.original.metadata;
        const pendingOriginal = await rows(
          tx,
          "SELECT source_id AS sourceId FROM listing_supplement_sources WHERE workspace_id=? AND user_id=? AND project_id=? AND kind=? AND original_type=? AND content_hash=? AND original_state IN ('prepared','deleting') LIMIT 2 FOR UPDATE",
          [
            identity.workspaceId,
            identity.userId,
            scope.projectId,
            prepared.manifest.kind,
            metadata.originalType,
            metadata.contentHash,
          ],
          2
        );
        if (pendingOriginal.length)
          supplementFail("ORIGINAL_OPERATION_PENDING_CHECK_SAME_UUID");
        await write(
          tx,
          "INSERT INTO listing_supplement_sources (source_id,workspace_id,project_id,user_id,kind,original_type,file_name,content_type,byte_size,content_hash,provider,domain_hash,object_key,original_state,record_state,manifest_version,manifest_hash,preview_status,reason_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared','visible',1,?,?,?)",
          [
            prepared.sourceId,
            identity.workspaceId,
            scope.projectId,
            identity.userId,
            prepared.manifest.kind,
            metadata.originalType,
            metadata.fileName,
            metadata.contentType,
            metadata.byteSize,
            metadata.contentHash,
            prepared.original.provider,
            prepared.original.domainHash,
            prepared.original.objectKey,
            prepared.manifest.manifestHash,
            prepared.manifest.previewStatus,
            prepared.manifest.reasonCode,
          ]
        );
        const current = await source(tx, identity, scope, prepared.sourceId);
        if (
          !equal(current.original, prepared.original) ||
          current.manifestHash !== prepared.manifest.manifestHash ||
          current.originalState !== "prepared"
        )
          supplementFail("SOURCE_UNCONFIRMED");
        const stored = await insertOperation(
          tx,
          identity,
          scope,
          prepared,
          null
        );
        await audit(tx, identity, scope, actor.role, "prepare", {
          sourceId: prepared.sourceId,
          kind: prepared.manifest.kind,
          originalType: metadata.originalType,
          byteSize: metadata.byteSize,
          contentHash: metadata.contentHash,
          manifestHash: prepared.manifest.manifestHash,
        });
        return { created: true, operation: stored };
      });
    },
    async dispatch(
      identity: SupplementIdentity,
      scope: SupplementOperationInput,
      expectedAction: "save" | "delete_original" | "delete_record"
    ) {
      return transaction(
        identity,
        scope,
        expectedAction === "save" ? "upload" : "delete",
        async (tx, actor) => {
          const current = await operation(tx, identity, scope);
          if (!current?.prepared || current.state !== "prepared")
            supplementFail("ALREADY_DISPATCHED");
          if (!enabled()) supplementFail("WRITES_DISABLED");
          if (current.prepared.action !== expectedAction)
            supplementFail("OPERATION_CHANGED");
          if (
            current.prepared.action === "save" &&
            !equal(
              await captureSupplementTargets(
                tx,
                scope,
                current.prepared.manifest.kind,
                actor.parent
              ),
              current.prepared.targets
            )
          )
            supplementFail("TARGETS_CHANGED");
          const stored = await source(
            tx,
            identity,
            scope,
            current.prepared.sourceId
          );
          if (!equal(stored.original, current.prepared.original))
            supplementFail("SOURCE_CHANGED");
          await write(
            tx,
            "UPDATE listing_supplement_operations SET state='dispatched' WHERE operation_key=? AND state='prepared'",
            [supplementOperationKey(identity, scope.operationId)]
          );
          const after = await operation(tx, identity, scope);
          if (after?.state !== "dispatched")
            supplementFail("DISPATCH_UNCONFIRMED");
          await audit(tx, identity, scope, actor.role, "dispatch", {
            action: current.prepared.action,
            requestHash: current.prepared.requestHash,
          });
          return current.prepared;
        }
      );
    },
    async check(identity: SupplementIdentity, scope: SupplementOperationInput) {
      return transaction(identity, scope, "read", tx =>
        operation(tx, identity, scope)
      );
    },
    async finalize(
      identity: SupplementIdentity,
      scope: SupplementOperationInput,
      expected: SupplementPrepared
    ) {
      return transaction(
        identity,
        scope,
        expected.action === "save" ? "upload" : "delete",
        async (tx, actor) => {
          const op = await operation(tx, identity, scope);
          if (op?.receipt) return op.receipt;
          if (
            !op?.prepared ||
            !equal(op.prepared, expected) ||
            (op.state !== "dispatched" &&
              !(
                op.state === "prepared" &&
                expected.action !== "save" &&
                expected.previousOriginalState === "deleted"
              ))
          )
            supplementFail("OPERATION_CHANGED");
          const current = await source(tx, identity, scope, expected.sourceId);
          if (!equal(current.original, expected.original))
            supplementFail("SOURCE_CHANGED");
          if (expected.action === "save") {
            if (
              !equal(
                await captureSupplementTargets(
                  tx,
                  scope,
                  expected.manifest.kind,
                  actor.parent
                ),
                expected.targets
              )
            )
              supplementFail("TARGETS_CHANGED");
            if (
              current.originalState !== "prepared" ||
              current.recordState !== "visible" ||
              current.manifestHash !== expected.manifest.manifestHash
            )
              supplementFail("SOURCE_CHANGED");
            await write(
              tx,
              "INSERT INTO listing_supplement_manifests (source_id,version,workspace_id,project_id,user_id,manifest_hash,previous_hash,manifest_json) VALUES (?,1,?,?,?,?,NULL,?)",
              [
                expected.sourceId,
                identity.workspaceId,
                scope.projectId,
                identity.userId,
                expected.manifest.manifestHash,
                supplementCanonical(expected.manifest),
              ]
            );
            await manifest(tx, identity, scope, current);
            await write(
              tx,
              "UPDATE listing_supplement_sources SET original_state='stored' WHERE source_id=? AND original_state='prepared' AND manifest_hash=?",
              [expected.sourceId, expected.manifest.manifestHash]
            );
          } else {
            if (
              current.manifestHash !== expected.manifestHash ||
              !["deleting", "deleted"].includes(current.originalState)
            )
              supplementFail("SOURCE_CHANGED");
            await committedManifest(tx, identity, scope, current);
            await write(
              tx,
              "UPDATE listing_supplement_sources SET original_state='deleted',record_state=? WHERE source_id=? AND manifest_hash=? AND original_state IN ('deleting','deleted')",
              [
                expected.action === "delete_record"
                  ? "deleted"
                  : current.recordState,
                expected.sourceId,
                expected.manifestHash,
              ]
            );
          }
          const after = await source(tx, identity, scope, expected.sourceId),
            receipt = receiptOf(
              expected,
              expected.action === "save" ? "stored" : "deleted",
              expected.action === "delete_record"
                ? "deleted"
                : current.recordState
            );
          if (
            after.originalState !== receipt.originalState ||
            after.recordState !== receipt.recordState
          )
            supplementFail("SOURCE_UNCONFIRMED");
          const result = await finish(tx, expected, receipt);
          await audit(tx, identity, scope, actor.role, "complete", {
            action: expected.action,
            sourceId: expected.sourceId,
            requestHash: expected.requestHash,
            manifestHash: receipt.manifestHash,
          });
          const published = await committedManifest(tx, identity, scope, after);
          if (published.manifestHash !== receipt.manifestHash)
            supplementFail("MANIFEST_UNCONFIRMED");
          return result;
        }
      );
    },
    async prepareDelete(
      identity: SupplementIdentity,
      scope: SupplementOperationInput,
      sourceId: string,
      expectedManifestHash: string,
      action: "delete_original" | "delete_record",
      requestHash: string
    ) {
      return transaction(identity, scope, "delete", async (tx, actor) => {
        const old = await operation(tx, identity, scope);
        if (old) {
          if (old.prepared && old.prepared.requestHash !== requestHash)
            supplementFail("UUID_REQUEST_CONFLICT");
          return { created: false, operation: old };
        }
        if (!enabled()) supplementFail("WRITES_DISABLED");
        const current = await source(tx, identity, scope, sourceId);
        if (
          current.manifestHash !== expectedManifestHash ||
          !["stored", "deleted"].includes(current.originalState)
        )
          supplementFail("SOURCE_CHANGED");
        await committedManifest(tx, identity, scope, current);
        const pending = await rows(
          tx,
          "SELECT operation_key FROM listing_supplement_operations WHERE workspace_id=? AND user_id=? AND project_id=? AND source_id=? AND state IN ('prepared','dispatched') LIMIT 1 FOR UPDATE",
          [identity.workspaceId, identity.userId, scope.projectId, sourceId],
          1
        );
        if (pending.length) supplementFail("SOURCE_OPERATION_PENDING");
        const prepared: SupplementPreparedDelete = {
          version: 1,
          action,
          identity,
          scope: supplementScope(scope),
          operationId: scope.operationId,
          sourceId,
          requestHash,
          original: current.original,
          manifestHash: expectedManifestHash,
          previousOriginalState: current.originalState as "stored" | "deleted",
          previousRecordState: current.recordState,
        };
        if (current.originalState === "stored")
          await write(
            tx,
            "UPDATE listing_supplement_sources SET original_state='deleting' WHERE source_id=? AND original_state='stored'",
            [sourceId]
          );
        const stored = await insertOperation(
          tx,
          identity,
          scope,
          prepared,
          null
        );
        await audit(tx, identity, scope, actor.role, "prepare", {
          action,
          sourceId,
          manifestHash: expectedManifestHash,
          preserveNormalizedRecords: true,
        });
        return { created: true, operation: stored };
      });
    },
    async cancel(
      identity: SupplementIdentity,
      scope: SupplementOperationInput
    ) {
      return transaction(identity, scope, "update", async (tx, actor) => {
        const current = await operation(tx, identity, scope);
        if (current?.receipt) return current.receipt;
        if (
          current?.state === "dispatched" &&
          current.prepared?.action !== "save"
        )
          return supplementUnknown(
            identity,
            scope,
            "DELETE_ALREADY_DISPATCHED_CHECK_SAME_UUID"
          );
        const receipt = SupplementReceiptSchema.parse({
          identity,
          scope,
          action: null,
          status: "cancelled",
          sourceId: null,
          requestHash: null,
          manifestHash: null,
          originalState: null,
          recordState: null,
          reasonCode: "OPERATION_CANCELLED",
        });
        if (current) {
          if (current.prepared) {
            const prepared = current.prepared;
            const ownedSource = await source(
              tx,
              identity,
              scope,
              prepared.sourceId
            );
            if (!equal(ownedSource.original, prepared.original))
              supplementFail("SOURCE_CHANGED");
            if (prepared.action === "save")
              await write(
                tx,
                "UPDATE listing_supplement_sources SET original_state='cancelled' WHERE source_id=? AND original_state='prepared'",
                [prepared.sourceId]
              );
            else if (prepared.previousOriginalState === "stored")
              await write(
                tx,
                "UPDATE listing_supplement_sources SET original_state='stored' WHERE source_id=? AND original_state='deleting'",
                [prepared.sourceId]
              );
          }
          await write(
            tx,
            "UPDATE listing_supplement_operations SET state='cancelled',receipt_json=? WHERE operation_key=? AND state IN ('prepared','dispatched')",
            [
              supplementCanonical(receipt),
              supplementOperationKey(identity, scope.operationId),
            ]
          );
          const after = await operation(tx, identity, scope);
          if (!after || !equal(after.receipt, receipt))
            supplementFail("CANCEL_UNCONFIRMED");
        } else await insertOperation(tx, identity, scope, null, receipt);
        await audit(tx, identity, scope, actor.role, "cancel", {
          status: "cancelled",
        });
        return receipt;
      });
    },
    async readManifest(
      identity: SupplementIdentity,
      scope: SupplementSourceInput
    ) {
      return transaction(identity, scope, "read", async tx =>
        committedManifest(
          tx,
          identity,
          scope,
          await source(tx, identity, scope, scope.sourceId)
        )
      );
    },
    async downloadable(
      identity: SupplementIdentity,
      scope: SupplementSourceInput
    ) {
      return transaction(identity, scope, "export", async tx => {
        const current = await source(tx, identity, scope, scope.sourceId);
        if (
          current.originalState !== "stored" ||
          current.recordState !== "visible"
        )
          supplementFail("ORIGINAL_UNAVAILABLE");
        await committedManifest(tx, identity, scope, current);
        return current.original;
      });
    },
    async history(identity: SupplementIdentity, raw: SupplementHistoryInput) {
      const scope = SupplementHistoryInputSchema.parse(raw);
      return transaction(identity, scope, "read", async tx => {
        const cursor = scope.cursor,
          values: unknown[] = [
            identity.workspaceId,
            identity.userId,
            scope.projectId,
          ];
        let where =
          "workspace_id=? AND user_id=? AND project_id=? AND record_state='visible'";
        if (cursor) {
          const epoch = isoEpoch(cursor.createdAt);
          where +=
            " AND (created_at<FROM_UNIXTIME(?) OR (created_at=FROM_UNIXTIME(?) AND source_id<?))";
          values.push(epoch, epoch, cursor.sourceId);
        }
        values.push(scope.limit + 1);
        const found = await rows(
            tx,
            `SELECT ${sourceProjection} FROM listing_supplement_sources WHERE ${where} ORDER BY created_at DESC,source_id DESC LIMIT ?`,
            values,
            scope.limit + 1
          ),
          page = found.slice(0, scope.limit).map(row => sourceShape.parse(row));
        const items = page.map(row => ({
          sourceId: row.sourceId,
          kind: row.kind,
          originalType: row.originalType,
          fileName: row.fileName,
          contentType: row.contentType,
          byteSize: row.byteSize,
          contentHash: row.contentHash,
          originalState: row.originalState,
          previewStatus: row.previewStatus,
          reasonCode: row.reasonCode,
          manifestVersion: row.manifestVersion,
          manifestHash: row.manifestHash,
          createdAt: epochIso(row.createdEpoch),
        }));
        if (
          page.some(
            row =>
              row.workspaceId !== identity.workspaceId ||
              row.projectId !== scope.projectId ||
              row.userId !== identity.userId ||
              row.recordState !== "visible"
          )
        )
          supplementFail("SOURCE_UNAVAILABLE");
        const last = items.at(-1);
        return {
          identity,
          scope: supplementScope(scope),
          items,
          nextCursor:
            found.length > scope.limit && last
              ? { sourceId: last.sourceId, createdAt: last.createdAt }
              : null,
        };
      });
    },
  };
}
export type SupplementSourceRepository = ReturnType<
  typeof createSupplementSourceRepository
>;
