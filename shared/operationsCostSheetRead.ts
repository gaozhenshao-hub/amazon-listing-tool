import { z } from "zod";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

/** Read-only compatibility with friend 383b69e. Not a write or migration contract. */
export const OPERATIONS_COST_SHEET_RULE_VERSION = "friend-383b69e-cost-v1" as const;
export const OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES = 1024 * 1024;
export const OPERATIONS_COST_SHEET_RESULT_MAX_BYTES = 4 * 1024 * 1024;
export const OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS = 500;
export const OPERATIONS_COST_SHEET_MAX_DISPLAY_ROWS = 1000;
export const OPERATIONS_COST_SHEET_MAX_OBSERVATIONS = 5000;
export const OPERATIONS_COST_SHEET_PROFIT_LABEL = "固定15%佣金假设下的单件测算，非会计利润" as const;
export const OPERATIONS_COST_SHEET_FBA_SOURCE = "https://sellercentral.amazon.com/help/hub/reference/external/GABBX6GZPA8MSZGW?locale=en_us";

const id = z.number().int().positive().safe().max(2_147_483_647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim() === value);
const country = text(20).transform(normalizeMarketplaceCode);
const finite = z.number().finite();
const amount = finite.min(0).max(10_000_000).nullable();
const measure = finite.positive().max(10_000).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const timestamp = z.string().datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/u).nullable();
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();

export const OperationsCostSheetScopeSchema = z.object({
  workspaceId: id, parentAsin: text(500), storeName: text(200), country,
}).strict();
export type OperationsCostSheetScope = z.infer<typeof OperationsCostSheetScopeSchema>;

export const OperationsCostSheetReadInputSchema = z.object({
  expectedWorkspaceId: id, parentAsin: text(500), storeName: text(200), country,
}).strict();
export type OperationsCostSheetReadInput = z.infer<typeof OperationsCostSheetReadInputSchema>;

export const OperationsCostSheetRowInputSchema = z.object({
  key: text(500), productCost: amount, packagingCost: amount, actualFreight: amount,
  actualFba: amount, weightKg: measure, lengthCm: measure, widthCm: measure, heightCm: measure,
}).strict();
export type OperationsCostSheetRowInput = z.infer<typeof OperationsCostSheetRowInputSchema>;
export const OperationsCostSheetSettingsSchema = z.object({
  cnyPerCurrency: finite.positive().max(100_000).nullable(),
  freightRate: finite.min(0).max(100_000), standardGoodsConfirmed: z.boolean(),
}).strict();
export type OperationsCostSheetSettings = z.infer<typeof OperationsCostSheetSettingsSchema>;

function jsonByteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("COST_SHEET_INVALID_JSON");
  return new TextEncoder().encode(encoded).byteLength;
}
export const OperationsCostSheetPayloadSchema = z.object({
  settings: OperationsCostSheetSettingsSchema,
  rows: z.array(OperationsCostSheetRowInputSchema).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.rows.map(row => row.key)).size !== value.rows.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate saved row key" });
  }
  if (jsonByteLength(value) > OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Saved payload exceeds byte limit" });
  }
});
export type OperationsCostSheetPayload = z.infer<typeof OperationsCostSheetPayloadSchema>;

/** Never truncates, strips unknown fields, supplies defaults, or coerces missing costs to zero. */
export function parseOperationsCostSheetPayload(value: unknown): OperationsCostSheetPayload {
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES) {
      throw new Error("COST_SHEET_PAYLOAD_TOO_LARGE");
    }
    return OperationsCostSheetPayloadSchema.parse(JSON.parse(value));
  }
  if (jsonByteLength(value) > OPERATIONS_COST_SHEET_PAYLOAD_MAX_BYTES) {
    throw new Error("COST_SHEET_PAYLOAD_TOO_LARGE");
  }
  return OperationsCostSheetPayloadSchema.parse(value);
}

