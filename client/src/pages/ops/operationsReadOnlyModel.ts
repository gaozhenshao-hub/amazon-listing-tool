/** Projections of existing read APIs only; no planning, valuation, permission or write logic. */
export type InventoryReadRecord = {
  asin?: unknown;
  parentAsin?: unknown;
  storeName?: unknown;
  country?: unknown;
  sku?: unknown;
  productName?: unknown;
  operator?: unknown;
  operatorSource?: unknown;
  totalInventory?: unknown;
  localInventory?: unknown;
  localInventoryConfirmedAt?: unknown;
  currency?: unknown;
  productCost?: unknown;
  estimatedFirstLegCost?: unknown;
  actualFirstLegCost?: unknown;
  estimatedFbaFee?: unknown;
  actualFbaFee?: unknown;
  sellingPrice?: unknown;
};
export type FinancialReadRecord = {
  id?: unknown;
  parentAsin?: unknown;
  storeName?: unknown;
  country?: unknown;
  yearMonth?: unknown;
  financialProfit?: unknown;
};
export type ReadScope = {
  parentAsin: string;
  storeName: string;
  country: string;
};
export type InventoryReadRow = ReadScope & {
  key: string;
  asin: string;
  sku: string;
  productName: string;
  operator: string;
  operatorSource: string;
  currency: string;
  totalInventory: number | null;
  localInventory: number | null;
  localConfirmed: boolean;
  productCost: number | null;
  estimatedFirstLegCost: number | null;
  actualFirstLegCost: number | null;
  estimatedFbaFee: number | null;
  actualFbaFee: number | null;
  sellingPrice: number | null;
  issues: string[];
};
export type InventoryReadGroup = ReadScope & {
  key: string;
  rows: InventoryReadRow[];
  completeScope: boolean;
  totalInventory: number | null;
};
export type FinancialReadRow = ReadScope & {
  key: string;
  recordId: string;
  yearMonth: string;
  financialProfit: number | null;
  scopeKind: "scoped" | "legacy" | "incomplete";
  issues: string[];
};
export type FinancialReadGroup = ReadScope & {
  key: string;
  scopeKind: FinancialReadRow["scopeKind"];
  rows: FinancialReadRow[];
};
export type OperationsReadResult<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: readonly T[] };

