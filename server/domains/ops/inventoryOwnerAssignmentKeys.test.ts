import { describe, expect, it } from "vitest";
import {
  inventoryOwnerAssignmentKey,
  normalizeInventoryOwnerAssignmentScope,
  uniqueInventoryOwnerAssignmentScopes,
} from "./inventoryOwnerAssignmentKeys";

describe("inventoryOwnerAssignmentKeys", () => {
  it("将父ASIN与美国/US站点别名归一为同一严格映射键", () => {
    expect(inventoryOwnerAssignmentKey({ parentAsin: " b0abc123 ", storeName: "3店-US", country: "美国" }))
      .toBe(inventoryOwnerAssignmentKey({ parentAsin: "B0ABC123", storeName: "3店-US", country: "US" }));
  });

  it("保留店铺作为归属边界，避免同父ASIN跨店误配", () => {
    expect(inventoryOwnerAssignmentKey({ parentAsin: "B0ABC123", storeName: "3店-US", country: "US" }))
      .not.toBe(inventoryOwnerAssignmentKey({ parentAsin: "B0ABC123", storeName: "2337店-US", country: "US" }));
  });

  it("批量操作对同一父ASIN、店铺、站点的重复目标去重", () => {
    const targets = uniqueInventoryOwnerAssignmentScopes([
      { parentAsin: "B0ABC123", storeName: "3店-US", country: "US" },
      { parentAsin: "b0abc123", storeName: "3店-US", country: "美国" },
      { parentAsin: "B0XYZ789", storeName: "3店-US", country: "US" },
    ]);
    expect(targets).toHaveLength(2);
    expect(normalizeInventoryOwnerAssignmentScope(targets[0])).toEqual({ parentAsin: "B0ABC123", storeName: "3店-US", country: "US" });
  });
});