const reportNumber = z.union([finite, z.string().max(100).refine(value =>
  value.trim() === "" || (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim()) && Number.isFinite(Number(value))),
), z.null()]);
export const OperationsCostSheetSourceRowSchema = z.object({
  kind: z.enum(["lingxing", "saihu"]), id, importId: id.nullable(), date: date.nullable(),
  sourceKind: z.string().max(48).nullable(), sourceBatchId: id.nullable(),
  sourceTraceId: z.string().max(128).nullable(), sourceSchemaVersion: z.string().max(32).nullable(),
  scope: OperationsCostSheetScopeSchema,
  sku: z.string().max(10_000).nullable(), msku: z.string().max(10_000).nullable(),
  asin: z.string().max(10_000).nullable(), name: z.string().max(2000).nullable(),
  currency: z.string().max(20).nullable(), price: reportNumber,
  priceField: z.enum(["avgPrice", "price"]).optional(),
  actualFbaUnitFee: reportNumber, actualFbaTotalFee: reportNumber, fbaSalesQty: reportNumber,
  missingColumns: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u).max(80)).max(30),
}).strict();
export type OperationsCostSheetSourceRow = z.infer<typeof OperationsCostSheetSourceRowSchema>;

const factSourceSchema = z.object({
  kind: z.enum(["lingxing", "saihu"]), id, importId: id.nullable(), date: date.nullable(),
  sourceKind: z.string().max(48).nullable(), sourceBatchId: id.nullable(),
  sourceTraceId: z.string().max(128).nullable(), sourceSchemaVersion: z.string().max(32).nullable(),
  basis: z.object({ price: z.string().min(1).max(1000), actualFba: z.string().min(1).max(1000), currency: z.string().min(1).max(1000) }).strict(),
  missingColumns: z.array(z.string().max(80)).max(30),
  raw: z.object({ price: finite.nullable(), actualFbaUnitFee: finite.nullable(), actualFbaTotalFee: finite.nullable(), fbaSalesQty: finite.nullable() }).strict(),
}).strict();
export const OperationsCostSheetFactSchema = z.object({
  key: text(500), sku: text(500), name: z.string().min(1).max(2000), currency,
  price: finite.positive().nullable(), actualFba: finite.min(0).nullable(),
  ambiguous: z.boolean(), source: factSourceSchema,
}).strict();
export type OperationsCostSheetFact = z.infer<typeof OperationsCostSheetFactSchema>;

const profitSchema = z.object({
  profit: finite, margin: finite, commissionRate: z.literal(0.15), label: z.literal(OPERATIONS_COST_SHEET_PROFIT_LABEL),
}).strict();
const freightSchema = z.object({ dimensionalKg: finite.positive(), billableKg: finite.positive(), cost: finite.min(0) }).strict();
const estimatedFbaSchema = z.object({
  fee: finite.min(0).nullable(), reason: z.string().min(1).max(1000), currency: z.literal("USD"),
  ruleVersion: z.literal(OPERATIONS_COST_SHEET_RULE_VERSION), asOfDate: date,
}).strict();
export const OperationsCostSheetDisplayRowSchema = z.object({
  key: text(500), name: z.string().min(1).max(2000), sku: text(500), currency,
  orphaned: z.boolean(), ambiguous: z.boolean(), currencyMismatch: z.boolean(), sourceConflict: z.boolean(),
  input: OperationsCostSheetRowInputSchema.nullable(), fact: OperationsCostSheetFactSchema.nullable(),
  observations: z.array(OperationsCostSheetFactSchema).max(OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS),
  profit: profitSchema.nullable(), profitUnavailableReason: z.string().min(1).max(1000).nullable(),
  estimatedFreight: freightSchema.nullable(), estimatedFba: estimatedFbaSchema,
}).strict();
export type OperationsCostSheetDisplayRow = z.infer<typeof OperationsCostSheetDisplayRowSchema>;

