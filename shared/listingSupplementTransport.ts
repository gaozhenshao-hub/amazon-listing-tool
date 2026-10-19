import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import {
  LISTING_SUPPLEMENT_LIMITS,
  SupplementDeleteInputSchema,
  SupplementHashSchema,
  SupplementHistoryInputSchema,
  SupplementIdentitySchema,
  SupplementKindSchema,
  SupplementManifestSchema,
  SupplementOperationInputSchema,
  SupplementOriginalMetadataSchema,
  SupplementPreviewInputSchema,
  SupplementPreviewSchema,
  SupplementReceiptSchema,
  SupplementSaveInputSchema,
  SupplementScopeSchema,
  SupplementSourceInputSchema,
  SupplementUuidSchema,
  supplementCanonical,
  type SupplementIdentity,
} from "./listingSupplementSources";

/** The existing Express parser admits 50MiB. A file's original bytes are at
 * most 20MiB (27,962,028 base64 characters). These RPCs must use a non-batched
 * HTTP request: the limit is for the complete HTTP body, not each batch item.
 * The stricter per-input budget leaves room for the tRPC/SuperJSON envelope.
 * These limits never authorize parsing, storage, business adoption or a model.
 */
export const LISTING_SUPPLEMENT_TRANSPORT_LIMITS = Object.freeze({
  httpBodyBytes: 50 * 1024 * 1024,
  inputBytes: 40 * 1024 * 1024,
  fileBase64Characters: Math.ceil(LISTING_SUPPLEMENT_LIMITS.fileBytes / 3) * 4,
  timeoutMs: 180_000,
  maxBatchItems: 1,
});

export const listingSupplementTransportInputs = {
  capabilities: SupplementScopeSchema,
  preview: SupplementPreviewInputSchema,
  save: SupplementSaveInputSchema,
  check: SupplementOperationInputSchema,
  complete: SupplementOperationInputSchema,
  cancel: SupplementOperationInputSchema,
  history: SupplementHistoryInputSchema,
  download: SupplementSourceInputSchema,
  manifest: SupplementSourceInputSchema,
  deleteOriginal: SupplementDeleteInputSchema,
  deleteRecord: SupplementDeleteInputSchema,
} as const;
export type SupplementTransportMethod =
  keyof typeof listingSupplementTransportInputs;

/** Both client and server bind the FULL strict input, including original
 * base64/text/html, without sending those bytes back in an echo or a log.
 * Defaults (notably the history cursor/limit) are parsed identically here.
 */
export function listingSupplementTransportInputHash(
  method: SupplementTransportMethod,
  identity: SupplementIdentity,
  input: unknown
): string {
  return SHA256(
    supplementCanonical(
      {
        method,
        identity: SupplementIdentitySchema.parse(identity),
        input: listingSupplementTransportInputs[method].parse(input),
      },
      LISTING_SUPPLEMENT_TRANSPORT_LIMITS.inputBytes
    )
  ).toString();
}

const same = (left: unknown, right: unknown) =>
  supplementCanonical(left) === supplementCanonical(right);
const inputScope = z.object(SupplementScopeSchema.shape);
function envelope<I extends z.ZodType, D extends z.ZodType>(input: I, data: D) {
  return z
    .object({
      identity: SupplementIdentitySchema,
      scope: SupplementScopeSchema,
      inputHash: SupplementHashSchema,
      input,
      data,
    })
    .strict()
    .superRefine((value, context) => {
      const parsedScope = z.object({ input: inputScope }).safeParse(value);
      if (
        value.identity.workspaceId !== value.scope.expectedWorkspaceId ||
        !parsedScope.success ||
        !same(parsedScope.data.input, value.scope)
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid transport scope",
        });
      }
    });
}
const metadataShape = SupplementOriginalMetadataSchema.shape;
export const SupplementHistoryItemSchema = z
  .object({
    sourceId: SupplementUuidSchema,
    kind: SupplementKindSchema,
    ...metadataShape,
    originalState: z.enum([
      "prepared",
      "stored",
      "deleting",
      "deleted",
      "cancelled",
    ]),
    previewStatus: z.enum(["ready", "failed"]),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/u)
      .nullable(),
    manifestVersion: z.literal(1),
    manifestHash: SupplementHashSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const original = SupplementOriginalMetadataSchema.safeParse({
      originalType: value.originalType,
      fileName: value.fileName,
      contentType: value.contentType,
      byteSize: value.byteSize,
      contentHash: value.contentHash,
    });
    if (
      !original.success ||
      (value.previewStatus === "ready") !== (value.reasonCode === null)
    )
      context.addIssue({ code: "custom", message: "Invalid history metadata" });
  });
