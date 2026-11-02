import { createHash } from "node:crypto";

export const AD_MCP_MAX_PAGES_PER_PROFILE = 100;
export const AD_MCP_MAX_ROWS_PER_PROFILE = 20_000;
export const AD_MCP_PAGE_SIZE = 200;
export const AD_MCP_PARENT_ASIN_LOOKBACK_DAYS = 90;
export const AD_MCP_VALIDATOR_VERSION = "ad_mcp_p1_2026_09_12_r2";

export type AdMcpFactDomain = "ad_campaign_mcp" | "ad_product_mcp";
export type RecordValue = Record<string, unknown>;
export type ParentAsinMappingStatus =
  | "exact_asin_same_day"
  | "exact_asin_prior_evidence"
  | "exact_sku"
  | "manual_confirmed"
  | "unmapped";

export type AdMcpProfile = {
  profileId: string;
  sourceStoreId: string;
  country: string;
  storeName: string | null;
  profileName: string | null;
  status: string;
  sourceRowHash: string;
  metadata: RecordValue;
};

export type AdMcpCampaignInput = {
  profileId: string;
  sourceStoreId: string;
  country: string;
  reportDate: string;
  adType: string;
  campaignId: string;
  campaignName: string | null;
  campaignStatus: string | null;
  biddingStrategy: string | null;
  budget: string | null;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  spend: string | null;
  sales: string | null;
  orders: number | null;
  sourceRowHash: string;
  sourcePayloadHash: string;
  validationErrors: string[];
};

export type AdMcpProductInput = {
  profileId: string;
  sourceStoreId: string;
  country: string;
  reportDate: string;
  adType: string;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  adId: string;
  advertisedAsin: string;
  advertisedSku: string | null;
  creativeSku: string | null;
  creativeResolvedAsin: string | null;
  currency: string | null;
  impressions: number;
  clicks: number;
  spend: string;
  sales: string;
  orders: number;
  sourceRowHash: string;
  sourcePayloadHash: string;
  validationErrors: string[];
};

export type AsinMappingEvidence = {
  sourceStoreId: string | null;
  country: string | null;
  asin: string | null;
  sku: string | null;
  parentAsin: string | null;
  reportDate: string | null;
};

export type ResolvedParentAsinMapping = {
  parentAsin: string | null;
  status: ParentAsinMappingStatus;
  evidenceDate: string | null;
  evidenceKind: string;
};

export type AdMcpBatchIntegrityInput = {
  status: string;
  summary: unknown;
  rows: Array<{ entityKey: string; validationErrors: unknown; normalizedData: unknown }>;
  scope: { startDate: string; endDate: string };
  domain: AdMcpFactDomain;
};

/**
 * 批次摘要仅保存稳定类别和计数，绝不保存原始验证消息或源报告字段。
 * 这样生产审计可将批次与规则版本对应，同时不扩大业务数据暴露面。
 */
export function summarizeAdMcpValidationErrors(validationErrors: unknown): Record<string, number> {
  const errors = Array.isArray(validationErrors) ? validationErrors : [];
  const counts = new Map<string, number>();
  for (const error of errors) {
    const message = text(error);
    const category = message.includes("Profile与授权目录不一致") ? "profile_mismatch"
      : message.includes("店铺SID与授权Profile不一致") ? "sid_mismatch"
      : message.includes("站点与授权Profile不一致") ? "marketplace_mismatch"
      : message.includes("缺少Campaign") || message.includes("缺少广告组") || message.includes("缺少广告ID") ? "entity_identity_missing"
      : message.includes("广告类型") ? "unsupported_ad_type"
      : message.includes("广告报告日期") ? "report_date_invalid"
      : message.includes("父ASIN") || message.includes("ASIN") ? "product_mapping_error"
      : "other_validation_error";
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * 预览阶段的异常仅允许以固定运行前置类别返回。
 * 禁止将错误正文、请求URL、源端响应或任何业务字段放入批次摘要或tRPC响应。
 */
export type AdMcpPreviewFailureCategory =
  | "oauth_not_configured"
  | "database_unavailable"
  | "lingxing_request_failed"
  | "request_timeout"
  | "unknown";

export function classifyAdMcpPreviewFailure(error: unknown): AdMcpPreviewFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/oauth.*(not configured|missing)|未配置.*oauth/.test(message)) return "oauth_not_configured";
  if (/数据库不可用|database.*unavailable|db.*unavailable/.test(message)) return "database_unavailable";
  if (/timeout|timed out|aborterror|aborted|超时/.test(message)) return "request_timeout";
  if (/lingxing|领星|mcp|emperor tool/.test(message)) return "lingxing_request_failed";
  return "unknown";
}

