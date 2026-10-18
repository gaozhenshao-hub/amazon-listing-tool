import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { acquisitionReviewCanonical, AcquisitionReviewWriteResultSchema } from "../../../shared/acquisitionReview";
import type { SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
import { createManualSnapshotReviewTestFixture } from "./manualSnapshotReview.testFixture";
import { normalizeApifyAmazonArtifact } from "./amazonNormalizer";
import { createManualSnapshotImageStorage, manualSnapshotImageBytesHash, type ManualSnapshotPreparedImage } from "./manualSnapshotImageStorage";
import { createManualSnapshotImageRecovery, type ManualSnapshotImageRecoveryRepository } from "./manualSnapshotImageRecovery";

/** Real review repository/journal/revision replay and actual sharp validation;
 * only the S3/OSS/CDN transports and database wire protocol are synthetic.
 * This does not constitute native MySQL or production/provider acceptance. */
async function fixture() {
  const f = createManualSnapshotReviewTestFixture(), objects = new Map<string, Buffer>();
  const image = await sharp({ create: { width: 4, height: 3, channels: 4, background: "#246813" } }).png().toBuffer();
  const sourceUrl = "https://m.media-amazon.com/images/I/raw-original.png";
  const raw = Buffer.from(JSON.stringify([{ asin: f.state.snapshot.asin, title: "Original title", brand: "Original brand", highResolutionImages: [sourceUrl] }]));
  const normalized = normalizeApifyAmazonArtifact({ bytes: raw, expectedAsin: f.state.snapshot.asin, marketplace: "US" });
  Object.assign(f.state.snapshot, { normalizedData: { ...normalized.snapshot, research: f.state.snapshot.normalizedData.research }, sourceHash: normalized.sourceHash, fieldStatuses: normalized.snapshot.fieldEvidence });
  Object.assign(f.state.assets[0], { sourceJsonPath: normalized.sourceAssets[0].sourcePath, sourceUrlHash: normalized.sourceAssets[0].sourceUrlHash });
  const rawKey = `acquisition/7/runs/41/${manualSnapshotImageBytesHash(raw)}.json`;
  Object.assign(f.state.artifact, { storageKey: `storage://s3/${rawKey}`, contentHash: manualSnapshotImageBytesHash(raw), sizeBytes: raw.length }); objects.set(rawKey, raw);
  let transactions = 0;
  const control = { losePutAck: false, ackLostMode: null as "write" | "recover" | null, afterGet: null as (() => void | Promise<void>) | null };
  const repository: ManualSnapshotImageRecoveryRepository = { async transaction(identity, scope, mode, body) {
    transactions++;
    if (control.ackLostMode === mode) { control.ackLostMode = null; f.control.commitAckLost = true; }
    try { return await f.repository.transaction(identity, scope, mode, body); } finally { transactions--; }
  } };
  const put = vi.fn(async (key: string, bytes: string | Uint8Array) => {
    expect(transactions).toBe(0);
    expect(f.state.audits.some(row => row.action === "acquisition.review.prepare")).toBe(true);
    objects.set(key, typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes));
    if (control.losePutAck) throw new Error("private provider PUT timeout with secret URL");
    return { key, storageUri: `storage://s3/${key}`, url: "https://objects.invalid/not-for-client?signature=secret" };
  });
  const get = vi.fn(async (key: string) => {
    expect(transactions).toBe(0);
    return { key, url: `https://objects.synthetic.invalid/original?key=${encodeURIComponent(key)}` };
  });
  const request = vi.fn(async (rawUrl: string | URL) => {
    const url = new URL(rawUrl);
    expect(transactions).toBe(0);
    const body = url.hostname === "m.media-amazon.com" ? image : objects.get(url.searchParams.get("key") ?? "");
    await control.afterGet?.();
    return { ok: Boolean(body), status: body ? 200 : 404, body: body ?? Buffer.alloc(0) } as SafeHttpResponse;
  });
  const storage = createManualSnapshotImageStorage({ assertPrivate: () => undefined, provider: () => "s3", configured: () => true, put, get, request });
  const service = createManualSnapshotImageRecovery({ repository, storage });
  const input = async (sourceAssetId: number | null = null) => ({ ...f.scope, operationId: f.operationId,
    expectedRevisionHash: (await f.service.read(f.ctx, f.scope)).revisionHash, mode: "supplement" as const, sourceAssetId, role: "secondary" as const,
    fileName: "original-pixels.png", base64: image.toString("base64") });
  const recover = (decision: "check" | "complete_image" | "cancel", operationId = f.operationId) => service.recover(f.identity, { ...f.scope, operationId, decision });
  const prepared = () => JSON.parse(String(f.state.audits.find(row => row.action === "acquisition.review.prepare")?.metadata)).prepared as ManualSnapshotPreparedImage;
  return { ...f, image, raw, rawKey, objects, storage, recovery: service, sourceUrl, controlImage: control, put, get, request, input, recover, prepared };
}

