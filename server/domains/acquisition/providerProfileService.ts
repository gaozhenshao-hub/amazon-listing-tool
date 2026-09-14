import { and, desc, eq } from "drizzle-orm";
import { acquisitionProviderProfiles } from "../../../drizzle/schema/acquisition";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  AcquisitionBudgetPolicySchema,
  DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
  type AcquisitionBudgetPolicy,
} from "./policy";

export const DEFAULT_APIFY_PROFILE_KEY = "apify-amazon-primary";
export const APIFY_PROVIDER_CODE = "apify.junglee.amazon_crawler";

export async function defaultApifyProviderProfileView() {
  return {
    id: null,
    profileKey: DEFAULT_APIFY_PROFILE_KEY,
    providerCode: APIFY_PROVIDER_CODE,
    displayName: "Apify Amazon主Provider",
    status: "qualification_pending" as const,
    actorName: "junglee/Amazon-crawler",
    capabilities: ["catalog_basic", "image_gallery", "aplus", "brand_story", "listing_content"],
    perRunMaxUsd: 0.1,
    dailyBudgetUsd: 5,
    monthlyBudgetUsd: 100,
    cacheTtlSeconds: DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
    qualificationVersion: "apify-junglee-us-gallery-2026-09-13-r1",
    lastQualifiedAt: null,
    secretConfigured: await isApiConnectionSecretConfigured("apify", "api_token"),
    createdAt: null,
    updatedAt: null,
  };
}

export type ApifyProviderProfileInput = AcquisitionBudgetPolicy & {
  displayName: string;
  actorName: string;
  status: "qualification_pending" | "active" | "paused" | "rejected";
  capabilities: string[];
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function sanitizeProviderProfile(row: typeof acquisitionProviderProfiles.$inferSelect) {
  return {
    id: row.id,
    profileKey: row.profileKey,
    providerCode: row.providerCode,
    displayName: row.displayName,
    status: row.status,
    actorName: row.actorName,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    perRunMaxUsd: toNumber(row.perRunMaxUsd),
    dailyBudgetUsd: toNumber(row.dailyBudgetUsd),
    monthlyBudgetUsd: toNumber(row.monthlyBudgetUsd),
    cacheTtlSeconds: row.cacheTtlSeconds,
    qualificationVersion: row.qualificationVersion,
    lastQualifiedAt: row.lastQualifiedAt,
    secretConfigured: await isApiConnectionSecretConfigured("apify", "api_token"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getApifyProviderProfile(db: DbExecutor, workspaceId: number) {
  const rows = await db.select()
    .from(acquisitionProviderProfiles)
    .where(and(
      eq(acquisitionProviderProfiles.workspaceId, workspaceId),
      eq(acquisitionProviderProfiles.profileKey, DEFAULT_APIFY_PROFILE_KEY),
    ))
    .orderBy(desc(acquisitionProviderProfiles.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertApifyProviderProfile(input: {
  db: DbExecutor;
  workspaceId: number;
  userId: number;
  profile: ApifyProviderProfileInput;
}) {
  const budget = AcquisitionBudgetPolicySchema.parse(input.profile);
  const values = {
    workspaceId: input.workspaceId,
    profileKey: DEFAULT_APIFY_PROFILE_KEY,
    providerCode: APIFY_PROVIDER_CODE,
    displayName: input.profile.displayName.trim(),
    status: input.profile.status,
    secretRef: "secret://integration.apify.api_token",
    actorName: input.profile.actorName.trim(),
    capabilities: input.profile.capabilities,
    providerSettings: {
      proxyCountry: "US",
      maxItems: 1,
      maxOffers: 0,
      scrapeSellers: false,
    },
    perRunMaxUsd: budget.perRunMaxUsd.toFixed(4),
    dailyBudgetUsd: budget.dailyBudgetUsd.toFixed(4),
    monthlyBudgetUsd: budget.monthlyBudgetUsd.toFixed(4),
    cacheTtlSeconds: budget.cacheTtlSeconds || DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
    qualificationVersion: "apify-junglee-us-gallery-2026-09-13-r1",
    lastQualifiedAt: new Date(),
    createdBy: input.userId,
    updatedBy: input.userId,
  };

  await input.db.insert(acquisitionProviderProfiles)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        providerCode: values.providerCode,
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
        lastQualifiedAt: values.lastQualifiedAt,
        updatedBy: values.updatedBy,
      },
    });
  const row = await getApifyProviderProfile(input.db, input.workspaceId);
  if (!row) throw new Error("Provider profile was not persisted");
  return sanitizeProviderProfile(row);
}
