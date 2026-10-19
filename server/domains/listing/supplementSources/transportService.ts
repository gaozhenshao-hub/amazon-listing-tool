import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { AppError, APP_ERROR_CODES } from "../../../../shared/_core/errors";
import type { TrpcContext } from "../../../_core/context";
import {
  LISTING_SUPPLEMENT_LIMITS,
  SupplementIdentitySchema,
  type SupplementScope,
} from "../../../../shared/listingSupplementSources";
import {
  listingSupplementTransportInputs as inputs,
  listingSupplementTransportInputHash,
  SupplementCapabilitiesTransportSchema,
  SupplementPreviewTransportSchema,
  SupplementSaveTransportSchema,
  SupplementOperationTransportSchema,
  SupplementHistoryTransportSchema,
  SupplementDownloadTransportSchema,
  SupplementManifestTransportSchema,
  SupplementDeleteOriginalTransportSchema,
  SupplementDeleteRecordTransportSchema,
  type SupplementTransportMethod,
} from "../../../../shared/listingSupplementTransport";
import { createListingSupplementSourceService } from "./service";
import {
  createSupplementSourceRepository,
  type SupplementSourceRepository,
} from "./repository";
import { decodeSupplementOriginal } from "./parser";
import { SupplementSourceError, supplementFail } from "./protocol";

type Service = ReturnType<typeof createListingSupplementSourceService>;
type AuthenticatedContext = { user: { id: number }; workspaceId: number };
class TransportResponseError extends Error {}
// Only stable, deliberately public domain reason codes can cross this adapter.
// Driver/provider errors and arbitrary exception messages are never forwarded.
const publicReasons = new Set([
  "ACCESS_DENIED",
  "INPUT_INVALID",
  "BASE64_INVALID",
  "CLIPBOARD_LIMIT",
  "WRITES_DISABLED",
  "PREVIEW_CHANGED",
  "TARGETS_CHANGED",
  "ASSIGNMENT_MISMATCH",
  "EXPLICIT_ASSIGNMENTS_REQUIRED",
  "UUID_REQUEST_CONFLICT",
  "OPERATION_SCOPE_CHANGED",
  "SOURCE_CHANGED",
  "SOURCE_OPERATION_PENDING",
  "ORIGINAL_OPERATION_PENDING_CHECK_SAME_UUID",
  "CURSOR_INVALID",
  "ORIGINAL_UNAVAILABLE",
  "MANIFEST_UNAVAILABLE",
  "MANIFEST_ORIGIN_UNAVAILABLE",
  "MANIFEST_ORIGINAL_MISMATCH",
  "TARGETS_UNAVAILABLE",
  "SOURCE_UNAVAILABLE",
  "SCHEMA_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "STORAGE_DOMAIN_CHANGED",
  "TRANSACTION_UNAVAILABLE",
  "PACKET_LIMIT",
  "CONTENT_MISMATCH",
  "OBJECT_UNVERIFIED",
  "OUTCOME_UNKNOWN_CHECK_SAME_UUID",
  "ALREADY_DISPATCHED",
  "PREPARE_UNCONFIRMED",
  "DISPATCH_UNCONFIRMED",
  "MANIFEST_UNCONFIRMED",
  "SOURCE_UNCONFIRMED",
  "RECEIPT_UNCONFIRMED",
  "WRITE_UNCONFIRMED",
  "AUDIT_UNCONFIRMED",
  "CANCEL_UNCONFIRMED",
  "OPERATION_CHANGED",
  "OPERATION_INVALID",
  "MANIFEST_INVALID",
  "ORIGINAL_INVALID",
  "UNAVAILABLE",
]);
function safe(error: unknown): never {
  const reason =
    error instanceof TransportResponseError
      ? "RESPONSE_INVALID"
      : error instanceof z.ZodError
        ? "INPUT_INVALID"
        : error instanceof SupplementSourceError &&
            publicReasons.has(error.code)
          ? error.code
          : "UNAVAILABLE";
  const code =
    reason === "RESPONSE_INVALID"
      ? "INTERNAL_SERVER_ERROR"
      : reason === "ACCESS_DENIED"
        ? "FORBIDDEN"
        : [
              "INPUT_INVALID",
              "BASE64_INVALID",
              "CLIPBOARD_LIMIT",
              "CURSOR_INVALID",
              "ASSIGNMENT_MISMATCH",
              "EXPLICIT_ASSIGNMENTS_REQUIRED",
            ].includes(reason)
          ? "BAD_REQUEST"
          : /CHANGED|CONFLICT|PENDING|ALREADY_DISPATCHED/u.test(reason)
            ? "CONFLICT"
            : "PRECONDITION_FAILED";
  const status = {
    INTERNAL_SERVER_ERROR: {
      statusCode: 500,
      code: APP_ERROR_CODES.INTERNAL_ERROR,
    },
    FORBIDDEN: { statusCode: 403, code: APP_ERROR_CODES.PERMISSION_DENIED },
    BAD_REQUEST: { statusCode: 400, code: APP_ERROR_CODES.VALIDATION_FAILED },
    CONFLICT: { statusCode: 409, code: APP_ERROR_CODES.RESOURCE_CONFLICT },
    PRECONDITION_FAILED: {
      statusCode: 412,
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
    },
  }[code];
  const message = `LISTING_SUPPLEMENT_${reason}`;
  throw new TRPCError({
    code,
    message,
    // Deliberately no raw cause: the formatter receives only this closed,
    // non-retryable reason, never a provider/SQL exception or original bytes.
    cause: new AppError({
      ...status,
      message,
      retryable: false,
      details: { domain: "listing_supplement_sources", reasonCode: reason },
      expose: code !== "INTERNAL_SERVER_ERROR",
    }),
  });
}
function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new TransportResponseError();
  return result.data;
}
const scopeOf = (input: SupplementScope): SupplementScope => ({
  expectedWorkspaceId: input.expectedWorkspaceId,
  projectId: input.projectId,
});