describe("manual snapshot image durable recovery flow", () => {
  it("appends an original-byte supplemental asset and immutable pending revision without changing old confirmed data", async () => {
    const f = await fixture(), oldAsset = structuredClone(f.state.assets[0]), oldSnapshot = structuredClone(f.state.snapshot), input = await f.input();
    const receipt = await f.recovery.upload(f.identity, input);
    expect(receipt).toMatchObject({ status: "committed", action: "image", revisionVersion: 1, confirmedSnapshotId: null });
    expect(f.state.assets).toHaveLength(2); expect(f.state.assets[0]).toEqual(oldAsset); expect(f.state.snapshot).toEqual(oldSnapshot);
    expect(f.state.revisions).toHaveLength(1); expect(f.state.confirmed).toHaveLength(0); expect(f.state.published).toHaveLength(0);
    expect(f.state.assets[1]).toMatchObject({ role: "secondary", reviewStatus: "pending", contentHash: manualSnapshotImageBytesHash(f.image), width: 4, height: 3 });
    expect(f.objects.get(f.prepared().objectKey)).toEqual(f.image); expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.put).toHaveBeenCalledWith(f.prepared().objectKey, f.image, "image/png", { maxAttempts: 1 });
    const after = await f.service.read(f.ctx, f.scope);
    expect(after.assets[1]).toMatchObject({ origin: "supplement", replacesAssetId: null, decision: "keep" });
    expect(after.original.research).toEqual(oldSnapshot.normalizedData.research);
    expect(AcquisitionReviewWriteResultSchema.safeParse(receipt).success).toBe(true);
    expect(acquisitionReviewCanonical(receipt)).not.toMatch(/base64|storage:\/\/|objectKey|signature|https:/u);
    expect(JSON.stringify(f.state.audits)).not.toContain(input.base64);
  });
  it("preserves the exact old asset while linking an explicit replacement in new revision provenance", async () => {
    const f = await fixture(), oldAsset = structuredClone(f.state.assets[0]);
    await f.recovery.upload(f.identity, await f.input(oldAsset.id));
    expect(f.state.assets[0]).toEqual(oldAsset);
    const view = await f.service.read(f.ctx, f.scope);
    expect(view.assets.find(asset => asset.id === oldAsset.id)?.decision).toBe("delete");
    expect(view.assets.at(-1)).toMatchObject({ origin: "supplement", replacesAssetId: oldAsset.id, decision: "keep" });
  });
  it("retries only the exact raw-artifact role/path/URL hash, never a page/provider/model", async () => {
    const f = await fixture(); Object.assign(f.state.assets[0], { storageKey: null, contentHash: null, fieldStatus: "download_failed" });
    const oldAsset = structuredClone(f.state.assets[0]);
    const input = { ...f.scope, operationId: f.operationId, expectedRevisionHash: (await f.service.read(f.ctx, f.scope)).revisionHash,
      mode: "retry_original" as const, sourceAssetId: oldAsset.id };
    const receipt = await f.recovery.upload(f.identity, input);
    expect(receipt.status).toBe("committed"); expect(f.state.assets[0]).toEqual(oldAsset);
    expect(f.state.assets[1]).toMatchObject({ role: "main", positionIndex: 1, sourceJsonPath: oldAsset.sourceJsonPath, sourceUrlHash: oldAsset.sourceUrlHash });
    expect(f.request.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["objects.synthetic.invalid", "m.media-amazon.com", "objects.synthetic.invalid"]);
    expect(f.put).toHaveBeenCalledTimes(1);
  });
  it("does not refetch an already stored original or accept a browser-supplied original URL", async () => {
    const f = await fixture(), input = { ...f.scope, operationId: f.operationId, expectedRevisionHash: (await f.service.read(f.ctx, f.scope)).revisionHash,
      mode: "retry_original" as const, sourceAssetId: f.state.assets[0].id };
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("ORIGINAL_ALREADY_STORED");
    await expect(f.recovery.upload(f.identity, { ...input, sourceUrl: "https://m.media-amazon.com/other.png" } as typeof input)).rejects.toThrow();
    expect(f.get).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
  });
  it("refuses an arbitrary URL even when it is present inside the hash-verified original artifact", async () => {
    const f = await fixture(), raw = Buffer.from(JSON.stringify([{ asin: f.state.snapshot.asin, highResolutionImages: ["https://evil.example.test/image.png"] }]));
    const normalized = normalizeApifyAmazonArtifact({ bytes: raw, expectedAsin: f.state.snapshot.asin, marketplace: "US" });
    Object.assign(f.state.snapshot, { normalizedData: normalized.snapshot, sourceHash: normalized.sourceHash });
    Object.assign(f.state.assets[0], { storageKey: null, sourceJsonPath: normalized.sourceAssets[0].sourcePath, sourceUrlHash: normalized.sourceAssets[0].sourceUrlHash });
    const key = `acquisition/7/runs/41/${manualSnapshotImageBytesHash(raw)}.json`;
    Object.assign(f.state.artifact, { storageKey: `storage://s3/${key}`, contentHash: manualSnapshotImageBytesHash(raw), sizeBytes: raw.length }); f.objects.set(key, raw);
    const input = { ...f.scope, operationId: f.operationId, expectedRevisionHash: (await f.service.read(f.ctx, f.scope)).revisionHash,
      mode: "retry_original" as const, sourceAssetId: f.state.assets[0].id };
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("SOURCE_UNVERIFIED");
    expect(f.request.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["objects.synthetic.invalid"]); expect(f.put).not.toHaveBeenCalled();
  });
  it("a PUT timeout persists unknown state and same UUID replay performs no second PUT or source fetch", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true;
    expect((await f.recovery.upload(f.identity, input)).status).toBe("unknown");
    expect(f.state.audits).toHaveLength(1); expect(f.state.assets).toHaveLength(1); expect(f.state.revisions).toHaveLength(0);
    expect((await f.recovery.upload(f.identity, input)).status).toBe("unknown");
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.get).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it("the original UUID check is read-only and explicit complete can finish while new writes are disabled", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true;
    await f.recovery.upload(f.identity, input); f.control.enabled = false;
    expect((await f.recover("check")).status).toBe("unknown"); expect(f.state.assets).toHaveLength(1);
    const committed = await f.recover("complete_image"); expect(committed.status).toBe("committed");
    expect(await f.recover("complete_image")).toEqual(committed); expect(await f.recover("check")).toEqual(committed);
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.state.assets).toHaveLength(2); expect(f.state.revisions).toHaveLength(1);
  });
  it("a missing object is unknown, not permission to re-PUT under the old UUID", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true;
    await f.recovery.upload(f.identity, input); f.objects.delete(f.prepared().objectKey);
    expect((await f.recover("complete_image")).status).toBe("unknown");
    expect((await f.recovery.upload(f.identity, input)).status).toBe("unknown");
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.state.revisions).toHaveLength(0);
  });
  it("another UUID cannot blindly re-upload while the first durable operation is unresolved", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true; await f.recovery.upload(f.identity, input);
    await expect(f.recovery.upload(f.identity, { ...input, operationId: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow("IMAGE_OPERATION_PENDING");
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.state.audits).toHaveLength(1);
  });
  it("cancel fences a late verified object without deleting it or mutating assets", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true; await f.recovery.upload(f.identity, input);
    const key = f.prepared().objectKey; f.control.enabled = false;
    const cancelled = await f.recover("cancel"); expect(cancelled.status).toBe("cancelled");
    expect(await f.recover("complete_image")).toEqual(cancelled); expect(await f.recovery.upload(f.identity, input)).toEqual(cancelled);
    expect(f.objects.get(key)).toEqual(f.image); expect(f.state.assets).toHaveLength(1); expect(f.put).toHaveBeenCalledTimes(1);
  });
  it("cancellation racing a bounded GET wins before final transaction append", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true; await f.recovery.upload(f.identity, input);
    f.controlImage.afterGet = async () => { f.controlImage.afterGet = null; await f.recover("cancel"); };
    expect((await f.recover("complete_image")).status).toBe("cancelled"); expect(f.state.revisions).toHaveLength(0); expect(f.state.assets).toHaveLength(1);
  });
  it("a lost prepare commit ACK never permits a PUT; same UUID remains recoverable without new writes", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.ackLostMode = "write";
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("COMMIT_UNKNOWN");
    expect(f.state.audits).toHaveLength(1); expect(f.put).not.toHaveBeenCalled();
    expect((await f.recovery.upload(f.identity, input)).status).toBe("unknown");
    f.control.enabled = false; expect((await f.recover("cancel")).status).toBe("cancelled"); expect(f.put).not.toHaveBeenCalled();
  });
  it("a lost final commit ACK is resolved by the original UUID without another PUT", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.ackLostMode = "recover";
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("COMMIT_UNKNOWN");
    expect(f.state.assets).toHaveLength(2); expect(f.state.revisions).toHaveLength(1);
    expect((await f.recover("check")).status).toBe("committed"); expect(f.put).toHaveBeenCalledTimes(1);
  });
  it.each(["workspace", "project", "snapshot", "actor"])("rejects changed %s scope before any storage I/O", async kind => {
    const f = await fixture(), input = await f.input(), identity = { ...f.identity };
    if (kind === "workspace") input.expectedWorkspaceId++;
    if (kind === "project") input.expectedProjectId = 12;
    if (kind === "snapshot") input.snapshotId++;
    if (kind === "actor") identity.userId = 4;
    await expect(f.recovery.upload(identity, input)).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it("rechecks fresh actor access after object verification before transaction append", async () => {
    const f = await fixture(), input = await f.input();
    f.controlImage.afterGet = () => { f.state.actor.status = "disabled"; };
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("ACCESS_DENIED");
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.state.assets).toHaveLength(1); expect(f.state.revisions).toHaveLength(0);
  });
  it("rechecks the exact original source CAS after a successful GET", async () => {
    const f = await fixture(), input = await f.input();
    f.controlImage.afterGet = () => { f.state.snapshot.updatedAt = "2026-10-19 01:00:01.000000"; };
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("REVISION_CONFLICT");
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.state.assets).toHaveLength(1); expect(f.state.revisions).toHaveLength(0);
  });
  it.each(["bad-raw-hash", "wrong-path", "wrong-role", "wrong-url-hash", "missing-address"])("does not recover a bad original: %s", async kind => {
    const f = await fixture(); Object.assign(f.state.assets[0], { storageKey: null, contentHash: null, fieldStatus: "download_failed" });
    if (kind === "bad-raw-hash") f.objects.set(f.rawKey, Buffer.alloc(f.raw.length));
    if (kind === "wrong-path") f.state.assets[0].sourceJsonPath = "$.unrelated[0]";
    if (kind === "wrong-role") f.state.assets[0].role = "aplus";
    if (kind === "wrong-url-hash") f.state.assets[0].sourceUrlHash = "e".repeat(64);
    if (kind === "missing-address") {
      const raw = Buffer.from(JSON.stringify([{ asin: f.state.snapshot.asin, title: "Original title" }]));
      const normalized = normalizeApifyAmazonArtifact({ bytes: raw, expectedAsin: f.state.snapshot.asin, marketplace: "US" });
      Object.assign(f.state.snapshot, { normalizedData: normalized.snapshot, sourceHash: normalized.sourceHash });
      const key = `acquisition/7/runs/41/${manualSnapshotImageBytesHash(raw)}.json`;
      Object.assign(f.state.artifact, { storageKey: `storage://s3/${key}`, contentHash: manualSnapshotImageBytesHash(raw), sizeBytes: raw.length }); f.objects.set(key, raw);
    }
    const input = { ...f.scope, operationId: f.operationId, expectedRevisionHash: (await f.service.read(f.ctx, f.scope)).revisionHash,
      mode: "retry_original" as const, sourceAssetId: f.state.assets[0].id };
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow("ACQUISITION_IMAGE_ORIGINAL");
    expect(f.put).not.toHaveBeenCalled(); expect(f.request.mock.calls.some(([url]) => new URL(url).hostname === "m.media-amazon.com")).toBe(false);
    expect(f.state.audits).toHaveLength(0);
  });
  it.each(["base64", "file-type", "signature", "foreign-asset", "off", "stale"])("refuses invalid supplemental input %s before PUT", async kind => {
    const f = await fixture(), input = await f.input();
    if (kind === "base64") input.base64 = "YR==";
    if (kind === "file-type") input.fileName = "original.jpg";
    if (kind === "signature") input.base64 = Buffer.from("<html>not an image</html>").toString("base64");
    if (kind === "foreign-asset") input.sourceAssetId = 999;
    if (kind === "off") f.control.enabled = false;
    if (kind === "stale") input.expectedRevisionHash = "e".repeat(64);
    await expect(f.recovery.upload(f.identity, input)).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled(); expect(f.state.audits).toHaveLength(0); expect(f.state.assets).toHaveLength(1);
  });
  it("rejects a changed request under a prepared UUID and under an already committed UUID", async () => {
    const f = await fixture(), input = await f.input(); f.controlImage.losePutAck = true; await f.recovery.upload(f.identity, input);
    await expect(f.recovery.upload(f.identity, { ...input, fileName: "changed.png" })).rejects.toThrow("CONTENT_CONFLICT");
    await f.recover("complete_image");
    await expect(f.recovery.upload(f.identity, { ...input, role: "aplus" })).rejects.toThrow("CONTENT_CONFLICT"); expect(f.put).toHaveBeenCalledTimes(1);
  });
  it("does not submit a new image when only an absent UUID is checked or completed", async () => {
    const f = await fixture(); f.control.enabled = false;
    expect((await f.recover("check")).status).toBe("unknown"); expect((await f.recover("complete_image")).status).toBe("unknown");
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.state.audits).toHaveLength(0);
  });
});
