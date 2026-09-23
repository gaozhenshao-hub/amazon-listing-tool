import { and, desc, eq } from "drizzle-orm";
import { acquisitionProviderProfiles } from "../../../drizzle/schema/acquisition";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  AcquisitionBudgetPolicySchema,
  DEFAULT_ACQUISITION_CACHE_TTL_SECONDS,
  type AcquisitionBudgetPolicy,
} from "./policy";
import type { ProviderQualificationRecord } from "./providerContracts";

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
  const existing = await getApifyProviderProfile(input.db, input.workspaceId);
  if (input.profile.status === "active" && existing?.status !== "active") {
    throw new Error("采集Provider只能由受控资格验证成功后启用，不能在治理页面直接切换为启用");
  }
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
    qualificationVersion: existing?.qualificationVersion ?? "apify-junglee-us-gallery-2026-09-13-r1",
    lastQualifiedAt: existing?.lastQualifiedAt ?? null,
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

/**
 * Only the server-side qualification workflow may activate the primary
 * Provider. It preserves the user-configured budget while replacing the
 * capability set with the technically observed minimum and stores only
 * redacted technical evidence (never an ASIN, raw payload, URL or secret).
 */
export async function finalizeApifyProviderQualification(input: {
  db: DbExecutor;
  workspaceId: number;
  userId: number;
  profileId: number;
  record: ProviderQualificationRecord;
  jobId: number;
  runId: number;
}) {
  const profile = await getApifyProviderProfile(input.db, input.workspaceId);
  if (!profile || profile.id !== input.profileId || profile.status !== "qualification_pending") {
    throw new Error("primary Provider profile is no longer eligible for qualification finalization");
  }
  const observedCapabilities = input.record.observedCapabilities;
  if (!observedCapabilities.includes("catalog_basic") || !observedCapabilities.includes("image_gallery")) {
    throw new Error("primary Provider qualification did not observe required capabilities");
  }
  const previousSettings = profile.providerSettings && typeof profile.providerSettings === "object" && !Array.isArray(profile.providerSettings)
    ? profile.providerSettings as Record<string, unknown>
    : {};
  await input.db.update(acquisitionProviderProfiles).set({
    status: "active",
    capabilities: observedCapabilities,
    qualificationVersion: "apify-junglee-us-gallery-2026-09-23-r2",
    lastQualifiedAt: new Date(),
    providerSettings: {
      ...previousSettings,
      qualification: {
        version: "apify-junglee-us-gallery-2026-09-23-r2",
        decision: input.record.decision,
        observedCapabilities,
        checkedAt: input.record.checkedAt,
        maxObservedChargeUsd: input.record.maxObservedChargeUsd,
        jobId: input.jobId,
        runId: input.runId,
      },
    },
    updatedBy: input.userId,
  }).where(and(
    eq(acquisitionProviderProfiles.workspaceId, input.workspaceId),
    eq(acquisitionProviderProfiles.id, input.profileId),
    eq(acquisitionProviderProfiles.status, "qualification_pending"),
  ));
  const finalized = await getApifyProviderProfile(input.db, input.workspaceId);
  if (!finalized || finalized.status !== "active") {
    throw new Error("primary Provider qualification finalization did not persist");
  }
  return sanitizeProviderProfile(finalized);
}
