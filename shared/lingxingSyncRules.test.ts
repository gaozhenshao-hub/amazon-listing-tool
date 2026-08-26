import { describe, expect, it } from "vitest";
import { getLingxingSyncRule, LINGXING_SYNC_RULES } from "./lingxingSyncRules";

describe("领星分域同步规则目录", () => {
  it("为库存与广告定义独立粒度、目标和人工保护字段", () => {
    const inventory = getLingxingSyncRule("fba_inventory");
    const campaign = getLingxingSyncRule("ad_campaign");
    const keyword = getLingxingSyncRule("ad_keyword");
    expect(inventory?.target).toBe("ops_asin_daily_snapshots");
    expect(inventory?.protectedFields).toContain("生产周期");
    expect(campaign?.target).toBe("ad_campaign_reports");
    expect(campaign?.protectedFields).toContain("预算");
    expect(keyword?.identity).toContain("keyword/target");
  });

  it("不将父ASIN流量与子ASIN日表现共享写入目标", () => {
    const daily = getLingxingSyncRule("product_performance_daily");
    const traffic = getLingxingSyncRule("parent_asin_traffic");
    expect(daily?.target).not.toBe(traffic?.target);
    expect(traffic?.confirmation).toContain("分库存储");
    expect(LINGXING_SYNC_RULES).toHaveLength(8);
  });
});
