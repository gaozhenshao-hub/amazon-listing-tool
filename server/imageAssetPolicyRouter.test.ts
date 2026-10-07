import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  register: vi.fn(),
  review: vi.fn(),
  requireUse: vi.fn(),
  listEvidence: vi.fn(),
  listMyEvidence: vi.fn(),
  reviewEvidence: vi.fn(),
  previewEvidence: vi.fn(),
}));

vi.mock("./domains/image/services/imageAssetPolicyService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageAssetPolicyService")>();
  return {
    ...actual,
    imageAssetPolicyService: {
      listCurrentPolicies: mocks.list,
      registerReceiptAsset: mocks.register,
      reviewAssetPolicy: mocks.review,
      requireCurrentApprovedAssetUse: mocks.requireUse,
    },
  };
});
vi.mock("./domains/image/services/imageAssetTrustLedgerService", () => ({
  imageAssetTrustLedgerService: {
    listLicenseEvidenceForReview: mocks.listEvidence,
    listMyLicenseEvidence: mocks.listMyEvidence,
    reviewLicenseEvidence: mocks.reviewEvidence,
    createLicenseEvidencePreview: mocks.previewEvidence,
  },
}));

import { router } from "./_core/trpc";
import { imageAssetPolicyProcedures } from "./domains/image/routers/assetPolicy";

