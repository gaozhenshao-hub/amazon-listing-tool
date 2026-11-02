import { describe, expect, it } from "vitest";
import {
  COMPETITOR_GALLERY_DEFAULT_ANALYSIS_ROLES,
  assertGallerySelectionAssets,
  buildCompetitorGallerySelectionHash,
  defaultGallerySelectionAssetIds,
} from "./competitorGallerySelectionContracts";

const assets = [
  { id: 11, role: "main", positionIndex: 0, contentHash: "main" },
  { id: 12, role: "secondary", positionIndex: 1, contentHash: "secondary" },
  { id: 13, role: "aplus", positionIndex: 2, contentHash: "aplus" },
  { id: 14, role: "brand_story", positionIndex: 3, contentHash: "brand" },
];

describe("competitor gallery analysis scope contracts", () => {
  it("defaults to the product gallery and A+ while excluding brand story", () => {
    expect(COMPETITOR_GALLERY_DEFAULT_ANALYSIS_ROLES).toEqual(["main", "secondary", "aplus"]);
    expect(defaultGallerySelectionAssetIds(assets)).toEqual([11, 12, 13]);
  });

  it("rejects empty, duplicate, and cross-gallery asset selections", () => {
    expect(() => assertGallerySelectionAssets({ selectedAssetIds: [], assets })).toThrow("至少选择");
    expect(() => assertGallerySelectionAssets({ selectedAssetIds: [11, 11], assets })).toThrow("重复");
    expect(() => assertGallerySelectionAssets({ selectedAssetIds: [99], assets })).toThrow("不属于当前竞品");
  });

  it("binds the selection hash to the selected image content rather than omitted brand-story evidence", () => {
    const left = buildCompetitorGallerySelectionHash({
      subjectId: 7,
      confirmedSnapshotId: 9,
      selectedAssetIds: [11, 13],
      assets,
      filters: { includedRoles: ["main", "aplus"] },
    });
    const right = buildCompetitorGallerySelectionHash({
      subjectId: 7,
      confirmedSnapshotId: 9,
      selectedAssetIds: [13, 11],
      assets: [...assets].reverse(),
      filters: { includedRoles: ["main", "aplus"] },
    });
    const changed = buildCompetitorGallerySelectionHash({
      subjectId: 7,
      confirmedSnapshotId: 9,
      selectedAssetIds: [11, 14],
      assets,
      filters: { includedRoles: ["main", "brand_story"] },
    });
    expect(left).toBe(right);
    expect(left).not.toBe(changed);
  });
});
