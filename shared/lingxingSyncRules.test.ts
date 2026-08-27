import { describe, expect, it } from "vitest";
import { getLingxingSyncGovernance, getLingxingSyncRule, LINGXING_SYNC_GOVERNANCE, LINGXING_SYNC_RULES } from "./lingxingSyncRules";

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
    expect(LINGXING_SYNC_RULES).toHaveLength(11);
  });

  it("为全部数据域显式声明重复键、差异字段、写入策略与定时策略", () => {
    expect(Object.keys(LINGXING_SYNC_GOVERNANCE).sort()).toEqual(LINGXING_SYNC_RULES.map((rule) => rule.domain).sort());
    for (const rule of LINGXING_SYNC_RULES) {
      const governance = getLingxingSyncGovernance(rule.domain);
      expect(governance.dedupeKey).toBeTruthy();
      expect(governance.diffFields.length).toBeGreaterThan(0);
      expect(governance.writePolicy).toBeTruthy();
      expect(governance.schedulePolicy).toBeTruthy();
      expect(governance.scopePolicy).toBeTruthy();
      expect(governance.readWindowPolicy).toBeTruthy();
    }
    expect(getLingxingSyncGovernance("product_performance_daily")).toMatchObject({ writePolicy: "validated_daily_auto_apply", schedulePolicy: "daily_17_shanghai" });
    expect(getLingxingSyncGovernance("fba_inventory")).toMatchObject({ writePolicy: "validated_daily_auto_apply", schedulePolicy: "daily_1720_shanghai" });
    expect(getLingxingSyncGovernance("ad_keyword")).toMatchObject({ writePolicy: "validated_daily_auto_apply", schedulePolicy: "daily_1740_shanghai" });
    expect(getLingxingSyncGovernance("parent_asin_traffic")).toMatchObject({ writePolicy: "unavailable", schedulePolicy: "disabled_pending_source" });
  });
});
