import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createManualKbImageDeliveryGate } from "./kbManualImageDelivery";
const owner = { userId: 3, workspaceId: 7 };
const set = { id: 10, ...owner, asin: "B012345678", visibility: "private", originInstanceId: "manual_acquisition_review_v1", remoteId: 41, syncVersion: 2 };
const image = { id: 20, imageSetId: 10, imageUrl: "storage://s3/acquisition/7/snapshots/21/main/original.png", imagePosition: "main", positionIndex: 0,
  aplusModuleType: null, aplusModuleClass: null };
const verified = { mode: "manual_revision" as const, status: "verified" as const, revisionVersion: 2, confirmedSnapshotId: 41, kept: 1, excluded: 1, total: 2 };
const unavailable = { mode: "manual_revision" as const, status: "unavailable" as const, reasonCode: "MANUAL_VERSION_UNVERIFIED" as const };
function fixture() {
  const getSet = vi.fn(async () => ({ ...set })), images = vi.fn(async () => [{ ...image }]), database = vi.fn(async () => ({}));
  const coverage = vi.fn(async () => verified as typeof verified | typeof unavailable);
  const dependencies = { getSet, images, database, coverage } as unknown as NonNullable<Parameters<typeof createManualKbImageDeliveryGate>[1]>;
  return { getSet, images, database, coverage, create: () => createManualKbImageDeliveryGate(owner, dependencies) };
}
describe("request-local manual KB image delivery gate", () => {
  it("replays complete images for a filtered selection and caches only inside this request", async () => {
    const f = fixture(), delivery = f.create();
    expect(await delivery.selection([image])).toEqual([image]);
    expect(await delivery.forSet(set, [image])).toEqual({ images: [image], sourceCoverage: verified });
    expect(f.getSet).toHaveBeenCalledWith(10, 3, 7); expect(f.coverage).toHaveBeenCalledTimes(1);
    await f.create().selection([image]); expect(f.coverage).toHaveBeenCalledTimes(2);
  });
  it("checks a thumbnail's emitted fields even though thumbnail omits A+ metadata", async () => {
    const f = fixture(); const { aplusModuleType: _type, aplusModuleClass: _class, ...thumbnail } = image;
    expect((await f.create().forSet(set, [thumbnail])).images).toEqual([thumbnail]);
    await expect(f.create().forSet(set, [{ ...thumbnail, imageUrl: "storage://s3/acquisition/8/private.png" }])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("shows unavailable thumbnails without a pointer but rejects incomplete export rather than returning an empty successful bundle", async () => {
    const f = fixture(); f.coverage.mockResolvedValue(unavailable);
    expect(await f.create().forSet(set, [image])).toEqual({ images: [], sourceCoverage: unavailable });
    await expect(f.create().selection([image])).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "MANUAL_KB_IMAGE_SOURCE_UNVERIFIED" });
  });
  it.each([{ userId: 4 }, { workspaceId: 8 }, { visibility: "team" }])("does not widen manual private scope for %j", async change => {
    const f = fixture(); f.getSet.mockResolvedValue({ ...set, ...change });
    await expect(f.create().selection([image])).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.images).not.toHaveBeenCalled();
  });
  it("preserves a real authorization error instead of silently omitting the denied version", async () => {
    const f = fixture(); f.coverage.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "REVOKED" }));
    await expect(f.create().selection([image])).rejects.toMatchObject({ code: "FORBIDDEN", message: "REVOKED" });
  });
  it("rejects >300 full manual images before database proof and never truncates into a valid subset", async () => {
    const f = fixture(); f.images.mockResolvedValue(Array.from({ length: 301 }, (_, index) => ({ ...image, id: index + 1 })));
    await expect(f.create().selection([image])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.coverage).not.toHaveBeenCalled();
  });
  it.each(["duplicate", "missing", "wrong-position", "wrong-module"])("does not deliver a %s selected row", async kind => {
    const f = fixture(); const selected = kind === "duplicate" ? [image, image] : [{ ...image,
      ...(kind === "missing" ? { id: 99 } : kind === "wrong-position" ? { positionIndex: 1 } : { aplusModuleType: "changed" }) }];
    await expect(f.create().selection(selected)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("leaves legacy direct/shared rows unchanged without opening the manual proof path", async () => {
    const f = fixture(); f.getSet.mockResolvedValue({ ...set, originInstanceId: "unified_amazon_acquisition", userId: 4, visibility: "team" });
    expect(await f.create().selection([image])).toEqual([image]); expect(f.coverage).not.toHaveBeenCalled(); expect(f.images).not.toHaveBeenCalled();
  });
});
