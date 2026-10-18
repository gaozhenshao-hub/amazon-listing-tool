import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";

/** Dedicated source storage only. These records do not publish a Snapshot,
 * import business rows, approve facts, or authorize a model invocation. */
export const LISTING_SUPPLEMENT_LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  clipboardTextBytes: 150_000,
  clipboardHtmlBytes: 500_000,
  clipboardBytes: 700_000,
  records: 20_000,
  manifestBytes: 32 * 1024 * 1024,
});
export const LISTING_SUPPLEMENT_KEYS = Object.freeze({
  original: "listing.supplement.original.v1",
  manifest: "listing.supplement.manifest.v1",
  receipt: "listing.supplement.receipt.v1",
});
export const LISTING_SUPPLEMENT_PARSER = "listing-supplement-parser/1" as const;
const id = z.number().int().positive().max(2147483647);
export const SupplementHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const SupplementUuidSchema = z
  .string()
  .uuid()
  .refine(value => value === value.toLowerCase());
const utf8 = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine(
      value =>
        new TextDecoder().decode(new TextEncoder().encode(value)) === value &&
        new TextEncoder().encode(value).length <= maximum
    );
const name = utf8(255).refine(
  value =>
    !!value.trim() &&
    value === value.trim() &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
);
export function supplementCanonical(
  value: unknown,
  maximum = LISTING_SUPPLEMENT_LIMITS.manifestBytes
): string {
  let nodes = 0,
    bytes = 0;
  function emit(token: string): string {
    bytes += new TextEncoder().encode(token).length;
    if (bytes > maximum) throw new Error("SUPPLEMENT_JSON_LIMIT");
    return token;
  }
  function walk(input: unknown, depth: number): string {
    if (++nodes > 1_000_000 || depth > 40)
      throw new Error("SUPPLEMENT_JSON_LIMIT");
    if (input === null || typeof input === "boolean")
      return emit(JSON.stringify(input));
    if (typeof input === "string") {
      if (new TextDecoder().decode(new TextEncoder().encode(input)) !== input)
        throw new Error("SUPPLEMENT_JSON_INVALID");
      return emit(JSON.stringify(input));
    }
    if (typeof input === "number" && Number.isFinite(input))
      return emit(JSON.stringify(input));
    if (!input || typeof input !== "object")
      throw new Error("SUPPLEMENT_JSON_INVALID");
    if (Array.isArray(input)) {
      if (
        Object.getPrototypeOf(input) !== Array.prototype ||
        Reflect.ownKeys(input).length !== input.length + 1
      )
        throw new Error("SUPPLEMENT_JSON_INVALID");
      const start = emit("[");
      return (
        start +
        Array.from({ length: input.length }, (_, i) => {
          const d = Object.getOwnPropertyDescriptor(input, String(i));
          if (!d || !("value" in d)) throw new Error("SUPPLEMENT_JSON_INVALID");
          return (i ? emit(",") : "") + walk(d.value, depth + 1);
        }).join("") +
        emit("]")
      );
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(input)))
      throw new Error("SUPPLEMENT_JSON_INVALID");
    const start = emit("{");
    return (
      start +
      Reflect.ownKeys(input)
        .map(key => {
          if (typeof key !== "string")
            throw new Error("SUPPLEMENT_JSON_INVALID");
          return key;
        })
        .sort()
        .map((key, index) => {
          const d = Object.getOwnPropertyDescriptor(input, key)!;
          if (!d.enumerable || !("value" in d))
            throw new Error("SUPPLEMENT_JSON_INVALID");
          return (
            (index ? emit(",") : "") +
            emit(`${JSON.stringify(key)}:`) +
            walk(d.value, depth + 1)
          );
        })
        .join("") +
      emit("}")
    );
  }
  const result = walk(value, 0);
  return result;
}
export const supplementHash = (value: unknown) =>
  SHA256(supplementCanonical(value)).toString();
