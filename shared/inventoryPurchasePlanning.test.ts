import { describe, expect, it } from "vitest";
import { buildMonthlyPurchasePlans } from "./inventoryPurchasePlanning";

describe("月度采购与资金规划归集", () => {
  it("按建议订货日归集三个月，并只将已维护成本的行计入资金", () => {
    const plans = buildMonthlyPurchasePlans([
      { asin: "A", suggestedOrderQuantity: 10, suggestedOrderDate: "2026-08-20", productCost: 2.5 },
      { asin: "B", suggestedOrderQuantity: 8, suggestedOrderDate: "2026-09-10", productCost: null },
      { asin: "C", suggestedOrderQuantity: 4, suggestedOrderDate: "2026-07-20", productCost: 3 },
      { asin: "D", suggestedOrderQuantity: 9, suggestedOrderDate: "2026-11-01", productCost: 4 },
    ], "2026-08-16");
    expect(plans.map((plan) => plan.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(plans[0]).toMatchObject({ totalQuantity: 14, knownAmount: 37.5, missingCostCount: 0 });
    expect(plans[1]).toMatchObject({ totalQuantity: 8, knownAmount: 0, missingCostCount: 1 });
    expect(plans[1].rows[0].purchaseAmount).toBeNull();
    expect(plans[2].totalQuantity).toBe(0);
  });
});
