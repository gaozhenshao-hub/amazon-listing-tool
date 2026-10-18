import { z } from "zod";
import { monthlyFinancialJsonBytes, type MonthlyFinancialReadRow } from "./monthlyFinancialRead";

/** Current, server-resolved filtering metadata. It is never an authorization
 * grant, an archived owner snapshot, or evidence of a partner relationship. */
export const OPERATIONS_BOARD_OWNERSHIP_LIMITS = { operators: 5000, parents: 60000, rows: 60000, bytes: 8 * 1024 * 1024, jsonNodes: 1_000_000 } as const;
const id = z.number().int().positive().safe().max(2147483647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
const month = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u);
const operatorSchema = z.object({ userId: id, displayName: text(200) }).strict();
const parentSchema = z.object({
  parentAsin: text(500), operatorIds: z.array(id).max(OPERATIONS_BOARD_OWNERSHIP_LIMITS.operators),
  status: z.enum(["resolved", "unresolved", "conflict"]), basis: z.enum(["manual", "confirmed_source_mapping", "none"]),
  sourceMonth: month.nullable(), reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u).nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.operatorIds).size !== value.operatorIds.length) ctx.addIssue({ code: "custom", message: "Duplicate owner IDs" });
  if (value.status === "resolved" ? !value.operatorIds.length || value.reasonCode !== null || value.basis === "none" : value.operatorIds.length > 0 || value.reasonCode === null) ctx.addIssue({ code: "custom", message: "Owner status mismatch" });
  if (value.basis === "confirmed_source_mapping" ? value.sourceMonth === null : value.sourceMonth !== null) ctx.addIssue({ code: "custom", message: "Owner source month mismatch" });
  if (value.basis === "none" && value.status !== "unresolved") ctx.addIssue({ code: "custom", message: "Unspecified owner source cannot resolve or conflict" });
});
const schema = z.object({
  version: z.literal(1), meaning: z.literal("current_manual_else_latest_visible_financial_mapping_not_archive"),
  status: z.enum(["ready", "unavailable"]), reasonCode: z.literal("registry_unavailable").nullable(),
  visibility: z.enum(["full", "scoped"]), operators: z.array(operatorSchema).max(OPERATIONS_BOARD_OWNERSHIP_LIMITS.operators),
  parents: z.array(parentSchema).max(OPERATIONS_BOARD_OWNERSHIP_LIMITS.parents),
  partners: z.object({ status: z.literal("not_configured"), reasonCode: z.literal("trusted_partner_relationship_not_configured") }).strict(),
}).strict().superRefine((value, ctx) => {
  const operators = new Set(value.operators.map(item => item.userId));
  if (operators.size !== value.operators.length || new Set(value.parents.map(item => item.parentAsin)).size !== value.parents.length) ctx.addIssue({ code: "custom", message: "Duplicate owner directory entry" });
  if (value.parents.some(parent => parent.operatorIds.some(owner => !operators.has(owner)))) ctx.addIssue({ code: "custom", message: "Owner is absent from the visible directory" });
  if (value.status === "ready" ? value.reasonCode !== null : value.reasonCode !== "registry_unavailable" || value.operators.length > 0 || value.parents.some(parent => parent.status !== "unresolved" || parent.basis !== "none" || parent.sourceMonth !== null || parent.reasonCode !== "registry_unavailable")) ctx.addIssue({ code: "custom", message: "Unavailable registry must not pretend to resolve owners" });
});
export const OperationsBoardOwnershipSchema = z.preprocess((value, ctx) => {
  try {
    if (monthlyFinancialJsonBytes(value, { jsonNodes: OPERATIONS_BOARD_OWNERSHIP_LIMITS.jsonNodes, jsonDepth: 12, stringLength: 2000 }) > OPERATIONS_BOARD_OWNERSHIP_LIMITS.bytes) throw new Error();
    return value;
  } catch { ctx.addIssue({ code: "custom", message: "Bounded plain ownership metadata required" }); return z.NEVER; }
}, schema);
export type OperationsBoardOwnership = z.infer<typeof OperationsBoardOwnershipSchema>;
export class OperationsBoardOwnershipError extends Error {
  constructor(public readonly code: string) { super("运营人筛选目录与当前授权来源无法核验；不推断搭档或扩大授权"); this.name = "OperationsBoardOwnershipError"; }
}
function fail(code: string): never { throw new OperationsBoardOwnershipError(code); }
const allocated = (row: Pick<MonthlyFinancialReadRow, "parentAsin" | "allocation">) => Boolean(row.parentAsin) && (row.allocation === "child" || row.allocation === "parent_only");
function validateViewer(ownership: OperationsBoardOwnership, userId: number) {
  if (!id.safeParse(userId).success) fail("identity_invalid");
  if (ownership.visibility === "scoped" && (ownership.operators.some(operator => operator.userId !== userId) || ownership.parents.some(parent => parent.operatorIds.some(owner => owner !== userId)))) fail("scoped_directory_disclosure");
}

/** Called with ALL already-authorized, exact-request-scope original rows,
 * before search, operator filtering, grouping, statistics or pagination. */