export const SupplementIdentitySchema = z
  .object({ userId: id, workspaceId: id })
  .strict();
export const SupplementScopeSchema = z
  .object({ expectedWorkspaceId: id, projectId: id })
  .strict();
export const SupplementKindSchema = z.enum([
  "reviews",
  "questions",
  "attributes",
]);
export const SupplementMimeSchema = z.enum([
  "text/csv",
  "text/plain",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
export const SupplementOriginalInputSchema = z.discriminatedUnion(
  "originalType",
  [
    z
      .object({
        originalType: z.literal("file"),
        fileName: name,
        contentType: SupplementMimeSchema,
        base64: z
          .string()
          .min(4)
          .max(Math.ceil(LISTING_SUPPLEMENT_LIMITS.fileBytes / 3) * 4),
      })
      .strict(),
    z
      .object({
        originalType: z.literal("clipboard"),
        text: utf8(LISTING_SUPPLEMENT_LIMITS.clipboardTextBytes),
        html: utf8(LISTING_SUPPLEMENT_LIMITS.clipboardHtmlBytes),
      })
      .strict()
      .refine(value => !!value.text.trim() || !!value.html.trim()),
  ]
);
export const SupplementOriginalMetadataSchema = z
  .object({
    originalType: z.enum(["file", "clipboard"]),
    fileName: name,
    contentType: z.union([
      SupplementMimeSchema,
      z.literal("application/vnd.listing.clipboard+json"),
    ]),
    byteSize: id.max(LISTING_SUPPLEMENT_LIMITS.fileBytes),
    contentHash: SupplementHashSchema,
  })
  .strict()
  .refine(value =>
    value.originalType === "clipboard"
      ? value.contentType === "application/vnd.listing.clipboard+json" &&
        value.fileName === "clipboard.txt+html.json" &&
        value.byteSize <= LISTING_SUPPLEMENT_LIMITS.clipboardBytes
      : value.contentType !== "application/vnd.listing.clipboard+json"
  );
const text = utf8(32_000),
  optional = text.nullable();
const locator = z.object({ part: utf8(255), row: id }).strict();
const base = z.object({
  recordId: SupplementHashSchema,
  declaredAsin: z
    .string()
    .regex(/^[A-Z0-9]{10}$/u)
    .nullable(),
  locator,
  sourceFields: z
    .array(
      z
        .object({
          column: id.max(64),
          header: utf8(32_000),
          value: z.union([
            utf8(32_000),
            z.number().finite().safe(),
            z.boolean(),
            z.null(),
          ]),
        })
        .strict()
    )
    .max(64),
});
export const SupplementRecordSchema = z.discriminatedUnion("kind", [
  base
    .extend({
      kind: z.literal("reviews"),
      value: z
        .object({
          body: text.refine(value => !!value.trim()),
          title: optional,
          rating: z.number().min(0).max(5).nullable(),
          date: optional,
          author: optional,
          verifiedPurchase: z.boolean().nullable(),
          variant: optional,
          sourceReviewId: optional,
        })
        .strict(),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("questions"),
      value: z
        .object({
          question: text.refine(value => !!value.trim()),
          questionCn: optional,
          answer: optional,
          answerCn: optional,
          parentQuestion: optional,
          type: z.enum(["alexa", "follow_up"]),
        })
        .strict(),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("attributes"),
      value: z
        .object({
          name: utf8(120).refine(value => !!value.trim()),
          value: utf8(2000),
        })
        .strict(),
    })
    .strict(),
]);
export const SupplementTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("competitor"),
      analysisId: id,
      asin: z.string().regex(/^[A-Z0-9]{10}$/u),
      revisionHash: SupplementHashSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("product"),
      projectId: id,
      revisionHash: SupplementHashSchema,
    })
    .strict(),
]);
export const supplementTargetKey = (
  target: z.infer<typeof SupplementTargetSchema>
) =>
  target.type === "competitor"
    ? `competitor:${target.analysisId}`
    : `product:${target.projectId}`;
