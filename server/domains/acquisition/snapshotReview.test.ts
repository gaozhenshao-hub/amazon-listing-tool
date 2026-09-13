import { describe, expect, it } from "vitest";
import { applySnapshotPatch, confirmSnapshotFieldStatuses, SnapshotPatchSchema } from "./snapshotReview";

const baseSnapshot = {
  asin: "B012345678",
  marketplace: "US",
  sourceUrlHash: "a".repeat(64),
  title: "Original title",
  brand: "Original brand",
  category: null,
  description: null,
  bulletPoints: ["Original bullet"],
  price: null,
  rating: null,
  reviewCount: null,
  variantAsins: [],
  assets: [],
  fieldEvidence: {
    title: { status: "pending_review", sourcePath: "$.title", valueHash: "b".repeat(64), noteCode: "provider_value_unconfirmed" },
    description: { status: "not_returned", sourcePath: null, valueHash: null, noteCode: "provider_value_not_returned" },
  },
};

describe("acquisition snapshot review contracts", () => {
  it("applies an editable patch without mutating source evidence", () => {
    const revised = applySnapshotPatch(baseSnapshot, { title: "Reviewed title" });
    expect(revised.title).toBe("Reviewed title");
    expect(revised.fieldEvidence.title.status).toBe("pending_review");
    expect(baseSnapshot.title).toBe("Original title");
  });

  it("confirms returned evidence but preserves not-returned semantics", () => {
    const statuses = confirmSnapshotFieldStatuses(baseSnapshot.fieldEvidence) as Record<string, any>;
    expect(statuses.title.status).toBe("confirmed");
    expect(statuses.title.noteCode).toBe("human_confirmed");
    expect(statuses.description.status).toBe("not_returned");
  });

  it("rejects unrecognized patch fields", () => {
    expect(() => SnapshotPatchSchema.parse({ sourceUrlHash: "override" })).toThrow();
  });
});
