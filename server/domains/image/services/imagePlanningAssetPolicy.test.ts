import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createImagePlanningTestFixture } from "./imagePlanning.testFixture";
import { buildHumanConfirmedStageDraft, materializeImmutableStageSnapshot, immutableDigest } from "./imageWorkflowVersionPolicy";
import type { AuthorizedAssetUse } from "./imageAssetPolicyService";
const approved: AuthorizedAssetUse = { assetId: "asset-synthetic", originKind: "own_product", allowedUses: ["approved_deliverable"], reviewState: "approved", revision: 2,
  contentHash: "c".repeat(64), storageRef: "storage://synthetic/safe.png", reviewedAt: new Date("2026-10-19T00:00:00Z"), hasLicenseEvidence: true };
function attach(f: ReturnType<typeof createImagePlanningTestFixture>) {
  const policyHash = immutableDigest({ assetId: approved.assetId, originKind: approved.originKind, allowedUses: [...approved.allowedUses].sort(),
    reviewState: approved.reviewState, revision: approved.revision, contentHash: approved.contentHash, storageRef: approved.storageRef });
  const rows = f.state.snapshots;
  for (let step = 0; step < 2; step++) {
    const old = rows[step], content = JSON.parse(String(old.contentJson));
    const draft = buildHumanConfirmedStageDraft({ workspaceId: 7, projectId: 8, sessionId: 9, step: step as 0 | 1, content, contentRevision: 1,
      contentOrigin: "human_confirmed", sourceConfirmed: true, assetDependencies: step ? [] : [{ assetId: approved.assetId, purpose: "SYNTHETIC saved asset", allowedUse: "approved_deliverable",
        originKind: approved.originKind, reviewState: "approved", policyRevision: approved.revision, policyHash, contentHash: approved.contentHash, contentReferences: [approved.storageRef], includedInExport: true }] },
    step ? [{ step: 0, version: 1, snapshotDigest: String(rows[0].snapshotDigest) }] : []);
    const snapshot = materializeImmutableStageSnapshot({ draft, version: 1, confirmedBy: 3, confirmedAt: new Date("2026-10-19T00:00:00Z") });
    rows[step] = { ...snapshot, contentJson: JSON.stringify(content), assetDependenciesJson: JSON.stringify(snapshot.assetDependencies), dependenciesJson: JSON.stringify(snapshot.dependencies), state: "confirmed" };
  }
}
describe("Image Step2 current asset policy integration", () => {
  it("rechecks the exact saved dependency on the consuming source transaction, without opening another transaction or sending pixels", async () => {
    const policyReader = vi.fn(async () => approved), f = createImagePlanningTestFixture({ policyReader }); attach(f); await f.submitted();
    expect(policyReader).toHaveBeenCalled(); expect(policyReader.mock.calls[0]).toEqual([f.tx, { workspaceId: 7, projectId: 8, actorId: 3, actorRole: "super_admin", assetId: approved.assetId, allowedUse: "approved_deliverable", expectedRevision: 2 }]);
    expect(f.providerContexts).toHaveLength(0);
  });
  it.each(["revision", "hash", "origin", "revoked", "license", "engine"])("rejects current %s changes rather than trusting historic approval", async kind => {
    const policyReader = vi.fn(async () => { if (kind === "license") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SYNTHETIC evidence revoked" });
      return { ...approved, ...(kind === "revision" ? { revision: 3 } : {}), ...(kind === "hash" ? { contentHash: "d".repeat(64) } : {}),
        ...(kind === "origin" ? { originKind: "designer_upload" as const } : {}), ...(kind === "revoked" ? { reviewState: "revoked" as const } : {}) }; });
    const f = createImagePlanningTestFixture({ policyReader }); attach(f); if (kind === "engine") f.control.nonTransactionalTable = "image_asset_policy_revisions";
    await expect(f.submitted()).rejects.toThrow(); expect(f.state.jobs).toHaveLength(0); expect(f.providerContexts).toHaveLength(0);
  });
});
