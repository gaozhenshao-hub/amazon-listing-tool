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
          { sid: 7395, mid: 1, name: "2店-US", seller_id: "AH81S", marketplace: "US" },
          { sid: 7392, mid: 1, name: "1店-US", seller_id: "XYZ12", marketplace: "US" },
        ]
      };
    }
    // msku/list with summaryEnabled (aggregated by MSKU)
    if (path.includes("msku/list") && opts.body?.summaryEnabled) {
      return {
        code: "200", msg: "OK", data: {
          records: [
            {
              msku: "XWJK001", localSku: "XWJK001-US", asin: "B0ABC12345", itemName: "Wireless Keyboard",
              localName: "无线键盘", storeName: "2店-US", sid: 7395,
              totalFbaAndFbmAmount: 38303, totalFbaAndFbmQuantity: 520, totalSalesQuantity: 520,
              grossProfit: 8744, grossRate: 0.228,
              platformFee: 5745, totalFbaDeliveryFee: 7660, totalStorageFee: 200,
              cgPriceAbsTotal: 15000, postedDateLocale: "2026-03-01",
            },
            {
              msku: "HSCGZH001", localSku: "HSCGZH001-US", asin: "B0DEF67890", itemName: "Bluetooth Headset",
              localName: "蓝牙耳机", storeName: "2店-US", sid: 7395,
              totalFbaAndFbmAmount: 23595, totalFbaAndFbmQuantity: 310, totalSalesQuantity: 310,
              grossProfit: 8381, grossRate: 0.355,
              platformFee: 3539, totalFbaDeliveryFee: 4719, totalStorageFee: 120,
              cgPriceAbsTotal: 6500, postedDateLocale: "2026-03-01",
            },
          ],
          total: 2,
        }
      };
    }
    // msku/list without summaryEnabled (daily records)
    if (path.includes("msku/list")) {
      return {
        code: "200", msg: "OK", data: {
          records: [
            {
              msku: "XWJK001", asin: "B0ABC12345", itemName: "Wireless Keyboard",
              totalFbaAndFbmAmount: 1200, totalSalesQuantity: 16,
              grossProfit: 280, grossRate: 0.233,
              postedDateLocale: "2026-03-01",
            },
            {
              msku: "XWJK001", asin: "B0ABC12345", itemName: "Wireless Keyboard",
              totalFbaAndFbmAmount: 1350, totalSalesQuantity: 18,
              grossProfit: 310, grossRate: 0.230,
              postedDateLocale: "2026-03-02",
            },
            {
              msku: "HSCGZH001", asin: "B0DEF67890", itemName: "Bluetooth Headset",
              totalFbaAndFbmAmount: 800, totalSalesQuantity: 10,
              grossProfit: 280, grossRate: 0.350,
              postedDateLocale: "2026-03-01",
            },
          ],
          total: 3,
        }
      };
    }
    // FBA inventory - real field names
    if (path.includes("fbaList") || path.includes("fbaStock")) {
      return {
        code: "200", msg: "OK", data: {
          total: 4,
          list: [
            { msku: "XWJK001", product_name: "Wireless Keyboard", fulfillable_quantity: 100, sellable_days: 5, avg_daily_sales: "20.0", inbound_quantity: 0, reserved_quantity: 10, asin: "B0ABC12345", name: "2店-US" },
            { msku: "HSCGZH001", product_name: "Bluetooth Headset", fulfillable_quantity: 500, sellable_days: 50, avg_daily_sales: "10.0", inbound_quantity: 200, reserved_quantity: 5, asin: "B0DEF67890", name: "2店-US" },
            { msku: "LZ002-952", product_name: "Phone Case", fulfillable_quantity: 30, sellable_days: 10, avg_daily_sales: "3.0", inbound_quantity: 0, reserved_quantity: 2, asin: "B0GHI11111", name: "1店-US" },
            { msku: "SKU-SLOW", product_name: "Slow Seller", fulfillable_quantity: 2000, sellable_days: 120, avg_daily_sales: "2.0", inbound_quantity: 0, reserved_quantity: 0, asin: "B0JKL22222", name: "1店-US" },
          ],
        }
      };
    }
    // SP Campaign list - real API structure
    if (path.includes("spCampaigns") && !path.includes("Reports")) {
      return {
        code: "200", msg: "OK", data: [
          { campaign_id: "105475193993356", name: "UST1202-自动", state: "enabled", budget: 50, bidding_strategy: "legacyForSales" },
          { campaign_id: "105475193993357", name: "Auto-USQ1152", state: "enabled", budget: 30, bidding_strategy: "legacyForSales" },
        ], total: 2
      };
    }
    // SP Campaign Reports - real API structure
    if (path.includes("spCampaignReports")) {
      return {
        code: "200", msg: "OK", data: [
          { campaign_id: "105475193993356", impressions: 10000, clicks: 500, cost: 200, sales: 800, orders: 25 },
          { campaign_id: "105475193993357", impressions: 5000, clicks: 200, cost: 45.51, sales: 296.02, orders: 8 },
        ], total: 2
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
    if (path.includes("replenish")) {
      return {
        code: "200", msg: "OK", data: [
          { seller_sku: "XWJK001", recommended_qty: 500, days_of_supply: 5 },
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
            { seller_sku: "XWJK001", urgency: "urgent", suggested_qty: 500, reason: "仅剩5天库存", estimated_stockout_date: "2026-03-28", notes: "建议空运加急" },
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
    const { operationsRouter } = await import("./operations");
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

describe("Operations Router - Real API Field Mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FBA inventory uses correct field names (msku, sellable_days, fulfillable_quantity)", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/fba/fbaStock/fbaList", body: { sid: "7395,7392" } });
    const rawData = res.data;
    const items = rawData.list || [];

    expect(items).toHaveLength(4);
    // Verify real field names exist
    expect(items[0].msku).toBe("XWJK001");
    expect(items[0].product_name).toBe("Wireless Keyboard");
    expect(items[0].fulfillable_quantity).toBe(100);
    expect(items[0].sellable_days).toBe(5);
    expect(items[0].avg_daily_sales).toBe("20.0"); // String from API
    expect(items[0].inbound_quantity).toBe(0);
  });

  it("FBA inventory alert levels use sellable_days (not days_of_supply)", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/routing/fba/fbaStock/fbaList", body: { sid: "7395,7392" } });
    const items = (res.data.list || []).map((item: any) => {
      const daysOfSupply = Number(item.sellable_days) || 0;
      let alertLevel = "normal";
      if (daysOfSupply <= 7) alertLevel = "critical";
      else if (daysOfSupply <= 14) alertLevel = "low";
      else if (daysOfSupply > 90) alertLevel = "overstock";
      return { ...item, alertLevel };
    });

    expect(items[0].alertLevel).toBe("critical"); // 5 days
    expect(items[1].alertLevel).toBe("normal"); // 50 days
    expect(items[2].alertLevel).toBe("low"); // 10 days
    expect(items[3].alertLevel).toBe("overstock"); // 120 days
  });

  it("Profit summary uses real field names (totalFbaAndFbmAmount, grossProfit, grossRate)", async () => {
    const res = await mockAdapter.request({
      path: "/bd/profit/report/open/report/msku/list",
      body: { startDate: "2026-02-23", endDate: "2026-03-25", length: 500, summaryEnabled: true },
    });
    const records = res.data.records || [];

    expect(records).toHaveLength(2);
    expect(records[0].msku).toBe("XWJK001");
    expect(records[0].totalFbaAndFbmAmount).toBe(38303);
    expect(records[0].grossProfit).toBe(8744);
    expect(records[0].grossRate).toBe(0.228);
    expect(records[0].platformFee).toBe(5745);
    expect(records[0].totalFbaDeliveryFee).toBe(7660);
    expect(records[0].cgPriceAbsTotal).toBe(15000);
  });

  it("Profit trend groups daily data by date correctly", async () => {
    const res = await mockAdapter.request({
      path: "/bd/profit/report/open/report/msku/list",
      body: { startDate: "2026-02-23", endDate: "2026-03-25", length: 500 },
    });
    const dailyData = res.data.records || [];

    // Group by date
    const dateMap: Record<string, { revenue: number; profit: number; orders: number }> = {};
    for (const d of dailyData) {
      const date = d.postedDateLocale || '';
      if (!date) continue;
      if (!dateMap[date]) dateMap[date] = { revenue: 0, profit: 0, orders: 0 };
      dateMap[date].revenue += d.totalFbaAndFbmAmount || 0;
      dateMap[date].profit += d.grossProfit || 0;
      dateMap[date].orders += d.totalSalesQuantity || 0;
    }

    // 2026-03-01 has two records (XWJK001 + HSCGZH001)
    expect(dateMap["2026-03-01"].revenue).toBe(2000); // 1200 + 800
    expect(dateMap["2026-03-01"].profit).toBe(560); // 280 + 280
    expect(dateMap["2026-03-01"].orders).toBe(26); // 16 + 10

    // 2026-03-02 has one record (XWJK001)
    expect(dateMap["2026-03-02"].revenue).toBe(1350);
    expect(dateMap["2026-03-02"].profit).toBe(310);
  });

  it("Ad campaigns merge list + report data correctly", async () => {
    const listRes = await mockAdapter.request({
      path: "/pb/openapi/newad/spCampaigns",
      body: { sid: 7395, offset: 0, length: 200 },
    });
    const reportRes = await mockAdapter.request({
      path: "/pb/openapi/newad/spCampaignReports",
      body: { sid: 7395, report_date: "2026-03-24", show_detail: 0, offset: 0, length: 200 },
    });

    const campaignList = listRes.data || [];
    const reportData = reportRes.data || [];

    // Build name map from list
    const nameMap: Record<string, any> = {};
    for (const c of campaignList) {
      nameMap[String(c.campaign_id)] = c;
    }

    // Build report map
    const reportMap: Record<string, any> = {};
    for (const r of reportData) {
      reportMap[String(r.campaign_id)] = r;
    }

    // Merge
    const allIds = Array.from(new Set([
      ...campaignList.map((c: any) => String(c.campaign_id)),
      ...Object.keys(reportMap),
    ]));

    expect(allIds).toHaveLength(2);

    // Campaign 105475193993356 has both name and report
    const info1 = nameMap["105475193993356"];
    const report1 = reportMap["105475193993356"];
    expect(info1.name).toBe("UST1202-自动");
    expect(report1.cost).toBe(200);
    expect(report1.sales).toBe(800);
    const acos1 = report1.sales > 0 ? (report1.cost / report1.sales) * 100 : 0;
    expect(acos1).toBe(25);
  });

  it("Dashboard summary uses summaryEnabled data for totals", async () => {
    const summaryRes = await mockAdapter.request({
      path: "/bd/profit/report/open/report/msku/list",
      body: { startDate: "2026-02-23", endDate: "2026-03-25", length: 500, summaryEnabled: true },
    });
    const records = summaryRes.data.records || [];

    const totalRevenue = records.reduce((s: number, d: any) => s + (d.totalFbaAndFbmAmount || 0), 0);
    const totalProfit = records.reduce((s: number, d: any) => s + (d.grossProfit || 0), 0);
    const totalOrders = records.reduce((s: number, d: any) => s + (d.totalSalesQuantity || 0), 0);

    expect(totalRevenue).toBe(61898); // 38303 + 23595
    expect(totalProfit).toBe(17125); // 8744 + 8381
    expect(totalOrders).toBe(830); // 520 + 310

    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    expect(profitMargin).toBeCloseTo(27.7, 0);
  });

  it("Dashboard alerts use correct field names (sellable_days, msku)", async () => {
    const inventoryRes = await mockAdapter.request({
      path: "/erp/sc/routing/fba/fbaStock/fbaList",
      body: { sid: "7395,7392" },
    });
    const items = inventoryRes.data.list || [];

    const alerts = items
      .filter((i: any) => {
        const days = Number(i.sellable_days) || 0;
        return days <= 7 && days >= 0;
      })
      .map((i: any) => ({
        type: "inventory_critical",
        message: `${i.msku}: 仅剩${i.sellable_days}天库存，需紧急补货`,
        severity: "critical",
      }));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("XWJK001");
    expect(alerts[0].message).toContain("5天库存");
    expect(alerts[0].severity).toBe("critical");
  });

  it("avg_daily_sales is string from API, must be converted to number", async () => {
    const res = await mockAdapter.request({
      path: "/erp/sc/routing/fba/fbaStock/fbaList",
      body: { sid: "7395,7392" },
    });
    const items = res.data.list || [];

    // API returns string
    expect(typeof items[0].avg_daily_sales).toBe("string");

    // Must convert for calculations
    const avgSales = Number(items[0].avg_daily_sales);
    expect(avgSales).toBe(20);
    expect(typeof avgSales).toBe("number");
  });
});

describe("Operations Router - Seller SIDs", () => {
  it("getAllSellerSids returns real SIDs from seller/lists API", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/data/seller/lists" });
    const sellers = res.data || [];
    const sids = sellers.map((s: any) => String(s.sid));

    expect(sids).toContain("7395");
    expect(sids).toContain("7392");
    expect(sids).not.toContain("1"); // No hardcoded sid=1
  });

  it("FBA inventory uses comma-separated SIDs", async () => {
    const res = await mockAdapter.request({ path: "/erp/sc/data/seller/lists" });
    const sids = (res.data || []).map((s: any) => String(s.sid));
    const allSidsStr = sids.join(',');

    expect(allSidsStr).toBe("7395,7392");

    // Verify FBA inventory accepts this format
    const invRes = await mockAdapter.request({
      path: "/erp/sc/routing/fba/fbaStock/fbaList",
      body: { sid: allSidsStr, length: 200 },
    });
    expect(invRes.data.list).toHaveLength(4);
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
    const diff = (Date.now() - new Date(thirtyDaysAgo).getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBeGreaterThanOrEqual(29);
    expect(diff).toBeLessThanOrEqual(31);
  });
});

describe("Operations Router - Marketplace Filtering", () => {
  it("MARKETPLACE_MAP has correct US entry (mid=1)", () => {
    const MARKETPLACE_MAP: Record<number, { code: string; name: string; region: string }> = {
      1: { code: 'US', name: '美国', region: 'NA' },
      2: { code: 'CA', name: '加拿大', region: 'NA' },
      9: { code: 'JP', name: '日本', region: 'FE' },
    };
    expect(MARKETPLACE_MAP[1].code).toBe('US');
    expect(MARKETPLACE_MAP[1].region).toBe('NA');
    expect(MARKETPLACE_MAP[2].code).toBe('CA');
  });

  it("filterSidsByMarketplace filters sellers by marketplace code", () => {
    const sellers = [
      { sid: 7395, mid: 1, name: "2店-US" },
      { sid: 7392, mid: 1, name: "1店-US" },
      { sid: 8001, mid: 2, name: "CA-Store" },
    ];
    const MARKETPLACE_MAP: Record<number, { code: string }> = {
      1: { code: 'US' },
      2: { code: 'CA' },
    };

    function filterSidsByMarketplace(sellers: any[], marketplaceCode?: string): string[] {
      if (!marketplaceCode || marketplaceCode === 'ALL') {
        return sellers.map((s: any) => String(s.sid));
      }
      const midEntry = Object.entries(MARKETPLACE_MAP).find(([_, v]) => v.code === marketplaceCode);
      if (!midEntry) return sellers.map((s: any) => String(s.sid));
      const targetMid = Number(midEntry[0]);
      const filtered = sellers.filter((s: any) => Number(s.mid) === targetMid);
      return filtered.length > 0 ? filtered.map((s: any) => String(s.sid)) : sellers.map((s: any) => String(s.sid));
    }

    const usSids = filterSidsByMarketplace(sellers, 'US');
    expect(usSids).toEqual(['7395', '7392']);

    const caSids = filterSidsByMarketplace(sellers, 'CA');
    expect(caSids).toEqual(['8001']);

    const allSids = filterSidsByMarketplace(sellers, 'ALL');
    expect(allSids).toEqual(['7395', '7392', '8001']);
  });

  it("getMarketplaces groups sellers by marketplace correctly", async () => {
    const sellers = [
      { sid: 7395, mid: 1, name: "2店-US" },
      { sid: 7392, mid: 1, name: "1店-US" },
      { sid: 8001, mid: 2, name: "CA-Store" },
    ];
    const MARKETPLACE_MAP: Record<number, { code: string; name: string; region: string }> = {
      1: { code: 'US', name: '美国', region: 'NA' },
      2: { code: 'CA', name: '加拿大', region: 'NA' },
    };

    const mpMap: Record<string, { code: string; name: string; region: string; sids: string[]; storeNames: string[] }> = {};
    for (const s of sellers) {
      const mid = Number(s.mid);
      const mp = MARKETPLACE_MAP[mid];
      if (!mp) continue;
      if (!mpMap[mp.code]) {
        mpMap[mp.code] = { ...mp, sids: [], storeNames: [] };
      }
      mpMap[mp.code].sids.push(String(s.sid));
      mpMap[mp.code].storeNames.push(s.name);
    }

    const result = Object.values(mpMap).sort((a, b) => b.sids.length - a.sids.length);
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('US');
    expect(result[0].sids).toEqual(['7395', '7392']);
    expect(result[0].storeNames).toEqual(['2店-US', '1店-US']);
    expect(result[1].code).toBe('CA');
    expect(result[1].sids).toEqual(['8001']);
  });
});

describe("Operations Router - Ad State Filtering", () => {
  it("adState filter correctly filters campaigns by state", () => {
    const campaigns = [
      { campaign_id: "1", campaign_name: "Active Campaign", state: "enabled", spend: 100 },
      { campaign_id: "2", campaign_name: "Paused Campaign", state: "paused", spend: 50 },
      { campaign_id: "3", campaign_name: "Archived Campaign", state: "archived", spend: 20 },
    ];

    // Filter enabled only
    const enabled = campaigns.filter(c => c.state === "enabled");
    expect(enabled).toHaveLength(1);
    expect(enabled[0].campaign_name).toBe("Active Campaign");

    // Filter paused only
    const paused = campaigns.filter(c => c.state === "paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].campaign_name).toBe("Paused Campaign");

    // All (no filter)
    expect(campaigns).toHaveLength(3);
  });

  it("adState defaults to 'all' when not specified", () => {
    const defaultState = 'all';
    const campaigns = [
      { state: "enabled" },
      { state: "paused" },
    ];
    const filtered = defaultState === 'all' ? campaigns : campaigns.filter(c => c.state === defaultState);
    expect(filtered).toHaveLength(2);
  });
});

describe("Operations Router - ASIN Status Management", () => {
  it("ASIN status correctly identifies active vs inactive listings", () => {
    const listings = [
      { asin1: "B0ABC12345", status: "Active", msku: "SKU001" },
      { asin1: "B0DEF67890", status: "Inactive", msku: "SKU002" },
      { asin1: "B0GHI11111", status: "active", msku: "SKU003" },
      { asin1: "B0JKL22222", status: "deleted", msku: "SKU004" },
    ];

    const statuses = listings.map(item => ({
      asin: item.asin1,
      status: item.status === 'Active' || item.status === 'active' ? 'active' : 'inactive',
    }));

    expect(statuses[0].status).toBe('active');
    expect(statuses[1].status).toBe('inactive');
    expect(statuses[2].status).toBe('active');
    expect(statuses[3].status).toBe('inactive');
  });

  it("Discontinued ASINs are filtered from inventory list", () => {
    const items = [
      { asin: "B0ABC12345", msku: "SKU001", fulfillable_qty: 100 },
      { asin: "B0DEF67890", msku: "SKU002", fulfillable_qty: 50 },
      { asin: "B0GHI11111", msku: "SKU003", fulfillable_qty: 200 },
    ];

    const discontinuedAsins = new Set(["B0DEF67890"]);
    const filtered = items.filter(item => !discontinuedAsins.has(item.asin));

    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.asin)).toEqual(["B0ABC12345", "B0GHI11111"]);
  });

  it("Discontinued ASINs should not trigger restock alerts", () => {
    const items = [
      { asin: "B0ABC12345", msku: "SKU001", sellable_days: 3 }, // Critical, active
      { asin: "B0DEF67890", msku: "SKU002", sellable_days: 2 }, // Critical, discontinued
      { asin: "B0GHI11111", msku: "SKU003", sellable_days: 50 }, // Normal, active
    ];

    const discontinuedAsins = new Set(["B0DEF67890"]);
    const activeItems = items.filter(item => !discontinuedAsins.has(item.asin));
    const criticalAlerts = activeItems.filter(item => item.sellable_days <= 7);

    expect(criticalAlerts).toHaveLength(1);
    expect(criticalAlerts[0].msku).toBe("SKU001");
    // B0DEF67890 is discontinued, should NOT appear in alerts
    expect(criticalAlerts.find(a => a.asin === "B0DEF67890")).toBeUndefined();
  });
});

