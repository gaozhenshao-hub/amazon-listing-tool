import { describe, expect, it } from "vitest";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

describe("站点身份标准化", () => {
  it("将美国站常见代码和中文别名收敛为同一规范站点", () => {
    expect(normalizeMarketplaceCode("US")).toBe("US");
    expect(normalizeMarketplaceCode(" 美国 ")).toBe("US");
    expect(normalizeMarketplaceCode("美国站")).toBe("US");
  });

  it("保留未知站点的稳定大写回退，避免丢失可审计身份", () => {
    expect(normalizeMarketplaceCode(" custom-market ")).toBe("CUSTOM-MARKET");
  });
});
