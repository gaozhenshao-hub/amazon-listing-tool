import type { ImageAssetKind } from "./imageAssetReceipt";

export type AssetLicenseEvidence = {
  proofRecordId: string;
  proofType: string;
  grantSummary: string;
};

/** Metadata must come from the server-side controlled storage/receipt ledger. */
export type VerifiedReceiptAsset = {
  contentHash: string;
  storageRef: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
};

export type ReceiptAssetResolver = (input: {
  receipt: { key: string; url: string; kind: ImageAssetKind };
  projectId: number;
  uploadedBy: number;
}) => Promise<VerifiedReceiptAsset>;

export type LicenseEvidenceVerifier = (input: {
  evidence: AssetLicenseEvidence;
  asset: VerifiedReceiptAsset;
  originKind: "own_product" | "designer_upload";
  projectId: number;
}) => Promise<boolean>;

/** Revalidates the durable evidence/receipt binding on every consumption. */
export type CurrentPolicyEvidenceVerifier = (input: {
  workspaceId: number;
  projectId: number;
  originKind: "own_product" | "designer_upload";
  originRecordType: string;
  originRecordId: string;
  asset: Pick<VerifiedReceiptAsset, "contentHash" | "storageRef">;
  evidence: AssetLicenseEvidence | null;
}) => Promise<boolean>;