export const SupplementCoverageSchema = z
  .object({
    scope: z.literal("complete_supplied_original_not_market_total"),
    totalRows: z.number().int().min(0).max(20_000).nullable(),
    acceptedRows: z.number().int().min(0).max(20_000),
    excluded: z
      .array(
        z
          .object({
            locator,
            reason: z.enum(["blank", "empty_required_field"]),
          })
          .strict()
      )
      .max(20_000),
    normalization: z.literal("LF_then_trim_no_internal_whitespace_collapse"),
  })
  .strict();
export const SupplementPreviewInputSchema = SupplementScopeSchema.extend({
  kind: SupplementKindSchema,
  original: SupplementOriginalInputSchema,
}).strict();
export const SupplementPreviewSchema = z
  .object({
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    kind: SupplementKindSchema,
    original: SupplementOriginalMetadataSchema,
    parserVersion: z.literal(LISTING_SUPPLEMENT_PARSER),
    status: z.enum(["ready", "failed"]),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/u)
      .nullable(),
    records: z.array(SupplementRecordSchema).max(20_000),
    coverage: SupplementCoverageSchema,
    targets: z.array(SupplementTargetSchema).max(300),
    previewHash: SupplementHashSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const { previewHash, ...body } = value;
    if (
      value.identity.workspaceId !== value.scope.expectedWorkspaceId ||
      value.records.some(item => item.kind !== value.kind) ||
      new Set(value.records.map(item => item.recordId)).size !==
        value.records.length ||
      value.coverage.acceptedRows !== value.records.length ||
      (value.status === "ready" &&
        value.coverage.totalRows !==
          value.coverage.acceptedRows + value.coverage.excluded.length) ||
      (value.status === "failed" && value.coverage.totalRows !== null) ||
      (value.status === "ready") !== (value.reasonCode === null) ||
      (value.status === "failed" && value.records.length !== 0) ||
      new Set(value.targets.map(supplementTargetKey)).size !==
        value.targets.length ||
      supplementHash(body) !== previewHash
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid complete preview binding",
      });
  });
export const SupplementAssignmentSchema = z
  .object({ recordId: SupplementHashSchema, target: SupplementTargetSchema })
  .strict();
export const SupplementSaveInputSchema = SupplementPreviewInputSchema.extend({
  operationId: SupplementUuidSchema,
  expectedPreviewHash: SupplementHashSchema,
  assignments: z.array(SupplementAssignmentSchema).max(20_000),
  confirmSourceOnly: z.literal(true),
}).strict();
export const SupplementOperationInputSchema = SupplementScopeSchema.extend({
  operationId: SupplementUuidSchema,
}).strict();
export const SupplementSourceInputSchema = SupplementScopeSchema.extend({
  sourceId: SupplementUuidSchema,
}).strict();
export const SupplementDeleteInputSchema =
  SupplementOperationInputSchema.extend({
    sourceId: SupplementUuidSchema,
    expectedManifestHash: SupplementHashSchema,
    confirmPreserveImportedData: z.literal(true),
  }).strict();
