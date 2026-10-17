import { z } from "zod";
import { INVENTORY_READ_LIMITS, INVENTORY_SOURCE_KEYS, INVENTORY_STOCK_KEYS, InventorySnapshotReadError, InventoryBusinessScopeSchema, InventoryStockSchema, InventoryReadRowSchema, InventoryLegacyRowSchema, InventoryCanonicalSnapshotSchema, inventoryCanonical, inventoryJsonBytes, parseInventoryJson, mapInventorySources, sumInventoryStock, type InventoryReadRow, type InventoryStock, type InventoryBusinessScope, type InventoryAux } from "./inventorySnapshotMapping";
export * from "./inventorySnapshotMapping";

const id = z.number().int().positive().safe().max(2147483647);
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type InventoryReadIdentity = z.infer<typeof identitySchema>;
export const InventorySnapshotReadInputSchema = z.object({ expectedWorkspaceId: id, search: z.string().max(200), unpaired: z.boolean(), ageThreshold: z.union([z.literal(180), z.literal(365)]), groupOffset: z.number().int().min(0).max(INVENTORY_READ_LIMITS.rows), groupLimit: z.number().int().min(1).max(50), agedGroupOffset: z.number().int().min(0).max(INVENTORY_READ_LIMITS.rows), agedGroupLimit: z.number().int().min(1).max(50), exactScope: InventoryBusinessScopeSchema.optional() }).strict();
export type InventorySnapshotReadInput = z.infer<typeof InventorySnapshotReadInputSchema>;
const provenanceSchema = z.object({ status: z.enum(["legacy_unverifiable", "replayed_v2"]), missingReasons: z.array(z.string()), sourceCoverage: z.enum(["legacy_saved_only", "provided_arrays_not_collection_attested"]) }).strict();
export type ParsedInventorySnapshot = { version: 1 | 2; currency: "CNY"; capturedAt: number; startedAt: number; rows: InventoryReadRow[]; warnings: string[]; sourceCounts: Record<string, number>; provenance: z.infer<typeof provenanceSchema>; scopeUniverse: { scopes: InventoryBusinessScope[]; complete: boolean } };
const timestamp = z.number().int().min(0).max(253402300799999).safe();
const countsSchema = z.record(z.string(), z.number().int().nonnegative().max(INVENTORY_READ_LIMITS.sourceRows));
const legacySchema = z.object({ version: z.literal(1), currency: z.literal("CNY"), capturedAt: timestamp, startedAt: timestamp, rows: z.array(InventoryLegacyRowSchema).min(1).max(INVENTORY_READ_LIMITS.rows), warnings: z.array(z.string().max(4000)).max(10000), sourceCounts: countsSchema }).strict();
function assertStockEqual(left: InventoryStock, right: InventoryStock) {
  if (left.quantity !== right.quantity || (left.value === null) !== (right.value === null) || left.value !== null && right.value !== null && Math.abs(left.value - right.value) > 0.00011) throw new InventorySnapshotReadError("stock_total_mismatch");
}
function checkedAux(rows: InventoryReadRow[]): InventoryAux[] {
  const values = new Map<string, InventoryAux>();
  for (const row of rows) for (const item of row.aux) {
    const prior = values.get(item.id); if (prior && inventoryCanonical(prior) !== inventoryCanonical(item)) throw new InventorySnapshotReadError("shared_aux_conflict"); values.set(item.id, item);
  }
  return [...values.values()];
}
function validateRows(rows: InventoryReadRow[]) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new InventorySnapshotReadError("duplicate_row_id");
  for (const row of rows) {
    assertStockEqual(row.total, sumInventoryStock([row.domestic, row.purchase, row.shipping, row.fba]));
    if (new Set(row.aux.map(item => item.id)).size !== row.aux.length || new Set(row.physicalStockIds).size !== row.physicalStockIds.length) throw new InventorySnapshotReadError("duplicate_row_stock");
  }
  checkedAux(rows);
}
/** A stored v2 receipt is not trusted: all nine original arrays and explicit
 * row-bound scope mappings are replayed, then compared to the saved result. */