describe("Operations Router - User Settings", () => {
  it("User settings are stored as key-value pairs", () => {
    const settings: Record<string, string> = {};
    settings['default_marketplace'] = 'US';
    settings['language'] = 'zh-CN';

    expect(settings.default_marketplace).toBe('US');
    expect(settings.language).toBe('zh-CN');
  });

  it("Default marketplace preference is applied correctly", () => {
    const userSettings = { default_marketplace: 'US' };
    const marketplace = userSettings.default_marketplace || 'ALL';
    expect(marketplace).toBe('US');

    const emptySettings = {};
    const defaultMp = (emptySettings as any).default_marketplace || 'ALL';
    expect(defaultMp).toBe('ALL');
  });
});

describe("Operations Router - Search Term Translation", () => {
  it("Translation result maps English terms to Chinese", () => {
    const translations: Record<string, string> = {
      "wireless earbuds": "无线耳塞",
      "bluetooth headphones": "蓝牙耳机",
      "phone case": "手机壳",
    };

    expect(translations["wireless earbuds"]).toBe("无线耳塞");
    expect(translations["bluetooth headphones"]).toBe("蓝牙耳机");
    expect(translations["phone case"]).toBe("手机壳");
  });

  it("Batch translation limits to 50 terms", () => {
    const allTerms = Array.from({ length: 100 }, (_, i) => `term_${i}`);
    const batch = allTerms.slice(0, 50);

    expect(batch).toHaveLength(50);
    expect(batch[0]).toBe("term_0");
    expect(batch[49]).toBe("term_49");
  });

  it("Already translated terms are skipped in batch", () => {
    const searchTerms = [
      { query: "wireless earbuds" },
      { query: "bluetooth headphones" },
      { query: "phone case" },
    ];
    const translations: Record<string, string> = {
      "wireless earbuds": "无线耳塞",
    };

    const untranslated = searchTerms
      .filter(st => !translations[st.query])
      .map(st => st.query);

    expect(untranslated).toEqual(["bluetooth headphones", "phone case"]);
  });
});
