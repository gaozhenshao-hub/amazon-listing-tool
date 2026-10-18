import { z } from "zod";
import SHA256 from "crypto-js/sha256";
import { inventoryCanonical, parseInventorySnapshot, type InventorySnapshotRecord } from "./inventorySnapshotRead";

const id = z.number().int().positive().max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.object({ userId: id, workspaceId: id }).strict();
const operationId = z.string().uuid().refine(value => value === value.toLowerCase());
export const InventorySnapshotRunSourceSchema = z.enum(["saihu_sync", "manual_collection"]);
export const InventorySnapshotRefreshOptionsInputSchema = z.object({ expectedWorkspaceId: id }).strict();
export const InventorySnapshotRefreshStartInputSchema = InventorySnapshotRefreshOptionsInputSchema.extend({ operationId, expectedSnapshotKey: hash, expectedConnectionVersion: hash, expectedMappingVersion: hash }).strict();
export const InventorySnapshotRefreshReadRunInputSchema = InventorySnapshotRefreshOptionsInputSchema.extend({ operationId }).strict();
export const InventorySnapshotRefreshRecoverInputSchema = InventorySnapshotRefreshReadRunInputSchema.extend({ decision: z.enum(["check", "cancel"]) }).strict();
export const InventoryCollectionProgressSchema = z.object({ source: z.enum(["warehouses", "warehouse", "fba", "commodities", "aux", "auxParents", "listings", "shipping", "shippingItems", "details"]).nullable(), completedSources: z.number().int().min(0).max(10), totalSources: z.literal(10) }).strict();
export const InventorySnapshotRefreshResultSchema = z.object({ identity, operationId, outcome: z.enum(["accepted", "committed", "cancelled", "failed", "unknown"]), jobId: id.nullable(), state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).nullable(), snapshotId: id.nullable(), snapshotKey: hash.nullable(), progress: InventoryCollectionProgressSchema, reasonCode: z.string().regex(/^[a-z0-9_]{1,100}$/u).nullable() }).strict().superRefine((value, ctx) => {
  const issue = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inventory operation state" });
  if (value.outcome === "unknown") { if (value.jobId !== null || value.state !== null || value.snapshotId !== null || value.snapshotKey !== null || value.reasonCode === null) issue(); }
  else if (value.jobId === null) issue();
  if (value.outcome === "committed") { if (value.state !== "succeeded" || value.snapshotId === null || value.snapshotKey === null || value.reasonCode !== null || value.progress.completedSources !== 10) issue(); }
  else if (value.snapshotId !== null || value.snapshotKey !== null) issue();
  if (value.outcome === "accepted" && (!value.state || !["queued", "running"].includes(value.state) || value.reasonCode !== null)) issue();
  if (value.outcome === "cancelled" && (value.state !== "cancelled" || value.reasonCode === null)) issue();
  if (value.outcome === "failed" && (value.state !== "failed" || value.reasonCode === null)) issue();
});
export const InventorySnapshotRefreshOptionsResultSchema = z.object({ identity, capabilities: z.object({ refresh: z.object({ status: z.enum(["available", "unavailable"]), reasonCode: z.string().nullable() }).strict() }).strict(), snapshot: z.object({ status: z.enum(["ready", "not_found", "missing", "invalid"]), id: id.nullable(), key: hash.nullable(), runSource: InventorySnapshotRunSourceSchema.nullable() }).strict(), connectionVersion: hash.nullable(), mappingVersion: hash.nullable() }).strict().superRefine((value, ctx) => {
  const cap = value.capabilities.refresh, issue = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inventory refresh capability" });
  if ((cap.status === "available") !== (cap.reasonCode === null)) issue();
  if (cap.status === "available" && (!value.connectionVersion || !value.mappingVersion || !value.snapshot.key || !["ready", "not_found"].includes(value.snapshot.status))) issue();
  if (value.snapshot.status === "ready" && (!value.snapshot.id || !value.snapshot.key || !value.snapshot.runSource)) issue();
  if (value.snapshot.status !== "ready" && (value.snapshot.id !== null || value.snapshot.runSource !== null)) issue();
  if (value.snapshot.status === "not_found" && value.snapshot.key === null || ["missing", "invalid"].includes(value.snapshot.status) && value.snapshot.key !== null) issue();
});
export type InventorySnapshotRefreshOptionsInput = z.infer<typeof InventorySnapshotRefreshOptionsInputSchema>;
export type InventorySnapshotRefreshStartInput = z.infer<typeof InventorySnapshotRefreshStartInputSchema>;
export type InventorySnapshotRefreshReadRunInput = z.infer<typeof InventorySnapshotRefreshReadRunInputSchema>;
export type InventorySnapshotRefreshRecoverInput = z.infer<typeof InventorySnapshotRefreshRecoverInputSchema>;
export type InventorySnapshotRefreshResult = z.infer<typeof InventorySnapshotRefreshResultSchema>;
export type InventorySnapshotRefreshOptionsResult = z.infer<typeof InventorySnapshotRefreshOptionsResultSchema>;
export type InventoryCollectionProgress = z.infer<typeof InventoryCollectionProgressSchema>;
export function inventoryRefreshHash(value: unknown): string { return SHA256(inventoryCanonical(value)).toString(); }
export function inventorySnapshotKey(workspaceId: number, record: InventorySnapshotRecord | null): string {
  id.parse(workspaceId);
  if (!record) return inventoryRefreshHash({ workspaceId, latest: null });
  id.parse(record.id); id.parse(record.runId);
  const parsed = parseInventorySnapshot(record.payload), runSource = InventorySnapshotRunSourceSchema.parse(record.runSource ?? "saihu_sync");
  if (record.workspaceId !== workspaceId || Number(record.capturedAt) !== parsed.capturedAt) throw new Error("INVENTORY_SNAPSHOT_IDENTITY_INVALID");
  const payload = typeof record.payload === "string" ? JSON.parse(record.payload) : record.payload;
  return inventoryRefreshHash({ workspaceId, id: record.id, runId: record.runId, runSource, capturedAt: parsed.capturedAt, payload });
}
export const inventoryCollectionInitialProgress = (): InventoryCollectionProgress => ({ source: null, completedSources: 0, totalSources: 10 });
