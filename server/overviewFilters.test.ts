import { describe, it, expect } from "vitest";

describe("产品总览和库存总览筛选器优化", () => {
  // Test operator enrichment logic
  describe("Operator enrichment via childAsin mapping", () => {
    it("should match operator by parentAsin directly", () => {
      const profiles = [
        { parentAsin: "B0ABC12345", operator: "张三", storeName: "1店-US" },
      ];
      const profileMap = new Map(profiles.map(p => [p.parentAsin, p]));
      
      const item = { asin: "B0ABC12345", store_name: "1店-US" };
      const profile = profileMap.get(item.asin);
      expect(profile?.operator).toBe("张三");
    });

    it("should match operator by childAsin → parentAsin mapping", () => {
      const profiles = [
        { parentAsin: "B0ABC12345", operator: "张三", storeName: "1店-US" },
      ];
      const profileMap = new Map(profiles.map(p => [p.parentAsin, p]));
      
      const childProfileMap = new Map([
        ["B0CHILD001", { childAsin: "B0CHILD001", parentAsin: "B0ABC12345", operator: "张三", storeName: "1店-US" }],
      ]);
      
      const item = { asin: "B0CHILD001", store_name: "" };
      let profile = profileMap.get(item.asin);
      if (!profile) {
        const childProfile = childProfileMap.get(item.asin);
        if (childProfile) {
          profile = profileMap.get(childProfile.parentAsin) || {
            parentAsin: childProfile.parentAsin,
            operator: childProfile.operator,
            storeName: childProfile.storeName,
          };
        }
      }
      expect(profile?.operator).toBe("张三");
    });

    it("should return empty operator when no match found", () => {
      const profileMap = new Map<string, any>();
      const childProfileMap = new Map<string, any>();
      
      const item = { asin: "B0UNKNOWN", store_name: "" };
      let profile = profileMap.get(item.asin);
      if (!profile) {
        const childProfile = childProfileMap.get(item.asin);
        if (childProfile) {
          profile = { operator: childProfile.operator };
        }
      }
      const operator = profile?.operator || "";
      expect(operator).toBe("");
    });
  });

  // Test filter logic
  describe("Filter logic for operator and store", () => {
    const items = [
      { asin: "B001", seller_sku: "SKU1", operator: "张三", store_name: "1店-US", alertLevel: "critical" },
      { asin: "B002", seller_sku: "SKU2", operator: "李四", store_name: "2店-US", alertLevel: "normal" },
      { asin: "B003", seller_sku: "SKU3", operator: "张三", store_name: "2店-US", alertLevel: "low" },
      { asin: "B004", seller_sku: "SKU4", operator: "", store_name: "1店-US", alertLevel: "normal" },
    ];

    it("should filter by operator", () => {
      const operatorFilter = "张三";
      const filtered = items.filter(i => (i.operator || "") === operatorFilter);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.asin)).toEqual(["B001", "B003"]);
    });

    it("should filter by store", () => {
      const storeFilter = "2店-US";
      const filtered = items.filter(i => (i.store_name || "") === storeFilter);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.asin)).toEqual(["B002", "B003"]);
    });

    it("should filter by both operator and store", () => {
      const operatorFilter = "张三";
      const storeFilter = "2店-US";
      const filtered = items
        .filter(i => (i.operator || "") === operatorFilter)
        .filter(i => (i.store_name || "") === storeFilter);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].asin).toBe("B003");
    });

    it("should show all items when filters are 'all'", () => {
      const operatorFilter = "all";
      const storeFilter = "all";
      let filtered = items;
      if (operatorFilter !== "all") {
        filtered = filtered.filter(i => (i.operator || "") === operatorFilter);
      }
      if (storeFilter !== "all") {
        filtered = filtered.filter(i => (i.store_name || "") === storeFilter);
      }
      expect(filtered).toHaveLength(4);
    });

    it("should extract unique operators from items", () => {
      const arr: string[] = items.map(i => String(i.operator || "")).filter(Boolean);
      const unique = Array.from(new Set(arr)).sort();
      expect(unique).toEqual(["张三", "李四"]);
    });

    it("should extract unique stores from items", () => {
      const arr: string[] = items.map(i => String(i.store_name || "")).filter(Boolean);
      const unique = Array.from(new Set(arr)).sort();
      expect(unique).toEqual(["1店-US", "2店-US"]);
    });
  });
});
