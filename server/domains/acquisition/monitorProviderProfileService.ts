import { and, desc, eq } from "drizzle-orm";
import { acquisitionProviderProfiles } from "../../../drizzle/schema/acquisition";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";
import type { DbExecutor } from "../../repositories/dbClient";
import { AcquisitionBudgetPolicySchema, DEFAULT_ACQUISITION_CACHE_TTL_SECONDS } from "./policy";
import type { AmazonMonitorKind } from "./monitorProviderContracts";

export const MONITOR_PROVIDER_CANDIDATES = {
  competitor: {
    profileKey: "apify-amazon-monitor-offers-rankings",
    providerCode: "apify.calm_builder.amazon_product_scraper",
    actorName: "calm_builder/amazon-product-scraper",
    displayName: "Apify Amazon商品详情 / Offer监控",
    capabilities: ["offers", "rankings"],
    qualificationVersion: "monitor-product-offers-us-qualification-v2",
    defaultPerRunMaxUsd: 0.05,
  },
  keyword: {
    profileKey: "apify-amazon-monitor-search-rank",
    providerCode: "apify.doesaiknow.amazon_rank_tracker",
    actorName: "doesaiknow/amazon-rank-tracker",
    displayName: "Apify Amazon关键词排名监控",
    capabilities: ["search_rank"],
    qualificationVersion: "monitor-search-rank-us-qualification-v1",
    defaultPerRunMaxUsd: 0.1,
  },
} as const;

export function monitorProviderCandidate(kind: AmazonMonitorKind) {
  return MONITOR_PROVIDER_CANDIDATES[kind];
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function defaultMonitorProviderView(kind: AmazonMonitorKind) {
  const candidate = monitorProviderCandidate(kind);
  return {
    id: null,
    kind,
    ...candidate,
    status: "qualification_pending" as const,
    perRunMaxUsd: candidate.defaultPerRunMaxUsd,
    dailyBudgetUsd: 5,
    monthlyBudgetUsd: 100,
    cacheTtlSeconds: DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
    lastQualifiedAt: null,
    secretConfigured: await isApiConnectionSecretConfigured("apify", "api_token"),
    configured: false,
  };
}

export async function sanitizeMonitorProviderProfile(kind: AmazonMonitorKind, row: typeof acquisitionProviderProfiles.$inferSelect) {
  return {
    id: row.id,
    kind,
    profileKey: row.profileKey,
    providerCode: row.providerCode,
    actorName: row.actorName,
    displayName: row.displayName,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    status: row.status,
    perRunMaxUsd: numeric(row.perRunMaxUsd),
    dailyBudgetUsd: numeric(row.dailyBudgetUsd),
    monthlyBudgetUsd: numeric(row.monthlyBudgetUsd),
    cacheTtlSeconds: row.cacheTtlSeconds,
    qualificationVersion: row.qualificationVersion,
    lastQualifiedAt: row.lastQualifiedAt,
    secretConfigured: await isApiConnectionSecretConfigured("apify", "api_token"),
    configured: true,
  };
}

export async function getMonitorProviderProfile(db: DbExecutor, workspaceId: number, kind: AmazonMonitorKind) {
  const candidate = monitorProviderCandidate(kind);
  const rows = await db.select().from(acquisitionProviderProfiles).where(and(
    eq(acquisitionProviderProfiles.workspaceId, workspaceId),
    eq(acquisitionProviderProfiles.profileKey, candidate.profileKey),
  )).orderBy(desc(acquisitionProviderProfiles.id)).limit(1);
  return rows[0] ?? null;
}

export async function getQualifiedMonitorProviderProfile(db: DbExecutor, workspaceId: number, kind: AmazonMonitorKind) {
  const row = await getMonitorProviderProfile(db, workspaceId, kind);
  if (!row || row.status !== "active" || !row.lastQualifiedAt || !row.qualificationVersion) return null;
  if (!await isApiConnectionSecretConfigured("apify", "api_token")) return null;
  const candidate = monitorProviderCandidate(kind);
  const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
  if (row.providerCode !== candidate.providerCode || row.actorName !== candidate.actorName) return null;
  if (!candidate.capabilities.every(capability => capabilities.includes(capability))) return null;
  return row;
}

export async function upsertMonitorProviderCandidate(input: {
  db: DbExecutor;
  workspaceId: number;
  userId: number;
  kind: AmazonMonitorKind;
  displayName?: string;
  perRunMaxUsd: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
}) {
  const candidate = monitorProviderCandidate(input.kind);
  const budget = AcquisitionBudgetPolicySchema.parse({
    perRunMaxUsd: input.perRunMaxUsd,
    dailyBudgetUsd: input.dailyBudgetUsd,
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    cacheTtlSeconds: DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
  });
  const values = {
    workspaceId: input.workspaceId,
    profileKey: candidate.profileKey,
    providerCode: candidate.providerCode,
    displayName: input.displayName?.trim() || candidate.displayName,
    status: "qualification_pending" as const,
    secretRef: "secret://integration.apify.api_token",
    actorName: candidate.actorName,
    capabilities: [...candidate.capabilities],
    providerSettings: input.kind === "keyword"
      ? { marketplace: "com", postalCode: "10001", depth: 1, includeVolume: false }
      : { marketplace: "US", productUrlTemplate: "https://www.amazon.com/dp/{ASIN}", scrapeOffers: true, maxOffers: 10 },
    perRunMaxUsd: budget.perRunMaxUsd.toFixed(4),
    dailyBudgetUsd: budget.dailyBudgetUsd.toFixed(4),
    monthlyBudgetUsd: budget.monthlyBudgetUsd.toFixed(4),
    cacheTtlSeconds: budget.cacheTtlSeconds,
    qualificationVersion: candidate.qualificationVersion,
    lastQualifiedAt: null,
    createdBy: input.userId,
    updatedBy: input.userId,
  };
  await input.db.insert(acquisitionProviderProfiles).values(values).onDuplicateKeyUpdate({
    set: {
      displayName: values.displayName,
      status: values.status,
      secretRef: values.secretRef,
      actorName: values.actorName,
      capabilities: values.capabilities,
      providerSettings: values.providerSettings,
      perRunMaxUsd: values.perRunMaxUsd,
      dailyBudgetUsd: values.dailyBudgetUsd,
      monthlyBudgetUsd: values.monthlyBudgetUsd,
      cacheTtlSeconds: values.cacheTtlSeconds,
      qualificationVersion: values.qualificationVersion,
      lastQualifiedAt: null,
      updatedBy: values.updatedBy,
    },
  });
  const row = await getMonitorProviderProfile(input.db, input.workspaceId, input.kind);
  if (!row) throw new Error("Monitor provider profile was not persisted");
  return sanitizeMonitorProviderProfile(input.kind, row);
}

export async function markMonitorProviderQualified(input: {
  db: DbExecutor;
  workspaceId: number;
  profileId: number;
  userId: number;
  kind: AmazonMonitorKind;
}) {
  const candidate = monitorProviderCandidate(input.kind);
  await input.db.update(acquisitionProviderProfiles).set({
    status: "active",
    qualificationVersion: candidate.qualificationVersion,
    lastQualifiedAt: new Date(),
    updatedBy: input.userId,
  }).where(and(
    eq(acquisitionProviderProfiles.id, input.profileId),
    eq(acquisitionProviderProfiles.workspaceId, input.workspaceId),
    eq(acquisitionProviderProfiles.profileKey, candidate.profileKey),
  ));
}
