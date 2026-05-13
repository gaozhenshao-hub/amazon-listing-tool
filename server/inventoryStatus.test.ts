import { describe, it, expect } from "vitest";

/**
 * Unit tests for inventory status logic
 * Tests the same logic used in the getInventoryStatus procedure
 */

function computeInventoryStatus(input: {
  fbaAvailable: number;
  fbaInbound: number;
  avgDailySales7d: number;
  daysOfStock: number;
  productionTimeDays: number;
  shippingTimeDays: number;
}) {
  const { fbaAvailable, fbaInbound, avgDailySales7d, daysOfStock, productionTimeDays, shippingTimeDays } = input;
  const totalLeadTime = productionTimeDays + shippingTimeDays;
  const inboundCoverDays = avgDailySales7d > 0 ? Math.round(fbaInbound / avgDailySales7d) : 0;
  const effectiveDays = daysOfStock + inboundCoverDays;

  let status: string;
  let label: string;
  let color: string;
  let suggestion: string;

  if (avgDailySales7d === 0 && fbaAvailable === 0) {
    status = "stockout_risk"; label = "断货"; color = "red";
    suggestion = "产品已断货，无销量数据。建议评估是否需要补货或下架。";
  } else if (effectiveDays <= 7) {
    status = "stockout_risk"; label = "断货风险"; color = "red";
    suggestion = `可售天数仅${daysOfStock}天（含在途约${effectiveDays}天），远低于生产+物流周期${totalLeadTime}天。建议立即启动紧急补货或空运。`;
  } else if (effectiveDays <= totalLeadTime) {
    status = "urgent"; label = "紧急备货"; color = "orange";
    suggestion = `可售天数${daysOfStock}天（含在途约${effectiveDays}天），已接近生产+物流周期${totalLeadTime}天。建议立即下单生产。`;
  } else if (effectiveDays <= totalLeadTime + 14) {
    status = "warning"; label = "需备货"; color = "amber";
    suggestion = `可售天数${daysOfStock}天（含在途约${effectiveDays}天），接近安全库存线。建议近期安排生产计划。`;
  } else {
    status = "sufficient"; label = "充足"; color = "green";
    suggestion = `库存充足，可售约${daysOfStock}天（含在途约${effectiveDays}天），无需立即补货。`;
  }

  return { status, label, color, suggestion, metrics: { daysOfStock, inboundCoverDays, effectiveDays, totalLeadTime, avgDailySales7d } };
}