export function validateOperationsBoardOwnershipForRows(ownership: OperationsBoardOwnership, rows: readonly MonthlyFinancialReadRow[], userId: number): OperationsBoardOwnership {
  const checked = OperationsBoardOwnershipSchema.safeParse(ownership);
  if (!checked.success) return fail("invalid_directory");
  const value = checked.data; validateViewer(value, userId);
  if (rows.length > OPERATIONS_BOARD_OWNERSHIP_LIMITS.rows) fail("row_limit");
  const latest = new Map<string, string>();
  for (const row of rows) if (allocated(row)) {
    if (!text(500).safeParse(row.parentAsin).success || !month.safeParse(row.yearMonth).success) fail("invalid_parent_source");
    if (!latest.has(row.parentAsin) || row.yearMonth > latest.get(row.parentAsin)!) latest.set(row.parentAsin, row.yearMonth);
  }
  if (latest.size !== value.parents.length || value.parents.some(parent => !latest.has(parent.parentAsin))) fail("parent_directory_incomplete");
  if (value.parents.some(parent => parent.basis === "confirmed_source_mapping" && parent.sourceMonth !== latest.get(parent.parentAsin))) fail("latest_visible_month_mismatch");
  return value;
}

/** Filtering is a parent selection, never a per-row operator-name predicate.
 * Financial rows stay intact, including unknown values and separate bases. */
export function filterOperationsBoardRowsByOperator(rows: readonly MonthlyFinancialReadRow[], ownership: OperationsBoardOwnership | undefined, operatorId?: number): MonthlyFinancialReadRow[] {
  if (operatorId === undefined) return [...rows];
  if (!id.safeParse(operatorId).success || !ownership || ownership.status !== "ready" || !ownership.operators.some(operator => operator.userId === operatorId)) return fail("operator_not_visible");
  const parents = new Set(ownership.parents.filter(parent => parent.status === "resolved" && parent.operatorIds.includes(operatorId)).map(parent => parent.parentAsin));
  return rows.filter(row => allocated(row) && parents.has(row.parentAsin));
}

/** Only a trusted repository catching a known missing registry may use this.
 * It does not convert malformed records or failed financial authorization. */
export function buildUnavailableOperationsBoardOwnership(rows: readonly MonthlyFinancialReadRow[], visibility: OperationsBoardOwnership["visibility"]): OperationsBoardOwnership {
  if (rows.length > OPERATIONS_BOARD_OWNERSHIP_LIMITS.rows) return fail("row_limit");
  return OperationsBoardOwnershipSchema.parse({ version: 1, meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", status: "unavailable", reasonCode: "registry_unavailable", visibility, operators: [],
    parents: [...new Set(rows.filter(allocated).map(row => row.parentAsin))].sort().map(parentAsin => ({ parentAsin, operatorIds: [], status: "unresolved", basis: "none", sourceMonth: null, reasonCode: "registry_unavailable" })),
    partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" },
  });
}

/** Verifiable response checks. The page cannot prove unseen parents; the
 * builder above checks the full authorized directory before it is paginated. */
export function validateOperationsBoardOwnershipPage(value: {
  ownership?: OperationsBoardOwnership; operatorId?: number; userId: number;
  parentAsin?: string; month: string; rows: readonly MonthlyFinancialReadRow[];
  products: readonly { parentAsin: string | null }[];
}, issue: (message: string) => void) {
  const { ownership, operatorId } = value;
  if (!ownership) { if (operatorId !== undefined) issue("Selected operator requires verified ownership metadata"); return; }
  try { validateViewer(ownership, value.userId); } catch { issue("Scoped ownership directory contains another user"); }
  const parents = new Map(ownership.parents.map(parent => [parent.parentAsin, parent]));
  if (operatorId !== undefined && (ownership.status !== "ready" || !ownership.operators.some(operator => operator.userId === operatorId))) issue("Selected operator is not visible");
  if (ownership.parents.some(parent => value.parentAsin !== undefined && parent.parentAsin !== value.parentAsin || parent.sourceMonth !== null && parent.sourceMonth > value.month)) issue("Ownership directory exceeds requested scope");
  for (const product of value.products) {
    const owner = product.parentAsin === null ? undefined : parents.get(product.parentAsin);
    if (product.parentAsin !== null && !owner) issue("Visible product missing from ownership directory");
    if (operatorId !== undefined && (!owner || owner.status !== "resolved" || !owner.operatorIds.includes(operatorId))) issue("Visible product does not match selected operator");
  }
  for (const row of value.rows) {
    const owner = allocated(row) ? parents.get(row.parentAsin) : undefined;
    if (allocated(row) && !owner) issue("Visible original parent missing from ownership directory");
    if (owner?.sourceMonth !== null && owner?.sourceMonth !== undefined && owner.sourceMonth < row.yearMonth) issue("Ownership month predates visible financial evidence");
    if (operatorId !== undefined && (!owner || owner.status !== "resolved" || !owner.operatorIds.includes(operatorId))) issue("Visible original does not match selected operator");
  }
}
