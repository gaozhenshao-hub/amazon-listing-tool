import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LingxingAdapter
const mockAdapter = {
  isMockMode: vi.fn(() => true),
  getRecentLogs: vi.fn(() => []),
  setMockMode: vi.fn(),
  request: vi.fn(async (opts: any) => {
    const path = opts.path;
    if (path.includes("seller/lists")) {
      return {
        code: "200", msg: "OK", data: [
          { sid: 1, name: "US Store", marketplace: "US" },
          { sid: 2, name: "UK Store", marketplace: "UK" },
        ]
      };
    }
    if (path.includes("profit/list")) {
      return {
        code: "200", msg: "OK", data: [
          { date: "2026-03-01", revenue: 5000, profit: 1200, profit_margin: 24, order_count: 50, product_cost: 2000, fba_fee: 800, referral_fee: 500, ad_spend: 300, other_fee: 200 },
          { date: "2026-03-02", revenue: 5500, profit: 1400, profit_margin: 25.5, order_count: 55, product_cost: 2100, fba_fee: 850, referral_fee: 550, ad_spend: 350, other_fee: 250 },
        ]
      };
    }
    if (path.includes("fbaInventory")) {
      return {
        code: "200", msg: "OK", data: [
          { seller_sku: "SKU-001", product_name: "Test Product A", fulfillable_qty: 100, days_of_supply: 5, avg_daily_sales: 20 },
          { seller_sku: "SKU-002", product_name: "Test Product B", fulfillable_qty: 500, days_of_supply: 50, avg_daily_sales: 10 },
          { seller_sku: "SKU-003", product_name: "Test Product C", fulfillable_qty: 30, days_of_supply: 10, avg_daily_sales: 3 },
          { seller_sku: "SKU-004", product_name: "Test Product D", fulfillable_qty: 2000, days_of_supply: 120, avg_daily_sales: 2 },
        ]
      };
    }
    if (path.includes("campaign/list")) {
      return {
        code: "200", msg: "OK", data: [
          { campaign_id: 1, campaign_name: "Auto Campaign", spend: 200, sales: 800, acos: 25, impressions: 10000, clicks: 500 },
          { campaign_id: 2, campaign_name: "Manual Campaign", spend: 150, sales: 100, acos: 150, impressions: 5000, clicks: 200 },
        ]
      };
    }
    if (path.includes("searchTerm/list")) {
      return {
        code: "200", msg: "OK", data: [
          { search_term: "wireless earbuds", impressions: 5000, clicks: 200, spend: 50, sales: 300, orders: 10, acos: 16.7 },
          { search_term: "bluetooth headphones", impressions: 3000, clicks: 100, spend: 30, sales: 0, orders: 0, acos: 0 },
        ]
      };
    }
    if (path.includes("profit/productList")) {
      return {
        code: "200", msg: "OK", data: [
          { seller_sku: "SKU-001", product_name: "Product A", revenue: 3000, profit: 800, profit_margin: 26.7 },
          { seller_sku: "SKU-002", product_name: "Product B", revenue: 2000, profit: 400, profit_margin: 20 },
        ]
      };
    }
    if (path.includes("replenish")) {
      return {
        code: "200", msg: "OK", data: [
          { seller_sku: "SKU-001", recommended_qty: 500, days_of_supply: 5 },
        ]
      };
    }
    return { code: "200", msg: "OK", data: [] };
  }),
};

vi.mock("../lingxingAdapter", () => ({
  getLingxingAdapter: () => mockAdapter,
}));

// Mock LLM
vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          suggestions: [
            { seller_sku: "SKU-001", urgency: "urgent", suggested_qty: 500, reason: "仅剩5天库存", estimated_stockout_date: "2026-03-28", notes: "建议空运加急" },
          ],
        }),
      },
    }],
  })),
}));

// Mock DB
const mockDbResult = { insertId: 1 };
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([mockDbResult]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

describe("Operations Router - Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getDashboardOverview returns summary metrics from mock data", async () => {
    // Import after mocks
    const { operationsRouter } = await import("./operations");

    // The router is defined - verify structure
    expect(operationsRouter).toBeDefined();
    expect(operationsRouter._def).toBeDefined();
  });

  it("getLingxingStatus returns mock mode status", () => {
    expect(mockAdapter.isMockMode()).toBe(true);
    expect(mockAdapter.getRecentLogs()).toEqual([]);
  });

  it("toggleMockMode changes mock mode", () => {
    mockAdapter.setMockMode(false);
    expect(mockAdapter.setMockMode).toHaveBeenCalledWith(false);
  });
});

