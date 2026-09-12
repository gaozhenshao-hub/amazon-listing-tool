import { and, eq } from "drizzle-orm";
import { opsAdMcpCampaignDailyFacts, opsAdMcpFactRevisions, opsAdMcpProductDailyFacts, opsAdMcpProfiles, opsExternalSyncBatches, opsExternalSyncConfirmations, opsExternalSyncRows } from "../../../drizzle/schema";
import { assertAdMcpAutoApplyIntegrity, type AdMcpFactDomain } from "./adMcpFacts";

type RecordValue = Record<string, unknown>;
type AdMcpBatch = { id: number; status: string; dataDomain: string; scope: unknown; summary: unknown };
type AdMcpRow = { id: number; entityKey: string; validationErrors: unknown; normalizedData: unknown; sourceData: unknown };

const object = (input: unknown): RecordValue => input && typeof input === "object" && !Array.isArray(input) ? input as RecordValue : {};
const text = (input: unknown): string => input === null || input === undefined ? "" : String(input).trim();
const value = (input: unknown): number => {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
};
const nullableNumber = (input: unknown): number | null => {
  if (input === null || input === undefined || text(input) === "") return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
};
const nullableDecimal = (input: unknown): string | null => text(input) || null;

function profilePatch(data: RecordValue, input: { workspaceId: number; batchId: number }) {
  return {
    workspaceId: input.workspaceId,
    profileId: text(data.profileId),
    sourceStoreId: text(data.sourceStoreId),
    country: text(data.country),
    storeName: text(data.storeName) || null,
    profileName: text(data.profileName) || null,
    status: "active",
    sourceBatchId: input.batchId,
    sourceRowHash: text(data.sourceRowHash),
    metadata: { source: "lingxing_mcp_ad", profileId: text(data.profileId), sourceStoreId: text(data.sourceStoreId), country: text(data.country) },
    isActive: 1,
  };
}

async function upsertProfile(db: any, data: RecordValue, input: { workspaceId: number; batchId: number }) {
  const patch = profilePatch(data, input);
  const [current] = await db.select().from(opsAdMcpProfiles).where(and(
    eq(opsAdMcpProfiles.workspaceId, input.workspaceId),
    eq(opsAdMcpProfiles.profileId, patch.profileId),
  )).limit(1);
  if (current) {
    await db.update(opsAdMcpProfiles).set(patch).where(and(
      eq(opsAdMcpProfiles.workspaceId, input.workspaceId),
      eq(opsAdMcpProfiles.id, current.id),
    ));
    return current.id;
  }
  const [created] = await db.insert(opsAdMcpProfiles).values(patch).$returningId();
  return created.id;
}

function campaignPatch(data: RecordValue, input: { workspaceId: number; userId: number; batchId: number }) {
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    profileId: text(data.profileId),
    sourceStoreId: text(data.sourceStoreId),
    country: text(data.country),
    reportDate: text(data.reportDate),
    adType: text(data.adType),
    campaignId: text(data.campaignId),
    campaignName: text(data.campaignName) || null,
    campaignStatus: text(data.campaignStatus) || null,
    biddingStrategy: text(data.biddingStrategy) || null,
    budget: text(data.budget) || null,
    currency: text(data.currency) || null,
    impressions: nullableNumber(data.impressions),
    clicks: nullableNumber(data.clicks),
    spend: nullableDecimal(data.spend),
    sales: nullableDecimal(data.sales),
    orders: nullableNumber(data.orders),
    sourceBatchId: input.batchId,
    sourceRowHash: text(data.sourceRowHash),
    sourcePayloadHash: text(data.sourcePayloadHash),
  };
}

