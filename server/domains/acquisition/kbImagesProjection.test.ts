import { describe, expect, it } from "vitest";
import { projectionRolesForCapabilities } from "./kbImagesProjection";

describe("KB Images confirmed snapshot projection", () => {
  it("replaces only requested capabilities with confirmed field evidence", () => {
    expect(projectionRolesForCapabilities(
      ["catalog_basic", "image_gallery", "aplus", "brand_story"],
      {
        imageGallery: { status: "confirmed" },
        aplus: { status: "not_returned" },
        brandStory: { status: "confirmed" },
      },
    )).toEqual(["main", "secondary", "brand_story"]);
  });

  it("does not clear an existing module when the Provider did not return that field", () => {
    expect(projectionRolesForCapabilities(["aplus"], { aplus: { status: "not_returned" } })).toEqual([]);
    expect(projectionRolesForCapabilities(["image_gallery"], { imageGallery: { status: "pending_review" } })).toEqual([]);
  });
});
