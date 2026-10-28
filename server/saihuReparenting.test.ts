import { describe, expect, it } from "vitest";
import { selectSaihuFacts } from "./domains/ops/productOverview/saihuDaily";

const base = { workspaceId: 1, asin: "CHILD", parentAsin: "OLD", storeName: "one", site: "US", reportLevel: "asin", reportDate: "2026-09-26", importId: 1, id: 1, salesQty: 10, grossProfit: "20" };

describe("赛狐最新父子关系", () => {
  it("同一子体同一天换父体只保留新导入，不受记录顺序影响", () => {
    const changed = { ...base, parentAsin: "NEW", importId: 2, salesQty: 12 };
    for (const input of [[base, changed], [changed, base]]) {
      const result = selectSaihuFacts(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ parentAsin: "NEW", salesQty: 12 });
    }
  });
  it("历史子体数据跟随新父体，金额销量不变，原始记录不修改", () => {
    const changed = { ...base, reportDate: "2026-10-02", parentAsin: "NEW", importId: 2 };
    const result = selectSaihuFacts([base, changed]);
    expect(result.map(r => r.parentAsin)).toEqual(["NEW", "NEW"]);
    expect(result.reduce((n,r) => n+r.salesQty, 0)).toBe(20);
    expect(result.reduce((n,r) => n+Number(r.grossProfit), 0)).toBe(40);
    expect(base.parentAsin).toBe("OLD");
    expect(selectSaihuFacts(result)).toEqual(result);
  });
  it("拆为独立商品及新导入的历史回补也采用新关系", () => {
    const result = selectSaihuFacts([{ ...base, reportDate: "2026-10-02" }, { ...base, parentAsin: "CHILD", importId: 2 }]);
    expect(result.every(r => r.parentAsin === "CHILD")).toBe(true);
  });
  it("不同店铺、站点、工作区的相同ASIN不串归属", () => {
    const result = selectSaihuFacts([base, { ...base, storeName: "two", parentAsin: "P2", importId: 2 }, { ...base, site: "CA", parentAsin: "P3", importId: 3 }, { ...base, workspaceId: 2, parentAsin: "P4", importId: 4 }]);
    expect(result.map(r => r.parentAsin)).toEqual(["OLD", "P2", "P3", "P4"]);
  });
  it("站点别名合并且保留父体汇总排重规则", () => {
    expect(selectSaihuFacts([base, { ...base, site: "美国", parentAsin: "NEW", importId: 2 }])).toHaveLength(1);
    const result = selectSaihuFacts([base, { ...base, asin: "CHILD,OTHER", reportLevel: "parent", salesQty: 30 }, { ...base, parentAsin: "NEW", reportDate: "2026-10-02", importId: 2 }]);
    expect(result.reduce((n,r) => n+r.salesQty,0)).toBe(40);
  });
});