const callerFactory = router(imageAssetPolicyProcedures);
function context(role: "user" | "designer" | "admin" | "super_admin" = "user", workspaceId: number | null = 7): TrpcContext {
  return {
    user: { id: 17, role, openId: "asset-policy-user", email: "asset-policy@test.local", name: "Asset Policy",
      loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    workspaceId,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const proof = { proofRecordId: "license-17", proofType: "signed_license", grantSummary: "Authorized for current project." };
const receipt = "https://storage.example.invalid/private.png#imageAsset=synthetic";

describe("image asset policy tRPC router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.register.mockResolvedValue({ assetId: "asset-1", revision: 1, reviewState: "pending_review" });
    mocks.review.mockResolvedValue({ assetId: "asset-1", revision: 2, reviewState: "approved" });
    mocks.requireUse.mockResolvedValue({ assetId: "asset-1", revision: 2, reviewState: "approved" });
    mocks.listEvidence.mockResolvedValue([]);
    mocks.listMyEvidence.mockResolvedValue([]);
    mocks.reviewEvidence.mockResolvedValue({ evidenceRecordId: "license_00000000-0000-4000-8000-000000000001", version: 2, status: "verified" });
    mocks.previewEvidence.mockResolvedValue({ previewUrl: "https://private.example.invalid/signed-proof.pdf?expires=300" });
  });

  it("binds workspace and actor to authenticated context rather than browser input", async () => {
    const caller = callerFactory.createCaller(context("user", 7));
    await caller.registerReceiptAsset({ projectId: 51, expectedRevision: 0, originKind: "own_product", receiptReference: receipt,
      requestedUses: ["step4_reference"], licenseEvidence: proof, source: { sourceRole: "main", sourcePosition: 0 } });
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7, projectId: 51, actorId: 17, actorRole: "user", expectedRevision: 0,
    }));
  });

  it("rejects an absent current workspace before calling the service", async () => {
    await expect(callerFactory.createCaller(context("admin", null)).listAssetPolicies({ projectId: 51 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not expose an unauthenticated policy route", async () => {
    const unauthenticated = callerFactory.createCaller({ ...context(), user: null });
    await expect(unauthenticated.listAssetPolicies({ projectId: 51 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("accepts only own-product or designer registration origins and bounded source fields", async () => {
    const caller = callerFactory.createCaller(context());
    await expect(caller.registerReceiptAsset({ projectId: 51, expectedRevision: 0, originKind: "competitor_research" as never,
      receiptReference: receipt, requestedUses: ["step4_reference"], licenseEvidence: proof,
      source: { sourceRole: "main", sourcePosition: 0 } })).rejects.toThrow();
    await expect(caller.registerReceiptAsset({ projectId: 51, expectedRevision: 0, originKind: "designer_upload",
      receiptReference: receipt, requestedUses: ["designer_attachment"], licenseEvidence: proof,
      source: { sourceRole: "secondary", sourcePosition: -1 } })).rejects.toThrow();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("passes review and consumer-use CAS inputs without adding a download or URL-copy operation", async () => {
    const caller = callerFactory.createCaller(context("admin"));
    await caller.reviewAssetPolicy({ projectId: 51, assetId: "asset-1", expectedRevision: 1, decision: "approve",
      allowedUses: ["step4_reference"], licenseEvidence: proof });
    await caller.requireApprovedAssetUse({ projectId: 51, assetId: "asset-1", expectedRevision: 2, allowedUse: "step4_reference" });
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ actorRole: "admin", expectedRevision: 1 }));
    expect(mocks.requireUse).toHaveBeenCalledWith(expect.objectContaining({ actorId: 17, workspaceId: 7, expectedRevision: 2 }));
  });

  it("restricts the license evidence queue and policy review list to administrators", async () => {
    const userCaller = callerFactory.createCaller(context("user"));
    await expect(userCaller.listLicenseEvidenceForReview({ projectId: 51 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(userCaller.createLicenseEvidencePreview({ projectId: 51,
      evidenceRecordId: "license_00000000-0000-4000-8000-000000000001", expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(userCaller.listAssetPolicies({ projectId: 51 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listEvidence).not.toHaveBeenCalled();
    expect(mocks.previewEvidence).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();

    const adminCaller = callerFactory.createCaller(context("admin"));
    await adminCaller.listLicenseEvidenceForReview({ projectId: 51 });
    await adminCaller.reviewLicenseEvidence({ projectId: 51,
      evidenceRecordId: "license_00000000-0000-4000-8000-000000000001", expectedVersion: 1, decision: "verify" });
    const preview = await adminCaller.createLicenseEvidencePreview({ projectId: 51,
      evidenceRecordId: "license_00000000-0000-4000-8000-000000000001", expectedVersion: 1 });
    expect(mocks.listEvidence).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 7, actorRole: "admin" }));
    expect(mocks.reviewEvidence).toHaveBeenCalledWith(expect.objectContaining({ actorId: 17, actorRole: "admin" }));
    expect(mocks.previewEvidence).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 7, projectId: 51, actorRole: "admin", expectedVersion: 1 }));
    expect(preview).toEqual({ previewUrl: "https://private.example.invalid/signed-proof.pdf?expires=300" });
  });

  it("lets an uploader read only their status summary, never a proof URL, key, or hash", async () => {
    mocks.listMyEvidence.mockResolvedValueOnce([{
      evidenceRecordId: "license_00000000-0000-4000-8000-000000000001",
      version: 1,
      status: "pending_review",
      proofType: "signed_license",
      grantSummary: "Authorized for current project.",
      proofMaterialStorageUri: "storage://s3/private-proof.pdf",
      proofMaterialSha256: "a".repeat(64),
    }]);
    const result = await callerFactory.createCaller(context("user")).listMyLicenseEvidence({ projectId: 51 });
    expect(mocks.listMyEvidence).toHaveBeenCalledWith(expect.objectContaining({ actorId: 17, workspaceId: 7 }));
    expect(JSON.stringify(result)).not.toContain("private-proof.pdf");
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
  });

  it("never serializes private object storage references or byte hashes to the browser", async () => {
    mocks.requireUse.mockResolvedValueOnce({ assetId: "asset-1", revision: 2, reviewState: "approved",
      allowedUses: ["step4_reference"], originKind: "own_product", policyHash: "policy-hash",
      reviewedAt: new Date(), hasLicenseEvidence: true,
      storageRef: "private/project/key", contentHash: "a".repeat(64), proofMaterialStorageUri: "storage://forge/private-proof.pdf" });
    const result = await callerFactory.createCaller(context()).requireApprovedAssetUse({ projectId: 51,
      assetId: "asset-1", expectedRevision: 2, allowedUse: "step4_reference" });
    expect(result).toMatchObject({ assetId: "asset-1", reviewState: "approved" });
    expect(JSON.stringify(result)).not.toContain("private/project/key");
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
    expect(JSON.stringify(result)).not.toContain("policy-hash");
    expect(JSON.stringify(result)).not.toContain("private-proof.pdf");
  });
});
