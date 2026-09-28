import { describe, expect, it } from "vitest";
import {
  confirmSnapshotFieldStatuses,
  directIngestionBlockReason,
} from "./snapshotReview";

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

describe("acquisition direct-ingestion contracts", () => {
  it("system-confirms returned evidence but preserves not-returned semantics", () => {
    const statuses = confirmSnapshotFieldStatuses(baseSnapshot.fieldEvidence) as Record<string, any>;
    expect(statuses.title.status).toBe("confirmed");
    expect(statuses.title.noteCode).toBe("system_direct_ingestion");
    expect(statuses.description.status).toBe("not_returned");
  });

  it("fails closed when a requested gallery asset was not safely stored", () => {
    expect(directIngestionBlockReason({
      requestedCapabilities: ["catalog_basic", "image_gallery"],
      assets: [
        { role: "main", fieldStatus: "pending_review", storageKey: "s3://stored" },
        { role: "secondary", fieldStatus: "invalid", storageKey: null },
      ] as any,
    })).toContain("全部安全入库");
  });

  it("fails closed when gallery capability returns no usable main or secondary image", () => {
    expect(directIngestionBlockReason({
      requestedCapabilities: ["catalog_basic", "image_gallery"],
      assets: [
        { role: "aplus", fieldStatus: "pending_review", storageKey: "s3://stored" },
      ] as any,
    })).toContain("主图或副图");
  });

  it("permits a catalog-only result with no image capability", () => {
    expect(directIngestionBlockReason({
      requestedCapabilities: ["catalog_basic"],
      assets: [],
    })).toBeNull();
  });

});
