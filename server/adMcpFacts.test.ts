import { describe, expect, it } from "vitest";
import {
  AD_MCP_VALIDATOR_VERSION,
  assertAdMcpAutoApplyIntegrity,
  classifyAdMcpPreviewFailure,
  isAdMcpAggregateRow,
  normalizeAdMcpCampaign,
  normalizeAdMcpProfile,
  normalizeAdMcpProduct,
  resolveParentAsinMapping,
  summarizeAdMcpValidationErrors,
} from "./domains/ops/adMcpFacts";

const profileSource = {
  profile_id: "profile-us-1",
  sid: "store-us-1",
  country: "美国",
  alias: "US Store",
};

const productSource = {
  profile_id: "profile-us-1",
  store_id: "store-us-1",
  store_country: "US",
  sponsored_type: "SP",
  campaign_id: "campaign-1",
  campaign_name: "Campaign A",
  ad_group_id: "ad-group-1",
  ad_group_name: "Ad group A",
  ad_id: "ad-1",
  asin: "B0ABC12345",
  sku: "SKU-A",
  impressions: "100",
  clicks: "10",
  spends: "12.50",
  sales: "50.00",
  orders: "2",
  creative: {
    productCreative: {
      productCreativeSettings: {
        advertisedProduct: {
          productId: "SKU-A",
          resolvedProductId: "B0ABC12345",
        },
      },
    },
  },
};

describe("广告MCP事实归一化", () => {
  it("以授权Profile规范站点，并过滤没有实体键的广告商品总计行", () => {
    const parsed = normalizeAdMcpProfile(profileSource);
    expect(parsed.validationErrors).toEqual([]);
    expect(parsed.profile).toMatchObject({ profileId: "profile-us-1", sourceStoreId: "store-us-1", country: "US" });
    expect(isAdMcpAggregateRow("ad_product_mcp", { profile_id: "", campaign_id: "", impressions: "1000" })).toBe(true);
  });

  it("拒绝广告商品指标哨兵值和创意ASIN冲突，不把它们静默写成0", () => {
    const profile = normalizeAdMcpProfile(profileSource).profile!;
    const invalid = normalizeAdMcpProduct({ ...productSource, spends: "99999999", creative: { productCreative: { productCreativeSettings: { advertisedProduct: { resolvedProductId: "B0ZZZ99999" } } } } }, profile, "2026-09-07");
    expect(invalid.validationErrors.join(" ")).toContain("广告商品花费缺失");
    expect(invalid.validationErrors.join(" ")).toContain("创意解析ASIN不一致");
    expect(invalid.spend).toBe("0.00");
  });

  it("以活动实体身份规范化活动日事实，并拒绝空Campaign的总计行", () => {
    const profile = normalizeAdMcpProfile(profileSource).profile!;
    expect(isAdMcpAggregateRow("ad_campaign_mcp", { profile_id: "profile-us-1", campaign_id: "", spends: "100" })).toBe(true);
    const campaign = normalizeAdMcpCampaign({ ...productSource, name: "Campaign A", state: "enabled" }, profile, "2026-09-07");
    expect(campaign.validationErrors).toEqual([]);
    expect(campaign).toMatchObject({ profileId: "profile-us-1", campaignId: "campaign-1", reportDate: "2026-09-07", adType: "SP" });
  });

  it("允许活动报告仅提供状态或预算，并只对明确SID进行店铺一致性校验", () => {
    const profile = normalizeAdMcpProfile(profileSource).profile!;
    const metadataOnly = normalizeAdMcpCampaign({
      ...productSource,
      store_id: "advertising-scoped-store-id",
      sales: "99999999",
      orders: "",
      name: "Campaign A",
      state: "enabled",
    }, profile, "2026-09-07");
    expect(metadataOnly.validationErrors).toEqual([]);
    expect(metadataOnly).toMatchObject({ sales: null, orders: null, spend: "12.50" });
    const explicitSidMismatch = normalizeAdMcpCampaign({ ...productSource, sid: "different-sid" }, profile, "2026-09-07");
    expect(explicitSidMismatch.validationErrors.join(" ")).toContain("店铺SID与授权Profile不一致");
  });

  it("将活动验证错误归为固定脱敏类别，并为批次审计提供规则版本", () => {
    expect(AD_MCP_VALIDATOR_VERSION).toBe("ad_mcp_p1_2026_09_12_r2");
    expect(summarizeAdMcpValidationErrors([
      "广告活动行店铺SID与授权Profile不一致。",
      "广告活动行广告类型不是SP、SB或SD。",
      "不应写入批次摘要的任意原始错误文本",
    ])).toEqual({
      other_validation_error: 1,
      sid_mismatch: 1,
      unsupported_ad_type: 1,
    });
  });

  it("将预览异常限制为固定运行前置类别，不回传异常正文", () => {
    expect(classifyAdMcpPreviewFailure(new Error("OAUTH_SERVER_URL is not configured"))).toBe("oauth_not_configured");
    expect(classifyAdMcpPreviewFailure(new Error("数据库不可用"))).toBe("database_unavailable");
    expect(classifyAdMcpPreviewFailure(new Error("MCP窗口读取超时"))).toBe("request_timeout");
    expect(classifyAdMcpPreviewFailure(new Error("Lingxing request rejected"))).toBe("lingxing_request_failed");
    expect(classifyAdMcpPreviewFailure(new Error("source-specific internal detail"))).toBe("unknown");
  });
});

