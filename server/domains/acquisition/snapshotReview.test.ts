import { describe, expect, it } from "vitest";
import {
  confirmSnapshotFieldStatuses,
  directIngestionBlockReason,
  isRecoverableDirectIngestionSnapshot,
  readSnapshotJsonField,
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

  it("permits partial gallery ingestion when at least one usable image was safely stored", () => {
    expect(directIngestionBlockReason({
      requestedCapabilities: ["catalog_basic", "image_gallery"],
      assets: [
        { role: "main", fieldStatus: "pending_review", storageKey: "s3://stored" },
        { role: "secondary", fieldStatus: "invalid", storageKey: null },
      ] as any,
    })).toBeNull();
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

  it("reads persisted JSON using either Drizzle camelCase or physical snake_case keys", () => {
    expect(readSnapshotJsonField({ normalizedData: baseSnapshot }, "normalizedData", "normalized_data")).toEqual(baseSnapshot);
    expect(readSnapshotJsonField({ normalized_data: JSON.stringify(baseSnapshot) }, "normalizedData", "normalized_data")).toEqual(baseSnapshot);
    expect(readSnapshotJsonField({ field_statuses: JSON.stringify(baseSnapshot.fieldEvidence) }, "fieldStatuses", "field_statuses"))
      .toEqual(baseSnapshot.fieldEvidence);
    expect(readSnapshotJsonField({ confirmed_data: JSON.stringify(baseSnapshot) }, "confirmedData", "confirmed_data")).toEqual(baseSnapshot);
  });

  it("fails explicitly for malformed persisted snapshot JSON", () => {
    expect(() => readSnapshotJsonField({ normalized_data: "not-json" }, "normalizedData", "normalized_data"))
      .toThrow("snapshot normalizedData JSON is invalid");
  });

  it("only permits recovery for system-blocked direct-ingestion snapshots", () => {
    expect(isRecoverableDirectIngestionSnapshot({ status: "draft" })).toBe(true);
    expect(isRecoverableDirectIngestionSnapshot({ status: "pending_review" })).toBe(true);
    expect(isRecoverableDirectIngestionSnapshot({ status: "rejected", reviewNote: "system_direct_ingestion_blocked: contract retry" })).toBe(true);
    expect(isRecoverableDirectIngestionSnapshot({ status: "rejected", reviewNote: "manual_rejection" })).toBe(false);
    expect(isRecoverableDirectIngestionSnapshot({ status: "confirmed" })).toBe(false);
  });

});
