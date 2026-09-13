import { describe, expect, it } from "vitest";
import { normalizeApifyAmazonArtifact } from "./amazonNormalizer";

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("normalizeApifyAmazonArtifact", () => {
  it("keeps gallery, A+ and brand story roles separate without persisting source URLs", () => {
    const result = normalizeApifyAmazonArtifact({
      expectedAsin: "B000000001",
      marketplace: "US",
      bytes: bytes([{
        asin: "B000000001",
        title: "Example",
        brand: "Brand",
        breadCrumbs: "Category",
        features: ["Feature A"],
        highResolutionImages: [
          "https://m.media-amazon.com/images/I/main.jpg",
          "https://m.media-amazon.com/images/I/secondary.jpg",
        ],
        aPlusContent: { modules: [{ image: "https://m.media-amazon.com/images/I/aplus.jpg" }] },
        brandStory: { backgroundImage: "https://m.media-amazon.com/images/I/story.jpg" },
        variantAsins: ["B000000002"],
        stars: 4.6,
        reviewsCount: 12,
        input: "https://www.amazon.com/dp/B000000001",
      }]),
    });

    expect(result.completeness).toEqual({
      basicFieldsReturned: 4,
      mainGalleryCount: 2,
      aplusAssetCount: 1,
      brandStoryAssetCount: 1,
      variantCount: 1,
    });
    expect(result.snapshot.assets.map(asset => asset.role)).toEqual(["main", "secondary", "aplus", "brand_story"]);
    expect(JSON.stringify(result.snapshot)).not.toContain("https://");
    expect(result.snapshot.fieldEvidence.aplus.status).toBe("pending_review");
  });

  it("marks missing A+ and variants as not returned rather than confirmed absent", () => {
    const result = normalizeApifyAmazonArtifact({
      expectedAsin: "B000000001",
      marketplace: "US",
      bytes: bytes([{ asin: "B000000001", title: "Example", highResolutionImages: [] }]),
    });
    expect(result.snapshot.fieldEvidence.aplus.status).toBe("not_returned");
    expect(result.snapshot.fieldEvidence.variants.status).toBe("not_returned");
    expect(result.snapshot.fieldEvidence.imageGallery.status).toBe("not_returned");
  });

  it("fails closed when the returned ASIN does not match the requested ASIN", () => {
    expect(() => normalizeApifyAmazonArtifact({
      expectedAsin: "B000000001",
      marketplace: "US",
      bytes: bytes([{ asin: "B000000009" }]),
    })).toThrow("does not match request");
  });
});
