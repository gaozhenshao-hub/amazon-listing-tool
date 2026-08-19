import { describe, expect, it } from "vitest";
import { normalizeRufusProductIdentity } from "./routers/projectFileRufusIdentity";

describe("Rufus product identity normalization", () => {
  const source = `品牌名称: LndscLaser\n产品名称: WH22X37840 Main Control Board\nASIN: B0HDSTQ7B9\n产品类目: Washer Parts & Accessories`;

  it("preserves source identity fields when the Emperor Skill omits them", () => {
    expect(normalizeRufusProductIdentity(source, {
      coreSpecs: [{ attribute: "Product Name", value: "WH22X37840 Main Control Board" }],
    })).toMatchObject({
      productIdentity: {
        brand: "LndscLaser",
        productName: "WH22X37840 Main Control Board",
        asin: "B0HDSTQ7B9",
        category: "Washer Parts & Accessories",
      },
    });
  });

  it("retains result values for identity fields absent from the source table", () => {
    expect(normalizeRufusProductIdentity("产品名称: Replacement Board", {
      productIdentity: { asin: "B012345678", category: "Electronics" },
    })).toMatchObject({
      productIdentity: {
        productName: "Replacement Board",
        asin: "B012345678",
        category: "Electronics",
        brand: "",
      },
    });
  });
});