const savedSchema = z.object({
  id, version: id, updatedBy: id, updatedAt: timestamp, payload: OperationsCostSheetPayloadSchema,
}).strict();
const reasonCodeSchema = z.enum(["table_missing", "not_saved", "invalid_payload", "invalid_source", "result_limit", "source_unavailable"]).nullable();
export const OperationsCostSheetReadResultSchema = z.object({
  identity: identitySchema, scope: OperationsCostSheetScopeSchema, asOfDate: date,
  status: z.enum(["saved", "not_saved", "not_connected", "corrupt"]),
  reasonCode: reasonCodeSchema, missingReason: z.string().min(1).max(1000).nullable(),
  saved: savedSchema.nullable(),
  sourceStatus: z.enum(["available", "unavailable"]),
  sourceRecordCount: z.number().int().min(0).max(OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS).nullable(),
  rows: z.array(OperationsCostSheetDisplayRowSchema).max(OPERATIONS_COST_SHEET_MAX_DISPLAY_ROWS),
  provenance: z.object({
    kind: z.literal("current_saved_cost_sheet"), historyAvailable: z.literal(false),
    ruleVersion: z.literal(OPERATIONS_COST_SHEET_RULE_VERSION), sourcePriority: z.literal("latest_unambiguous_observation"),
  }).strict(),
}).strict().superRefine((result, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (result.identity.workspaceId !== result.scope.workspaceId) issue("Workspace identity mismatch");
  if ((result.status === "saved") !== (result.saved !== null)) issue("Saved state mismatch");
  if (result.status === "saved" && (result.reasonCode !== null || result.missingReason !== null)) issue("Saved reason mismatch");
  if (result.status !== "saved" && (!result.reasonCode || !result.missingReason)) issue("Missing status reason");
  if (result.status === "not_connected" && result.reasonCode !== "table_missing") issue("Only missing table is not connected");
  if (result.status === "not_saved" && result.reasonCode !== "not_saved") issue("Not saved reason mismatch");
  if ((result.sourceStatus === "available") !== (result.sourceRecordCount !== null)) issue("Unknown sources are not zero");
  if (new Set(result.rows.map(row => row.key)).size !== result.rows.length) issue("Duplicate display key");
  const savedRows = new Map(result.saved?.payload.rows.map(row => [row.key, row]) ?? []);
  const displayRows = new Map(result.rows.map(row => [row.key, row]));
  for (const [key, saved] of savedRows) {
    if (JSON.stringify(displayRows.get(key)?.input) !== JSON.stringify(saved)) issue("Saved row omitted or modified");
  }
  let memberships = 0;
  const uniqueSources = new Set<string>();
  for (const row of result.rows) {
    memberships += row.observations.length;
    if (row.input && (!savedRows.has(row.key) || row.input.key !== row.key)) issue("Unexpected saved input");
    if (row.orphaned !== (row.fact === null && row.input !== null)) issue("Orphan state mismatch");
    if (row.fact && (row.fact.key !== row.key || row.fact.sku !== row.sku || row.fact.currency !== row.currency || row.fact.ambiguous !== row.ambiguous)) issue("Selected observation mismatch");
    if (row.observations.some(fact => fact.key !== row.key)) issue("Observation identity mismatch");
    for (const observation of row.observations) uniqueSources.add(`${observation.source.kind}:${observation.source.id}`);
    if (new Set(row.observations.map(fact => `${fact.source.kind}:${fact.source.id}`)).size !== row.observations.length) issue("Duplicate row observation");
    if (row.fact && !row.observations.some(fact => JSON.stringify(fact) === JSON.stringify(row.fact))) issue("Selected observation absent");
    if (JSON.stringify(row.fact) !== JSON.stringify([...row.observations].sort(observationOrder)[0] ?? null)) issue("Selected observation is not the deterministic display candidate");
    if (row.sourceConflict !== (row.fact ? conflictingObservations(row.observations, row.fact) : false)) issue("Conflict flag mismatch");
    const expectedCurrencyMismatch = row.currency !== null && !!currencyByCountry[result.scope.country] && row.currency !== currencyByCountry[result.scope.country];
    if (row.currencyMismatch !== expectedCurrencyMismatch) issue("Currency mismatch flag mismatch");
    if (row.profit && (!row.input || !row.fact || row.ambiguous || row.currencyMismatch || row.sourceConflict || row.orphaned || row.profitUnavailableReason !== null)) issue("Profit without complete unambiguous evidence");
    if (row.profit && (!row.currency || !currencyByCountry[result.scope.country] || !result.saved || !row.input || !row.fact || JSON.stringify(row.profit) !== JSON.stringify(calculateOperationsCostSheetProfit(row.fact.price, row.input.actualFba, row.input, result.saved.payload.settings)))) issue("Profit calculation mismatch");
    if (!row.profit && row.profitUnavailableReason === null) issue("Missing profit reason");
    if (row.estimatedFba.asOfDate !== result.asOfDate) issue("Prediction date mismatch");
  }
  if (result.sourceStatus === "unavailable" && uniqueSources.size !== 0) issue("Unknown source status with observations");
  if (result.sourceStatus === "available" && result.reasonCode !== "result_limit" && uniqueSources.size !== result.sourceRecordCount) issue("Source record count mismatch");
  if (memberships > OPERATIONS_COST_SHEET_MAX_OBSERVATIONS) issue("Expanded observations exceed limit");
  if (jsonByteLength(result) > OPERATIONS_COST_SHEET_RESULT_MAX_BYTES) issue("Result exceeds byte limit");
});
export type OperationsCostSheetReadResult = z.infer<typeof OperationsCostSheetReadResultSchema>;

