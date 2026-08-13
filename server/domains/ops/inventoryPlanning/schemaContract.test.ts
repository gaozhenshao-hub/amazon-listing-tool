import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  dataImports,
  opsAsinDailySnapshots,
  opsInventoryPlanningParameters,
  opsInventoryPlanningVersions,
  opsLocalInventoryAdjustments,
  opsReplenishmentPlans,
} from "../../../../drizzle/schema";

describe("模块三日粒度库存规划 Schema 契约", () => {
  it("导入批次保留周度兼容字段并新增日粒度与替代关系", () => {
    expect(dataImports.dataGranularity).toBeDefined();
    expect(dataImports.replacesImportId).toBeDefined();
    expect(dataImports.supersededAt).toBeDefined();
  });

  it("日快照、人工库存、参数、补货和规划版本均有稳定表名", () => {
    expect(getTableName(opsAsinDailySnapshots)).toBe("ops_asin_daily_snapshots");
    expect(getTableName(opsLocalInventoryAdjustments)).toBe("ops_local_inventory_adjustments");
    expect(getTableName(opsInventoryPlanningParameters)).toBe("ops_inventory_planning_parameters");
    expect(getTableName(opsReplenishmentPlans)).toBe("ops_replenishment_plans");
    expect(getTableName(opsInventoryPlanningVersions)).toBe("ops_inventory_planning_versions");
  });

  it("日快照具备 ASIN 日库存与销售计算所需的关键字段", () => {
    expect(opsAsinDailySnapshots.reportDate).toBeDefined();
    expect(opsAsinDailySnapshots.asin).toBeDefined();
    expect(opsAsinDailySnapshots.parentAsin).toBeDefined();
    expect(opsAsinDailySnapshots.fbaAvailable).toBeDefined();
    expect(opsAsinDailySnapshots.fbaInTransit).toBeDefined();
    expect(opsAsinDailySnapshots.salesQty).toBeDefined();
    expect(opsAsinDailySnapshots.sourceRowHash).toBeDefined();
  });

  it("库存规划参数保留用户确认的 30/30/10 货期字段", () => {
    expect(opsInventoryPlanningParameters.productionDays).toBeDefined();
    expect(opsInventoryPlanningParameters.shippingDays).toBeDefined();
    expect(opsInventoryPlanningParameters.bufferDays).toBeDefined();
  });
});
