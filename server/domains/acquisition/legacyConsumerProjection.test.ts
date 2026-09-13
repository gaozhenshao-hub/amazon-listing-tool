import { describe, expect, it, vi } from "vitest";
import { projectConfirmedSnapshotToLegacyConsumer } from "./legacyConsumerProjection";

const normalized = {
  asin: "B012345678",
  marketplace: "US",
  sourceUrlHash: "a".repeat(64),
  title: "Confirmed title",
  brand: "Confirmed brand",
  category: "Confirmed category",
  description: "Confirmed description",
  bulletPoints: ["Confirmed bullet"],
  price: { value: "19.99", currency: "USD" },
  rating: "4.7",
  reviewCount: 321,
  variantAsins: [],
  assets: [],
  fieldEvidence: {},
};

const fieldStatuses = Object.fromEntries([
  "title", "brand", "category", "description", "bulletPoints", "price", "rating", "reviewCount", "imageGallery",
].map(field => [field, { status: "confirmed" }]));

function queryResult(value: any[]) {
  const promise = Promise.resolve(value);
  return { limit: () => promise, then: promise.then.bind(promise) };
}

function mockDb(selectResults: any[][]) {
  const updates: any[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => queryResult(selectResults.shift() || [])) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => {
        updates.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  };
  return { db: db as any, updates };
}

describe("legacy confirmed snapshot projection", () => {
  it("fails closed when the confirmed snapshot is outside the workspace", async () => {
    const { db } = mockDb([[]]);
    await expect(projectConfirmedSnapshotToLegacyConsumer({
      db, workspaceId: 9, confirmedSnapshotId: 3, requestedBy: 5,
      consumerType: "kb_listing", consumerRef: "kb-listing:17",
    })).rejects.toThrow("confirmed snapshot not found");
  });

  it("projects only confirmed fields and stores an acquisition reference instead of raw provider JSON", async () => {
    const confirmed = {
      id: 3, snapshotId: 2, asin: normalized.asin, confirmedData: normalized,
      confirmedAssetIds: [], fieldStatuses, contentHash: "b".repeat(64), confirmationVersion: 4,
    };
    const record = { id: 17, userId: 5, workspaceId: 9, asin: normalized.asin };
    const { db, updates } = mockDb([[confirmed], [], [record]]);
    const projection = await projectConfirmedSnapshotToLegacyConsumer({
      db, workspaceId: 9, confirmedSnapshotId: 3, requestedBy: 5,
      consumerType: "kb_listing", consumerRef: "kb-listing:17",
    });
    expect(projection).toMatchObject({ consumerType: "kb_listing", recordId: 17, confirmedSnapshotId: 3 });
    expect(updates[0]).toMatchObject({ titleText: "Confirmed title", bulletPoints: JSON.stringify(["Confirmed bullet"]), remoteId: 3, status: "analyzing" });
    expect(JSON.parse(updates[0].crawledData)).toEqual(expect.objectContaining({ source: "unified_amazon_acquisition", confirmedSnapshotId: 3 }));
    expect(updates[0].crawledData).not.toContain("providerPayload");
  });

  it("rejects a consumer row whose ASIN does not match the confirmed snapshot", async () => {
    const confirmed = {
      id: 3, snapshotId: 2, asin: normalized.asin, confirmedData: normalized,
      confirmedAssetIds: [], fieldStatuses, contentHash: "b".repeat(64), confirmationVersion: 1,
    };
    const { db } = mockDb([[confirmed], [], [{ id: 17, userId: 5, workspaceId: 9, asin: "B099999999" }]]);
    await expect(projectConfirmedSnapshotToLegacyConsumer({
      db, workspaceId: 9, confirmedSnapshotId: 3, requestedBy: 5,
      consumerType: "kb_listing", consumerRef: "kb-listing:17",
    })).rejects.toThrow("target mismatch");
  });
});
