// @vitest-environment jsdom
import { it, expect } from "vitest";
import { visibleResearchPage } from "../../../extensions/research-collector/core";
it("extracts current product title, thumbnail and price from a product detail page", () => {
  document.body.innerHTML =
    '<h1><span id="productTitle">Example Water Pump</span></h1><img id="landingImage" src="https://m.media-amazon.com/images/I/a.jpg"><span class="a-price"><span class="a-offscreen">$29.99</span></span>';
  const result = visibleResearchPage(
    document,
    "https://www.amazon.com/product/dp/B082TMBYR6?ref=test"
  );
  expect(result?.data).toMatchObject({
    kind: "product",
    title: "Example Water Pump",
    price: "$29.99",
    url: "https://www.amazon.com/dp/B082TMBYR6",
  });
  expect(result?.target?.id).toBe("productTitle");
});
it("recognizes store pages and ignores checkout/account pages", () => {
  document.body.innerHTML = "<h1>Example Store</h1>";
  expect(
    visibleResearchPage(document, "https://www.amazon.com/sp?seller=A123456789")
      ?.data.kind
  ).toBe("store");
  expect(
    visibleResearchPage(document, "https://www.amazon.com/gp/your-account")
  ).toBe(null);
});