export const readText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
export function readAmount(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : null;
  const text = readText(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}
const scopeOf = (
  row: InventoryReadRecord | FinancialReadRecord
): ReadScope => ({
  parentAsin: readText(row.parentAsin).toUpperCase(),
  // Keep store labels exact; do not guess store aliases or collapse sites.
  storeName: readText(row.storeName),
  country: readText(row.country).toUpperCase(),
});
const scopeComplete = (scope: ReadScope) =>
  Boolean(scope.parentAsin && scope.storeName && scope.country);
const scopeKey = (scope: ReadScope) =>
  JSON.stringify([scope.parentAsin, scope.storeName, scope.country]);
const quantity = (value: unknown) => {
  const parsed = readAmount(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};

export function inventoryReadGroups(
  records: readonly InventoryReadRecord[]
): InventoryReadGroup[] {
  const identityCounts = new Map<string, number>();
  const rows = records.map((source, index): InventoryReadRow => {
    const scope = scopeOf(source),
      asin = readText(source.asin).toUpperCase();
    const identity = JSON.stringify([asin, scope.storeName, scope.country]);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
    return {
      ...scope,
      key: `${identity}:${index}`,
      asin,
      sku: readText(source.sku),
      productName: readText(source.productName),
      operator: readText(source.operator),
      operatorSource: readText(source.operatorSource),
      currency: readText(source.currency).toUpperCase(),
      totalInventory: quantity(source.totalInventory),
      localInventory: quantity(source.localInventory),
      localConfirmed:
        source.localInventoryConfirmedAt != null &&
        source.localInventoryConfirmedAt !== "",
      productCost: readAmount(source.productCost),
      estimatedFirstLegCost: readAmount(source.estimatedFirstLegCost),
      actualFirstLegCost: readAmount(source.actualFirstLegCost),
      estimatedFbaFee: readAmount(source.estimatedFbaFee),
      actualFbaFee: readAmount(source.actualFbaFee),
      sellingPrice: readAmount(source.sellingPrice),
      issues: !scopeComplete(scope) || !asin ? ["身份不完整，不推测归属"] : [],
    };
  });
  const groups = new Map<string, InventoryReadGroup>();
  for (const row of rows) {
    const identity = JSON.stringify([row.asin, row.storeName, row.country]);
    if (
      row.asin &&
      row.storeName &&
      row.country &&
      identityCounts.get(identity)! > 1
    )
      row.issues.push("子 ASIN / 店铺 / 站点重复，原样保留待核对");
    if (row.totalInventory === null) row.issues.push("总库存未返回有效非负数");
    const completeScope = scopeComplete(row) && Boolean(row.asin);
    const key = completeScope ? scopeKey(row) : `unknown:${row.key}`;
    const group = groups.get(key) || {
      ...scopeOf(row),
      key,
      completeScope,
      rows: [],
      totalInventory: null,
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.rows.sort(
      (a, b) =>
        a.asin.localeCompare(b.asin) ||
        a.sku.localeCompare(b.sku) ||
        a.key.localeCompare(b.key)
    );
    // Do not turn duplicate, unknown or invalid records into a plausible inventory sum.
    const sum = group.rows.reduce(
      (total, row) => total + (row.totalInventory ?? 0),
      0
    );
    group.totalInventory =
      group.completeScope &&
      group.rows.every(row => row.issues.length === 0) &&
      Number.isFinite(sum) &&
      sum <= Number.MAX_SAFE_INTEGER
        ? sum
        : null;
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function financialReadGroups(
  records: readonly FinancialReadRecord[]
): FinancialReadGroup[] {
  const rows = records.map((source, index): FinancialReadRow => {
    const scope = scopeOf(source),
      yearMonth = readText(source.yearMonth);
    const scopeKind = scopeComplete(scope)
      ? "scoped"
      : scope.parentAsin && source.storeName == null && source.country == null
        ? "legacy"
        : "incomplete";
    const identity = JSON.stringify([
      scope.parentAsin,
      scope.storeName,
      scope.country,
      scopeKind,
      yearMonth,
    ]);
    const financialProfit = readAmount(source.financialProfit);
    const issues: string[] = [];
    if (scopeKind === "legacy")
      issues.push("旧 NULL 店铺 / 站点记录，仅单列展示，不自动关联库存");
    if (scopeKind === "incomplete") issues.push("范围不完整，不推测店铺或站点");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth))
      issues.push("月份格式待核对");
    if (financialProfit === null) issues.push("金额未返回有效数值");
    return {
      ...scope,
      key: `${identity}:${index}`,
      recordId:
        typeof source.id === "number" || typeof source.id === "string"
          ? String(source.id)
          : "",
      yearMonth,
      financialProfit,
      scopeKind,
      issues,
    };
  });
  const monthKey = (row: FinancialReadRow) =>
    JSON.stringify([scopeKey(row), row.scopeKind, row.yearMonth]);
  const duplicateCounts = new Map<string, number>();
  for (const row of rows)
    duplicateCounts.set(
      monthKey(row),
      (duplicateCounts.get(monthKey(row)) || 0) + 1
    );
  const groups = new Map<string, FinancialReadGroup>();
  for (const row of rows) {
    // Count by normalized display identity as well, so whitespace/case duplicates cannot silently merge.
    if (
      row.scopeKind !== "incomplete" &&
      duplicateCounts.get(monthKey(row))! > 1
    )
      row.issues.push("同范围月份存在多条记录，不自动选最新或合计");
    const key =
      row.scopeKind === "incomplete"
        ? `unknown:${row.key}`
        : `${row.scopeKind}:${scopeKey(row)}`;
    const group = groups.get(key) || {
      ...scopeOf(row),
      key,
      scopeKind: row.scopeKind,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values())
    group.rows.sort(
      (a, b) =>
        b.yearMonth.localeCompare(a.yearMonth) || a.key.localeCompare(b.key)
    );
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Search keeps an entire source-scoped parent group together. It never grants access. */
export function filterReadGroups<
  T extends {
    parentAsin: string;
    storeName: string;
    country: string;
    rows: readonly object[];
  },
>(groups: readonly T[], search: string): T[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return [...groups];
  return groups.filter(group =>
    [
      group.parentAsin,
      group.storeName,
      group.country,
      ...group.rows.flatMap(row =>
        ["asin", "sku", "productName", "operator", "recordId", "yearMonth"].map(
          key => readText((row as Record<string, unknown>)[key])
        )
      ),
    ].some(value => value.toLocaleLowerCase().includes(needle))
  );
}

/** Fixed small page size; grouping always precedes pagination. */
export function readGroupPage<T>(groups: readonly T[], requested: number) {
  const pageCount = Math.max(1, Math.ceil(groups.length / 6));
  const page = Math.min(
    pageCount,
    Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1)
  );
  return { page, pageCount, groups: groups.slice((page - 1) * 6, page * 6) };
}

export function formatReadAmount(value: number | null): string {
  return value === null
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
