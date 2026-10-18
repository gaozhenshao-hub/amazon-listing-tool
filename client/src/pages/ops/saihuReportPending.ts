import { z } from "zod";
import {
  SaihuReportHash,
  SaihuReportIdentitySchema,
  SaihuReportUuid,
} from "@shared/saihuReportSync";
export const SaihuReportPendingSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    runOperationId: SaihuReportUuid,
    action: z.enum(["start", "apply", "revoke"]),
    requestHash: SaihuReportHash,
  })
  .strict();
export type SaihuReportPending = z.infer<typeof SaihuReportPendingSchema>;
const key = (identity: SaihuReportPending["identity"]) =>
  `saihu-report-pending:v1:${identity.userId}:${identity.workspaceId}`;
/** Recovery metadata only: never dates, shop lists, source rows, credentials,
 * raw API responses, filenames, URLs, object references or mapped payloads. */
export function readSaihuReportPending(
  identity: SaihuReportPending["identity"]
) {
  const text = localStorage.getItem(key(identity));
  if (text === null) return null;
  if (text.length > 2048) throw new Error("RECOVERY_METADATA_INVALID");
  const pending = SaihuReportPendingSchema.parse(JSON.parse(text));
  if (
    pending.identity.userId !== identity.userId ||
    pending.identity.workspaceId !== identity.workspaceId
  )
    throw new Error("RECOVERY_SCOPE_CHANGED");
  return pending;
}
async function locked<T>(
  identity: SaihuReportPending["identity"],
  body: () => T
): Promise<T> {
  SaihuReportIdentitySchema.parse(identity);
  if (typeof navigator === "undefined" || !navigator.locks?.request)
    throw new Error("RECOVERY_LOCK_UNAVAILABLE");
  return navigator.locks.request(key(identity), { mode: "exclusive" }, body);
}
/** The browser's cross-tab lock covers the complete read/check/write/readback,
 * not an HTTP request. Absence of Web Locks never permits a best-effort send. */
export async function persistSaihuReportPending(pending: SaihuReportPending) {
  pending = SaihuReportPendingSchema.parse(pending);
  return locked(pending.identity, () => {
    if (readSaihuReportPending(pending.identity))
      throw new Error("RESOLVE_ORIGINAL_OPERATION_FIRST");
    localStorage.setItem(key(pending.identity), JSON.stringify(pending));
    if (
      JSON.stringify(readSaihuReportPending(pending.identity)) !==
      JSON.stringify(pending)
    )
      throw new Error("RECOVERY_STORAGE_FAILED");
  });
}
export async function clearSaihuReportPending(pending: SaihuReportPending) {
  pending = SaihuReportPendingSchema.parse(pending);
  return locked(pending.identity, () => {
    if (
      JSON.stringify(readSaihuReportPending(pending.identity)) ===
      JSON.stringify(pending)
    ) {
      localStorage.removeItem(key(pending.identity));
      if (readSaihuReportPending(pending.identity) !== null)
        throw new Error("RECOVERY_STORAGE_FAILED");
    }
  });
}
