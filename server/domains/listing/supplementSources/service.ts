import { z } from "zod";
import {
  SupplementPreviewInputSchema,
  SupplementSaveInputSchema,
  SupplementOperationInputSchema,
  SupplementSourceInputSchema,
  SupplementDeleteInputSchema,
  SupplementHistoryInputSchema,
  SupplementManifestSchema,
  SupplementReceiptSchema,
  SupplementIdentitySchema,
  supplementHash,
  supplementCanonical,
  supplementTargetKey,
  type SupplementSaveInput,
  type SupplementIdentity,
  type SupplementOperationInput,
  type SupplementScope,
  type SupplementOriginalInput,
  type SupplementPreview,
  type SupplementManifest,
  type SupplementReceipt,
} from "../../../../shared/listingSupplementSources";
import { buildSupplementPreview, decodeSupplementOriginal } from "./parser";
import {
  createSupplementOriginalStorage,
  type SupplementOriginalStorage,
} from "./storage";
import {
  createSupplementSourceRepository,
  supplementUnknown,
  type SupplementSourceRepository,
} from "./repository";
import {
  SupplementPreparedSaveSchema,
  supplementScope,
  supplementFail,
  SupplementSourceError,
  type SupplementPrepared,
  type SupplementPreparedSave,
} from "./protocol";
type Context = { user: { id: number }; workspaceId?: number | null };
function identityOf(
  context: Context,
  scope: SupplementScope
): SupplementIdentity {
  if (context.workspaceId !== scope.expectedWorkspaceId)
    supplementFail("ACCESS_DENIED");
  return SupplementIdentitySchema.parse({
    userId: context.user.id,
    workspaceId: context.workspaceId,
  });
}
function safe(error: unknown): never {
  if (error instanceof SupplementSourceError) throw error;
  if (error instanceof z.ZodError) return supplementFail("INPUT_INVALID");
  return supplementFail("UNAVAILABLE");
}
const same = (a: unknown, b: unknown) =>
  supplementCanonical(a) === supplementCanonical(b);