const currencyByCountry: Record<string, string> = {
  US: "USD", CA: "CAD", MX: "MXN", UK: "GBP", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", JP: "JPY", AU: "AUD",
};
const splitKeys = (value: string | null) => [...new Set((value ?? "").split(/[,，、\n]+/u).map(item => item.trim()).filter(Boolean))];
function sourceNumber(value: z.infer<typeof reportNumber>): number | null {
  return value === null || (typeof value === "string" && value.trim() === "") ? null : Number(value);
}
function sameScope(a: OperationsCostSheetScope, b: OperationsCostSheetScope) {
  return a.workspaceId === b.workspaceId && a.parentAsin === b.parentAsin && a.storeName === b.storeName && a.country === b.country;
}

/** All admitted observations remain available, including older/alternate-source reports. */
export function mapOperationsCostSheetFacts(scopeValue: OperationsCostSheetScope, sourcesValue: OperationsCostSheetSourceRow[]): OperationsCostSheetFact[] {
  const scope = OperationsCostSheetScopeSchema.parse(scopeValue);
  const sources = z.array(OperationsCostSheetSourceRowSchema).max(OPERATIONS_COST_SHEET_MAX_SOURCE_ROWS).parse(sourcesValue);
  const identities = new Set<string>();
  const facts: OperationsCostSheetFact[] = [];
  for (const source of sources) {
    if (!sameScope(scope, source.scope)) throw new Error("COST_SHEET_SOURCE_SCOPE_MISMATCH");
    const identity = `${source.kind}:${source.id}`;
    if (identities.has(identity)) throw new Error("COST_SHEET_DUPLICATE_SOURCE");
    identities.add(identity);
    const skus = splitKeys(source.sku?.trim() ? source.sku : source.msku);
    const children = splitKeys(source.asin);
    const ambiguous = skus.length > 1 || children.length > 1 || (skus.length === 0 && children.length !== 1);
    const keys = skus.length ? skus : [children.length === 1 ? children[0] : "父级汇总"];
    const rawPrice = sourceNumber(source.price), unitFee = sourceNumber(source.actualFbaUnitFee);
    const totalFee = sourceNumber(source.actualFbaTotalFee), quantity = sourceNumber(source.fbaSalesQty);
    const derivedFba = unitFee !== null ? Math.abs(unitFee) : totalFee !== null && quantity !== null && quantity > 0 ? Math.abs(totalFee) / quantity : null;
    const actualFba = derivedFba !== null && Number.isFinite(derivedFba) ? derivedFba : null;
    const rawCurrency = source.currency?.trim().toUpperCase();
    const rowCurrency = rawCurrency || currencyByCountry[scope.country] || null;
    const basis = {
      price: ambiguous ? "父级/多 SKU 汇总，不把均价分摊给单品" : `${source.priceField ?? "report_price"}：该来源行的售价；非正值或缺失不作为单品售价`,
      actualFba: ambiguous ? "父级/多 SKU 汇总，不把费用分摊给单品" : unitFee !== null ? "报表单件实际 FBA 的绝对值" : totalFee !== null && quantity !== null && quantity > 0 && actualFba !== null ? "同一报表行实际 FBA 总费用绝对值 ÷ 同行正 FBA 销量" : "报表缺少可用单件实际 FBA（不以预测或其他来源补空）",
      currency: rawCurrency ? "该来源行显式币种" : rowCurrency ? "按站点映射推断币种；不是来源报表币种认证" : "报表与站点映射均未提供币种",
    };
    for (const key of keys) {
      if (facts.length >= OPERATIONS_COST_SHEET_MAX_OBSERVATIONS) throw new Error("COST_SHEET_OBSERVATION_LIMIT");
      facts.push(OperationsCostSheetFactSchema.parse({
        key, sku: key, name: source.name?.trim() || key, currency: rowCurrency,
        ambiguous, price: !ambiguous && rawPrice !== null && rawPrice > 0 ? rawPrice : null,
        actualFba: ambiguous ? null : actualFba,
        source: { kind: source.kind, id: source.id, importId: source.importId, date: source.date, basis,
          sourceKind: source.sourceKind, sourceBatchId: source.sourceBatchId,
          sourceTraceId: source.sourceTraceId, sourceSchemaVersion: source.sourceSchemaVersion,
          missingColumns: source.missingColumns,
          raw: { price: rawPrice, actualFbaUnitFee: unitFee, actualFbaTotalFee: totalFee, fbaSalesQty: quantity } },
      }));
    }
  }
  return facts;
}

