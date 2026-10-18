import { z } from "zod";
import { monthlyFinancialJsonBytes, type MonthlyFinancialReadRow } from "./monthlyFinancialRead";

/** Archive-specific CURRENT authorization metadata, never a historical member
 * snapshot or a new permission grant. The legacy self-only ownership contract
 * intentionally remains unchanged. Only freshly verified direct partners may
 * appear as partners; that relationship is read-only and never transitive. */
export const OPERATIONS_BOARD_EDITION_OWNERSHIP_MEANING = "current_authorization_not_historical_membership" as const;
const id = z.number().int().positive().safe().max(2147483647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
const month = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u);
const parentSchema = z.object({ parentAsin: text(500), operatorIds: z.array(id).max(5000), status: z.enum(["resolved", "unresolved"]),
  basis: z.enum(["manual", "confirmed_source_mapping", "none"]), sourceMonth: month.nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.operatorIds).size !== value.operatorIds.length || value.operatorIds.some((value, index, array) => index > 0 && value <= array[index - 1])) ctx.addIssue({ code: "custom", message: "Owner IDs must be unique and ordered" });
  if ((value.status === "resolved") !== (value.operatorIds.length > 0) || value.status === "resolved" && value.basis === "none") ctx.addIssue({ code: "custom", message: "Owner resolution mismatch" });
  if ((value.basis === "confirmed_source_mapping") !== (value.sourceMonth !== null)) ctx.addIssue({ code: "custom", message: "Current mapping evidence month mismatch" });
});
const schema = z.object({ version: z.literal(1), meaning: z.literal(OPERATIONS_BOARD_EDITION_OWNERSHIP_MEANING), visibility: z.enum(["full", "scoped"]),
  operators: z.array(z.object({ userId: id, displayName: text(200), relation: z.enum(["self", "direct_partner", "workspace_owner"]) }).strict()).max(5000),
  // Both arrays describe the complete authorized range BEFORE operator filter,
  // allowing selection to be cleared without inventing a member directory.
  parents: z.array(parentSchema).max(60000), selectedOperatorId: id.nullable(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.operators.map(operator => operator.userId)), referenced = new Set(value.parents.flatMap(parent => parent.operatorIds));
  if (ids.size !== value.operators.length || new Set(value.parents.map(parent => parent.parentAsin)).size !== value.parents.length
    || value.operators.some((operator, index) => index > 0 && operator.userId <= value.operators[index - 1].userId)) ctx.addIssue({ code: "custom", message: "Duplicate or unordered ownership directory" });
  if ([...referenced].some(owner => !ids.has(owner)) || [...ids].some(owner => !referenced.has(owner))) ctx.addIssue({ code: "custom", message: "Directory must contain only resolved visible-product owners" });
  if (value.visibility === "scoped" && value.operators.some(operator => operator.relation === "workspace_owner")) ctx.addIssue({ code: "custom", message: "Scoped ownership cannot disclose other workspace members" });
  if (value.selectedOperatorId !== null && !ids.has(value.selectedOperatorId)) ctx.addIssue({ code: "custom", message: "Selected owner is not visible" });
});
export const OperationsBoardEditionOwnershipSchema = z.preprocess((value, ctx) => {
  try {
    if (monthlyFinancialJsonBytes(value, { jsonNodes: 1000000, jsonDepth: 12, stringLength: 2000 }) > 8 * 1024 * 1024) throw Error();
    return value;
  } catch { ctx.addIssue({ code: "custom", message: "Bounded plain archive ownership metadata required" }); return z.NEVER; }
}, schema);
export type OperationsBoardEditionOwnership = z.infer<typeof OperationsBoardEditionOwnershipSchema>;
export class OperationsBoardEditionOwnershipError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_OWNERSHIP_${code}`); this.name = "OperationsBoardEditionOwnershipError"; }
}
const allocated = (row: MonthlyFinancialReadRow) => !!row.parentAsin && ["child", "parent_only"].includes(row.allocation);
function validate(ownership: OperationsBoardEditionOwnership, rows: readonly MonthlyFinancialReadRow[], userId: number, operatorId: number | undefined, complete: boolean) {
  const checked = OperationsBoardEditionOwnershipSchema.safeParse(ownership);
  if (!checked.success || !id.safeParse(userId).success || rows.length > 60000) throw new OperationsBoardEditionOwnershipError("INVALID");
  const value = checked.data;
  if (value.selectedOperatorId !== (operatorId ?? null) || value.operators.some(operator => (operator.relation === "self") !== (operator.userId === userId))) throw new OperationsBoardEditionOwnershipError("IDENTITY_MISMATCH");
  const parents = new Map(value.parents.map(parent => [parent.parentAsin, parent])), latest = new Map<string, string>();
  for (const row of rows) {
    if (!allocated(row)) { if (operatorId !== undefined) throw new OperationsBoardEditionOwnershipError("FILTER_MISMATCH"); continue; }
    const owner = parents.get(row.parentAsin);
    if (!owner || owner.sourceMonth !== null && owner.sourceMonth < row.yearMonth || operatorId !== undefined && !owner.operatorIds.includes(operatorId)) throw new OperationsBoardEditionOwnershipError("FILTER_MISMATCH");
    if (!latest.has(row.parentAsin) || row.yearMonth > latest.get(row.parentAsin)!) latest.set(row.parentAsin, row.yearMonth);
  }
  if (complete && (parents.size !== latest.size || value.parents.some(parent => !latest.has(parent.parentAsin)
    || parent.basis === "confirmed_source_mapping" && parent.sourceMonth !== latest.get(parent.parentAsin)))) throw new OperationsBoardEditionOwnershipError("INCOMPLETE");
  return value;
}
/** Select parents only AFTER the complete original rows are authorized, but
 * BEFORE any statistics, chart grouping, searching or paging. Never compares
 * source operator text, and never modifies financial/source rows. */
export function filterOperationsBoardEditionRowsByOperator(rows: readonly MonthlyFinancialReadRow[], ownership: OperationsBoardEditionOwnership,
  userId: number, operatorId?: number): { rows: MonthlyFinancialReadRow[]; ownership: OperationsBoardEditionOwnership } {
  const checked = validate(ownership, rows, userId, undefined, true);
  if (operatorId === undefined) return { rows: [...rows], ownership: checked };
  if (!id.safeParse(operatorId).success || !checked.operators.some(operator => operator.userId === operatorId)) throw new OperationsBoardEditionOwnershipError("OPERATOR_NOT_VISIBLE");
  const parents = new Set(checked.parents.filter(parent => parent.operatorIds.includes(operatorId)).map(parent => parent.parentAsin));
  return { rows: rows.filter(row => allocated(row) && parents.has(row.parentAsin)), ownership: { ...checked, selectedOperatorId: operatorId } };
}
/** Cross-field response validation. Complete pre-filter metadata is required
 * even when selected rows are empty; absent/hidden editions must use null. */
export function validateOperationsBoardEditionOwnershipResult(value: { ownership: OperationsBoardEditionOwnership; rows: readonly MonthlyFinancialReadRow[];
  userId: number; operatorId?: number; visibility: "full" | "scoped"; month: string }, issue: (message: string) => void) {
  try {
    validate(value.ownership, value.rows, value.userId, value.operatorId, value.operatorId === undefined);
    if (value.ownership.visibility !== value.visibility || value.ownership.parents.some(parent => parent.sourceMonth !== null && parent.sourceMonth > value.month)) throw Error();
  } catch { issue("Current owner directory does not match authorized selected rows"); }
}
