import { describe, expect, it } from "vitest";
import {
  KB_IMAGE_IMPORT_CAPABILITIES,
  capabilitiesForKbPositions,
  kbImagesConsumerRef,
  parseAmazonUsAsins,
} from "./kbImagesAcquisition";

describe("KB Images acquisition contract", () => {
  it("extracts and deduplicates only Amazon US ASINs", () => {
    expect(parseAmazonUsAsins([
      "https://www.amazon.com/dp/B000000001",
      "https://amazon.com/gp/product/B000000002?ref_=test",
      "B000000001",
    ].join("\n"))).toEqual(["B000000001", "B000000002"]);
    expect(() => parseAmazonUsAsins("https://www.amazon.co.uk/dp/B000000001")).toThrow("美国站");
  });

  it("maps gallery positions to one capability and keeps partial refresh explicit", () => {
    expect(capabilitiesForKbPositions(["main"])).toEqual(["catalog_basic", "image_gallery"]);
    expect(capabilitiesForKbPositions(["secondary", "aplus"])).toEqual(["catalog_basic", "image_gallery", "aplus"]);
    expect(capabilitiesForKbPositions(["brand_story"])).toEqual(["catalog_basic", "brand_story"]);
    expect(KB_IMAGE_IMPORT_CAPABILITIES).toEqual(["catalog_basic", "image_gallery", "aplus", "brand_story"]);
    expect(kbImagesConsumerRef("b000000001")).toBe("kb-images:US:B000000001");
  });
});