function saveRequestHash(
  identity: SupplementIdentity,
  input: SupplementSaveInput
) {
  const { original: _bytes, ...request } = input;
  return supplementHash({
    identity,
    request: {
      ...request,
      assignments: [...input.assignments].sort((a, b) =>
        a.recordId.localeCompare(b.recordId)
      ),
      original: decodeSupplementOriginal(input.original).metadata,
    },
  });
}
function bindManifest(
  identity: SupplementIdentity,
  input: SupplementSaveInput,
  preview: SupplementPreview,
  now: string
): SupplementManifest {
  if (input.expectedPreviewHash !== preview.previewHash)
    supplementFail("PREVIEW_CHANGED");
  if (
    input.assignments.length !== preview.records.length ||
    new Set(input.assignments.map(item => item.recordId)).size !==
      input.assignments.length
  )
    supplementFail("EXPLICIT_ASSIGNMENTS_REQUIRED");
  const records = preview.records.map(source => {
    const assignment = input.assignments.find(
      item => item.recordId === source.recordId
    );
    if (
      !assignment ||
      !preview.targets.some(
        target =>
          supplementTargetKey(target) ===
            supplementTargetKey(assignment.target) &&
          same(target, assignment.target)
      )
    )
      supplementFail("TARGETS_CHANGED");
    if (
      source.kind === "attributes"
        ? assignment.target.type !== "product" ||
          assignment.target.projectId !== input.projectId
        : assignment.target.type !== "competitor" ||
          (source.declaredAsin !== null &&
            source.declaredAsin !== assignment.target.asin)
    )
      supplementFail("ASSIGNMENT_MISMATCH");
    return { source, target: assignment.target };
  });
  const body = {
    version: 1 as const,
    manifestVersion: 1 as const,
    sourceId: input.operationId,
    identity,
    scope: supplementScope(input),
    kind: input.kind,
    original: preview.original,
    parserVersion: preview.parserVersion,
    previewHash: preview.previewHash,
    previewStatus: preview.status,
    reasonCode: preview.reasonCode,
    records,
    coverage: preview.coverage,
    previousManifestHash: null,
    createdAt: now,
  };
  return SupplementManifestSchema.parse({
    ...body,
    manifestHash: supplementHash(body),
  });
}
function originalFromBytes(
  prepared: SupplementPreparedSave,
  bytes: Buffer
): SupplementOriginalInput {
  const metadata = prepared.original.metadata;
  if (metadata.originalType === "file") {
    if (metadata.contentType === "application/vnd.listing.clipboard+json")
      return supplementFail("ORIGINAL_INVALID");
    return {
      originalType: "file",
      fileName: metadata.fileName,
      contentType: metadata.contentType,
      base64: bytes.toString("base64"),
    };
  }
  try {
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    const value = z
      .object({ version: z.literal(1), text: z.string(), html: z.string() })
      .strict()
      .parse(raw);
    return { originalType: "clipboard", text: value.text, html: value.html };
  } catch {
    return supplementFail("ORIGINAL_INVALID");
  }
}
export function createListingSupplementSourceService(
  dependencies: {
    repository?: SupplementSourceRepository;
    storage?: SupplementOriginalStorage;
    now?: () => string;
  } = {}
) {
  const repository =
      dependencies.repository ?? createSupplementSourceRepository(),
    storage = dependencies.storage ?? createSupplementOriginalStorage(),
    now = dependencies.now ?? (() => new Date().toISOString());
  async function finishVerified(
    identity: SupplementIdentity,
    scope: SupplementOperationInput,
    prepared: SupplementPrepared
  ): Promise<SupplementReceipt> {
    if (prepared.action === "save") {
      const bytes = await storage.readVerified(prepared.original),
        original = originalFromBytes(prepared, bytes);
      const decoded = buildSupplementPreview(
        identity,
        prepared.scope,
        prepared.manifest.kind,
        original,
        prepared.targets
      );
      if (
        decoded.preview.previewHash !== prepared.manifest.previewHash ||
        !same(
          decoded.preview.records,
          prepared.manifest.records.map(item => item.source)
        ) ||
        !same(decoded.preview.coverage, prepared.manifest.coverage) ||
        decoded.preview.status !== prepared.manifest.previewStatus ||
        decoded.preview.reasonCode !== prepared.manifest.reasonCode
      )
        supplementFail("MANIFEST_ORIGINAL_MISMATCH");
    } else if (prepared.previousOriginalState !== "deleted")
      await storage.verifyAbsent(prepared.original);
    return repository.finalize(identity, scope, prepared);
  }
  async function preview(context: Context, raw: unknown) {
    try {
      const input = SupplementPreviewInputSchema.parse(raw),
        identity = identityOf(context, input),
        targets = await repository.targets(identity, input, input.kind);
      return buildSupplementPreview(
        identity,
        supplementScope(input),
        input.kind,
        input.original,
        targets
      ).preview;
    } catch (error) {
      return safe(error);
    }
  }
  async function save(
    context: Context,
    raw: unknown
  ): Promise<SupplementReceipt> {
    let identity: SupplementIdentity | undefined,
      scope: SupplementOperationInput | undefined;
    try {
      const input = SupplementSaveInputSchema.parse(raw);
      identity = identityOf(context, input);
      scope = { ...supplementScope(input), operationId: input.operationId };
      const old = await repository.check(identity, scope),
        requestHash = saveRequestHash(identity, input);
      if (old) {
        if (old.prepared && old.prepared.requestHash !== requestHash)
          supplementFail("UUID_REQUEST_CONFLICT");
        return old.receipt ?? supplementUnknown(identity, scope);
      }
      const targets = await repository.targets(identity, input, input.kind),
        parsed = buildSupplementPreview(
          identity,
          supplementScope(input),
          input.kind,
          input.original,
          targets
        );
      const manifest = bindManifest(identity, input, parsed.preview, now()),
        original = storage.prepare(
          identity,
          supplementScope(input),
          input.operationId,
          parsed.preview.original
        );
      const prepared = SupplementPreparedSaveSchema.parse({
        version: 1,
        action: "save",
        identity,
        scope: supplementScope(input),
        operationId: input.operationId,
        sourceId: input.operationId,
        requestHash,
        original,
        manifest,
        targets,
      });
      const reserved = await repository.reserve(
        identity,
        prepared,
        supplementHash(targets)
      );
      if (!reserved.created)
        return reserved.operation.receipt ?? supplementUnknown(identity, scope);
      // Both short transactions must positively ACK before the single PUT.
      const dispatched = await repository.dispatch(identity, scope, "save");
      if (dispatched.action !== "save") supplementFail("OPERATION_CHANGED");
      await storage.putOnce(dispatched.original, parsed.bytes);
      return await finishVerified(identity, scope, dispatched);
    } catch (error) {
      if (
        identity &&
        scope &&
        error instanceof SupplementSourceError &&
        /UNKNOWN|UNCONFIRMED|OBJECT_UNVERIFIED/u.test(error.code)
      )
        return supplementUnknown(identity, scope);
      return safe(error);
    }
  }
  async function check(
    context: Context,
    raw: unknown
  ): Promise<SupplementReceipt> {
    try {
      const scope = SupplementOperationInputSchema.parse(raw),
        identity = identityOf(context, scope);
      return (
        (await repository.check(identity, scope))?.receipt ??
        supplementUnknown(identity, scope)
      );
    } catch (error) {
      return safe(error);
    }
  }
  async function complete(
    context: Context,
    raw: unknown
  ): Promise<SupplementReceipt> {
    let identity: SupplementIdentity | undefined,
      scope: SupplementOperationInput | undefined;
    try {
      scope = SupplementOperationInputSchema.parse(raw);
      identity = identityOf(context, scope);
      const current = await repository.check(identity, scope);
      if (current?.receipt) return current.receipt;
      if (
        !current?.prepared ||
        (current.state !== "dispatched" &&
          !(
            current.state === "prepared" &&
            current.prepared.action !== "save" &&
            current.prepared.previousOriginalState === "deleted"
          ))
      )
        return supplementUnknown(identity, scope);
      return await finishVerified(identity, scope, current.prepared);
    } catch (error) {
      if (
        identity &&
        scope &&
        error instanceof SupplementSourceError &&
        /UNKNOWN|UNCONFIRMED|OBJECT_UNVERIFIED/u.test(error.code)
      )
        return supplementUnknown(identity, scope);
      return safe(error);
    }
  }
  async function cancel(context: Context, raw: unknown) {
    try {
      const input = SupplementOperationInputSchema.parse(raw);
      return await repository.cancel(identityOf(context, input), input);
    } catch (error) {
      return safe(error);
    }
  }
  async function remove(
    context: Context,
    raw: unknown,
    action: "delete_original" | "delete_record"
  ): Promise<SupplementReceipt> {
    let identity: SupplementIdentity | undefined,
      scope: SupplementOperationInput | undefined;
    try {
      const input = SupplementDeleteInputSchema.parse(raw);
      identity = identityOf(context, input);
      scope = { ...supplementScope(input), operationId: input.operationId };
      const requestHash = supplementHash({ identity, action, request: input });
      const result = await repository.prepareDelete(
        identity,
        scope,
        input.sourceId,
        input.expectedManifestHash,
        action,
        requestHash
      );
      if (!result.created)
        return result.operation.receipt ?? supplementUnknown(identity, scope);
      const prepared = result.operation.prepared;
      if (!prepared || prepared.action === "save")
        supplementFail("OPERATION_CHANGED");
      if (prepared.previousOriginalState !== "deleted") {
        const dispatched = await repository.dispatch(identity, scope, action);
        await storage.deleteOnce(dispatched.original);
      }
      return await finishVerified(identity, scope, prepared);
    } catch (error) {
      if (
        identity &&
        scope &&
        error instanceof SupplementSourceError &&
        /UNKNOWN|UNCONFIRMED|OBJECT_UNVERIFIED/u.test(error.code)
      )
        return supplementUnknown(identity, scope);
      return safe(error);
    }
  }
  async function history(context: Context, raw: unknown) {
    try {
      const input = SupplementHistoryInputSchema.parse(raw);
      return await repository.history(identityOf(context, input), input);
    } catch (error) {
      return safe(error);
    }
  }
  async function download(context: Context, raw: unknown) {
    try {
      const input = SupplementSourceInputSchema.parse(raw),
        identity = identityOf(context, input),
        descriptor = await repository.downloadable(identity, input),
        bytes = await storage.readVerified(descriptor);
      // Reauthorize after external I/O; a deleted/hidden/revoked source cannot
      // be delivered by a late callback. No signed URL or object key escapes.
      if (!same(descriptor, await repository.downloadable(identity, input)))
        supplementFail("SOURCE_CHANGED");
      return {
        fileName: descriptor.metadata.fileName,
        contentType: descriptor.metadata.contentType,
        byteSize: descriptor.metadata.byteSize,
        contentHash: descriptor.metadata.contentHash,
        base64: bytes.toString("base64"),
      };
    } catch (error) {
      return safe(error);
    }
  }
  async function manifest(context: Context, raw: unknown) {
    try {
      const input = SupplementSourceInputSchema.parse(raw);
      return await repository.readManifest(identityOf(context, input), input);
    } catch (error) {
      return safe(error);
    }
  }
  return {
    preview,
    save,
    check,
    complete,
    cancel,
    history,
    download,
    manifest,
    deleteOriginal: (context: Context, input: unknown) =>
      remove(context, input, "delete_original"),
    deleteRecord: (context: Context, input: unknown) =>
      remove(context, input, "delete_record"),
  };
}