export const SupplementManifestSchema = z
  .object({
    version: z.literal(1),
    manifestVersion: z.literal(1),
    sourceId: SupplementUuidSchema,
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    kind: SupplementKindSchema,
    original: SupplementOriginalMetadataSchema,
    parserVersion: z.literal(LISTING_SUPPLEMENT_PARSER),
    previewHash: SupplementHashSchema,
    previewStatus: z.enum(["ready", "failed"]),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/u)
      .nullable(),
    records: z
      .array(
        z
          .object({
            source: SupplementRecordSchema,
            target: SupplementTargetSchema,
          })
          .strict()
      )
      .max(20_000),
    coverage: SupplementCoverageSchema,
    previousManifestHash: z.null(),
    createdAt: z.string().datetime(),
    manifestHash: SupplementHashSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const { manifestHash, ...body } = value;
    if (
      value.identity.workspaceId !== value.scope.expectedWorkspaceId ||
      supplementHash(body) !== manifestHash ||
      value.records.length !== value.coverage.acceptedRows ||
      new Set(value.records.map(item => item.source.recordId)).size !==
        value.records.length ||
      value.records.some(item => {
        if (item.source.kind !== value.kind) return true;
        return value.kind === "attributes"
          ? item.target.type !== "product" ||
              item.target.projectId !== value.scope.projectId
          : item.target.type !== "competitor" ||
              (item.source.declaredAsin !== null &&
                item.source.declaredAsin !== item.target.asin);
      }) ||
      (value.previewStatus === "failed" &&
        (value.records.length !== 0 || value.reasonCode === null))
    )
      ctx.addIssue({ code: "custom", message: "Invalid immutable manifest" });
  });
export const SupplementReceiptSchema = z
  .object({
    identity: SupplementIdentitySchema,
    scope: SupplementOperationInputSchema,
    action: z.enum(["save", "delete_original", "delete_record"]).nullable(),
    status: z.enum(["committed", "cancelled", "unknown"]),
    sourceId: SupplementUuidSchema.nullable(),
    requestHash: SupplementHashSchema.nullable(),
    manifestHash: SupplementHashSchema.nullable(),
    originalState: z.enum(["stored", "deleted"]).nullable(),
    recordState: z.enum(["visible", "deleted"]).nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/u)
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.identity.workspaceId !== value.scope.expectedWorkspaceId ||
      (value.status === "committed"
        ? value.action === null ||
          value.sourceId === null ||
          value.requestHash === null ||
          value.manifestHash === null ||
          value.originalState === null ||
          value.recordState === null ||
          value.reasonCode !== null
        : value.action !== null ||
          value.sourceId !== null ||
          value.requestHash !== null ||
          value.manifestHash !== null ||
          value.originalState !== null ||
          value.recordState !== null ||
          value.reasonCode === null)
    )
      ctx.addIssue({ code: "custom", message: "Invalid source receipt" });
  });
export const SupplementHistoryInputSchema = SupplementScopeSchema.extend({
  limit: z.number().int().min(1).max(100).default(30),
  cursor: z
    .object({
      createdAt: z.string().datetime(),
      sourceId: SupplementUuidSchema,
    })
    .strict()
    .nullable()
    .default(null),
}).strict();
export type SupplementIdentity = z.infer<typeof SupplementIdentitySchema>;
export type SupplementScope = z.infer<typeof SupplementScopeSchema>;
export type SupplementKind = z.infer<typeof SupplementKindSchema>;
export type SupplementOriginalInput = z.infer<
  typeof SupplementOriginalInputSchema
>;
export type SupplementOriginalMetadata = z.infer<
  typeof SupplementOriginalMetadataSchema
>;
export type SupplementRecord = z.infer<typeof SupplementRecordSchema>;
export type SupplementTarget = z.infer<typeof SupplementTargetSchema>;
export type SupplementPreviewInput = z.infer<
  typeof SupplementPreviewInputSchema
>;
export type SupplementPreview = z.infer<typeof SupplementPreviewSchema>;
export type SupplementSaveInput = z.infer<typeof SupplementSaveInputSchema>;
export type SupplementOperationInput = z.infer<
  typeof SupplementOperationInputSchema
>;
export type SupplementSourceInput = z.infer<typeof SupplementSourceInputSchema>;
export type SupplementDeleteInput = z.infer<typeof SupplementDeleteInputSchema>;
export type SupplementManifest = z.infer<typeof SupplementManifestSchema>;
export type SupplementReceipt = z.infer<typeof SupplementReceiptSchema>;
export type SupplementHistoryInput = z.infer<
  typeof SupplementHistoryInputSchema
>;
