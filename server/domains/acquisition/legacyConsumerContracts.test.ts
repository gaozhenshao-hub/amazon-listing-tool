import { describe, expect, it } from "vitest";
import {
  CONVERSION_COLLECTOR_ACQUISITION_CAPABILITIES,
  KB_LISTING_ACQUISITION_CAPABILITIES,
  KB_PRODUCT_ACQUISITION_CAPABILITIES,
  PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES,
  conversionCollectorConsumerRef,
  kbListingConsumerRef,
  kbProductConsumerRef,
  parseLegacySnapshotConsumerRef,
  projectCompetitorConsumerRef,
} from "./legacyConsumerContracts";

describe("legacy acquisition consumer contracts", () => {
  it("builds and parses stable workspace-safe consumer references", () => {
    expect(parseLegacySnapshotConsumerRef("kb_listing", kbListingConsumerRef(12))).toEqual({ type: "kb_listing", recordId: 12 });
    expect(parseLegacySnapshotConsumerRef("kb_product", kbProductConsumerRef(13))).toEqual({ type: "kb_product", recordId: 13 });
    expect(parseLegacySnapshotConsumerRef("project_competitor", projectCompetitorConsumerRef(8, "b012345678"))).toEqual({ type: "project_competitor", projectId: 8, asin: "B012345678" });
    expect(parseLegacySnapshotConsumerRef("conversion_collector", conversionCollectorConsumerRef("b012345678"))).toEqual({ type: "conversion_collector", marketplace: "US", asin: "B012345678" });
  });

  it("rejects malformed or cross-type references", () => {
    expect(() => parseLegacySnapshotConsumerRef("kb_listing", "kb-product:12")).toThrow();
    expect(() => parseLegacySnapshotConsumerRef("project_competitor", "project-competitor:8:BAD")).toThrow();
    expect(() => parseLegacySnapshotConsumerRef("conversion_collector", "conversion-collector:UK:B012345678")).toThrow();
  });

  it("requests only the capabilities each consumer can safely project", () => {
    expect(KB_LISTING_ACQUISITION_CAPABILITIES).toEqual(["catalog_basic", "listing_content"]);
    expect(KB_PRODUCT_ACQUISITION_CAPABILITIES).toContain("image_gallery");
    expect(PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES).not.toContain("aplus");
    expect(CONVERSION_COLLECTOR_ACQUISITION_CAPABILITIES).toEqual(expect.arrayContaining(["aplus", "brand_story", "ratings"]));
  });
});
