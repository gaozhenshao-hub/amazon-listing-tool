import { z } from "zod";
import { createHash } from "node:crypto";
import {
  SupplementIdentitySchema,
  SupplementScopeSchema,
  SupplementUuidSchema,
  SupplementHashSchema,
  SupplementOriginalMetadataSchema,
  SupplementManifestSchema,
  SupplementReceiptSchema,
  SupplementTargetSchema,
  supplementHash,
  type SupplementIdentity,
  type SupplementScope,
} from "../../../../shared/listingSupplementSources";
export class SupplementSourceError extends Error {
  constructor(readonly code: string) {
    super(`LISTING_SUPPLEMENT_${code}`);
    this.name = "SupplementSourceError";
  }
}
export function supplementFail(code: string): never {
  throw new SupplementSourceError(code);
}
export const supplementBytesHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const supplementOperationKey = (
  identity: SupplementIdentity,
  operationId: string
) =>
  supplementHash({
    namespace: "listing_supplement_source_v1",
    identity: SupplementIdentitySchema.parse(identity),
    operationId: SupplementUuidSchema.parse(operationId),
  });
export const SupplementStoredOriginalSchema = z
  .object({
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    sourceId: SupplementUuidSchema,
    metadata: SupplementOriginalMetadataSchema,
    provider: z.enum(["s3", "oss"]),
    domainHash: SupplementHashSchema,
    objectKey: z.string().max(500),
    storageUri: z.string().max(550),
  })
  .strict()
  .superRefine((value, ctx) => {
    const key = `listing-supplements/${value.identity.workspaceId}/${value.scope.projectId}/${supplementOperationKey(value.identity, value.sourceId)}.original`;
    if (
      value.identity.workspaceId !== value.scope.expectedWorkspaceId ||
      value.objectKey !== key ||
      value.storageUri !== `storage://${value.provider}/${key}`
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid private original binding",
      });
  });
export const SupplementPreparedSaveSchema = z
  .object({
    version: z.literal(1),
    action: z.literal("save"),
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    operationId: SupplementUuidSchema,
    sourceId: SupplementUuidSchema,
    requestHash: SupplementHashSchema,
    original: SupplementStoredOriginalSchema,
    manifest: SupplementManifestSchema,
    targets: z.array(SupplementTargetSchema).max(300),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.sourceId !== value.operationId ||
      value.manifest.sourceId !== value.sourceId ||
      supplementHash(value.manifest.identity) !==
        supplementHash(value.identity) ||
      supplementHash(value.original.identity) !==
        supplementHash(value.identity) ||
      supplementHash(value.original.scope) !== supplementHash(value.scope) ||
      supplementHash(value.manifest.scope) !== supplementHash(value.scope) ||
      supplementHash(value.manifest.original) !==
        supplementHash(value.original.metadata) ||
      value.requestHash !== supplementPreparedRequestHash(value) ||
      value.manifest.previewHash !==
        supplementHash({
          identity: value.identity,
          scope: value.scope,
          kind: value.manifest.kind,
          original: value.original.metadata,
          parserVersion: value.manifest.parserVersion,
          status: value.manifest.previewStatus,
          reasonCode: value.manifest.reasonCode,
          records: value.manifest.records.map(item => item.source),
          coverage: value.manifest.coverage,
          targets: value.targets,
        })
    )
      ctx.addIssue({ code: "custom", message: "Invalid prepared save" });
  });
export const SupplementPreparedDeleteSchema = z
  .object({
    version: z.literal(1),
    action: z.enum(["delete_original", "delete_record"]),
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    operationId: SupplementUuidSchema,
    sourceId: SupplementUuidSchema,
    requestHash: SupplementHashSchema,
    original: SupplementStoredOriginalSchema,
    manifestHash: SupplementHashSchema,
    previousOriginalState: z.enum(["stored", "deleted"]),
    previousRecordState: z.enum(["visible", "deleted"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      supplementHash(value.identity) !==
        supplementHash(value.original.identity) ||
      supplementHash(value.scope) !== supplementHash(value.original.scope) ||
      value.sourceId !== value.original.sourceId ||
      value.requestHash !==
        supplementHash({
          identity: value.identity,
          action: value.action,
          request: {
            ...value.scope,
            operationId: value.operationId,
            sourceId: value.sourceId,
            expectedManifestHash: value.manifestHash,
            confirmPreserveImportedData: true,
          },
        })
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid prepared deletion binding",
      });
    }
  });
export const SupplementPreparedSchema = z.union([
  SupplementPreparedSaveSchema,
  SupplementPreparedDeleteSchema,
]);
export const SupplementOperationSchema = z
  .object({
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    operationId: SupplementUuidSchema,
    state: z.enum(["prepared", "dispatched", "committed", "cancelled"]),
    prepared: SupplementPreparedSchema.nullable(),
    receipt: SupplementReceiptSchema.nullable(),
  })
  .strict();
export type SupplementStoredOriginal = z.infer<
  typeof SupplementStoredOriginalSchema
>;
export type SupplementPreparedSave = z.infer<
  typeof SupplementPreparedSaveSchema
>;
export type SupplementPreparedDelete = z.infer<
  typeof SupplementPreparedDeleteSchema
>;
export type SupplementPrepared = z.infer<typeof SupplementPreparedSchema>;
export type SupplementOperation = z.infer<typeof SupplementOperationSchema>;
export function supplementPreparedRequestHash(
  value: Pick<
    SupplementPreparedSave,
    "identity" | "scope" | "operationId" | "manifest" | "original"
  >
): string {
  return supplementHash({
    identity: value.identity,
    request: {
      ...value.scope,
      kind: value.manifest.kind,
      operationId: value.operationId,
      expectedPreviewHash: value.manifest.previewHash,
      assignments: value.manifest.records
        .map(item => ({ recordId: item.source.recordId, target: item.target }))
        .sort((a, b) => a.recordId.localeCompare(b.recordId)),
      confirmSourceOnly: true,
      original: value.original.metadata,
    },
  });
}
export const supplementScope = (input: SupplementScope): SupplementScope =>
  SupplementScopeSchema.parse({
    expectedWorkspaceId: input.expectedWorkspaceId,
    projectId: input.projectId,
  });
