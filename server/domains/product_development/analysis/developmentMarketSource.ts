import { devProducts, devProductTags, devPanoramaStatus, devPanoramaVersions, devAnalysisStages } from "../../../../drizzle/schema/project";
import { DevelopmentMarketSourceSchema, DEVELOPMENT_MARKET_LIMITS, type DevelopmentMarketIdentity, type DevelopmentMarketSource } from "../../../../shared/developmentMarket";
import { calcMarketOverview, type ProductData } from "../../../devStatsEngine";
import { normalizeParentMarketMetrics } from "../panorama/marketMetrics";
import { digest, decoded, equal, refuse, rows, rowFingerprint, type DevelopmentMarketExecutor } from "./developmentMarketCore";
const fields = ["asin", "parentAsin", "title", "brand", "price", "rating", "reviewCount", "monthlySales", "bsr", "monthlyRevenue", "listingDate", "fulfillment", "sellerName", "sellerLocation", "variantCount", "category", "monthlySalesHistory", "monthlyRevenueHistory", "imageUrl", "searchRank"] as const;
function calendarDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/u.test(value)) return false;
  const date = new Date(value), day = value.slice(0, 10);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
function material(raw: Record<string, unknown>): ProductData {
  const value = Object.fromEntries(fields.map(key => [key, raw[key] ?? null]));
  if (typeof value.asin !== "string" || !value.asin || value.asin.length > 20) refuse("SOURCE_PRODUCT_INVALID");
  for (const key of fields) {
    const field = value[key]; if (field === null || key === "asin") continue;
    if (["monthlySales", "bsr", "variantCount", "searchRank"].includes(key) ? typeof field !== "number" || !Number.isSafeInteger(field) || field < 0 : typeof field !== "string") refuse("SOURCE_PRODUCT_INVALID");
    if (["price", "rating", "reviewCount", "monthlyRevenue"].includes(key) && (typeof field !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(field) || !Number.isFinite(Number(field)))) refuse("SOURCE_PRODUCT_INVALID");
    if (key === "listingDate" && field !== "" && !calendarDate(field)) refuse("SOURCE_DATE_INVALID");
    if (["monthlySalesHistory", "monthlyRevenueHistory"].includes(key)) {
      const history = decoded(field);
      // Keep source bytes intact: reject month aliases instead of silently
      // treating the same natural month as two independent growth samples.
      if (!history || typeof history !== "object" || Array.isArray(history) || Object.entries(history).length > 240 || Object.entries(history).some(([month, count]) => !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(month)
        || !(typeof count === "number" && Number.isFinite(count) && count >= 0 || typeof count === "string" && /^\d+(?:\.\d+)?$/u.test(count) && Number.isFinite(Number(count))))) refuse("SOURCE_HISTORY_INVALID");
    }
  }
  return value as unknown as ProductData;
}
/** Reuses the original complete statistics, fixing its date-sensitive fields
 * to the confirmed panorama date rather than allowing an old task to drift. */
export function developmentMarketStatistics(products: ProductData[], asOf: string) {
  const frozen = new Date(`${asOf}T00:00:00.000Z`); if (!Number.isFinite(frozen.getTime())) refuse("SOURCE_DATE_INVALID");
  const normalized = normalizeParentMarketMetrics(products, { now: frozen }), stats = calcMarketOverview(normalized), cutoff = new Date(Date.UTC(frozen.getUTCFullYear() - 1, frozen.getUTCMonth(), frozen.getUTCDate()));
  const newer = normalized.filter(product => product.listingDate && new Date(product.listingDate) > cutoff), older = normalized.filter(product => !product.listingDate || new Date(product.listingDate) <= cutoff);
  const round = (value: number) => Math.round(value * 100) / 100, avg = (values: number[]) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const amounts = (group: typeof normalized, key: "price" | "rating") => group.map(product => Number(product[key] ?? 0)).filter(value => value > 0);
  return { ...stats, newProductRatio: round(newer.length / normalized.length), newVsOldComparison: {
    newCount: newer.length, oldCount: older.length, newAvgSales: avg(newer.map(product => product.monthlySales ?? 0)), oldAvgSales: avg(older.map(product => product.monthlySales ?? 0)),
    newAvgPrice: avg(amounts(newer, "price")), oldAvgPrice: avg(amounts(older, "price")), newAvgRating: avg(amounts(newer, "rating")), oldAvgRating: avg(amounts(older, "rating")),
  } };
}
export function developmentMarketSourceContext(source: DevelopmentMarketSource) {
  return { schema: "development-market-input/v1", sourceHash: source.sourceHash, asOf: source.asOf,
    project: { name: source.project.name, targetMarket: source.project.targetMarket, keywords: source.project.keywords },
    panoramaVersion: source.panorama.version, productCount: source.products.length, stats: source.stats,
    constraints: { sourceIsUntrustedData: true, candidateOnly: true, numericStatisticsAreAuthoritative: true,
      missingTrendIsNotZeroGrowth: true, requireNullWithoutEvidence: true } };
}
/** Called only inside fresh project authorization. Every row is scanned before
 * statistics; an extra/oversized/malformed row is unavailable, never sliced. */