export function calculateOperationsCostSheetProfit(price: number | null, actualFba: number | null, inputs: OperationsCostSheetRowInput, settings: OperationsCostSheetSettings) {
  const values = [price, actualFba, inputs.productCost, inputs.packagingCost, inputs.actualFreight, settings.cnyPerCurrency];
  if (values.some(value => value === null || !Number.isFinite(value) || value < 0) || !price || !settings.cnyPerCurrency) return null;
  const profit = price * 0.85 - (inputs.productCost! + inputs.packagingCost! + inputs.actualFreight!) / settings.cnyPerCurrency - actualFba!;
  const margin = profit / price * 100;
  return Number.isFinite(profit) && Number.isFinite(margin) ? { profit, margin, commissionRate: 0.15 as const, label: OPERATIONS_COST_SHEET_PROFIT_LABEL } : null;
}

export function calculateOperationsCostSheetFreight(inputs: OperationsCostSheetRowInput, rate: number) {
  const { weightKg, lengthCm, widthCm, heightCm } = inputs;
  if ([weightKg, lengthCm, widthCm, heightCm].some(value => value === null || !Number.isFinite(value) || value <= 0) || !Number.isFinite(rate) || rate < 0) return null;
  const dimensionalKg = lengthCm! * widthCm! * heightCm! / 6000;
  const billableKg = Math.max(weightKg!, dimensionalKg);
  const cost = billableKg * rate;
  return [dimensionalKg, billableKg, cost].every(Number.isFinite) ? { dimensionalKg, billableKg, cost } : null;
}

