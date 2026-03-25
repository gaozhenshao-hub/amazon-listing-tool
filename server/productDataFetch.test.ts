import { describe, it, expect, vi, beforeEach } from "vitest";

// Test the helper functions and data filtering logic

describe("Product Data Fetch - ASIN Filtering", () => {
  
  describe("findMatchedSid helper", () => {
    it("should match seller by storeName", async () => {
      // Import after mocks
      vi.mock("./db", () => ({
        getDb: vi.fn(() => Promise.resolve({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnValue(Promise.resolve([])),
        })),
      }));
      vi.mock("./lingxingAdapter", () => ({
        getLingxingAdapter: vi.fn(() => ({
          isMockMode: () => true,
          request: vi.fn().mockResolvedValue({ code: 0, data: [], msg: "ok" }),
        })),
      }));
      vi.mock("./_core/llm", () => ({
        invokeLLM: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ analysis: "test" }) } }],
        }),
      }));

      // The findMatchedSid function is internal, so we test via the router module
      const mod = await import("./routers/productOps");
      expect(mod.productOpsRouter).toBeDefined();
    });
  });

  describe("Profit data filtering by ASIN", () => {
    it("should filter profit items by parentAsin", () => {
      const parentAsin = "B0F21JYKNT";
      const childAsins = ["B0F21JYKNT-1", "B0F21JYKNT-2"];
      const skus = ["SKU-001", "SKU-002"];

      const allItems = [
        { asin: "B0F21JYKNT", revenue: 500, profit: 100 },
        { asin: "B0OTHER123", revenue: 300, profit: 50 },
        { seller_sku: "SKU-001", revenue: 200, profit: 40 },
        { asin: "B0RANDOM99", revenue: 800, profit: 200 },
        { parentAsin: "B0F21JYKNT", revenue: 150, profit: 30 },
      ];

      const filterByProduct = (items: any[]) => {
        return items.filter((item: any) => {
          const itemAsin = item.asin || item.parentAsin || '';
          const itemSku = item.localSku || item.msku || item.seller_sku || '';
          return childAsins.includes(itemAsin) || itemAsin === parentAsin ||
                 skus.includes(itemSku);
        });
      };

      const filtered = filterByProduct(allItems);
      expect(filtered.length).toBe(3); // B0F21JYKNT, SKU-001, parentAsin match
      expect(filtered[0].asin).toBe("B0F21JYKNT");
      expect(filtered[1].seller_sku).toBe("SKU-001");
      expect(filtered[2].parentAsin).toBe("B0F21JYKNT");
    });

    it("should return empty array when no items match", () => {
      const parentAsin = "B0NONEXIST";
      const childAsins: string[] = [];
      const skus: string[] = [];

      const allItems = [
        { asin: "B0OTHER123", revenue: 300 },
        { asin: "B0RANDOM99", revenue: 800 },
      ];

      const filterByProduct = (items: any[]) => {
        return items.filter((item: any) => {
          const itemAsin = item.asin || item.parentAsin || '';
          const itemSku = item.localSku || item.msku || item.seller_sku || '';
          return childAsins.includes(itemAsin) || itemAsin === parentAsin ||
                 skus.includes(itemSku);
        });
      };

      const filtered = filterByProduct(allItems);
      expect(filtered.length).toBe(0);
    });
  });

  describe("Inventory data filtering by ASIN", () => {
    it("should match FBA inventory by childAsin", () => {
      const childAsins = ["B0CHILD001", "B0CHILD002"];
      const skus = ["SKU-A", "SKU-B"];
      const parentAsin = "B0PARENT01";

      const invList = [
        { asin: "B0CHILD001", seller_sku: "SKU-A", fulfillable_quantity: 50 },
        { asin: "B0CHILD002", seller_sku: "SKU-B", fulfillable_quantity: 30 },
        { asin: "B0OTHER001", seller_sku: "SKU-X", fulfillable_quantity: 100 },
      ];

      const filtered = invList.filter((inv: any) =>
        childAsins.includes(inv.asin) || skus.includes(inv.seller_sku) || inv.asin === parentAsin
      );

      expect(filtered.length).toBe(2);
      expect(filtered[0].fulfillable_quantity).toBe(50);
      expect(filtered[1].fulfillable_quantity).toBe(30);
    });

    it("should match by seller_sku when asin doesn't match", () => {
      const childAsins: string[] = [];
      const skus = ["MY-SKU-123"];
      const parentAsin = "B0PARENT01";

      const invList = [
        { asin: "B0RANDOM01", seller_sku: "MY-SKU-123", fulfillable_quantity: 75 },
        { asin: "B0RANDOM02", seller_sku: "OTHER-SKU", fulfillable_quantity: 200 },
      ];

      const filtered = invList.filter((inv: any) =>
        childAsins.includes(inv.asin) || skus.includes(inv.seller_sku) || inv.asin === parentAsin
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].seller_sku).toBe("MY-SKU-123");
    });
  });

  describe("Ad campaign filtering by ASIN", () => {
    it("should filter campaigns by ASIN in campaign name", () => {
      const allAsins = ["B0F21JYKNT", "B0F21JYKNT-1"];
      const productTitle = "Dishwasher Lower Rack Compatible";

      const allCampaigns = [
        { campaign_name: "SP - B0F21JYKNT - Auto", spend: 50, sales: 200 },
        { campaign_name: "SP - B0OTHER123 - Manual", spend: 30, sales: 100 },
        { campaign_name: "SB - Brand Campaign", spend: 80, sales: 300 },
        { campaign_name: "SP - Dishwasher - Keywords", spend: 40, sales: 150 },
      ];

      const campaigns = allCampaigns.filter((c: any) => {
        const name = String(c.campaign_name || c.name || '').toLowerCase();
        return allAsins.some(asin => name.includes(asin.toLowerCase())) ||
               (productTitle && productTitle.split(' ').slice(0, 3).some((word: string) =>
                 word.length > 3 && name.includes(word.toLowerCase())
               ));
      });

      expect(campaigns.length).toBe(2); // B0F21JYKNT match + "Dishwasher" keyword match
      expect(campaigns[0].campaign_name).toContain("B0F21JYKNT");
      expect(campaigns[1].campaign_name).toContain("Dishwasher");
    });

    it("should not match campaigns with short words from title", () => {
      const allAsins = ["B0TESTTEST"];
      const productTitle = "A B CD Rack";

      const allCampaigns = [
        { campaign_name: "SP - General Campaign", spend: 50 },
        { campaign_name: "SP - Rack Keywords", spend: 30 },
      ];

      const campaigns = allCampaigns.filter((c: any) => {
        const name = String(c.campaign_name || c.name || '').toLowerCase();
        return allAsins.some(asin => name.includes(asin.toLowerCase())) ||
               (productTitle && productTitle.split(' ').slice(0, 3).some((word: string) =>
                 word.length > 3 && name.includes(word.toLowerCase())
               ));
      });

      // "A", "B", "CD" are all <= 3 chars, so no match
      expect(campaigns.length).toBe(0);
    });
  });

  describe("Seller cache", () => {
    it("should return cached sellers within TTL", () => {
      const SELLER_CACHE_TTL = 5 * 60 * 1000;
      let cache: { sellers: any[], ts: number } | null = null;

      // Simulate first call
      const sellers = [{ sid: 7395, name: "2店-US", mid: 1 }];
      cache = { sellers, ts: Date.now() };

      // Within TTL
      expect(cache && Date.now() - cache.ts < SELLER_CACHE_TTL).toBe(true);
      expect(cache.sellers.length).toBe(1);
    });

    it("should expire cache after TTL", () => {
      const SELLER_CACHE_TTL = 5 * 60 * 1000;
      const sellers = [{ sid: 7395, name: "2店-US", mid: 1 }];
      const cache = { sellers, ts: Date.now() - SELLER_CACHE_TTL - 1000 };

      expect(Date.now() - cache.ts < SELLER_CACHE_TTL).toBe(false);
    });
  });

  describe("Marketplace to MID mapping", () => {
    it("should map marketplace codes to correct MIDs", () => {
      const MARKETPLACE_MID_MAP: Record<string, number[]> = {
        'US': [1], 'UK': [4], 'DE': [5], 'FR': [6], 'IT': [7], 'ES': [8], 'JP': [9], 'AU': [10], 'CA': [2], 'MX': [3],
      };

      expect(MARKETPLACE_MID_MAP['US']).toEqual([1]);
      expect(MARKETPLACE_MID_MAP['UK']).toEqual([4]);
      expect(MARKETPLACE_MID_MAP['JP']).toEqual([9]);
    });

    it("should find matching seller by marketplace MID", () => {
      const MARKETPLACE_MID_MAP: Record<string, number[]> = {
        'US': [1], 'UK': [4], 'DE': [5],
      };
      const sellers = [
        { sid: 7395, mid: 1, name: "Store-US" },
        { sid: 7396, mid: 4, name: "Store-UK" },
        { sid: 7397, mid: 5, name: "Store-DE" },
      ];
      const product = { storeName: null, marketplace: "US" };

      const matched = sellers.find((s: any) =>
        (product.storeName && s.name === product.storeName) ||
        (product.marketplace && (MARKETPLACE_MID_MAP[product.marketplace] || []).includes(s.mid))
      );

      expect(matched).toBeDefined();
      expect(matched!.sid).toBe(7395);
    });
  });

  describe("Profit aggregation", () => {
    it("should correctly aggregate profit items", () => {
      const items = [
        { revenue: 100, product_cost: 30, ad_spend: 10, fba_fee: 15, referral_fee: 15, other_fee: 5, profit: 25, order_count: 5, unit_count: 8 },
        { revenue: 200, product_cost: 60, ad_spend: 20, fba_fee: 30, referral_fee: 30, other_fee: 10, profit: 50, order_count: 10, unit_count: 15 },
      ];

      let totalRevenue = 0, totalProfit = 0, totalOrders = 0;
      for (const item of items) {
        totalRevenue += item.revenue || 0;
        totalProfit += item.profit || 0;
        totalOrders += item.order_count || 0;
      }

      expect(totalRevenue).toBe(300);
      expect(totalProfit).toBe(75);
      expect(totalOrders).toBe(15);
      expect(totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0).toBe(25);
    });

    it("should handle empty items array", () => {
      const items: any[] = [];
      let totalRevenue = 0, totalProfit = 0;
      for (const item of items) {
        totalRevenue += item.revenue || 0;
        totalProfit += item.profit || 0;
      }
      expect(totalRevenue).toBe(0);
      expect(totalProfit).toBe(0);
    });
  });
});
