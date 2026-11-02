import { describe, expect, it } from "vitest";
import { buildMcpArguments, normalizeRow, phase5IdentityError } from "./routers/lingxingSync";

const scope = {
  storeId: "7392",
  profileId: "122437464981707,570049873512335",
  marketplace: "US",
  startDate: "2026-08-10",
  endDate: "2026-08-16",
};

describe("领星Phase 5只读草稿映射", () => {
  it("使用已验证的官方工具参数读取Listing、搜索词与投放目标", () => {
    expect(buildMcpArguments("listing_master", scope)).toMatchObject({ capability: "erp_listing", arguments: { pvi_ids: "", sids: "7392", length: 200, offset: 0 } });
    expect(buildMcpArguments("ad_search_term", scope)).toMatchObject({ capability: "ad_campaign_search_term_report", arguments: { profile_ids: ["122437464981707", "570049873512335"], report_date: "2026-08-10 - 2026-08-16", country: ["US"] } });
    expect(buildMcpArguments("ad_targeting", scope)).toMatchObject({ capability: "ad_campaign_targeting_report", arguments: { profile_ids: ["122437464981707", "570049873512335"], with_ring: 0, length: "200", page: 1 } });
  });

  it("拒绝广告全范围聚合行与空身份行，仅保留可审阅的事实草稿", () => {
    expect(phase5IdentityError("ad_search_term", { query: "all stores" }, scope)).toContain("Profile");
    expect(phase5IdentityError("ad_search_term", { profile_id: "122437464981707", query: "water heater", record_id: "row-1" }, scope)).toBeNull();
    expect(phase5IdentityError("ad_targeting", { profile_id: "122437464981707", target_id: "row-2", targeting_mark: "B0TARGET", campaign_id: "camp-1", ad_group_id: "group-1" }, scope)).toBeNull();
  });

  it("将99999999广告比率哨兵归一为缺失值并保留稳定身份键", () => {
    const normalized = normalizeRow("ad_search_term", { profile_id: "122437464981707", record_id: "row-1", query: "water heater", targeting_mark: "Exact|water heater", spends: "24.50", acos: "99999999", cpc: "1.75", ctr: "99999999" }, scope);
    expect(normalized.entityKey).toContain("water heater");
    expect(normalized.normalized).toMatchObject({ profileId: "122437464981707", recordId: "row-1", searchTerm: "water heater", adSpend: "24.50", adAcos: null, adCpc: "1.75", adCtr: null });
  });
});