// Pinned transcription of the friend's rule, NOT independently verified current official rates.
const small = [[2.43,3.32,3.58],[2.49,3.42,3.68],[2.56,3.45,3.71],[2.66,3.54,3.80],[2.77,3.68,3.94],[2.82,3.78,4.04],[2.92,3.91,4.17],[2.95,3.96,4.22]];
const large = [[2.91,3.73,3.99],[3.13,3.95,4.21],[3.38,4.20,4.46],[3.78,4.60,4.86],[4.22,5.04,5.30],[4.60,5.42,5.68],[4.75,5.57,5.83],[5.00,5.82,6.08],[5.10,5.92,6.18],[5.28,6.10,6.36],[5.44,6.26,6.52],[5.85,6.67,6.93]];
const smallPeak = [[2.62,3.51,3.77],[2.68,3.61,3.87],[2.76,3.65,3.91],[2.86,3.74,4.00],[2.98,3.89,4.15],[3.03,3.99,4.25],[3.14,4.13,4.39],[3.17,4.18,4.44]];
const largePeak = [[3.15,3.97,4.23],[3.39,4.21,4.47],[3.66,4.48,4.74],[4.07,4.89,5.15],[4.52,5.34,5.60],[4.91,5.73,5.99],[5.07,5.89,6.15],[5.33,6.15,6.41],[5.47,6.29,6.55],[5.67,6.49,6.75],[5.84,6.66,6.92],[6.26,7.08,7.34]];

export function estimateOperationsCostSheetFba(inputs: OperationsCostSheetRowInput | null, price: number | null, marketplace: string, standardGoodsConfirmed: boolean, asOfDate: string): z.infer<typeof estimatedFbaSchema> {
  date.parse(asOfDate);
  const result = (fee: number | null, reason: string) => ({ fee, reason, currency: "USD" as const, ruleVersion: OPERATIONS_COST_SHEET_RULE_VERSION, asOfDate });
  if (normalizeMarketplaceCode(marketplace) !== "US") return result(null, "固定朋友版规则仅支持美国；其他站点待核对");
  if (!standardGoodsConfirmed) return result(null, "保存数据未确认普通非服装、非危险品，不启用预测");
  if (asOfDate < "2026-01-15" || asOfDate > "2027-01-14") return result(null, "日期超出固定朋友版费率适用期，待核对新规则");
  if (!inputs || !price || !Number.isFinite(price) || price < 0 || !calculateOperationsCostSheetFreight(inputs, 9)) return result(null, "缺少有效单品售价、包装尺寸或重量");
  const [l, w, h] = [inputs.lengthCm!, inputs.widthCm!, inputs.heightCm!].sort((a, b) => b - a).map(value => value / 2.54);
  const unitLb = inputs.weightKg! / 0.45359237;
  const band = price < 10 ? 0 : price <= 50 ? 1 : 2;
  const peak = asOfDate >= "2026-10-15";
  const steps = (value: number) => Math.ceil(value - 1e-9);
  let base: number, tier: string;
  if (l <= 15 && w <= 12 && h <= 0.75 && unitLb <= 1) {
    base = (peak ? smallPeak : small)[Math.max(0, steps(unitLb * 8) - 1)][band]; tier = "小号标准尺寸";
  } else if (l <= 18 && w <= 14 && h <= 8 && Math.max(unitLb, l * w * h / 139) <= 20) {
    const lb = Math.max(unitLb, l * w * h / 139);
    base = lb <= 3 ? (peak ? largePeak : large)[Math.max(0, steps(lb * 4) - 1)][band] : (peak ? [6.69,7.51,7.77] : [6.15,6.97,7.23])[band] + 0.08 * steps((lb - 3) * 4);
    tier = "大号标准尺寸";
  } else {
    const lb = Math.max(unitLb, l * Math.max(w, 2) * Math.max(h, 2) / 139);
    if (lb > 50 || l > 59 || w > 33 || h > 33 || l + 2 * (w + h) > 130) return result(null, "超大件超出固定规则，需核对附加费");
    const isSmall = l <= 37 && w <= 28 && h <= 20;
    base = (isSmall ? (peak ? [7.82,8.59,8.59] : [6.78,7.55,7.55]) : (peak ? [9.62,10.39,10.39] : [8.58,9.35,9.35]))[band] + 0.38 * Math.max(0, steps(lb - 1));
    tier = isSmall ? "小号大件" : "大号大件";
  }
  return result(Math.round(base * (asOfDate >= "2026-04-17" ? 1.035 : 1) * 100) / 100,
    `${tier} · ${peak ? "旺季" : "非旺季"}；固定朋友版规则，非最新官方认证；包含规则内燃油附加费，不含 SIPP、低库存等调整；不参与实际利润`);
}