export const SupplementHistoryDataSchema = z
  .object({
    identity: SupplementIdentitySchema,
    scope: SupplementScopeSchema,
    items: z.array(SupplementHistoryItemSchema).max(100),
    nextCursor: z
      .object({
        createdAt: z.string().datetime(),
        sourceId: SupplementUuidSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
const historyEcho = SupplementScopeSchema.extend({
  limit: z.number().int().min(1).max(100),
  cursor: SupplementHistoryDataSchema.shape.nextCursor,
}).strict();

export const SupplementDownloadDataSchema = z
  .object({
    fileName: metadataShape.fileName,
    contentType: metadataShape.contentType,
    byteSize: metadataShape.byteSize,
    contentHash: SupplementHashSchema,
    base64: z
      .string()
      .min(4)
      .max(LISTING_SUPPLEMENT_TRANSPORT_LIMITS.fileBase64Characters),
  })
  .strict()
  .superRefine((value, context) => {
    // Bounded canonical base64 without a giant regular expression call stack.
    // The service also checks original bytes + SHA256 before returning them.
    const base64 = value.base64;
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const length = base64.length - padding;
    let valid =
      base64.length % 4 === 0 &&
      (base64.length / 4) * 3 - padding === value.byteSize;
    for (let i = 0; valid && i < length; i++) {
      const c = base64.charCodeAt(i);
      valid =
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 43 ||
        c === 47;
    }
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (valid && padding)
      valid =
        (alphabet.indexOf(base64[length - 1]) & (padding === 2 ? 15 : 3)) === 0;
    if (
      !valid ||
      (value.contentType === "application/vnd.listing.clipboard+json" &&
        (value.fileName !== "clipboard.txt+html.json" ||
          value.byteSize > LISTING_SUPPLEMENT_LIMITS.clipboardBytes))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid original byte envelope",
      });
    }
  });

export const SupplementCapabilitiesDataSchema = z
  .object({
    sourceWritesEnabled: z.boolean(),
    sourceOnly: z.literal(true),
    sealedManifestVersion: z.literal(1),
    limits: z
      .object({
        fileBytes: z.literal(LISTING_SUPPLEMENT_LIMITS.fileBytes),
        clipboardTextBytes: z.literal(
          LISTING_SUPPLEMENT_LIMITS.clipboardTextBytes
        ),
        clipboardHtmlBytes: z.literal(
          LISTING_SUPPLEMENT_LIMITS.clipboardHtmlBytes
        ),
        clipboardBytes: z.literal(LISTING_SUPPLEMENT_LIMITS.clipboardBytes),
        records: z.literal(LISTING_SUPPLEMENT_LIMITS.records),
        manifestBytes: z.literal(LISTING_SUPPLEMENT_LIMITS.manifestBytes),
      })
      .strict(),
  })
  .strict();
export const SupplementCapabilitiesTransportSchema = envelope(
  SupplementScopeSchema,
  SupplementCapabilitiesDataSchema
);
const previewEcho = SupplementPreviewInputSchema.omit({ original: true })
  .extend({
    original: SupplementOriginalMetadataSchema,
  })
  .strict();
const saveEcho = SupplementSaveInputSchema.omit({ original: true })
  .extend({
    original: SupplementOriginalMetadataSchema,
  })
  .strict();
export const SupplementPreviewTransportSchema = envelope(
  previewEcho,
  SupplementPreviewSchema
).superRefine((value, context) => {
  if (
    !same(value.identity, value.data.identity) ||
    !same(value.scope, value.data.scope) ||
    value.input.kind !== value.data.kind ||
    !same(value.input.original, value.data.original)
  )
    context.addIssue({
      code: "custom",
      message: "Invalid preview transport binding",
    });
});
function receiptBinding(
  value: {
    identity: SupplementIdentity;
    scope: z.infer<typeof SupplementScopeSchema>;
    input: z.infer<typeof SupplementOperationInputSchema>;
    data: z.infer<typeof SupplementReceiptSchema>;
  },
  context: z.RefinementCtx
) {
  if (
    !same(value.identity, value.data.identity) ||
    !same(value.data.scope, {
      ...value.scope,
      operationId: value.input.operationId,
    })
  )
    context.addIssue({
      code: "custom",
      message: "Invalid receipt transport binding",
    });
}
export const SupplementSaveTransportSchema = envelope(
  saveEcho,
  SupplementReceiptSchema
).superRefine((value, context) => {
  receiptBinding(value, context);
  if (
    value.data.status === "committed" &&
    (value.data.action !== "save" ||
      value.data.sourceId !== value.input.operationId)
  )
    context.addIssue({
      code: "custom",
      message: "Invalid saved source identity",
    });
});
export const SupplementOperationTransportSchema = envelope(
  SupplementOperationInputSchema,
  SupplementReceiptSchema
).superRefine(receiptBinding);
export const SupplementHistoryTransportSchema = envelope(
  historyEcho,
  SupplementHistoryDataSchema
).superRefine((value, context) => {
  const items = value.data.items;
  const last = items.at(-1);
  const next = value.data.nextCursor;
  const cursor = value.input.cursor;
  const before = (
    a: { createdAt: string; sourceId: string },
    b: { createdAt: string; sourceId: string }
  ) =>
    a.createdAt < b.createdAt ||
    (a.createdAt === b.createdAt && a.sourceId < b.sourceId);
  // The database emits microsecond timestamps. Normalize precision before a
  // lexical comparison (Date.parse would discard the final three digits).
  const normalized = (item: { createdAt: string; sourceId: string }) => ({
    ...item,
    createdAt: item.createdAt.replace(
      /(?:\.(\d{1,6}))?Z$/u,
      (_all, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`
    ),
  });
  if (
    !same(value.identity, value.data.identity) ||
    !same(value.scope, value.data.scope) ||
    items.length > value.input.limit ||
    new Set(items.map(item => item.sourceId)).size !== items.length ||
    items.some(
      (item, index) =>
        (cursor !== null && !before(normalized(item), normalized(cursor))) ||
        (index > 0 && !before(normalized(item), normalized(items[index - 1])))
    ) ||
    (next !== null &&
      (!last ||
        items.length !== value.input.limit ||
        !same(next, { createdAt: last.createdAt, sourceId: last.sourceId })))
  )
    context.addIssue({
      code: "custom",
      message: "Invalid ordered history page",
    });
});
export const SupplementDownloadTransportSchema = envelope(
  SupplementSourceInputSchema,
  SupplementDownloadDataSchema
)
  .safeExtend({ sourceId: SupplementUuidSchema })
  .superRefine((value, context) => {
    if (value.sourceId !== value.input.sourceId)
      context.addIssue({
        code: "custom",
        message: "Invalid download source identity",
      });
  });
export const SupplementManifestTransportSchema = envelope(
  SupplementSourceInputSchema,
  SupplementManifestSchema
).superRefine((value, context) => {
  if (
    !same(value.identity, value.data.identity) ||
    !same(value.scope, value.data.scope) ||
    value.data.sourceId !== value.input.sourceId
  )
    context.addIssue({
      code: "custom",
      message: "Invalid manifest transport binding",
    });
});
function deletionTransport(action: "delete_original" | "delete_record") {
  return envelope(
    SupplementDeleteInputSchema,
    SupplementReceiptSchema
  ).superRefine((value, context) => {
    receiptBinding(value, context);
    if (
      value.data.status === "committed" &&
      (value.data.action !== action ||
        value.data.sourceId !== value.input.sourceId ||
        value.data.manifestHash !== value.input.expectedManifestHash)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid deleted source binding",
      });
  });
}
export const SupplementDeleteOriginalTransportSchema =
  deletionTransport("delete_original");
export const SupplementDeleteRecordTransportSchema =
  deletionTransport("delete_record");

export type SupplementCapabilitiesTransport = z.infer<
  typeof SupplementCapabilitiesTransportSchema
>;
export type SupplementPreviewTransport = z.infer<
  typeof SupplementPreviewTransportSchema
>;
export type SupplementSaveTransport = z.infer<
  typeof SupplementSaveTransportSchema
>;
export type SupplementOperationTransport = z.infer<
  typeof SupplementOperationTransportSchema
>;
export type SupplementHistoryTransport = z.infer<
  typeof SupplementHistoryTransportSchema
>;
export type SupplementDownloadTransport = z.infer<
  typeof SupplementDownloadTransportSchema
>;
export type SupplementManifestTransport = z.infer<
  typeof SupplementManifestTransportSchema
>;
export type SupplementDeleteOriginalTransport = z.infer<
  typeof SupplementDeleteOriginalTransportSchema
>;
export type SupplementDeleteRecordTransport = z.infer<
  typeof SupplementDeleteRecordTransportSchema
>;