describe("Inventory Status Computation", () => {
  it("should return stockout when no stock and no sales", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 0, fbaInbound: 0, avgDailySales7d: 0,
      daysOfStock: 0, productionTimeDays: 15, shippingTimeDays: 30,
    });
    expect(result.status).toBe("stockout_risk");
    expect(result.label).toBe("断货");
    expect(result.color).toBe("red");
  });

  it("should return stockout_risk when effective days <= 7", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 30, fbaInbound: 0, avgDailySales7d: 10,
      daysOfStock: 3, productionTimeDays: 15, shippingTimeDays: 30,
    });
    expect(result.status).toBe("stockout_risk");
    expect(result.label).toBe("断货风险");
    expect(result.color).toBe("red");
  });

  it("should return urgent when effective days <= totalLeadTime", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 200, fbaInbound: 100, avgDailySales7d: 10,
      daysOfStock: 20, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // effectiveDays = 20 + 10 = 30, totalLeadTime = 45
    expect(result.status).toBe("urgent");
    expect(result.label).toBe("紧急备货");
    expect(result.color).toBe("orange");
  });

  it("should return warning when effective days <= totalLeadTime + 14", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 400, fbaInbound: 100, avgDailySales7d: 10,
      daysOfStock: 40, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // effectiveDays = 40 + 10 = 50, totalLeadTime = 45, 50 <= 45+14=59
    expect(result.status).toBe("warning");
    expect(result.label).toBe("需备货");
    expect(result.color).toBe("amber");
  });

  it("should return sufficient when effective days > totalLeadTime + 14", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 1000, fbaInbound: 500, avgDailySales7d: 10,
      daysOfStock: 100, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // effectiveDays = 100 + 50 = 150, totalLeadTime = 45, 150 > 59
    expect(result.status).toBe("sufficient");
    expect(result.label).toBe("充足");
    expect(result.color).toBe("green");
  });

  it("should handle inbound covering the gap", () => {
    // daysOfStock = 5 (would be stockout_risk alone)
    // but inbound = 500, avgDailySales = 10, so inboundCoverDays = 50
    // effectiveDays = 5 + 50 = 55, totalLeadTime = 45, 55 <= 59 → warning
    const result = computeInventoryStatus({
      fbaAvailable: 50, fbaInbound: 500, avgDailySales7d: 10,
      daysOfStock: 5, productionTimeDays: 15, shippingTimeDays: 30,
    });
    expect(result.status).toBe("warning");
    expect(result.metrics.inboundCoverDays).toBe(50);
    expect(result.metrics.effectiveDays).toBe(55);
  });

  it("should handle zero daily sales with stock", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 100, fbaInbound: 0, avgDailySales7d: 0,
      daysOfStock: 999, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // daysOfStock = 999 (set by backend when no sales), effectiveDays = 999 + 0 = 999
    expect(result.status).toBe("sufficient");
  });

  it("should correctly compute metrics", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 200, fbaInbound: 150, avgDailySales7d: 5,
      daysOfStock: 40, productionTimeDays: 20, shippingTimeDays: 25,
    });
    expect(result.metrics.totalLeadTime).toBe(45);
    expect(result.metrics.inboundCoverDays).toBe(30); // 150/5
    expect(result.metrics.effectiveDays).toBe(70); // 40+30
    expect(result.status).toBe("sufficient"); // 70 > 45+14=59
  });

  it("should handle short production time", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 100, fbaInbound: 0, avgDailySales7d: 10,
      daysOfStock: 10, productionTimeDays: 5, shippingTimeDays: 5,
    });
    // effectiveDays = 10, totalLeadTime = 10, 10 <= 10 → urgent
    expect(result.status).toBe("urgent");
  });

  it("should handle boundary case at exactly totalLeadTime + 14", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 590, fbaInbound: 0, avgDailySales7d: 10,
      daysOfStock: 59, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // effectiveDays = 59, totalLeadTime + 14 = 59, 59 <= 59 → warning
    expect(result.status).toBe("warning");
  });

  it("should handle boundary case at exactly totalLeadTime + 15", () => {
    const result = computeInventoryStatus({
      fbaAvailable: 600, fbaInbound: 0, avgDailySales7d: 10,
      daysOfStock: 60, productionTimeDays: 15, shippingTimeDays: 30,
    });
    // effectiveDays = 60, totalLeadTime + 14 = 59, 60 > 59 → sufficient
    expect(result.status).toBe("sufficient");
  });
});

describe("Days of Stock Calculation", () => {
  function calcDaysOfStock(fbaAvailable: number, weekSalesQty: number): number {
    const avgDailySales7d = weekSalesQty / 7;
    return avgDailySales7d > 0 ? Math.round(fbaAvailable / avgDailySales7d) : (fbaAvailable > 0 ? 999 : 0);
  }

  it("should calculate days of stock correctly", () => {
    expect(calcDaysOfStock(700, 70)).toBe(70); // 700 / (70/7) = 700/10 = 70
  });

  it("should return 999 when no sales but has stock", () => {
    expect(calcDaysOfStock(100, 0)).toBe(999);
  });

  it("should return 0 when no stock and no sales", () => {
    expect(calcDaysOfStock(0, 0)).toBe(0);
  });

  it("should round to nearest integer", () => {
    expect(calcDaysOfStock(100, 30)).toBe(23); // 100 / (30/7) ≈ 23.3 → 23
  });
});