function productPatch(data: RecordValue, input: { workspaceId: number; userId: number; batchId: number }) {
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    profileId: text(data.profileId),
    sourceStoreId: text(data.sourceStoreId),
    country: text(data.country),
    reportDate: text(data.reportDate),
    adType: text(data.adType),
    campaignId: text(data.campaignId),
    campaignName: text(data.campaignName) || null,
    adGroupId: text(data.adGroupId),
    adGroupName: text(data.adGroupName) || null,
    adId: text(data.adId),
    advertisedAsin: text(data.advertisedAsin),
    advertisedSku: text(data.advertisedSku) || null,
    creativeSku: text(data.creativeSku) || null,
    creativeResolvedAsin: text(data.creativeResolvedAsin) || null,
    parentAsin: text(data.parentAsin),
    mappingStatus: text(data.mappingStatus),
    mappingEvidenceDate: text(data.mappingEvidenceDate) || null,
    mappingEvidenceKind: text(data.mappingEvidenceKind),
    currency: text(data.currency) || null,
    impressions: value(data.impressions),
    clicks: value(data.clicks),
    spend: text(data.spend),
    sales: text(data.sales),
    orders: value(data.orders),
    sourceBatchId: input.batchId,
    sourceRowHash: text(data.sourceRowHash),
    sourcePayloadHash: text(data.sourcePayloadHash),
  };
}

async function appendRevision(db: any, input: { workspaceId: number; factType: "campaign" | "product"; factId: number; batchId: number; previousHash: string | null; nextHash: string; changedFields: string[] }) {
  await db.insert(opsAdMcpFactRevisions).values({
    workspaceId: input.workspaceId,
    factType: input.factType,
    factId: input.factId,
    sourceBatchId: input.batchId,
    previousSourcePayloadHash: input.previousHash,
    nextSourcePayloadHash: input.nextHash,
    changedFields: input.changedFields,
  });
}

async function applyCampaignFact(db: any, data: RecordValue, input: { workspaceId: number; userId: number; batchId: number }) {
  const patch = campaignPatch(data, input);
  const [current] = await db.select().from(opsAdMcpCampaignDailyFacts).where(and(
    eq(opsAdMcpCampaignDailyFacts.workspaceId, input.workspaceId), eq(opsAdMcpCampaignDailyFacts.profileId, patch.profileId),
    eq(opsAdMcpCampaignDailyFacts.reportDate, patch.reportDate), eq(opsAdMcpCampaignDailyFacts.adType, patch.adType), eq(opsAdMcpCampaignDailyFacts.campaignId, patch.campaignId),
  )).limit(1);
  if (!current) {
    const [created] = await db.insert(opsAdMcpCampaignDailyFacts).values({ ...patch, version: 1 }).$returningId();
    await appendRevision(db, { workspaceId: input.workspaceId, factType: "campaign", factId: created.id, batchId: input.batchId, previousHash: null, nextHash: patch.sourcePayloadHash, changedFields: ["created"] });
    return "inserted" as const;
  }
  if (current.sourcePayloadHash === patch.sourcePayloadHash) return "unchanged" as const;
  const changedFields = ["campaignName", "campaignStatus", "biddingStrategy", "budget", "impressions", "clicks", "spend", "sales", "orders"];
  await db.update(opsAdMcpCampaignDailyFacts).set({ ...patch, version: current.version + 1 }).where(eq(opsAdMcpCampaignDailyFacts.id, current.id));
  await appendRevision(db, { workspaceId: input.workspaceId, factType: "campaign", factId: current.id, batchId: input.batchId, previousHash: current.sourcePayloadHash, nextHash: patch.sourcePayloadHash, changedFields });
  return "revised" as const;
}

