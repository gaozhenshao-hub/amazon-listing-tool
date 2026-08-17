import { describe, expect, it } from "vitest";
import { getErpProductKey, mergeErpProducts } from "../shared/erpProductMerge";

describe("ERP 产品来源合并", () => {
  it("保留不同店铺或站点的同父 ASIN", () => {
    const products = mergeErpProducts([
      { source: "lingxing", products: [{ parentAsin: "B0TEST", storeName: "US-A", marketplace: "US" }] },
      { source: "saihu", products: [{ parentAsin: "B0TEST", storeName: "US-B", marketplace: "US" }] },
    ]);

    expect(products).toHaveLength(2);
  });

  it("对同父 ASIN、店铺和站点去重，并优先保留排在前面的数据源", () => {
    const products = mergeErpProducts([
      { source: "lingxing", products: [{ parentAsin: "B0TEST", storeName: "Store A", marketplace: "US", title: "领星汇总" }] },
      { source: "saihu", products: [{ parentAsin: "b0test", storeName: " store a ", marketplace: "us", title: "赛狐汇总" }] },
    ]);

    expect(products).toEqual([
      expect.objectContaining({ title: "领星汇总", erpSource: "lingxing" }),
    ]);
  });

  it("为每个产品附加实际的 ERP 来源标识", () => {
    const products = mergeErpProducts([
      { source: "saihu", products: [{ parentAsin: "B0SAIHU", storeName: "Store", marketplace: "US" }] },
    ]);

    expect(products[0].erpSource).toBe("saihu");
    expect(getErpProductKey(products[0])).toBe("B0SAIHU|STORE|US");
  });
});

