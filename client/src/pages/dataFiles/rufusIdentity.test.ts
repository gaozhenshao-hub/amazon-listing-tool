import { describe, expect, it } from "vitest";
import { getRufusIdentityEntries } from "./rufusIdentity";

describe("Rufus product identity presentation", () => {
  it("shows the source ASIN with other non-empty identity fields", () => {
    expect(getRufusIdentityEntries({
      brand: "LndscLaser",
      productName: "WH22X37840 Main Control Board",
      asin: "B0HDSTQ7B9",
      category: "Washer Parts & Accessories",
    })).toEqual([
      { key: "brand", label: "品牌", value: "LndscLaser" },
      { key: "productName", label: "产品名称", value: "WH22X37840 Main Control Board" },
      { key: "asin", label: "ASIN", value: "B0HDSTQ7B9" },
      { key: "category", label: "产品类目", value: "Washer Parts & Accessories" },
    ]);
  });

  it("does not render source fields that are empty", () => {
    expect(getRufusIdentityEntries({ asin: "  " })).toEqual([]);
  });
});
