import { describe, expect, it } from "vitest";
import { listingFactReviewProcedures } from "./facts";
import { listingCoreReviewProcedures } from "./cores";
import { listingCandidateReviewProcedures } from "./candidates";
import { listingReviewProcedures } from "./review";

describe("Listing human-review procedure composition", () => {
  it("preserves every original procedure by reference and original spread order", () => {
    const original = {
      ...listingFactReviewProcedures,
      ...listingCoreReviewProcedures,
      ...listingCandidateReviewProcedures,
    };
    expect(Object.keys(listingReviewProcedures)).toEqual(Object.keys(original));
    for (const [key, procedure] of Object.entries(original)) {
      expect(listingReviewProcedures[key as keyof typeof original]).toBe(procedure);
    }
  });
});
