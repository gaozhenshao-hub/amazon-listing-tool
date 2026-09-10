import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { applyConfirmedAdMcpFacts } from "./domains/ops/adMcpApply";

function chain<T>(result: T) {
  const query: any = { from: () => query, where: () => query, limit: async () => result };
  return query;
}

describe("广告MCP独立事实应用", () => {
  it("将完整广告商品草稿写入独立事实与修订审计，不触碰上传广告表或ASIN日快照", async () => {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    const selected = [[], []];
    let identity = 10;
    const db = {
      select: () => chain(selected.shift() || []),
      insert: (table: unknown) => ({
        values: (payload: unknown) => {
          inserts.push({ tableName: getTableName(table as any), payload });
          return { $returningId: async () => [{ id: identity++ }] };
        },
      }),
      update: (table: unknown) => ({
        set: (payload: unknown) => ({ where: async () => { updates.push({ table, payload }); } }),
      }),
    };
    const result = await applyConfirmedAdMcpFacts(db, {
      workspaceId: 1,
      userId: 2,
      batch: {
        id: 8,
        status: "confirmed",
        dataDomain: "ad_product_mcp",
        scope: { startDate: "2026-09-07", endDate: "2026-09-07" },
        summary: { profilesExpected: 1, profilesRead: 1, profileDateWindowsExpected: 1, profileDateWindowsRead: 1, pageTruncations: 0, capped: false },
      },
      rows: [{
        id: 12,
        entityKey: "profile-1|2026-09-07|SP|campaign-1|group-1|ad-1|B0CHILD",
        validationErrors: [],
        sourceData: {},
        normalizedData: {
          profileId: "profile-1", sourceStoreId: "sid-1", country: "US", storeName: "US Store", reportDate: "2026-09-07", adType: "SP",
          campaignId: "campaign-1", campaignName: "Campaign", adGroupId: "group-1", adGroupName: "Group", adId: "ad-1",
          advertisedAsin: "B0CHILD", advertisedSku: "SKU-1", parentAsin: "B0PARENT", mappingStatus: "exact_asin_same_day",
          mappingEvidenceKind: "same_day_asin", impressions: 100, clicks: 8, spend: "12.00", sales: "60.00", orders: 3,
          sourceRowHash: "r".repeat(64), sourcePayloadHash: "p".repeat(64),
        },
      }],
    });
    expect(result).toMatchObject({ success: true, importedRows: 1, revisedRows: 0, skippedRows: 0 });
    expect(inserts).toHaveLength(4);
    expect(updates).toHaveLength(2);
    expect(inserts.map((entry: any) => entry.tableName)).not.toContain("ops_asin_daily_snapshots");
    expect(inserts.map((entry: any) => entry.tableName)).not.toContain("ad_product_daily_reports");
  });
});