export type OperationsCostSheetReadStorage =
  | { status: "saved"; record: { id: number; version: number; updatedBy: number; updatedAt: string | Date; payload: unknown } }
  | { status: "not_saved" | "not_connected" | "corrupt"; reason?: string; reasonCode?: "not_saved" | "table_missing" | "invalid_payload" };
export type BuildOperationsCostSheetReadInput = {
  identity: { userId: number; workspaceId: number }; scope: OperationsCostSheetScope; asOfDate: string;
  storage: OperationsCostSheetReadStorage; sources: OperationsCostSheetSourceRow[] | null;
};

function observationOrder(a: OperationsCostSheetFact, b: OperationsCostSheetFact) {
  return Number(a.ambiguous) - Number(b.ambiguous)
    || (b.source.date ?? "").localeCompare(a.source.date ?? "")
    || (b.source.importId ?? 0) - (a.source.importId ?? 0)
    || b.source.id - a.source.id || a.source.kind.localeCompare(b.source.kind);
}
function conflictingObservations(observations: OperationsCostSheetFact[], selected: OperationsCostSheetFact) {
  // Table-local IDs do not establish which same-day cross-source observation is newest.
  const peers = observations.filter(fact => fact.ambiguous === selected.ambiguous && fact.source.date === selected.source.date);
  return peers.some(left => peers.some(right => (left.source.kind !== right.source.kind || left.source.sourceKind !== right.source.sourceKind) &&
    (left.price !== right.price || left.actualFba !== right.actualFba || left.currency !== right.currency)));
}

