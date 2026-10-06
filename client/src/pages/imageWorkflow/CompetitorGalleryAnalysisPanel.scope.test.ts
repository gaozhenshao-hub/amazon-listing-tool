import { describe, expect, it } from "vitest";
import { defaultGalleryAnalysisAssetIds, sameAssetIds, stableAssetIds } from "./CompetitorGalleryAnalysisPanel";

describe("competitor gallery analysis scope UI", () => {
  const assets = [
    { id: 1, role: "main" },
    { id: 2, role: "secondary" },
    { id: 3, role: "aplus" },
    { id: 4, role: "brand_story" },
  ];

  it("defaults to the product gallery and A+ without silently including brand story", () => {
    expect(defaultGalleryAnalysisAssetIds(assets)).toEqual([1, 2, 3]);
  });

  it("normalizes local selections before comparing them with a saved scope", () => {
    expect(stableAssetIds([3, 1, 3, 0, -1])).toEqual([1, 3]);
    expect(sameAssetIds([3, 1], [1, 3])).toBe(true);
    expect(sameAssetIds([1, 3], [1, 4])).toBe(false);
  });
});
