import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../repositories/dbClient";
import { canonicalTaskProductIdentity, type ProductTaskProductIdentity } from "../../../shared/productTaskRead";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { productTaskProductKey, type ProductTaskWriteProduct } from "../../../shared/productTaskWrite";

type Row = Record<string, unknown>;
export const taskWriteId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function taskWriteFail(message: string, code: "FORBIDDEN" | "PRECONDITION_FAILED" | "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message: `PRODUCT_TASK_WRITE_${message}` }); }
export function taskWriteSql(text: string, params: unknown[] = []): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) taskWriteFail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
export async function taskWriteRows(tx: DbExecutor, text: string, params: unknown[] = []): Promise<Row[]> {
  const result = await tx.execute(taskWriteSql(text, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) taskWriteFail("SOURCE_INVALID");
  return result[0];
}
function missingTable(error: unknown): boolean {
  let current = error; for (let i = 0; i < 5 && current && typeof current === "object"; i++) { const value = current as { code?: unknown; errno?: unknown; cause?: unknown }; if (value.code === "ER_NO_SUCH_TABLE" || value.errno === 1146) return true; current = value.cause; } return false;
}
const TABLES = ["team_tasks", "ops_task_attachments", "security_audit_logs", "product_profiles", "saihu_product_weekly", "operator_name_mappings", "ops_inventory_owner_assignments"] as const;
export type TaskWriteColumn = { nullable: boolean; dataType: string; columnType: string; extra: string; maxLength: number | null; defaultValue: unknown };
export async function taskWriteColumns(tx: DbExecutor, table: typeof TABLES[number]): Promise<Map<string, TaskWriteColumn> | null> {
  const rows = await taskWriteRows(tx, "SELECT COLUMN_NAME AS columnName,IS_NULLABLE AS isNullable,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  if (rows.length > 300 || new Set(rows.map(row => row.columnName)).size !== rows.length || rows.some(row => typeof row.columnName !== "string" || !["YES", "NO"].includes(String(row.isNullable)) || typeof row.dataType !== "string" || typeof row.columnType !== "string" || typeof row.extra !== "string" || row.maxLength !== null && (typeof row.maxLength !== "number" || row.maxLength < 0))) taskWriteFail("SCHEMA_INVALID");
  if (rows.length) return new Map(rows.map(row => [row.columnName as string, { nullable: row.isNullable === "YES", dataType: row.dataType as string, columnType: row.columnType as string, extra: row.extra as string, maxLength: row.maxLength as number | null, defaultValue: row.defaultValue }]));
  try { await taskWriteRows(tx, `SELECT 1 AS probe FROM ${table} LIMIT 0`); } catch (error) { if (missingTable(error)) return null; throw error; } return taskWriteFail("SCHEMA_UNVERIFIABLE");
}
export type TaskWriteMember = { id: number; displayName: string };
export async function taskWriteMembers(tx: DbExecutor, workspaceId: number, onlyIds?: number[]): Promise<TaskWriteMember[]> {
  const scope = onlyIds ? ` AND u.id IN (${onlyIds.map(() => "?").join(",")})` : "";
  if (onlyIds?.length === 0) return [];
  const rows = await taskWriteRows(tx, `SELECT m.id AS membershipId,m.workspaceId,m.userId,m.status AS membershipStatus,u.id,u.status,IF(OCTET_LENGTH(u.name)<=400,u.name,NULL) AS name FROM workspace_memberships m JOIN users u ON u.id=m.userId WHERE m.workspaceId=?${scope} ORDER BY u.id,m.id LIMIT 5001 FOR SHARE`, [workspaceId, ...(onlyIds ?? [])]);
  if (rows.length > 5000 || rows.some(row => !taskWriteId(row.membershipId) || !taskWriteId(row.id) || row.id !== row.userId || row.workspaceId !== workspaceId || onlyIds && !onlyIds.includes(row.id as number)) || new Set(rows.map(row => row.id)).size !== rows.length) taskWriteFail("MEMBERS_INVALID");
  return rows.filter(row => row.status === "active" && row.membershipStatus === "active").map(row => {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    return { id: row.id as number, displayName: name && name.length <= 100 ? name : `成员 ${row.id}` };
  });
}
export type TaskWriteCandidate = ProductTaskWriteProduct;
export type TaskWriteCandidateSource = { items: TaskWriteCandidate[]; capabilities: { profiles: "available" | "unavailable"; saihu: "available" | "unavailable"; mappings: "available" | "unavailable"; manualOwners: "available" | "unavailable" }; complete: boolean };
const LIMIT = 5000, BYTES = 8 * 1024 * 1024, ROW_BYTES = 128 * 1024;
// Daily/weekly history contains repeated observations of the same products.
// Bound historical reads separately from the final, deduplicated product list.
const HISTORY_LIMIT = 100000, HISTORY_BYTES = 64 * 1024 * 1024;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identityKey = (value: ProductTaskProductIdentity) => JSON.stringify([value.workspaceId, value.storeName, value.country, value.parentAsin]);
const nullableText = (value: unknown, max = 4000): string | null => value === null ? null : typeof value === "string" && value.length <= max ? value : taskWriteFail("CANDIDATE_INVALID");
/** Bounded two-phase reads: do not transfer unlimited source TEXT before checking budgets. */
async function sourceRows(tx: DbExecutor, table: "product_profiles" | "saihu_product_weekly", workspaceId: number, fields: Record<string, string>, strings: string[]): Promise<Row[]> {
  const sourceLimit = table === "saihu_product_weekly" ? HISTORY_LIMIT : LIMIT;
  const sourceBytes = table === "saihu_product_weekly" ? HISTORY_BYTES : BYTES;
  const size = strings.map(field => `COALESCE(OCTET_LENGTH(CAST(${field} AS CHAR CHARACTER SET utf8mb4)),0)`).join("+");
  const candidates = await taskWriteRows(tx, `SELECT id,workspaceId,${size} AS bodyBytes FROM ${table} WHERE workspaceId=? ORDER BY id LIMIT ${sourceLimit + 1} FOR SHARE`, [workspaceId]);
  if (candidates.length > sourceLimit || candidates.reduce((sum, row) => sum + Number(row.bodyBytes), 0) > sourceBytes) taskWriteFail("CANDIDATES_INCOMPLETE");
  if (new Set(candidates.map(row => row.id)).size !== candidates.length || candidates.some(row => !taskWriteId(row.id) || row.workspaceId !== workspaceId || typeof row.bodyBytes !== "number" || !Number.isSafeInteger(row.bodyBytes) || row.bodyBytes < 0 || row.bodyBytes > ROW_BYTES)) taskWriteFail("CANDIDATES_INVALID");
  const result: Row[] = [];
  for (let offset = 0; offset < candidates.length; offset += 200) {
    const group = candidates.slice(offset, offset + 200), rows = await taskWriteRows(tx, `SELECT id,workspaceId,${Object.entries(fields).map(([alias, field]) => `${field} AS ${alias}`).join(",")},${size} AS bodyBytes FROM ${table} WHERE workspaceId=? AND id IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 201 FOR SHARE`, [workspaceId, ...group.map(row => row.id)]);
    if (rows.length !== group.length || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => row.workspaceId !== workspaceId || !group.some(candidate => candidate.id === row.id && candidate.bodyBytes === row.bodyBytes))) taskWriteFail("CANDIDATES_CHANGED");
    result.push(...rows);
  }
  return result;
}
/** Latest product identities only; no financial fields, sync or model invocation. */
export async function loadTaskWriteCandidates(tx: DbExecutor, workspaceId: number, assigneeId: number): Promise<TaskWriteCandidateSource> {
  const activeMemberIds = new Set((await taskWriteMembers(tx, workspaceId)).map(member => member.id));
  if (!activeMemberIds.has(assigneeId)) taskWriteFail("ASSIGNEE_UNAVAILABLE", "BAD_REQUEST");
  const [profileColumns, saihuColumns, mappingColumns, ownerColumns] = await Promise.all([taskWriteColumns(tx, "product_profiles"), taskWriteColumns(tx, "saihu_product_weekly"), taskWriteColumns(tx, "operator_name_mappings"), taskWriteColumns(tx, "ops_inventory_owner_assignments")]);
  const has = (columns: Map<string, unknown> | null, names: string[]) => !!columns && names.every(name => columns.has(name));
  const profileFields = { userId: "user_id", parentAsin: "parent_asin", storeName: "store_name", site: "marketplace", title: "title", chineseName: "chinese_name", imageUrl: "image_url", operator: "operator", updatedAt: "DATE_FORMAT(updatedAt,'%Y-%m-%d %H:%i:%s.%f')" };
  const dailyMode = has(saihuColumns, ["report_date", "report_level"]);
  const saihuFields = { importId: "import_id", reportDate: dailyMode ? "report_date" : "NULL", reportLevel: dailyMode ? "report_level" : "NULL", weekStartDate: "week_start_date", weekEndDate: "week_end_date", asin: "asin", parentAsin: "parent_asin", storeName: "store_name", site: "site", title: "title", chineseName: "product_name", imageUrl: "image_url", operator: "operator" };
  const capabilities: TaskWriteCandidateSource["capabilities"] = { profiles: has(profileColumns, ["id", "workspaceId", "updatedAt", ...Object.values(profileFields).filter(value => !value.includes("("))]) ? "available" : "unavailable", saihu: has(saihuColumns, ["id", "workspaceId", ...Object.values(saihuFields).filter(value => value !== "NULL")]) ? "available" : "unavailable", mappings: has(mappingColumns, ["id", "workspaceId", "external_name", "source_type", "system_user_id", "is_confirmed"]) ? "available" : "unavailable", manualOwners: has(ownerColumns, ["id", "workspaceId", "parent_asin", "store_name", "country", "assignee_user_id", "is_active"]) ? "available" : "unavailable" };
  const profiles = capabilities.profiles === "available" ? await sourceRows(tx, "product_profiles", workspaceId, profileFields, ["parent_asin", "store_name", "marketplace", "title", "chinese_name", "image_url", "operator"]) : [];
  const daily = capabilities.saihu === "available" ? await sourceRows(tx, "saihu_product_weekly", workspaceId, saihuFields, Object.values(saihuFields).filter(value => value !== "import_id" && value !== "NULL")) : [];
  const dateValid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number(value.slice(0, 4)) >= 1000 && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  for (const row of daily) if (!taskWriteId(row.importId) || row.reportDate !== null && !dateValid(row.reportDate) || ![null, "asin", "parent"].includes(row.reportLevel as null | string) || !dateValid(row.weekStartDate) || !dateValid(row.weekEndDate) || row.weekStartDate > row.weekEndDate) taskWriteFail("SAIHU_INVALID");
  for (const row of profiles) if (typeof row.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u.test(row.updatedAt) || !dateValid(row.updatedAt.slice(0, 10))) taskWriteFail("PROFILES_INVALID");
  const owners = capabilities.manualOwners === "available" ? await taskWriteRows(tx, "SELECT id,workspaceId,IF(OCTET_LENGTH(parent_asin)<=2000,parent_asin,NULL) AS parentAsin,IF(OCTET_LENGTH(store_name)<=800,store_name,NULL) AS storeName,IF(OCTET_LENGTH(country)<=800,country,NULL) AS country,assignee_user_id AS assigneeId,is_active AS active FROM ops_inventory_owner_assignments WHERE workspaceId=? AND is_active=1 ORDER BY id LIMIT 5001 FOR SHARE", [workspaceId]) : [];
  const mappings = capabilities.mappings === "available" ? await taskWriteRows(tx, "SELECT id,workspaceId,IF(OCTET_LENGTH(external_name)<=800,external_name,NULL) AS externalName,IF(OCTET_LENGTH(source_type)<=40,source_type,NULL) AS sourceType,system_user_id AS userId,is_confirmed AS confirmed FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 ORDER BY id LIMIT 5001 FOR SHARE", [workspaceId]) : [];
  if (owners.length > LIMIT || mappings.length > LIMIT || Buffer.byteLength(JSON.stringify([owners, mappings, profiles]), "utf8") > BYTES || Buffer.byteLength(JSON.stringify(daily), "utf8") > HISTORY_BYTES) taskWriteFail("CANDIDATES_INCOMPLETE");
  const manual = new Map<string, number>();
  for (const row of owners) {
    const identity = canonicalTaskProductIdentity({ workspaceId: row.workspaceId, storeName: row.storeName, country: row.country, parentAsin: row.parentAsin });
    if (!taskWriteId(row.id) || !identity || row.workspaceId !== workspaceId || !taskWriteId(row.assigneeId) || row.active !== 1 || manual.has(identityKey(identity))) taskWriteFail("OWNERS_INVALID");
    manual.set(identityKey(identity), row.assigneeId);
  }
  for (const row of mappings) if (!taskWriteId(row.id) || row.workspaceId !== workspaceId || row.confirmed !== 1 || !taskWriteId(row.userId) || typeof row.externalName !== "string" || !row.externalName.trim() || row.externalName.length > 200 || !["saihu", "lingxing", "all"].includes(String(row.sourceType))) taskWriteFail("MAPPINGS_INVALID");
  let ownershipComplete = true;
  const owns = (row: Row, source: "profile" | "saihu", identity: ProductTaskProductIdentity) => {
    const override = manual.get(identityKey(identity)); if (override !== undefined) { if (!activeMemberIds.has(override)) { ownershipComplete = false; return false; } return override === assigneeId; }
    // Without the manual-rule source an unknown override must not be bypassed.
    if (capabilities.manualOwners !== "available") return false;
    if (source === "profile" && row.userId === assigneeId) return true;
    const names = splitExternalOperatorNames(typeof row.operator === "string" ? row.operator : null);
    if (!names.length || capabilities.mappings !== "available") { if (!(source === "profile" && taskWriteId(row.userId) && activeMemberIds.has(row.userId))) ownershipComplete = false; return false; }
    const resolved = names.map(name => [...new Set(mappings.filter(mapping => mapping.externalName === name && (mapping.sourceType === "all" || source === "saihu" && mapping.sourceType === "saihu")).map(mapping => mapping.userId as number))]);
    if (!resolved.every(ids => ids.length === 1 && activeMemberIds.has(ids[0]))) { ownershipComplete = false; return false; }
    return resolved.some(ids => ids[0] === assigneeId);
  };
  const newer = (left: Row, right: Row) => Number(left.importId ?? 0) - Number(right.importId ?? 0) || String(left.reportDate || left.weekEndDate || left.updatedAt || "").localeCompare(String(right.reportDate || right.weekEndDate || right.updatedAt || "")) || Number(left.id) - Number(right.id);
  // Current child relationships are selected before grouping owners; no old
  // parent assignment can authorize a newly re-parented source child.
  const childLatest = new Map<string, Row>();
  const childKey = (row: Row) => JSON.stringify([workspaceId, typeof row.asin === "string" ? row.asin.trim().toUpperCase() : row.asin, row.storeName, normalizeMarketplaceCode(String(row.site ?? ""))]);
  const parentKey = (row: Row) => JSON.stringify([workspaceId, typeof (row.parentAsin || row.asin) === "string" ? String(row.parentAsin || row.asin).trim().toUpperCase() : null, row.storeName, normalizeMarketplaceCode(String(row.site ?? ""))]);
  for (const row of daily) {
    if (row.reportLevel === "parent" || typeof row.asin !== "string" || !row.asin || row.asin.includes(",")) continue;
    const key = childKey(row);
    const old = childLatest.get(key); if (!old || newer(row, old) > 0) childLatest.set(key, row);
  }
  const currentParent = (row: Row): Row => { const current = row.reportLevel === "parent" ? undefined : childLatest.get(childKey(row)); return current ? { ...row, parentAsin: current.parentAsin || current.asin } : row; };
  // Equivalent ownership-only selection to the friend's selectSaihuFacts:
  // deduplicate business days, suppress children covered by original parent
  // totals BEFORE re-parenting, then exclude overlapping legacy weekly facts.
  // No financial values or scheduler routines participate in this selection.
  const selectedDays = new Map<string, Row>(), weekly: Row[] = [];
  for (const row of daily) {
    if (row.reportDate === null) { weekly.push(row); continue; }
    const key = JSON.stringify([row.reportLevel === "parent" ? parentKey(row) : childKey(row), row.reportDate, row.reportLevel === "parent" ? "parent" : "asin"]);
    const previous = selectedDays.get(key); if (!previous || newer(row, previous) > 0) selectedDays.set(key, row);
  }
  const parentDays = new Set([...selectedDays.values()].filter(row => row.reportLevel === "parent").map(row => JSON.stringify([parentKey(row), row.reportDate])));
  const facts = [...selectedDays.values()].filter(row => row.reportLevel === "parent" || !parentDays.has(JSON.stringify([parentKey(row), row.reportDate]))).map(currentParent);
  const covered = new Map<string, { start: string; end: string }[]>();
  for (const row of facts) {
    const date = new Date(`${row.reportDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 1) % 7);
    const start = date.toISOString().slice(0, 10); date.setUTCDate(date.getUTCDate() + 6); const end = date.toISOString().slice(0, 10), key = parentKey(row), ranges = covered.get(key) ?? [];
    if (!ranges.some(range => range.start === start)) ranges.push({ start, end }); covered.set(key, ranges);
  }
  const factRows = [...facts, ...weekly.map(currentParent).filter(row => !(covered.get(parentKey(row)) ?? []).some(range => String(row.weekStartDate) <= range.end && String(row.weekEndDate) >= range.start))];
  let completeIdentities = true;
  const latest = new Map<string, { row: Row; source: "profile" | "saihu"; identity: ProductTaskProductIdentity }>();
  for (const source of ["profile", "saihu"] as const) for (const row of source === "profile" ? profiles : factRows) {
    const parentAsin = row.parentAsin || (typeof row.asin === "string" && !row.asin.includes(",") ? row.asin : null);
    const identity = canonicalTaskProductIdentity({ workspaceId, parentAsin: typeof parentAsin === "string" ? parentAsin.trim() : parentAsin, storeName: row.storeName, country: row.site });
    if (!identity) { completeIdentities = false; continue; }
    const key = `${source}:${identityKey(identity)}`, old = latest.get(key); if (!old || newer(row, old.row) > 0) latest.set(key, { row, source, identity });
  }
  const items = new Map<string, TaskWriteCandidate>();
  for (const { row, source, identity } of latest.values()) {
    if (!owns(row, source, identity)) continue;
    const key = identityKey(identity); if (items.has(key)) continue;
    const candidate = { identity, profileId: source === "profile" ? row.id as number : null, source, sourceId: row.id as number, sourceMode: source === "profile" ? "profile" as const : row.reportDate !== null && ["asin", "parent"].includes(String(row.reportLevel)) ? "daily" as const : "legacy_weekly" as const, title: nullableText(row.title) || nullableText(row.chineseName) || identity.parentAsin, chineseName: nullableText(row.chineseName), imageUrl: nullableText(row.imageUrl) };
    const versioned = { ...candidate, versionKey: digest({ candidate, assigneeId, row, manual: manual.get(key) ?? null, mappings: mappings.filter(mapping => splitExternalOperatorNames(String(row.operator ?? "")).includes(String(mapping.externalName))) }) };
    items.set(key, { ...versioned, key: productTaskProductKey(versioned) });
  }
  if (items.size > LIMIT) taskWriteFail("CANDIDATES_INCOMPLETE");
  return { items: [...items.values()].sort((a, b) => identityKey(a.identity).localeCompare(identityKey(b.identity))), capabilities, complete: ownershipComplete && completeIdentities && dailyMode && daily.every(row => row.reportDate !== null && row.reportLevel !== null) && Object.values(capabilities).every(value => value === "available") };
}