function record(input: unknown): RecordValue {
  return input && typeof input === "object" && !Array.isArray(input) ? input as RecordValue : {};
}

function text(input: unknown): string {
  return input === null || input === undefined ? "" : String(input).trim();
}

function first(recordInput: RecordValue, keys: string[]): string {
  for (const key of keys) {
    const candidate = text(recordInput[key]);
    if (candidate) return candidate;
  }
  return "";
}

function nested(recordInput: RecordValue, path: string[]): string {
  let current: unknown = recordInput;
  for (const key of path) current = record(current)[key];
  return text(current);
}

function isNotProvided(input: unknown): boolean {
  const value = text(input).toLowerCase();
  return !value || value === "--" || value === "-" || value === "99999999" || value === "n/a" || value === "null";
}

function decimal(input: unknown): string | null {
  if (isNotProvided(input)) return null;
  const normalized = text(input).replace(/[$,%\s,]/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
}

function count(input: unknown): number | null {
  if (isNotProvided(input)) return null;
  const normalized = text(input).replace(/[,%\s,]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : null;
}

function hash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function validAsin(input: string): boolean {
  return /^[A-Z0-9]{10}$/.test(input);
}

function isoDate(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

export function normalizeAdMarketplace(input: unknown): string {
  const country = text(input).toUpperCase();
  if (country === "美国" || country === "US" || country.includes("US")) return "US";
  return country;
}

export function normalizeAdType(input: unknown): string {
  const adType = text(input).toUpperCase();
  return adType === "SP" || adType === "SB" || adType === "SD" ? adType : adType;
}

/** P1可写入的广告活动类型；产品KPI仍只由广告商品事实提供。 */
export const AD_MCP_SUPPORTED_CAMPAIGN_TYPES = ["SP", "SB", "SD"] as const;
/** 已知但不在P1活动事实范围内的来源类型，只能跳过，不能自动归类或写入。 */
export const AD_MCP_OUT_OF_SCOPE_CAMPAIGN_TYPES = ["HSA", "VD"] as const;

export function isAdMcpCampaignTypeOutOfScope(input: unknown): boolean {
  const adType = normalizeAdType(input);
  return (AD_MCP_OUT_OF_SCOPE_CAMPAIGN_TYPES as readonly string[]).includes(adType);
}

function isSupportedAdMcpCampaignType(input: unknown): boolean {
  const adType = normalizeAdType(input);
  return (AD_MCP_SUPPORTED_CAMPAIGN_TYPES as readonly string[]).includes(adType);
}

function requiredCount(source: RecordValue, aliases: string[], label: string, errors: string[]): number {
  const value = count(first(source, aliases));
  if (value === null) errors.push(`${label}缺失、非有限或为源端哨兵值，不能自动写入。`);
  return value ?? 0;
}

function requiredDecimal(source: RecordValue, aliases: string[], label: string, errors: string[]): string {
  const value = decimal(first(source, aliases));
  if (value === null) errors.push(`${label}缺失、非有限或为源端哨兵值，不能自动写入。`);
  return value ?? "0.00";
}

function optionalCount(source: RecordValue, aliases: string[]): number | null {
  return count(first(source, aliases));
}

function optionalDecimal(source: RecordValue, aliases: string[]): string | null {
  return decimal(first(source, aliases));
}

export function normalizeAdMcpProfile(source: RecordValue): { profile: AdMcpProfile | null; validationErrors: string[] } {
  const profileId = first(source, ["profile_id", "profileId", "profile", "id"]);
  const sourceStoreId = first(source, ["sid", "shop_id", "shopId"]);
  const country = normalizeAdMarketplace(first(source, ["country", "store_country", "site", "marketplace"]));
  const validationErrors: string[] = [];
  if (!profileId) validationErrors.push("广告授权目录缺少Profile ID。");
  if (!sourceStoreId) validationErrors.push("广告授权目录缺少领星SID。");
  if (!country) validationErrors.push("广告授权目录缺少站点。");
  if (validationErrors.length) return { profile: null, validationErrors };
  return {
    profile: {
      profileId,
      sourceStoreId,
      country,
      storeName: first(source, ["alias", "shop_name", "shopName", "store_name", "seller_name"]) || null,
      profileName: first(source, ["profile_name", "profileName", "name"]) || null,
      status: first(source, ["status", "state"]) || "active",
      sourceRowHash: first(source, ["entity_level_hash", "row_hash"]) || hash(source),
      metadata: source,
    },
    validationErrors,
  };
}

export function isAdMcpAggregateRow(domain: AdMcpFactDomain, source: RecordValue): boolean {
  const profileId = first(source, ["profile_id", "profileId", "profile"]);
  const campaignId = first(source, ["campaign_id", "campaignId"]);
  if (!profileId || !campaignId) return true;
  if (domain === "ad_product_mcp") {
    return !first(source, ["ad_group_id", "adGroupId"]) || !first(source, ["ad_id", "adId", "entity_id"]) || !first(source, ["asin", "advertised_asin", "advertisedAsin"]);
  }
  return false;
}

export function normalizeAdMcpCampaign(source: RecordValue, profile: AdMcpProfile, reportDate: string): AdMcpCampaignInput {
  const validationErrors: string[] = [];
  const sourceProfileId = first(source, ["profile_id", "profileId", "profile"]);
  // 广告活动报告的store_id/storeId可能是广告账户内部标识，而不是领星SID。
  // 只有源行明确提供sid时才可与授权目录SID作确定性比对。
  const sourceSid = first(source, ["sid", "lingxing_sid", "lingxingSid"]);
  const sourceCountry = normalizeAdMarketplace(first(source, ["store_country", "country", "site", "marketplace"]));
  const campaignId = first(source, ["campaign_id", "campaignId"]);
  const adType = normalizeAdType(first(source, ["sponsored_type", "ad_type", "adType"]));
  if (!isoDate(reportDate)) validationErrors.push("广告报告日期必须为单日ISO日期。");
  if (!sourceProfileId || sourceProfileId !== profile.profileId) validationErrors.push("广告活动行Profile与授权目录不一致。");
  if (sourceSid && sourceSid !== profile.sourceStoreId) validationErrors.push("广告活动行店铺SID与授权Profile不一致。");
  if (sourceCountry && sourceCountry !== profile.country) validationErrors.push("广告活动行站点与授权Profile不一致。");
  if (!campaignId) validationErrors.push("广告活动行缺少Campaign ID，疑似总计行或无效行。");
  if (!adType || (!isSupportedAdMcpCampaignType(adType) && !isAdMcpCampaignTypeOutOfScope(adType))) {
    validationErrors.push("广告活动行广告类型不属于本期支持或可安全跳过范围。");
  }
  const result: AdMcpCampaignInput = {
    profileId: profile.profileId,
    sourceStoreId: profile.sourceStoreId,
    country: profile.country,
    reportDate,
    adType,
    campaignId,
    campaignName: first(source, ["name", "campaign_name", "campaignName"]) || null,
    campaignStatus: first(source, ["state", "campaign_state", "service_status", "serving_status"]) || null,
    biddingStrategy: first(source, ["bidding_strategy", "bid_strategy"]) || null,
    budget: decimal(first(source, ["daily_budget", "budget"])) || null,
    currency: first(source, ["currency", "currency_code"]) || null,
    // 活动事实只为产品详情补充状态和预算，产品KPI仅来自广告商品事实。
    // 源端未提供的活动表现指标必须保持为空，不能伪造成0或阻断有效元数据。
    impressions: optionalCount(source, ["impressions"]),
    clicks: optionalCount(source, ["clicks"]),
    spend: optionalDecimal(source, ["spends", "spend"]),
    sales: optionalDecimal(source, ["sales", "ad_sales"]),
    orders: optionalCount(source, ["orders", "ad_orders"]),
    sourceRowHash: first(source, ["entity_level_hash", "row_hash"]) || hash({ profileId: profile.profileId, reportDate, adType, campaignId }),
    sourcePayloadHash: hash(source),
    validationErrors,
  };
  return result;
}

export function normalizeAdMcpProduct(source: RecordValue, profile: AdMcpProfile, reportDate: string): AdMcpProductInput {
  const validationErrors: string[] = [];
  const sourceProfileId = first(source, ["profile_id", "profileId", "profile"]);
  const sourceStoreId = first(source, ["sid", "store_id", "storeId"]);
  const sourceCountry = normalizeAdMarketplace(first(source, ["store_country", "country", "site", "marketplace"]));
  const campaignId = first(source, ["campaign_id", "campaignId"]);
  const adGroupId = first(source, ["ad_group_id", "adGroupId"]);
  const adId = first(source, ["ad_id", "adId", "entity_id"]);
  const advertisedAsin = first(source, ["asin", "advertised_asin", "advertisedAsin"]).toUpperCase();
  const creativeSku = nested(source, ["creative", "productCreative", "productCreativeSettings", "advertisedProduct", "productId"])
    || nested(source, ["creative", "product_creative", "product_creative_settings", "advertised_product", "product_id"]);
  const creativeResolvedAsin = (nested(source, ["creative", "productCreative", "productCreativeSettings", "advertisedProduct", "resolvedProductId"])
    || nested(source, ["creative", "product_creative", "product_creative_settings", "advertised_product", "resolved_product_id"])).toUpperCase();
  const adType = normalizeAdType(first(source, ["sponsored_type", "ad_type", "adType"]));
  if (!isoDate(reportDate)) validationErrors.push("广告报告日期必须为单日ISO日期。");
  if (!sourceProfileId || sourceProfileId !== profile.profileId) validationErrors.push("广告商品行Profile与授权目录不一致。");
  if (sourceStoreId && sourceStoreId !== profile.sourceStoreId) validationErrors.push("广告商品行店铺与授权Profile不一致。");
  if (sourceCountry && sourceCountry !== profile.country) validationErrors.push("广告商品行站点与授权Profile不一致。");
  if (!campaignId || !adGroupId || !adId) validationErrors.push("广告商品行缺少Campaign、广告组或广告ID，疑似总计行或无效行。");
  if (!validAsin(advertisedAsin)) validationErrors.push("广告商品行缺少有效广告ASIN，不能自动关联父ASIN。");
  if (creativeResolvedAsin && creativeResolvedAsin !== advertisedAsin) validationErrors.push("广告商品ASIN与创意解析ASIN不一致，需人工复核。");
  if (!adType || !["SP", "SB", "SD"].includes(adType)) validationErrors.push("广告商品行广告类型不是SP、SB或SD。");
  return {
    profileId: profile.profileId,
    sourceStoreId: profile.sourceStoreId,
    country: profile.country,
    reportDate,
    adType,
    campaignId,
    campaignName: first(source, ["campaign_name", "campaignName", "name"]) || null,
    adGroupId,
    adGroupName: first(source, ["ad_group_name", "adGroupName", "ad_group"]) || null,
    adId,
    advertisedAsin,
    advertisedSku: first(source, ["sku", "advertised_sku", "advertisedSku"]) || null,
    creativeSku: creativeSku || null,
    creativeResolvedAsin: creativeResolvedAsin || null,
    currency: first(source, ["currency", "currency_code"]) || null,
    impressions: requiredCount(source, ["impressions"], "广告商品曝光", validationErrors),
    clicks: requiredCount(source, ["clicks"], "广告商品点击", validationErrors),
    spend: requiredDecimal(source, ["spends", "spend"], "广告商品花费", validationErrors),
    sales: requiredDecimal(source, ["sales", "ad_sales"], "广告商品销售额", validationErrors),
    orders: requiredCount(source, ["orders", "ad_orders"], "广告商品订单", validationErrors),
    sourceRowHash: first(source, ["entity_level_hash", "row_hash"]) || hash({ profileId: profile.profileId, reportDate, adType, campaignId, adGroupId, adId, advertisedAsin }),
    sourcePayloadHash: hash(source),
    validationErrors,
  };
}

function daysBetween(laterDate: string, earlierDate: string): number {
  return Math.floor((Date.parse(`${laterDate}T00:00:00Z`) - Date.parse(`${earlierDate}T00:00:00Z`)) / 86_400_000);
}

export function resolveParentAsinMapping(input: { sourceStoreId: string; country: string; advertisedAsin: string; advertisedSku?: string | null; reportDate: string; evidence: AsinMappingEvidence[] }): ResolvedParentAsinMapping {
  const scoped = input.evidence.filter((item) =>
    text(item.sourceStoreId) === input.sourceStoreId
    && normalizeAdMarketplace(item.country) === input.country
    && text(item.parentAsin)
    && isoDate(text(item.reportDate)),
  );
  const byAsin = scoped.filter((item) => text(item.asin).toUpperCase() === input.advertisedAsin);
  const sameDayParents = [...new Set(byAsin.filter((item) => item.reportDate === input.reportDate).map((item) => text(item.parentAsin).toUpperCase()))];
  if (sameDayParents.length === 1) return { parentAsin: sameDayParents[0], status: "exact_asin_same_day", evidenceDate: input.reportDate, evidenceKind: "asin_same_day" };
  if (sameDayParents.length > 1) return { parentAsin: null, status: "unmapped", evidenceDate: input.reportDate, evidenceKind: "asin_same_day_multiple_parent" };
  const previous = byAsin
    .filter((item) => item.reportDate && item.reportDate <= input.reportDate && daysBetween(input.reportDate, item.reportDate) <= AD_MCP_PARENT_ASIN_LOOKBACK_DAYS)
    .sort((left, right) => text(right.reportDate).localeCompare(text(left.reportDate)));
  const latestDate = previous[0]?.reportDate || null;
  const previousParents = [...new Set(previous.filter((item) => item.reportDate === latestDate).map((item) => text(item.parentAsin).toUpperCase()))];
  if (previousParents.length === 1 && latestDate) return { parentAsin: previousParents[0], status: "exact_asin_prior_evidence", evidenceDate: latestDate, evidenceKind: "asin_prior_evidence" };
  if (!input.advertisedAsin && input.advertisedSku) {
    const skuParents = [...new Set(scoped.filter((item) => text(item.sku) === input.advertisedSku).map((item) => text(item.parentAsin).toUpperCase()))];
    if (skuParents.length === 1) return { parentAsin: skuParents[0], status: "exact_sku", evidenceDate: null, evidenceKind: "sku_unique_evidence" };
  }
  return { parentAsin: null, status: "unmapped", evidenceDate: null, evidenceKind: "no_unique_asin_evidence" };
}

export function assertAdMcpAutoApplyIntegrity(input: AdMcpBatchIntegrityInput) {
  const summary = record(input.summary);
  const label = input.domain === "ad_product_mcp" ? "广告商品" : "广告活动";
  if (!["ready_for_review", "confirmed"].includes(input.status)) throw new Error(`${label}自动应用校验未通过：草稿批次不处于待确认或已确认状态`);
  if (input.scope.startDate !== input.scope.endDate || !isoDate(input.scope.startDate)) throw new Error(`${label}自动应用校验未通过：每日计划必须覆盖单一报告日`);
  if (Boolean(summary.capped) || Number(summary.pageTruncations || 0) > 0) throw new Error(`${label}自动应用校验未通过：读取存在分页或行数截断`);
  if (Array.isArray(summary.failedProfileDateWindows) && summary.failedProfileDateWindows.length) throw new Error(`${label}自动应用校验未通过：存在Profile读取失败窗口`);
  if (Array.isArray(summary.profileDirectoryValidationErrors) && summary.profileDirectoryValidationErrors.length) throw new Error(`${label}自动应用校验未通过：广告授权目录存在无效Profile`);
  if (Number(summary.profileDirectoryDuplicateCount || 0) > 0) throw new Error(`${label}自动应用校验未通过：广告Profile映射到多个店铺或站点`);
  if (Number(summary.profilesExpected || 0) < 1 || Number(summary.profilesExpected) !== Number(summary.profilesRead || 0)) throw new Error(`${label}自动应用校验未通过：授权Profile覆盖不完整`);
  if (Number(summary.profileDateWindowsExpected || 0) !== Number(summary.profileDateWindowsRead || 0)) throw new Error(`${label}自动应用校验未通过：Profile报告日窗口覆盖不完整`);
  if (!input.rows.length) throw new Error(`${label}自动应用校验未通过：不存在可应用的广告实体行`);
  const identities = new Set<string>();
  for (const row of input.rows) {
    if (!row.entityKey || identities.has(row.entityKey)) throw new Error(`${label}自动应用校验未通过：存在重复或缺失的广告实体身份`);
    identities.add(row.entityKey);
    if (Array.isArray(row.validationErrors) && row.validationErrors.length) throw new Error(`${label}自动应用校验未通过：草稿包含字段或映射异常`);
    const data = record(row.normalizedData);
    if (text(data.reportDate) !== input.scope.startDate || !text(data.profileId) || !text(data.campaignId) || !text(data.adType)) throw new Error(`${label}自动应用校验未通过：存在缺失Profile、活动、广告类型或报告日的草稿行`);
    if (input.domain === "ad_product_mcp") {
      for (const key of ["impressions", "clicks", "spend", "sales", "orders"]) {
        const value = Number(data[key]);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${label}自动应用校验未通过：${key}存在无效或负数指标`);
      }
      if (!text(data.adGroupId) || !text(data.adId) || !text(data.advertisedAsin) || !text(data.parentAsin)) throw new Error("广告商品自动应用校验未通过：存在缺失广告实体、子ASIN或父ASIN映射的草稿行");
      if (!["exact_asin_same_day", "exact_asin_prior_evidence", "exact_sku", "manual_confirmed"].includes(text(data.mappingStatus))) throw new Error("广告商品自动应用校验未通过：存在非精确父ASIN映射草稿行");
    }
  }
}