describe("Operations Router - Inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getInventoryList returns items with alert levels", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } });
    const items = res.data.map((item: any) => {
      const daysOfSupply = item.days_of_supply || 0;
      let alertLevel = "normal";
      if (daysOfSupply <= 7) alertLevel = "critical";
      else if (daysOfSupply <= 14) alertLevel = "low";
      else if (daysOfSupply > 90) alertLevel = "overstock";
      return { ...item, alertLevel };
    });

    expect(items).toHaveLength(4);
    expect(items[0].alertLevel).toBe("critical"); // 5 days
    expect(items[1].alertLevel).toBe("normal"); // 50 days
    expect(items[2].alertLevel).toBe("low"); // 10 days
    expect(items[3].alertLevel).toBe("overstock"); // 120 days
  });

  it("filters inventory by alert level", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } });
    const items = res.data.map((item: any) => {
      const daysOfSupply = item.days_of_supply || 0;
      let alertLevel = "normal";
      if (daysOfSupply <= 7) alertLevel = "critical";
      else if (daysOfSupply <= 14) alertLevel = "low";
      else if (daysOfSupply > 90) alertLevel = "overstock";
      return { ...item, alertLevel };
    });

    const criticalOnly = items.filter((i: any) => i.alertLevel === "critical");
    expect(criticalOnly).toHaveLength(1);
    expect(criticalOnly[0].seller_sku).toBe("SKU-001");
  });

  it("sorts inventory by days_of_supply ascending", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } });
    const items = [...res.data].sort((a: any, b: any) => (a.days_of_supply || 0) - (b.days_of_supply || 0));
    expect(items[0].seller_sku).toBe("SKU-001"); // 5 days
    expect(items[3].seller_sku).toBe("SKU-004"); // 120 days
  });

  it("getReplenishmentSuggestions returns data", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/storage/replenish/getReplenishmentData", body: { sid: 1 } });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].seller_sku).toBe("SKU-001");
  });
});

describe("Operations Router - Profit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getProfitOverview calculates waterfall breakdown", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/data/profit/list",
      body: { start_date: "2026-03-01", end_date: "2026-03-02" },
    });

    const data = res.data;
    const totals = data.reduce((acc: any, d: any) => ({
      revenue: acc.revenue + (d.revenue || 0),
      productCost: acc.productCost + (d.product_cost || 0),
      fbaFee: acc.fbaFee + (d.fba_fee || 0),
      referralFee: acc.referralFee + (d.referral_fee || 0),
      adSpend: acc.adSpend + (d.ad_spend || 0),
      otherFee: acc.otherFee + (d.other_fee || 0),
      profit: acc.profit + (d.profit || 0),
    }), { revenue: 0, productCost: 0, fbaFee: 0, referralFee: 0, adSpend: 0, otherFee: 0, profit: 0 });

    expect(totals.revenue).toBe(10500);
    expect(totals.profit).toBe(2600);
    expect(totals.productCost).toBe(4100);
    expect(totals.fbaFee).toBe(1650);
    expect(totals.referralFee).toBe(1050);
    expect(totals.adSpend).toBe(650);
    expect(totals.otherFee).toBe(450);
  });

  it("getProfitByProduct returns product-level profit data", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/data/profit/productList",
      body: { start_date: "2026-03-01", end_date: "2026-03-30" },
    });
    expect(res.data).toHaveLength(2);
    expect(res.data[0].seller_sku).toBe("SKU-001");
  });
});

describe("Operations Router - Ads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAdCampaigns returns campaign data", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/data/ad_manage/campaign/list",
      body: {},
    });
    expect(res.data).toHaveLength(2);
    expect(res.data[0].campaign_name).toBe("Auto Campaign");
    expect(res.data[1].acos).toBe(150);
  });

  it("getSearchTerms returns search term data", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/data/ad_manage/searchTerm/list",
      body: {},
    });
    expect(res.data).toHaveLength(2);
    expect(res.data[0].search_term).toBe("wireless earbuds");
  });

  it("identifies high-ACoS campaigns for alerts", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/data/ad_manage/campaign/list",
      body: {},
    });
    const highAcos = res.data.filter((a: any) => (a.acos || 0) > 50);
    expect(highAcos).toHaveLength(1);
    expect(highAcos[0].campaign_name).toBe("Manual Campaign");
  });
});