/** Requires a separately authorized repository; userId in this DTO is not authority. */
export function buildOperationsCostSheetReadResult(input: BuildOperationsCostSheetReadInput): OperationsCostSheetReadResult {
  const identity = identitySchema.parse(input.identity), scope = OperationsCostSheetScopeSchema.parse(input.scope);
  if (identity.workspaceId !== scope.workspaceId) throw new Error("COST_SHEET_IDENTITY_MISMATCH");
  const asOfDate = date.parse(input.asOfDate);
  let status: OperationsCostSheetReadResult["status"] = input.storage.status;
  let reasonCode: OperationsCostSheetReadResult["reasonCode"] = status === "saved" ? null : status === "not_connected" ? "table_missing" : status === "not_saved" ? "not_saved" : "invalid_payload";
  let missingReason = status === "saved" ? null : status === "not_connected" ? "完整成本表尚未接通（表不存在），不表示已有零行成本" : status === "not_saved" ? "该范围尚未保存完整成本表；不使用默认成本或旧库存参数填充" : "保存成本数据损坏，未返回坏原文";
  let saved: OperationsCostSheetReadResult["saved"] = null;
  if (input.storage.status === "saved") {
    try {
      const record = input.storage.record;
      saved = savedSchema.parse({ ...record, updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt, payload: parseOperationsCostSheetPayload(record.payload) });
    } catch {
      status = "corrupt"; reasonCode = "invalid_payload"; missingReason = "保存成本数据或版本元数据损坏，未返回坏原文";
    }
  }
  let sourceStatus: "available" | "unavailable" = input.sources === null ? "unavailable" : "available";
  let sourceRecordCount: number | null = input.sources?.length ?? null;
  let facts: OperationsCostSheetFact[] = [];
  try {
    if (input.sources !== null) facts = mapOperationsCostSheetFacts(scope, input.sources);
  } catch {
    status = "corrupt"; reasonCode = "invalid_source"; missingReason = "来源范围、结构或完整数量无法核验，整批拒绝，不截断来源";
    saved = null; sourceStatus = "unavailable"; sourceRecordCount = null;
  }
  const grouped = new Map<string, OperationsCostSheetFact[]>();
  for (const fact of facts) grouped.set(fact.key, [...(grouped.get(fact.key) ?? []), fact]);
  const savedRows = new Map(saved?.payload.rows.map(row => [row.key, row]) ?? []);
  const keys = [...new Set([...grouped.keys(), ...savedRows.keys()])];
  const rows: OperationsCostSheetDisplayRow[] = keys.map(key => {
    const observations = (grouped.get(key) ?? []).sort(observationOrder);
    const fact = observations[0] ?? null, row = savedRows.get(key) ?? null;
    const rowCurrency = fact?.currency ?? null;
    const currencyMismatch = rowCurrency !== null && !!currencyByCountry[scope.country] && rowCurrency !== currencyByCountry[scope.country];
    const sourceConflict = fact ? conflictingObservations(observations, fact) : false;
    let profitUnavailableReason: string | null = !saved || !row ? "没有该 SKU 的完整保存成本输入" : !fact ? "保存行没有匹配的报表事实，保留为孤立行" : fact.ambiguous ? "多 SKU 或父级汇总不分摊售价及费用" : sourceConflict ? "同日跨来源事实冲突，不能认定最新事实" : currencyMismatch ? "来源币种与站点不匹配，不能套用同一汇率" : !rowCurrency || !currencyByCountry[scope.country] ? "币种或站点汇率身份无法确定" : null;
    const profit = profitUnavailableReason === null && fact && row && saved ? calculateOperationsCostSheetProfit(fact.price, row.actualFba, row, saved.payload.settings) : null;
    if (!profit && profitUnavailableReason === null) profitUnavailableReason = "缺少有效售价、实际成本/包装/运费/FBA或正汇率；预测费用不补空";
    const estimatedFba = estimateOperationsCostSheetFba(row, !sourceConflict && !currencyMismatch ? fact?.price ?? null : null, scope.country, saved?.payload.settings.standardGoodsConfirmed ?? false, asOfDate);
    return { key, sku: fact?.sku ?? key, name: fact?.name ?? key, currency: rowCurrency,
      orphaned: !fact && !!row, ambiguous: fact?.ambiguous ?? false, currencyMismatch, sourceConflict,
      input: row, fact, observations, profit, profitUnavailableReason,
      estimatedFreight: row && saved ? calculateOperationsCostSheetFreight(row, saved.payload.settings.freightRate) : null, estimatedFba };
  });
  const result = { identity, scope, asOfDate, status, reasonCode, missingReason, saved, sourceStatus, sourceRecordCount, rows,
    provenance: { kind: "current_saved_cost_sheet" as const, historyAvailable: false as const, ruleVersion: OPERATIONS_COST_SHEET_RULE_VERSION, sourcePriority: "latest_unambiguous_observation" as const } };
  if (rows.length > OPERATIONS_COST_SHEET_MAX_DISPLAY_ROWS || jsonByteLength(result) > OPERATIONS_COST_SHEET_RESULT_MAX_BYTES) {
    return OperationsCostSheetReadResultSchema.parse({ ...result, status: "corrupt", saved: null, rows: [], reasonCode: "result_limit", missingReason: "完整结果超过数量或字节上限，整批拒绝，不截断成本或来源" });
  }
  return OperationsCostSheetReadResultSchema.parse(result);
}
