import { describe, expect, it } from "vitest";
import {
  buildOperatorParentKey,
  buildOperatorProfileKey,
  normalizeMarketplaceForOperatorMapping,
} from "./operatorMappingKeys";

describe("负责人映射键", () => {
  it("将领星中文国家名和站点代码归一为同一严格店铺键", () => {
    expect(normalizeMarketplaceForOperatorMapping("美国")).toBe("US");
    expect(buildOperatorParentKey(" B0D2MDK6SL ", "1店-US", "美国"))
      .toBe(buildOperatorParentKey("b0d2mdk6sl", " 1店-us ", "US"));
  });

  it("保留父ASIN和店铺为映射键的一部分，不允许按站点单独归属", () => {
    expect(buildOperatorParentKey("B0D2MDK6SL", "1店-US", "US"))
      .not.toBe(buildOperatorParentKey("B0D2MDK6SL", "2店-US", "US"));
    expect(buildOperatorProfileKey("B0D2MDK6SL", "1店-US"))
      .not.toBe(buildOperatorProfileKey("B0D2MDK6SL", "2店-US"));
  });
});