async function applyProductFact(db: any, data: RecordValue, input: { workspaceId: number; userId: number; batchId: number }) {
  const patch = productPatch(data, input);
  const [current] = await db.select().from(opsAdMcpProductDailyFacts).where(and(
    eq(opsAdMcpProductDailyFacts.workspaceId, input.workspaceId), eq(opsAdMcpProductDailyFacts.profileId, patch.profileId),
    eq(opsAdMcpProductDailyFacts.reportDate, patch.reportDate), eq(opsAdMcpProductDailyFacts.adType, patch.adType),
    eq(opsAdMcpProductDailyFacts.campaignId, patch.campaignId), eq(opsAdMcpProductDailyFacts.adGroupId, patch.adGroupId),
    eq(opsAdMcpProductDailyFacts.adId, patch.adId), eq(opsAdMcpProductDailyFacts.advertisedAsin, patch.advertisedAsin),
  )).limit(1);
  if (!current) {
    const [created] = await db.insert(opsAdMcpProductDailyFacts).values({ ...patch, version: 1 }).$returningId();
    await appendRevision(db, { workspaceId: input.workspaceId, factType: "product", factId: created.id, batchId: input.batchId, previousHash: null, nextHash: patch.sourcePayloadHash, changedFields: ["created"] });
    return "inserted" as const;
  }
  if (current.sourcePayloadHash === patch.sourcePayloadHash) return "unchanged" as const;
  const changedFields = ["parentAsin", "mappingStatus", "campaignName", "adGroupName", "impressions", "clicks", "spend", "sales", "orders"];
  await db.update(opsAdMcpProductDailyFacts).set({ ...patch, version: current.version + 1 }).where(eq(opsAdMcpProductDailyFacts.id, current.id));
  await appendRevision(db, { workspaceId: input.workspaceId, factType: "product", factId: current.id, batchId: input.batchId, previousHash: current.sourcePayloadHash, nextHash: patch.sourcePayloadHash, changedFields });
  return "revised" as const;
}

export async function applyConfirmedAdMcpFacts(db: any, input: { batch: AdMcpBatch; rows: AdMcpRow[]; workspaceId: number; userId: number; note?: string }) {
  if (input.batch.dataDomain !== "ad_campaign_mcp" && input.batch.dataDomain !== "ad_product_mcp") throw new Error("该批次不是广告MCP活动或商品事实批次");
  const domain = input.batch.dataDomain as AdMcpFactDomain;
  const scope = object(input.batch.scope);
  const selectedRows = input.rows.filter((row) => !Array.isArray(row.validationErrors) || row.validationErrors.length === 0);
  assertAdMcpAutoApplyIntegrity({
    status: input.batch.status,
    summary: input.batch.summary,
    rows: selectedRows,
    scope: { startDate: text(scope.startDate), endDate: text(scope.endDate) },
    domain,
  });
  const execute = async (tx: any) => {
    let insertedRows = 0;
    let revisedRows = 0;
    let unchangedRows = 0;
    const profileIds = new Set<string>();
    for (const row of selectedRows) {
      const data = object(row.normalizedData);
      if (!profileIds.has(text(data.profileId))) {
        await upsertProfile(tx, data, { workspaceId: input.workspaceId, batchId: input.batch.id });
        profileIds.add(text(data.profileId));
      }
      const outcome = domain === "ad_campaign_mcp"
        ? await applyCampaignFact(tx, data, { workspaceId: input.workspaceId, userId: input.userId, batchId: input.batch.id })
        : await applyProductFact(tx, data, { workspaceId: input.workspaceId, userId: input.userId, batchId: input.batch.id });
      if (outcome === "inserted") insertedRows += 1;
      if (outcome === "revised") revisedRows += 1;
      if (outcome === "unchanged") unchangedRows += 1;
      await tx.update(opsExternalSyncRows).set({ rowStatus: "applied", selected: 1, appliedAt: new Date() }).where(eq(opsExternalSyncRows.id, row.id));
    }
    await tx.insert(opsExternalSyncConfirmations).values({ workspaceId: input.workspaceId, batchId: input.batch.id, userId: input.userId, action: "apply", selectedRowIds: selectedRows.map((row) => row.id), note: input.note || "广告MCP完整性校验通过后应用独立日事实" });
    await tx.update(opsExternalSyncBatches).set({
      status: "applied", appliedAt: new Date(), appliedBy: input.userId, errorMessage: null,
      summary: { ...object(input.batch.summary), autoApplied: true, writePolicy: "validated_ad_mcp_auto_apply", appliedRows: insertedRows + revisedRows, insertedRows, revisedRows, skippedRows: unchangedRows },
    }).where(and(eq(opsExternalSyncBatches.id, input.batch.id), eq(opsExternalSyncBatches.workspaceId, input.workspaceId)));
    return { success: true, batchId: input.batch.id, importedRows: insertedRows + revisedRows, revisedRows, skippedRows: unchangedRows };
  };
  return typeof db.transaction === "function" ? db.transaction((tx: any) => execute(tx)) : execute(db);
}