export function parseInventorySnapshot(payload: unknown): ParsedInventorySnapshot {
  try {
    const raw = parseInventoryJson(payload);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InventorySnapshotReadError("snapshot_structure");
    if (raw.version === 2) {
      const saved = InventoryCanonicalSnapshotSchema.parse(raw);
      const replay = mapInventorySources({ sources: saved.mapping.sources, startedAt: saved.startedAt, capturedAt: saved.capturedAt, scopeBindings: saved.mapping.scopeBindings, options: saved.mapping.options });
      if (inventoryCanonical(saved) !== inventoryCanonical(replay)) throw new InventorySnapshotReadError("derived_snapshot_mismatch");
      validateRows(replay.rows);
      // Include zero-quantity source rows omitted from the display. Otherwise
      // a manual assignment without account identity could appear unambiguous
      // merely because the other account happened to have zero stock today.
      const sourceIdentity = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
      const warehouseTypes = new Map(replay.mapping.sources.warehouses.map(raw => [sourceIdentity(raw.id), Number(raw.type)]));
      const required = [
        ...replay.mapping.sources.fba.flatMap((raw, index) => ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8"].includes(sourceIdentity(raw.marketplaceId)) ? [`fba:${index}`] : []),
        ...replay.mapping.sources.warehouse.flatMap((raw, index) => warehouseTypes.get(sourceIdentity(raw.warehouseId)) !== 2 ? [`warehouse:${index}`] : []),
      ];
      const bindings = new Map(replay.mapping.scopeBindings.map(binding => [`${binding.ref.source}:${binding.ref.index}`, binding.scope]));
      const scopes = required.map(key => bindings.get(key));
      const scopeUniverse = { scopes: [...new Map(replay.mapping.scopeBindings.map(binding => [inventoryCanonical(binding.scope), binding.scope])).values()], complete: required.length > 0 && scopes.every(Boolean) };
      return { version: 2, currency: "CNY", startedAt: replay.startedAt, capturedAt: replay.capturedAt, rows: replay.rows, warnings: replay.warnings, sourceCounts: replay.sourceCounts, provenance: { status: "replayed_v2", sourceCoverage: "provided_arrays_not_collection_attested", missingReasons: ["只验证已提供原数组及明确字段映射；尚无实采全账号、全分页完成证明。"] }, scopeUniverse };
    }
    const saved = legacySchema.parse(raw);
    if (saved.capturedAt < saved.startedAt || INVENTORY_SOURCE_KEYS.some(key => !Object.hasOwn(saved.sourceCounts, key))) throw new InventorySnapshotReadError("legacy_source_metadata");
    const rows: InventoryReadRow[] = saved.rows.map(row => ({ ...row, allocationEvidence: null, age: row.age ?? { days181To270: null, days271To365: null, days365Plus: null, dates: [] }, ageStatus: row.age && [row.age.days181To270, row.age.days271To365, row.age.days365Plus].every(value => value !== null) ? "observed" : "unknown", scopeStatus: "unknown", scopes: [], sourceRefs: [], physicalStockIds: [`legacy-row:${row.id}`, ...row.aux.map(item => `legacy-aux:${item.id}`)], fbaComponents: [], sourceSystem: "unknown", ownerEvidence: { status: "unknown", names: [], sourceRefs: [] } }));
    validateRows(rows);
    return { ...saved, rows, provenance: { status: "legacy_unverifiable", sourceCoverage: "legacy_saved_only", missingReasons: ["旧版 v1 未保存店铺/账号/完整站点来源，不能套用当前筛选范围补造。", "旧版 v1 未保存完整 FBA 分项及全部副本，无法回放去重校验。", "旧 ownerIds/operator 只是源注释，不代表当前读取权限。"] }, scopeUniverse: { scopes: [], complete: false } };
  } catch (error) { if (error instanceof InventorySnapshotReadError) throw error; throw new InventorySnapshotReadError("invalid_snapshot"); }
}
export function inventoryAgeQuantity(row: InventoryReadRow, threshold: 180 | 365 = 180): number | null {
  const values = threshold === 365 ? [row.age.days365Plus] : [row.age.days181To270, row.age.days271To365, row.age.days365Plus];
  if (values.some(value => value === null)) return null;
  const result = values.reduce<number>((sum, value) => sum + value!, 0); if (!Number.isFinite(result)) throw new InventorySnapshotReadError("age_overflow"); return result;
}
export const InventoryTotalsSchema = z.object({ domestic: InventoryStockSchema, purchase: InventoryStockSchema, shipping: InventoryStockSchema, fba: InventoryStockSchema, total: InventoryStockSchema, aux: InventoryStockSchema, plan: z.number().finite().nonnegative(), inboundWorking: z.number().finite().nonnegative().nullable() }).strict();
export type InventoryTotals = z.infer<typeof InventoryTotalsSchema>;
export function inventorySnapshotTotals(rows: InventoryReadRow[]): InventoryTotals {
  const stocks = Object.fromEntries(INVENTORY_STOCK_KEYS.map(key => [key, sumInventoryStock(rows.map(row => row[key]))])) as Record<typeof INVENTORY_STOCK_KEYS[number], InventoryStock>;
  const components = new Map(rows.flatMap(row => row.fbaComponents).map(value => [value.physicalStockId, value]));
  const inboundWorking = rows.some(row => row.sourceSystem === "unknown") || [...components.values()].some(value => value.inboundWorking === null) ? null : [...components.values()].reduce((sum, value) => sum + value.inboundWorking!, 0);
  return InventoryTotalsSchema.parse({ ...stocks, aux: sumInventoryStock(checkedAux(rows).map(item => item.stock)), plan: rows.reduce((sum, row) => sum + row.plan, 0), inboundWorking });
}
export const InventoryGroupSchema = z.object({ id: z.string(), parentAsin: z.string(), name: z.string(), operator: z.string(), rows: z.array(InventoryReadRowSchema).min(1).max(INVENTORY_READ_LIMITS.rows), aged: z.number().finite().nonnegative().nullable(), totals: InventoryTotalsSchema, scopes: z.array(InventoryBusinessScopeSchema), scopeStatus: z.enum(["verified", "unknown"]) }).strict();
export type InventoryGroup = z.infer<typeof InventoryGroupSchema>;
export function inventorySnapshotGroups(rows: InventoryReadRow[], threshold: 180 | 365): InventoryGroup[] {
  const groups = new Map<string, InventoryReadRow[]>();
  for (const row of rows) {
    // v1 / unknown scopes must not create a deceptively verified cross-shop
    // parent aggregate. Multi-scope pools remain distinct physical groups.
    const key = row.scopeStatus === "verified" && row.scopes.length === 1 && row.parentAsin ? inventoryCanonical({ scope: row.scopes[0], parentAsin: row.parentAsin }) : `source-row:${row.id}`;
    const values = groups.get(key) ?? []; values.push(row); groups.set(key, values);
  }
  return [...groups].map(([key, values]) => {
    const ages = values.map(row => inventoryAgeQuantity(row, threshold)), first = values[0];
    return { id: key, parentAsin: first.parentAsin, name: first.parentName || first.name, operator: [...new Set(values.map(row => row.operator).filter(Boolean))].join(" / "), rows: [...values].sort((a, b) => a.asin.localeCompare(b.asin) || a.msku.localeCompare(b.msku) || a.id.localeCompare(b.id)), aged: ages.some(value => value === null) ? null : ages.reduce<number>((sum, value) => sum + value!, 0), totals: inventorySnapshotTotals(values), scopes: [...new Map(values.flatMap(row => row.scopes).map(scope => [inventoryCanonical(scope), scope])).values()], scopeStatus: values.every(row => row.scopeStatus === "verified") ? "verified" as const : "unknown" as const };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export function planInventoryScopeAccess(parsed: ParsedInventorySnapshot, exactScope: InventoryBusinessScope): { rowIds: string[]; requiredRows: InventoryReadRow[]; scopeVerifiable: boolean; reasonCode: string | null } {
  const scope = InventoryBusinessScopeSchema.parse(exactScope), key = inventoryCanonical(scope);
  if (parsed.version !== 2) return { rowIds: [], requiredRows: [], scopeVerifiable: false, reasonCode: "legacy_scope_unverifiable" };
  const selected = parsed.rows.filter(row => row.scopes.some(value => inventoryCanonical(value) === key));
  const rowIds = selected.map(row => row.id), requiredRows = [...selected], visitedRows = new Set(rowIds), visitedPhysical = new Set<string>(), adjacency = new Map<string, InventoryReadRow[]>();
  for (const row of parsed.rows) for (const physical of row.physicalStockIds) { const values = adjacency.get(physical) ?? []; values.push(row); adjacency.set(physical, values); }
  for (let cursor = 0; cursor < requiredRows.length; cursor++) for (const physical of requiredRows[cursor].physicalStockIds) {
    if (visitedPhysical.has(physical)) continue; visitedPhysical.add(physical);
    for (const row of adjacency.get(physical) ?? []) if (!visitedRows.has(row.id)) { visitedRows.add(row.id); requiredRows.push(row); }
  }
  if (!selected.length || requiredRows.some(row => row.scopeStatus !== "verified" || !row.scopes.length)) return { rowIds: [], requiredRows: [], scopeVerifiable: false, reasonCode: !selected.length ? "exact_scope_not_proven" : "shared_scope_unverifiable" };
  return { rowIds, requiredRows, scopeVerifiable: true, reasonCode: null };
}
const pageSchema = z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50), totalGroups: z.number().int().nonnegative(), totalRows: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable(), hasMore: z.boolean() }).strict();
const metadataSchema = z.object({ id, runId: id, capturedAt: timestamp, startedAt: timestamp, version: z.union([z.literal(1), z.literal(2)]), currency: z.literal("CNY"), visibility: z.enum(["full", "scoped"]), provenance: provenanceSchema, sourceCounts: countsSchema.nullable(), warnings: z.array(z.string()) }).strict();
const resultSchema = z.object({ identity: identitySchema, request: InventorySnapshotReadInputSchema, status: z.enum(["ready", "missing", "not_found", "invalid", "scope_unverifiable"]), reasonCode: z.string().nullable(), missingReason: z.string().nullable(), snapshot: metadataSchema.nullable(), totals: InventoryTotalsSchema.nullable(), groups: z.array(InventoryGroupSchema).max(50), page: pageSchema, agedTotals: InventoryTotalsSchema.nullable(), unknownAgeTotals: InventoryTotalsSchema.nullable(), agedGroups: z.array(InventoryGroupSchema).max(50), unknownAgeGroups: z.array(InventoryGroupSchema).max(50), agedPage: pageSchema.extend({ knownGroupCount: z.number().int().nonnegative(), unknownGroupCount: z.number().int().nonnegative() }).strict() }).strict();
export const InventorySnapshotReadResultSchema = resultSchema.superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue("Identity mismatch");
  if (value.status === "ready") {
    if (!value.snapshot || !value.totals || !value.agedTotals || !value.unknownAgeTotals || value.reasonCode !== null || value.missingReason !== null) issue("Ready result missing data");
    if (value.snapshot?.visibility === "scoped" && (value.snapshot.version !== 2 || value.snapshot.sourceCounts !== null || !value.request.exactScope)) issue("Scoped metadata disclosure");
  } else if (value.snapshot || value.totals || value.agedTotals || value.unknownAgeTotals || value.groups.length || value.agedGroups.length || value.unknownAgeGroups.length || !value.reasonCode || !value.missingReason || value.page.totalGroups || value.agedPage.totalGroups) issue("Failure cannot contain partial data");
  for (const [page, groups, offset, limit] of [[value.page, value.groups, value.request.groupOffset, value.request.groupLimit], [value.agedPage, [...value.agedGroups, ...value.unknownAgeGroups], value.request.agedGroupOffset, value.request.agedGroupLimit]] as const) {
    if (page.offset !== offset || page.limit !== limit || groups.length !== Math.min(limit, Math.max(0, page.totalGroups - offset)) || page.hasMore !== (offset + groups.length < page.totalGroups) || page.nextOffset !== (page.hasMore ? offset + groups.length : null)) issue("Page continuity mismatch");
  }
  if (value.agedPage.totalGroups !== value.agedPage.knownGroupCount + value.agedPage.unknownGroupCount || value.agedGroups.some(group => group.aged === null || group.aged <= 0) || value.unknownAgeGroups.some(group => group.aged !== null)) issue("Age group classification mismatch");
  for (const groups of [value.groups, [...value.agedGroups, ...value.unknownAgeGroups]]) {
    const displayedRows = new Set<string>();
    for (const group of groups) {
      for (const row of group.rows) {
        if (displayedRows.has(row.id)) issue("Duplicate displayed source row"); displayedRows.add(row.id);
        if (value.snapshot?.visibility === "scoped" && (row.scopeStatus !== "verified" || !row.scopes.some(scope => inventoryCanonical(scope) === inventoryCanonical(value.request.exactScope)))) issue("Unrequested scoped source row");
      }
      try {
        validateRows(group.rows);
        const expected = inventorySnapshotGroups(group.rows, value.request.ageThreshold);
        if (expected.length !== 1 || inventoryCanonical(expected[0]) !== inventoryCanonical(group)) issue("Group identity, total, scope or age mismatch");
      } catch { issue("Invalid group source facts"); }
    }
  }
  try {
    if (value.status === "ready" && value.page.offset === 0 && !value.page.hasMore && inventoryCanonical(inventorySnapshotTotals(value.groups.flatMap(group => group.rows))) !== inventoryCanonical(value.totals)) issue("Complete filtered total mismatch");
    if (value.status === "ready" && value.agedGroups.length === value.agedPage.knownGroupCount && inventoryCanonical(inventorySnapshotTotals(value.agedGroups.flatMap(group => group.rows))) !== inventoryCanonical(value.agedTotals)) issue("Complete aged total mismatch");
    if (value.status === "ready" && value.unknownAgeGroups.length === value.agedPage.unknownGroupCount && inventoryCanonical(inventorySnapshotTotals(value.unknownAgeGroups.flatMap(group => group.rows))) !== inventoryCanonical(value.unknownAgeTotals)) issue("Complete unknown-age total mismatch");
  } catch { issue("Invalid filtered totals"); }
  try { if (inventoryJsonBytes(value) > INVENTORY_READ_LIMITS.resultBytes) throw new Error(); } catch { issue("Result exceeds bounded JSON limits"); }
});
export type InventorySnapshotReadResult = z.infer<typeof InventorySnapshotReadResultSchema>;
export type InventorySnapshotRecord = { id: number; workspaceId: number; runId: number; capturedAt: number | string; payload: unknown };
function checkedResult(value: unknown): InventorySnapshotReadResult {
  try { if (inventoryJsonBytes(value) > INVENTORY_READ_LIMITS.resultBytes) throw new Error(); return InventorySnapshotReadResultSchema.parse(value); }
  catch (error) { if (error instanceof InventorySnapshotReadError) throw error; throw new InventorySnapshotReadError("invalid_read_result"); }
}
function page<T extends { rows: InventoryReadRow[] }>(values: T[], offset: number, limit: number) {
  const groups = values.slice(offset, offset + limit), hasMore = offset + groups.length < values.length;
  return { groups, page: { offset, limit, totalGroups: values.length, totalRows: values.reduce((sum, group) => sum + group.rows.length, 0), nextOffset: hasMore ? offset + groups.length : null, hasMore } };
}
export function buildInventorySnapshotReadFailure(value: { identity: InventoryReadIdentity; input: InventorySnapshotReadInput; status: "missing" | "not_found" | "invalid" | "scope_unverifiable"; reasonCode: string; missingReason: string }): InventorySnapshotReadResult {
  const input = InventorySnapshotReadInputSchema.parse(value.input), identity = identitySchema.parse(value.identity);
  return checkedResult({ identity, request: input, status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, snapshot: null, totals: null, groups: [], page: page([], input.groupOffset, input.groupLimit).page, agedTotals: null, unknownAgeTotals: null, agedGroups: [], unknownAgeGroups: [], agedPage: { ...page([], input.agedGroupOffset, input.agedGroupLimit).page, knownGroupCount: 0, unknownGroupCount: 0 } });
}
export function buildInventorySnapshotReadResult(value: { identity: InventoryReadIdentity; input: InventorySnapshotReadInput; record: InventorySnapshotRecord | null; visibility?: "full" | "scoped"; scopedRows?: string[]; tableMissing?: boolean }): InventorySnapshotReadResult {
  const input = InventorySnapshotReadInputSchema.parse(value.input), identity = identitySchema.parse(value.identity);
  if (identity.workspaceId !== input.expectedWorkspaceId) throw new InventorySnapshotReadError("identity_mismatch");
  if (value.tableMissing || value.record === null) return buildInventorySnapshotReadFailure({ identity, input, status: value.tableMissing ? "missing" : "not_found", reasonCode: value.tableMissing ? "table_missing" : "snapshot_not_found", missingReason: value.tableMissing ? "保存库存快照表尚未接通，不表示库存为零" : "尚无保存库存快照；不会在线刷新或调用模型" });
  const record = value.record, parsed = parseInventorySnapshot(record.payload), visibility = value.visibility ?? "full";
  if (!id.safeParse(record.id).success || !id.safeParse(record.runId).success || record.workspaceId !== identity.workspaceId || typeof record.capturedAt === "string" && !/^(?:0|[1-9]\d*)$/u.test(record.capturedAt) || !timestamp.safeParse(Number(record.capturedAt)).success || Number(record.capturedAt) !== parsed.capturedAt) throw new InventorySnapshotReadError("record_identity_or_capture");
  let rows = parsed.rows;
  if (input.exactScope || visibility === "scoped") {
    if (!input.exactScope) throw new InventorySnapshotReadError("exact_scope_required");
    const plan = planInventoryScopeAccess(parsed, input.exactScope);
    if (!plan.scopeVerifiable) return buildInventorySnapshotReadFailure({ identity, input, status: "scope_unverifiable", reasonCode: plan.reasonCode!, missingReason: "保存来源无法证明此完整账号/店铺/站点/父体范围；未使用旧负责人或筛选值补造" });
    if (visibility === "scoped" && (!value.scopedRows || new Set(value.scopedRows).size !== value.scopedRows.length || inventoryCanonical([...value.scopedRows].sort()) !== inventoryCanonical([...plan.rowIds].sort()))) throw new InventorySnapshotReadError("authorized_row_set_mismatch");
    const allowedRows = new Set(plan.rowIds); rows = parsed.rows.filter(row => allowedRows.has(row.id));
  } else if (value.scopedRows) throw new InventorySnapshotReadError("unexpected_authorized_rows");
  const search = input.search.trim().toLocaleLowerCase();
  rows = rows.filter(row => !input.unpaired || row.unpaired);
  const groups = inventorySnapshotGroups(rows, input.ageThreshold).filter(group => !search || group.rows.some(row => [row.parentAsin, row.parentName, row.asin, row.msku, row.localSku, row.name, row.operator].some(text => text.toLocaleLowerCase().includes(search))));
  rows = groups.flatMap(group => group.rows);
  const known = groups.filter(group => group.aged !== null && group.aged > 0).sort((a, b) => b.aged! - a.aged! || a.id.localeCompare(b.id)), unknown = groups.filter(group => group.aged === null), regularPage = page(groups, input.groupOffset, input.groupLimit), agePage = page([...known, ...unknown], input.agedGroupOffset, input.agedGroupLimit);
  return checkedResult({ identity, request: input, status: "ready", reasonCode: null, missingReason: null, snapshot: { id: record.id, runId: record.runId, capturedAt: parsed.capturedAt, startedAt: parsed.startedAt, version: parsed.version, currency: "CNY", visibility, provenance: parsed.provenance, sourceCounts: visibility === "full" ? parsed.sourceCounts : null, warnings: visibility === "full" ? parsed.warnings : [...new Set(rows.flatMap(row => row.notes))] }, totals: inventorySnapshotTotals(rows), groups: regularPage.groups, page: regularPage.page, agedTotals: inventorySnapshotTotals(known.flatMap(group => group.rows)), unknownAgeTotals: inventorySnapshotTotals(unknown.flatMap(group => group.rows)), agedGroups: agePage.groups.filter(group => group.aged !== null), unknownAgeGroups: agePage.groups.filter(group => group.aged === null), agedPage: { ...agePage.page, knownGroupCount: known.length, unknownGroupCount: unknown.length } });
}