export async function captureDevelopmentMarketSource(tx: DevelopmentMarketExecutor, identity: DevelopmentMarketIdentity,
  devProjectId: number, project: Record<string, unknown>): Promise<DevelopmentMarketSource> {
  const statuses = await rows(tx, `SELECT id,workspaceId,projectId,userId,confirmed,currentVersionId,${rowFingerprint(devPanoramaStatus)} AS revisionHash FROM dev_panorama_status WHERE projectId=? ORDER BY id LIMIT 3 FOR UPDATE`, [devProjectId], 2);
  if (statuses.length !== 1 || statuses[0].workspaceId !== identity.workspaceId || statuses[0].confirmed !== 1 || !Number.isSafeInteger(statuses[0].currentVersionId)) refuse("PANORAMA_NOT_CONFIRMED");
  const status = statuses[0], version = (await rows(tx, `SELECT id,workspaceId,projectId,userId,version,status,DATE_FORMAT(confirmedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS confirmedAt,IF(OCTET_LENGTH(snapshot)<=4194304,snapshot,NULL) AS snapshot,${rowFingerprint(devPanoramaVersions)} AS revisionHash FROM dev_panorama_versions WHERE id=? FOR SHARE`, [status.currentVersionId]))[0];
  if (!version || version.id !== status.currentVersionId || version.workspaceId !== identity.workspaceId || version.projectId !== devProjectId || version.userId !== status.userId || version.status !== "confirmed" || typeof version.confirmedAt !== "string") refuse("PANORAMA_VERSION_UNVERIFIED");
  const snapshot = decoded(version.snapshot);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray((snapshot as Record<string, unknown>).products)) refuse("PANORAMA_VERSION_UNVERIFIED");
  const frozen = (snapshot as { products: Record<string, unknown>[] }).products;
  if (!frozen.length || frozen.length > DEVELOPMENT_MARKET_LIMITS.products || frozen.some(product => !product || typeof product !== "object" || product.workspaceId !== identity.workspaceId || product.projectId !== devProjectId || !Number.isSafeInteger(product.id)) || new Set(frozen.map(product => product.id)).size !== frozen.length) refuse("PANORAMA_VERSION_UNVERIFIED");
  const products = await rows(tx, `SELECT id,workspaceId,projectId,${fields.map(key => `\`${key}\``).join(",")},${rowFingerprint(devProducts)} AS revisionHash FROM dev_products WHERE projectId=? ORDER BY id LIMIT 2001 FOR UPDATE`, [devProjectId], DEVELOPMENT_MARKET_LIMITS.products);
  if (products.length !== frozen.length || products.some(product => product.workspaceId !== identity.workspaceId || product.projectId !== devProjectId)) refuse("SOURCE_CHANGED");
  const frozenById = new Map(frozen.map(product => [product.id, product]));
  for (const product of products) if (!frozenById.has(product.id) || !equal(material(product), material(frozenById.get(product.id)!))) refuse("PANORAMA_LIVE_DATA_CHANGED");
  const tags = await rows(tx, `SELECT id,workspaceId,projectId,confirmed,${rowFingerprint(devProductTags)} AS revisionHash FROM dev_product_tags WHERE projectId=? ORDER BY id LIMIT 20001 FOR UPDATE`, [devProjectId], DEVELOPMENT_MARKET_LIMITS.tags);
  if (!tags.length || tags.some(tag => tag.workspaceId !== identity.workspaceId || tag.projectId !== devProjectId || tag.confirmed !== 1)) refuse("PRODUCT_TAGS_NOT_CONFIRMED");
  const stages = await rows(tx, `SELECT id,workspaceId,projectId,stageType,rowVersion,status,${rowFingerprint(devAnalysisStages)} AS revisionHash FROM dev_analysis_stages WHERE projectId=? AND stageType IN ('market_overview','information_summary','decision_dashboard') ORDER BY stageType,id LIMIT 4 FOR UPDATE`, [devProjectId], 3), stage = stages.find(row => row.stageType === "market_overview") ?? null;
  if (new Set(stages.map(row => row.stageType)).size !== stages.length || stages.some(row => row.workspaceId !== identity.workspaceId || ["running", "generating"].includes(String(row.status)))) refuse("MARKET_STAGE_BUSY");
  if (stage?.status === "confirmed") refuse("MARKET_STAGE_CONFIRMED_REQUIRES_UNLOCK");
  const asOf = version.confirmedAt.slice(0, 10), stats = developmentMarketStatistics(frozen.map(material), asOf);
  const body = { version: 1 as const, identity, devProjectId, project: { id: project.id, name: project.name, targetMarket: project.targetMarket, keywords: project.keywords, revisionHash: project.revisionHash },
    panorama: { statusId: status.id, statusHash: status.revisionHash, versionId: version.id, version: version.version, revisionHash: version.revisionHash, confirmedAt: version.confirmedAt, snapshot },
    products: products.map(product => ({ id: product.id, revisionHash: product.revisionHash })), tags: tags.map(tag => ({ id: tag.id, revisionHash: tag.revisionHash })),
    stage: stage ? { id: stage.id, rowVersion: stage.rowVersion, revisionHash: stage.revisionHash } : null,
    downstream: stages.filter(row => row.stageType !== "market_overview").map(row => ({ id: row.id, revisionHash: row.revisionHash })), asOf, stats };
  return DevelopmentMarketSourceSchema.parse({ ...body, sourceHash: digest(body) });
}