/** Typed, authenticated transport adapter. Existing service methods and source
 * v1 semantics remain unchanged. No storage URL or authority from a client is
 * ever forwarded to the foundation service. Construction has no I/O.
 */
export function createListingSupplementTransportService(
  dependencies: {
    service?: Service;
    repository?: SupplementSourceRepository;
  } = {}
) {
  const repository =
    dependencies.repository ?? createSupplementSourceRepository();
  const service =
    dependencies.service ??
    createListingSupplementSourceService({ repository });
  async function invoke<T>(
    ctx: TrpcContext,
    method: SupplementTransportMethod,
    input: SupplementScope,
    body: (
      context: AuthenticatedContext,
      binding: {
        identity: { userId: number; workspaceId: number };
        scope: SupplementScope;
        inputHash: string;
      }
    ) => Promise<T>
  ): Promise<T> {
    try {
      // Never substitute user.defaultWorkspaceId, a caller's role, a data owner,
      // or a workspace from the input for the actual authenticated context.
      if (!ctx.user || ctx.workspaceId !== input.expectedWorkspaceId)
        supplementFail("ACCESS_DENIED");
      const identity = SupplementIdentitySchema.parse({
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
      const binding = {
        identity,
        scope: scopeOf(input),
        inputHash: listingSupplementTransportInputHash(method, identity, input),
      };
      return await body(
        { user: { id: identity.userId }, workspaceId: identity.workspaceId },
        binding
      );
    } catch (error) {
      return safe(error);
    }
  }
  return {
    capabilities(
      ctx: TrpcContext,
      input: z.output<typeof inputs.capabilities>
    ) {
      return invoke(ctx, "capabilities", input, async (_context, binding) => {
        // Fresh physical admission + actual actor/member/project/file-read
        // authorization, not a feature flag or a client-provided permission.
        await repository.targets(binding.identity, input, "attributes");
        return checked(SupplementCapabilitiesTransportSchema, {
          ...binding,
          input,
          data: {
            sourceWritesEnabled: repository.enabled(),
            sourceOnly: true,
            sealedManifestVersion: 1,
            limits: LISTING_SUPPLEMENT_LIMITS,
          },
        });
      });
    },
    // POST: a 20MiB original must never be put into a GET URL. The client uses
    // one independent HTTP request per original, without mutation retries.
    preview(ctx: TrpcContext, input: z.output<typeof inputs.preview>) {
      return invoke(ctx, "preview", input, async (context, binding) => {
        const data = await service.preview(context, input);
        const original = decodeSupplementOriginal(input.original).metadata;
        return checked(SupplementPreviewTransportSchema, {
          ...binding,
          input: { ...input, original },
          data,
        });
      });
    },
    save(ctx: TrpcContext, input: z.output<typeof inputs.save>) {
      return invoke(ctx, "save", input, async (context, binding) => {
        const data = await service.save(context, input);
        const original = decodeSupplementOriginal(input.original).metadata;
        return checked(SupplementSaveTransportSchema, {
          ...binding,
          input: { ...input, original },
          data,
        });
      });
    },
    check(ctx: TrpcContext, input: z.output<typeof inputs.check>) {
      return invoke(ctx, "check", input, async (context, binding) =>
        checked(SupplementOperationTransportSchema, {
          ...binding,
          input,
          data: await service.check(context, input),
        })
      );
    },
    complete(ctx: TrpcContext, input: z.output<typeof inputs.complete>) {
      return invoke(ctx, "complete", input, async (context, binding) =>
        checked(SupplementOperationTransportSchema, {
          ...binding,
          input,
          data: await service.complete(context, input),
        })
      );
    },
    cancel(ctx: TrpcContext, input: z.output<typeof inputs.cancel>) {
      return invoke(ctx, "cancel", input, async (context, binding) =>
        checked(SupplementOperationTransportSchema, {
          ...binding,
          input,
          data: await service.cancel(context, input),
        })
      );
    },
    history(ctx: TrpcContext, input: z.output<typeof inputs.history>) {
      return invoke(ctx, "history", input, async (context, binding) =>
        checked(SupplementHistoryTransportSchema, {
          ...binding,
          input,
          data: await service.history(context, input),
        })
      );
    },
    download(ctx: TrpcContext, input: z.output<typeof inputs.download>) {
      return invoke(ctx, "download", input, async (context, binding) => {
        const response = checked(SupplementDownloadTransportSchema, {
          ...binding,
          input,
          sourceId: input.sourceId,
          data: await service.download(context, input),
        });
        // Defense at the transport boundary too: return exact original bytes,
        // never a key/URL, a rewritten file or a merely plausible byte count.
        const bytes = Buffer.from(response.data.base64, "base64");
        if (
          bytes.length !== response.data.byteSize ||
          createHash("sha256").update(bytes).digest("hex") !==
            response.data.contentHash
        )
          throw new TransportResponseError();
        return response;
      });
    },
    manifest(ctx: TrpcContext, input: z.output<typeof inputs.manifest>) {
      return invoke(ctx, "manifest", input, async (context, binding) =>
        checked(SupplementManifestTransportSchema, {
          ...binding,
          input,
          data: await service.manifest(context, input),
        })
      );
    },
    deleteOriginal(
      ctx: TrpcContext,
      input: z.output<typeof inputs.deleteOriginal>
    ) {
      return invoke(ctx, "deleteOriginal", input, async (context, binding) =>
        checked(SupplementDeleteOriginalTransportSchema, {
          ...binding,
          input,
          data: await service.deleteOriginal(context, input),
        })
      );
    },
    deleteRecord(
      ctx: TrpcContext,
      input: z.output<typeof inputs.deleteRecord>
    ) {
      return invoke(ctx, "deleteRecord", input, async (context, binding) =>
        checked(SupplementDeleteRecordTransportSchema, {
          ...binding,
          input,
          data: await service.deleteRecord(context, input),
        })
      );
    },
  };
}

export const listingSupplementTransportService =
  createListingSupplementTransportService();
