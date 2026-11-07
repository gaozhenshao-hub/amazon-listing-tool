import { it, expect } from "vitest";
import {
  researchIdentity,
  researchThumbnail,
} from "../../../shared/researchLibrary";
it("deduplicates product links by site and ASIN without keeping tracking parameters", () => {
  expect(
    researchIdentity(
      "product",
      "https://www.amazon.com/Test-Product/dp/B082TMBYR6/ref=abc?tag=private"
    )
  ).toEqual({
    key: "product:amazon.com:B082TMBYR6",
    site: "amazon.com",
    asin: "B082TMBYR6",
    url: "https://www.amazon.com/dp/B082TMBYR6",
  });
  expect(
    researchIdentity("product", "https://www.amazon.ca/gp/product/B082TMBYR6")
      .key
  ).not.toBe(
    researchIdentity("product", "https://www.amazon.com/dp/B082TMBYR6").key
  );
});
it("recognizes brand storefront and seller storefront identities", () => {
  expect(
    researchIdentity(
      "store",
      "https://www.amazon.com/stores/Test/page/12345678-1234-1234-1234-123456789ABC?ref_=abc"
    ).url
  ).toBe(
    "https://www.amazon.com/stores/page/12345678-1234-1234-1234-123456789ABC"
  );
  expect(
    researchIdentity(
      "store",
      "https://www.amazon.com/sp?seller=A123456789&ref=abc"
    ).url
  ).toBe("https://www.amazon.com/sp?seller=A123456789");
});
it("rejects lookalike hosts, credentials, account pages and non-HTTPS links", () => {
  for (const url of [
    "https://amazon.com.evil.test/dp/B082TMBYR6",
    "https://www.amazon.com@evil.test/dp/B082TMBYR6",
    "http://www.amazon.com/dp/B082TMBYR6",
    "https://www.amazon.com:8443/dp/B082TMBYR6",
    "https://www.amazon.com/gp/your-account",
  ])
    expect(() => researchIdentity("product", url)).toThrow();
  expect(() =>
    researchIdentity(
      "store",
      "https://www.amazon.com/gp/your-account?seller=A123456789"
    )
  ).toThrow();
});
it("accepts only Amazon-hosted image thumbnails", () => {
  expect(
    researchThumbnail("https://m.media-amazon.com/images/I/a.jpg")
  ).toContain("media-amazon");
  expect(researchThumbnail("https://m.media-amazon.com.evil.test/a.jpg")).toBe(
    ""
  );
  expect(researchThumbnail("javascript:alert(1)")).toBe("");
});
