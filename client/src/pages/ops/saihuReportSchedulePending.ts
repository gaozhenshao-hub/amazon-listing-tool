import { z } from "zod";
import {
  SaihuReportIdentitySchema,
  SaihuReportUuid,
  SaihuReportHash,
} from "@shared/saihuReportSync";
export const SaihuSchedulePendingSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    planId: SaihuReportUuid,
    operationId: SaihuReportUuid,
    action: z.enum(["save", "pause", "activate"]),
    requestHash: SaihuReportHash,
  })
  .strict();
export type SaihuSchedulePending = z.infer<typeof SaihuSchedulePendingSchema>;
const key = (identity: SaihuSchedulePending["identity"]) =>
  `saihu-schedule-pending:v1:${identity.userId}:${identity.workspaceId}`;
export function readSaihuSchedulePending(
  identity: SaihuSchedulePending["identity"]
) {
  const raw = localStorage.getItem(key(identity));
  if (raw === null) return null;
  if (raw.length > 2048) throw new Error("SCHEDULE_RECOVERY_INVALID");
  const value = SaihuSchedulePendingSchema.parse(JSON.parse(raw));
  if (
    value.identity.userId !== identity.userId ||
    value.identity.workspaceId !== identity.workspaceId
  )
    throw new Error("SCHEDULE_RECOVERY_SCOPE_CHANGED");
  return value;
}
async function locked<T>(
  identity: SaihuSchedulePending["identity"],
  body: () => T
): Promise<T> {
  if (!navigator.locks?.request) throw new Error("SCHEDULE_LOCK_UNAVAILABLE");
  return navigator.locks.request(key(identity), { mode: "exclusive" }, body);
}
/** Metadata only: no policy, shop scope, source evidence, credentials or URLs. */
export async function reserveSaihuSchedulePending(raw: SaihuSchedulePending) {
  const value = SaihuSchedulePendingSchema.parse(raw);
  await locked(value.identity, () => {
    if (readSaihuSchedulePending(value.identity))
      throw new Error("RESOLVE_ORIGINAL_SCHEDULE_OPERATION");
    localStorage.setItem(key(value.identity), JSON.stringify(value));
    if (
      JSON.stringify(readSaihuSchedulePending(value.identity)) !==
      JSON.stringify(value)
    )
      throw new Error("SCHEDULE_RECOVERY_UNVERIFIED");
  });
}
export async function releaseSaihuSchedulePending(raw: SaihuSchedulePending) {
  const value = SaihuSchedulePendingSchema.parse(raw);
  await locked(value.identity, () => {
    if (
      JSON.stringify(readSaihuSchedulePending(value.identity)) !==
      JSON.stringify(value)
    )
      throw new Error("SCHEDULE_RECOVERY_CHANGED");
    localStorage.removeItem(key(value.identity));
    if (readSaihuSchedulePending(value.identity) !== null)
      throw new Error("SCHEDULE_RECOVERY_UNVERIFIED");
  });
}
