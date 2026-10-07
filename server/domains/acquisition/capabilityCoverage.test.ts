import { describe, expect, it } from "vitest";
import {
  assessConfirmedSnapshotCoverage,
  isCapabilitySubsetCovered,
  uncoveredCapabilitySummary,
} from "./capabilityCoverage";

const storedGalleryAssets = [
  { id: 101, role: "main", storageKey: "s3://main", fieldStatus: "pending_review" },
  { id: 102, role: "secondary", storageKey: "s3://secondary", fieldStatus: "pending_review" },
] as any;

const galleryWithoutAplus = {
  fieldStatuses: {
    imageGallery: { status: "confirmed" },
    aplus: { status: "not_returned" },
  },
  confirmedAssetIds: [101, 102],
  assets: storedGalleryAssets,
};

describe("confirmed acquisition capability coverage", () => {
  it("keeps safely stored main and secondary assets reusable while reporting missing A+ as a gap", () => {
    const coverage = assessConfirmedSnapshotCoverage(galleryWithoutAplus, ["image_gallery", "aplus"]);

    expect(coverage).toEqual([
      expect.objectContaining({
        capability: "image_gallery",
        state: "returned",
        safelyStoredAssetIds: [101, 102],
      }),
      expect.objectContaining({
        capability: "aplus",
        state: "not_returned",
        safelyStoredAssetIds: [],
      }),
    ]);
    expect(isCapabilitySubsetCovered(coverage)).toBe(false);
    expect(uncoveredCapabilitySummary(coverage)).toEqual(["aplus:not_returned"]);
    expect(galleryWithoutAplus.assets).toHaveLength(2);
    expect(galleryWithoutAplus.confirmedAssetIds).toEqual([101, 102]);
  });

  it("does not turn an empty A+ field into confirmed_absent", () => {
    const coverage = assessConfirmedSnapshotCoverage({
      ...galleryWithoutAplus,
      fieldStatuses: {
        ...galleryWithoutAplus.fieldStatuses,
        aplus: { status: "not_returned" },
      },
    }, ["aplus"]);

    expect(coverage[0]).toMatchObject({ capability: "aplus", state: "not_returned" });
  });

  it("retains provider unsupported, confirmed absent, and download failure as distinct states", () => {
    const unsupported = assessConfirmedSnapshotCoverage({
      fieldStatuses: { aplus: { status: "provider_unsupported" } },
      confirmedAssetIds: [],
      assets: [],
    }, ["aplus"]);
    const absent = assessConfirmedSnapshotCoverage({
      fieldStatuses: { aplus: { status: "confirmed_absent" } },
      confirmedAssetIds: [],
      assets: [],
    }, ["aplus"]);
    const failed = assessConfirmedSnapshotCoverage({
      fieldStatuses: { aplus: { status: "confirmed" } },
      confirmedAssetIds: [],
      assets: [{ id: 103, role: "aplus", storageKey: null, fieldStatus: "download_failed" }],
    } as any, ["aplus"]);

    expect(unsupported[0]).toMatchObject({ state: "provider_unsupported" });
    expect(absent[0]).toMatchObject({ state: "confirmed_absent" });
    expect(failed[0]).toMatchObject({ state: "download_failed", failedAssetIds: [103] });
  });
});
