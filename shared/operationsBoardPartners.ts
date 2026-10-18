import { z } from "zod";
import { operationsBoardEditionHash } from "./operationsBoardEdition";

/** Explicit numeric, workspace-local, direct READ relationships only. A pair
 * never grants a role, write permission, ownership, or transitive access. */
export const OPERATIONS_BOARD_PARTNER_LIMITS = { pairs: 1000, members: 5000 } as const;
const id = z.number().int().positive().max(2147483647);
const version = z.number().int().min(0).max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase(), "Lowercase UUID required");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reason = z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u);
const stamp = z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}000$/u).refine(value => {
  const iso = `${value.slice(0, 10)}T${value.slice(11, 23)}Z`, date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso;
});
const identity = z.object({ workspaceId: id, userId: id }).strict();
function ordered(value: { firstUserId: number; secondUserId: number }, ctx: z.RefinementCtx) {
  if (value.firstUserId >= value.secondUserId) ctx.addIssue({ code: "custom", message: "Distinct ordered numeric members required" });
}
export const OperationsBoardPartnersOptionsInputSchema = z.object({ expectedWorkspaceId: id }).strict();
export type OperationsBoardPartnersOptionsInput = z.infer<typeof OperationsBoardPartnersOptionsInputSchema>;
export const OperationsBoardPartnersExecuteInputSchema = z.object({ expectedWorkspaceId: id, operationId: uuid,
  firstUserId: id, secondUserId: id, isActive: z.boolean(), expectedVersion: version }).strict().superRefine(ordered);
export type OperationsBoardPartnersExecuteInput = z.infer<typeof OperationsBoardPartnersExecuteInputSchema>;
export const OperationsBoardPartnersRecoverInputSchema = z.object({ expectedWorkspaceId: id, operationId: uuid, decision: z.enum(["check", "cancel"]) }).strict();
export type OperationsBoardPartnersRecoverInput = z.infer<typeof OperationsBoardPartnersRecoverInputSchema>;
export const OperationsBoardPartnerSchema = z.object({ id, workspaceId: id, firstUserId: id, secondUserId: id,
  isActive: z.boolean(), version: version.min(1), updatedBy: id, updatedAt: stamp }).strict().superRefine(ordered);
export type OperationsBoardPartner = z.infer<typeof OperationsBoardPartnerSchema>;
export const OperationsBoardPartnerMemberSchema = z.object({ userId: id, displayName: z.string().min(1).max(200).refine(value =>
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) && new TextDecoder().decode(new TextEncoder().encode(value)) === value) }).strict();
export type OperationsBoardPartnerMember = z.infer<typeof OperationsBoardPartnerMemberSchema>;
const capability = z.object({ available: z.boolean(), reasonCode: reason.nullable() }).strict().refine(value => value.available === (value.reasonCode === null));
export const OperationsBoardPartnersOptionsResultSchema = z.object({ identity, request: OperationsBoardPartnersOptionsInputSchema,
  members: z.array(OperationsBoardPartnerMemberSchema).max(OPERATIONS_BOARD_PARTNER_LIMITS.members),
  pairs: z.array(OperationsBoardPartnerSchema).max(OPERATIONS_BOARD_PARTNER_LIMITS.pairs), capability }).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId || value.pairs.some(pair => pair.workspaceId !== value.identity.workspaceId)) issue("Workspace mismatch");
  if (new Set(value.members.map(member => member.userId)).size !== value.members.length
    || new Set(value.pairs.map(pair => pair.id)).size !== value.pairs.length
    || new Set(value.pairs.map(pair => `${pair.firstUserId}:${pair.secondUserId}`)).size !== value.pairs.length) issue("Duplicate member or pair");
  // Historical pairs remain visible even if their endpoints are no longer
  // eligible. Only members is the current active selection directory.
});
export type OperationsBoardPartnersOptionsResult = z.infer<typeof OperationsBoardPartnersOptionsResultSchema>;
export const OperationsBoardPartnersWriteResultSchema = z.object({ identity, operationId: uuid,
  status: z.enum(["committed", "cancelled", "unknown"]), requestHash: hash.nullable(), pair: OperationsBoardPartnerSchema.nullable(), reasonCode: reason.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "committed" ? value.requestHash === null || value.pair === null || value.reasonCode !== null
    : value.requestHash !== null || value.pair !== null || value.reasonCode === null) ctx.addIssue({ code: "custom", message: "Receipt state mismatch" });
  if (value.pair && (value.pair.workspaceId !== value.identity.workspaceId || value.pair.updatedBy !== value.identity.userId)) ctx.addIssue({ code: "custom", message: "Receipt workspace/actor mismatch" });
});
export type OperationsBoardPartnersWriteResult = z.infer<typeof OperationsBoardPartnersWriteResultSchema>;
/** Expected request hash is not proof of caller authority. The service must
 * authorize the live actor and bind its durable operation journal separately. */
export function operationsBoardPartnersRequestHash(input: OperationsBoardPartnersExecuteInput): string {
  return operationsBoardEditionHash({ protocol: "operations-board-partners/v1", request: OperationsBoardPartnersExecuteInputSchema.parse(input) });
}