describe("广告商品父ASIN映射", () => {
  it("优先选择同店铺、同站点、同报告日的唯一子ASIN证据", () => {
    const mapping = resolveParentAsinMapping({
      sourceStoreId: "store-us-1", country: "US", advertisedAsin: "B0ABC12345", reportDate: "2026-09-07",
      evidence: [
        { sourceStoreId: "store-us-1", country: "US", asin: "B0ABC12345", sku: "SKU-A", parentAsin: "PARENT-A", reportDate: "2026-09-07" },
        { sourceStoreId: "store-other", country: "US", asin: "B0ABC12345", sku: "SKU-A", parentAsin: "PARENT-B", reportDate: "2026-09-07" },
      ],
    });
    expect(mapping).toEqual({ parentAsin: "PARENT-A", status: "exact_asin_same_day", evidenceDate: "2026-09-07", evidenceKind: "asin_same_day" });
  });

  it("同日不存在时只回溯同店铺同站点90日内的唯一证据，多父证据保持未映射", () => {
    const prior = resolveParentAsinMapping({
      sourceStoreId: "store-us-1", country: "US", advertisedAsin: "B0ABC12345", reportDate: "2026-09-07",
      evidence: [{ sourceStoreId: "store-us-1", country: "US", asin: "B0ABC12345", sku: "SKU-A", parentAsin: "PARENT-A", reportDate: "2026-09-05" }],
    });
    expect(prior).toMatchObject({ parentAsin: "PARENT-A", status: "exact_asin_prior_evidence", evidenceDate: "2026-09-05" });
    const conflicted = resolveParentAsinMapping({
      sourceStoreId: "store-us-1", country: "US", advertisedAsin: "B0ABC12345", reportDate: "2026-09-07",
      evidence: [
        { sourceStoreId: "store-us-1", country: "US", asin: "B0ABC12345", sku: "SKU-A", parentAsin: "PARENT-A", reportDate: "2026-09-07" },
        { sourceStoreId: "store-us-1", country: "US", asin: "B0ABC12345", sku: "SKU-A", parentAsin: "PARENT-B", reportDate: "2026-09-07" },
      ],
    });
    expect(conflicted).toMatchObject({ parentAsin: null, status: "unmapped", evidenceKind: "asin_same_day_multiple_parent" });
  });
});

describe("广告MCP自动应用门禁", () => {
  it("仅允许单日、全Profile覆盖、实体唯一且精确映射的广告商品写入", () => {
    expect(() => assertAdMcpAutoApplyIntegrity({
      status: "ready_for_review",
      domain: "ad_product_mcp",
      scope: { startDate: "2026-09-07", endDate: "2026-09-07" },
      summary: { profilesExpected: 1, profilesRead: 1, profileDateWindowsExpected: 1, profileDateWindowsRead: 1, pageTruncations: 0, capped: false },
      rows: [{
        entityKey: "product-1", validationErrors: [], normalizedData: {
          profileId: "profile-us-1", campaignId: "campaign-1", adType: "SP", reportDate: "2026-09-07",
          adGroupId: "ad-group-1", adId: "ad-1", advertisedAsin: "B0ABC12345", parentAsin: "PARENT-A",
          mappingStatus: "exact_asin_same_day", impressions: 100, clicks: 10, spend: "12.50", sales: "50.00", orders: 2,
        },
      }],
    })).not.toThrow();
  });

  it("对分页截断或未映射广告商品保持失败关闭", () => {
    expect(() => assertAdMcpAutoApplyIntegrity({
      status: "ready_for_review", domain: "ad_campaign_mcp", scope: { startDate: "2026-09-07", endDate: "2026-09-07" },
      summary: { profilesExpected: 1, profilesRead: 1, profileDateWindowsExpected: 1, profileDateWindowsRead: 1, pageTruncations: 1 }, rows: [],
    })).toThrow("分页或行数截断");
    expect(() => assertAdMcpAutoApplyIntegrity({
      status: "ready_for_review", domain: "ad_product_mcp", scope: { startDate: "2026-09-07", endDate: "2026-09-07" },
      summary: { profilesExpected: 1, profilesRead: 1, profileDateWindowsExpected: 1, profileDateWindowsRead: 1 },
      rows: [{ entityKey: "unmapped", validationErrors: ["未映射"], normalizedData: {} }],
    })).toThrow("字段或映射异常");
  });

  it("允许没有表现KPI的完整广告活动元数据通过活动事实门禁", () => {
    expect(() => assertAdMcpAutoApplyIntegrity({
      status: "ready_for_review", domain: "ad_campaign_mcp", scope: { startDate: "2026-09-07", endDate: "2026-09-07" },
      summary: { profilesExpected: 1, profilesRead: 1, profileDateWindowsExpected: 1, profileDateWindowsRead: 1, pageTruncations: 0, capped: false },
      rows: [{ entityKey: "campaign-1", validationErrors: [], normalizedData: { profileId: "profile-us-1", campaignId: "campaign-1", adType: "SP", reportDate: "2026-09-07", impressions: null, clicks: null, spend: null, sales: null, orders: null } }],
    })).not.toThrow();
  });
});
