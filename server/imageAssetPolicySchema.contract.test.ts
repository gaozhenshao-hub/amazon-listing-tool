import fs from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../drizzle/schema";
import {
  IMAGE_ACQUISITION_COVERAGE_CAPABILITIES,
  IMAGE_ACQUISITION_COVERAGE_STATES,
  IMAGE_ASSET_ALLOWED_USES,
  IMAGE_ASSET_ORIGIN_KINDS,
  IMAGE_ASSET_REVIEW_STATES,
  imageAcquisitionCapabilityCoverageRevisions,
  imageAssetPolicyRevisions,
  imageAssetSourceReferences,
  imageAssets,
} from "../drizzle/schema/imageAssetPolicies";
import { repoPath } from "./testPaths";

const migrationPath = repoPath("drizzle/0205_image_asset_policy.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.keys(getTableColumns(table)).sort();
}

describe("Phase C image asset policy schema contract", () => {
  it("exports the four additive governance tables through the schema barrel", () => {
    expect([
      getTableName(imageAssets),
      getTableName(imageAssetPolicyRevisions),
      getTableName(imageAssetSourceReferences),
      getTableName(imageAcquisitionCapabilityCoverageRevisions),
    ]).toEqual([
      "image_assets",
      "image_asset_policy_revisions",
      "image_asset_source_references",
      "image_acquisition_capability_coverage_revisions",
    ]);
    expect(schema.imageAssets).toBe(imageAssets);
    expect(schema.imageAssetPolicySchema.imageAssetPolicyRevisions).toBe(imageAssetPolicyRevisions);
  });

  it("keeps byte identity workspace-scoped while preserving every semantic source role reference", () => {
    expect(columnNames(imageAssets)).toEqual(expect.arrayContaining([
      "assetId", "workspaceId", "contentHash", "storageRef", "contentType", "sizeBytes", "width", "height",
    ]));
    expect(columnNames(imageAssetSourceReferences)).toEqual(expect.arrayContaining([
      "assetId", "workspaceId", "projectId", "sourceSnapshotId", "sourceRole", "sourceModule", "sourcePosition", "sourceReferenceKey",
    ]));
    expect(migrationSql).toContain("UNIQUE KEY `uk_image_asset_workspace_hash` (`workspaceId`,`contentHash`)");
    expect(migrationSql).toContain("UNIQUE KEY `uk_image_asset_source_reference_scope_key` (`workspaceId`,`projectId`,`sourceReferenceKey`)");
    expect(migrationSql).toContain("KEY `idx_image_asset_source_snapshot_role_position` (`workspaceId`,`sourceSnapshotId`,`sourceRole`,`sourceModule`,`sourcePosition`)");
  });

  it("models immutable project policy revisions, legacy unclassified data, and explicit Step 4 eligibility", () => {
    expect(columnNames(imageAssetPolicyRevisions)).toEqual(expect.arrayContaining([
      "assetId", "workspaceId", "projectId", "sourceReferenceId", "originKind", "originRecordType", "originRecordId",
      "contentHash", "allowedUsesJson", "licenseEvidenceJson", "reviewState", "revision", "policyHash", "reviewedBy", "reviewedAt",
    ]));
    expect(IMAGE_ASSET_ORIGIN_KINDS).toEqual(expect.arrayContaining([
      "competitor_research", "own_product", "approved_knowledge_reference", "designer_upload", "legacy_unclassified",
    ]));
    expect(IMAGE_ASSET_REVIEW_STATES).toContain("unclassified");
    expect(IMAGE_ASSET_ALLOWED_USES).toEqual(expect.arrayContaining([
      "analysis_reference_only", "step4_reference",
    ]));
    expect(migrationSql).toContain("UNIQUE KEY `uk_image_asset_policy_scope_asset_revision` (`workspaceId`,`projectId`,`assetId`,`revision`)");
    expect(migrationSql).toContain("'legacy_unclassified'");
    expect(migrationSql).toContain("`allowedUsesJson` json NOT NULL");
  });

  it("records image acquisition coverage without altering existing acquisition tables", () => {
    expect(columnNames(imageAcquisitionCapabilityCoverageRevisions)).toEqual(expect.arrayContaining([
      "workspaceId", "projectId", "sourceSnapshotId", "confirmedSnapshotId", "consumerLinkId", "capability",
      "coverageState", "roleCoverageJson", "coverageHash", "revision",
    ]));
    expect(IMAGE_ACQUISITION_COVERAGE_CAPABILITIES).toEqual(["image_gallery", "aplus", "brand_story"]);
    expect(IMAGE_ACQUISITION_COVERAGE_STATES).toEqual(expect.arrayContaining([
      "not_requested", "returned", "confirmed_absent", "not_returned", "provider_unsupported", "download_failed", "pending_supplement", "manually_supplemented",
    ]));
    expect(migrationSql).toContain("UNIQUE KEY `uk_image_acq_coverage_snapshot_cap_revision` (`workspaceId`,`projectId`,`sourceSnapshotId`,`capability`,`revision`)");
  });

  it("keeps migration 0205 create-only and registers it exactly once in the governed plan", async () => {
    for (const tableName of [
      "image_assets",
      "image_asset_policy_revisions",
      "image_asset_source_references",
      "image_acquisition_capability_coverage_revisions",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS \`${tableName}\``);
    }
    expect(migrationSql).not.toMatch(/^\s*(?:ALTER|DROP|UPDATE|DELETE|INSERT|REPLACE|TRUNCATE)\b/gim);

    const migrationRunner = await import("../scripts/run-database-migrations.mjs");
    expect(migrationRunner.loadMigrationPlan()
      .filter((item: { fileName: string }) => item.fileName === "0205_image_asset_policy.sql"))
      .toHaveLength(1);
  });
});