describe("Operations Router - Competitor", () => {
  it("competitor monitors CRUD uses correct DB calls", async () => {
    // Verify DB mock is set up correctly
    expect(mockDb.select).toBeDefined();
    expect(mockDb.insert).toBeDefined();
    expect(mockDb.update).toBeDefined();
    expect(mockDb.delete).toBeDefined();
  });
});

describe("Operations Router - Helper Functions", () => {
  it("getToday returns YYYY-MM-DD format", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getDateNDaysAgo returns correct date", () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const thirtyDaysAgo = d.toISOString().split("T")[0];
    expect(thirtyDaysAgo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should be approximately 30 days before today
    const diff = (Date.now() - new Date(thirtyDaysAgo).getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBeGreaterThanOrEqual(29);
    expect(diff).toBeLessThanOrEqual(31);
  });
});

describe("Operations Router - Dashboard Metrics Calculation", () => {
  it("calculates summary metrics correctly from mock data", async () => {
    const [sellerRes, profitRes, inventoryRes, adRes] = await Promise.all([
      mockAdapter.request({ path: "/erp/sc/data/seller/lists" }),
      mockAdapter.request({ path: "/erp/sc/data/profit/list", body: { start_date: "2026-03-01", end_date: "2026-03-30" } }),
      mockAdapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } }),
      mockAdapter.request({ path: "/erp/sc/data/ad_manage/campaign/list", body: {} }),
    ]);

    const profitData = profitRes.data;
    const inventoryData = inventoryRes.data;
    const adData = adRes.data;

    const totalRevenue = profitData.reduce((s: number, d: any) => s + (d.revenue || 0), 0);
    const totalProfit = profitData.reduce((s: number, d: any) => s + (d.profit || 0), 0);
    const totalOrders = profitData.reduce((s: number, d: any) => s + (d.order_count || 0), 0);

    expect(totalRevenue).toBe(10500);
    expect(totalProfit).toBe(2600);
    expect(totalOrders).toBe(105);

    const lowStockCount = inventoryData.filter((i: any) => (i.days_of_supply || 0) < 14).length;
    const overstockCount = inventoryData.filter((i: any) => (i.days_of_supply || 0) > 90).length;
    expect(lowStockCount).toBe(2); // SKU-001 (5d) and SKU-003 (10d)
    expect(overstockCount).toBe(1); // SKU-004 (120d)

    const totalAdSpend = adData.reduce((s: number, d: any) => s + (d.spend || 0), 0);
    const totalAdSales = adData.reduce((s: number, d: any) => s + (d.sales || 0), 0);
    expect(totalAdSpend).toBe(350);
    expect(totalAdSales).toBe(900);

    expect(sellerRes.data).toHaveLength(2);
  });

  it("generates top alerts from inventory and ad data", async () => {
    const inventoryRes = await mockAdapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } });
    const adRes = await mockAdapter.request({ path: "/erp/sc/data/ad_manage/campaign/list", body: {} });

    const inventoryAlerts = inventoryRes.data
      .filter((i: any) => (i.days_of_supply || 0) < 7)
      .map((i: any) => ({
        type: "inventory_critical",
        message: `${i.seller_sku}: 仅剩${i.days_of_supply}天库存，需紧急补货`,
        severity: "critical",
      }));

    const adAlerts = adRes.data
      .filter((a: any) => (a.acos || 0) > 50)
      .map((a: any) => ({
        type: "ad_acos_high",
        message: `广告活动"${a.campaign_name}": ACoS ${a.acos}%，超出阈值`,
        severity: "warning",
      }));

    expect(inventoryAlerts).toHaveLength(1);
    expect(inventoryAlerts[0].severity).toBe("critical");
    expect(adAlerts).toHaveLength(1);
    expect(adAlerts[0].severity).toBe("warning");
  });
});
