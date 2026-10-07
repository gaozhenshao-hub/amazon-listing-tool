import fs from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  listingBulletCandidates,
  listingCompleteSnapshotPayloadFieldNames,
  listingCompleteSnapshots,
  listingCoreRevisions,
  listingFactRevisions,
  listingReviewRevisions,
} from "../drizzle/schema/listingRevisions";
import { listings } from "../drizzle/schema/listing";
import { repoPath } from "./testPaths";

const migrationPath = repoPath("drizzle/0204_listing_revision_governance.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.keys(getTableColumns(table)).sort();
}

describe("Phase B listing revision schema contract", () => {
  it("exports the five isolated, workspace- and project-scoped revision tables", () => {
    expect([
      getTableName(listingFactRevisions),
      getTableName(listingCoreRevisions),
      getTableName(listingBulletCandidates),
      getTableName(listingReviewRevisions),
      getTableName(listingCompleteSnapshots),
    ]).toEqual([
      "listing_fact_revisions",
      "listing_core_revisions",
      "listing_bullet_candidates",
      "listing_review_revisions",
      "listing_complete_snapshots",
    ]);

    for (const table of [
      listingFactRevisions,
      listingCoreRevisions,
      listingBulletCandidates,
      listingReviewRevisions,
      listingCompleteSnapshots,
    ]) {
      expect(columnNames(table)).toEqual(expect.arrayContaining(["id", "workspaceId", "projectId", "createdAt"]));
    }
  });

  it("preserves source line evidence and immutable fact review fields", () => {
    expect(columnNames(listingFactRevisions)).toEqual(expect.arrayContaining([
      "attributeKey", "value", "valueJson", "sourceFileId", "proofFileId", "proofSourceRef", "rawHash", "sourceLine", "sourceLineHash",
      "sourceLocator", "provenance", "status", "revision", "contentHash", "createdBy", "confirmedBy", "confirmedAt", "reviewNote",
    ]));
    expect(migrationSql).toContain("UNIQUE KEY `uk_listing_fact_project_attribute_revision` (`projectId`,`attributeKey`,`revision`)");
    expect(migrationSql).toContain("KEY `idx_listing_fact_source` (`workspaceId`,`projectId`,`sourceFileId`,`sourceLine`)");
  });

  it("requires fact-linked, CAS-versioned core revisions and candidate lineage", () => {
    expect(columnNames(listingCoreRevisions)).toEqual(expect.arrayContaining([
      "coreId", "sellingPointIndex", "buyerReason", "factRevisionIdsJson", "keywordIdsJson", "status", "revision", "inputHash", "contentHash", "createdBy",
    ]));
    expect(columnNames(listingBulletCandidates)).toEqual(expect.arrayContaining([
      "candidateKey", "candidateRevision", "parentCandidateId", "coreRevisionId", "jobId", "skillRunId", "promptVersion", "actualModel", "inputHash", "evidenceFactIdsJson", "gateResultJson", "status", "contentHash", "createdBy",
    ]));
    expect(migrationSql).toContain("UNIQUE KEY `uk_listing_core_project_core_revision` (`projectId`,`coreId`,`revision`)");
    expect(migrationSql).toContain("UNIQUE KEY `uk_listing_bullet_lineage_revision` (`coreRevisionId`,`candidateKey`,`candidateRevision`)");
  });

  it("records review CAS preconditions and full snapshots of every listings field", () => {
    expect(columnNames(listingReviewRevisions)).toEqual(expect.arrayContaining([
      "listingId", "candidateId", "reviewRevision", "decision", "status", "beforeHash", "afterHash", "expectedRevision", "resultingCandidateId", "actorId",
    ]));
    expect(columnNames(listingCompleteSnapshots)).toEqual(expect.arrayContaining([
      "listingId", "contentVersion", "fullPayloadJson", "fullHash", "humanApprovalRef", "changeType", "status", "expectedListingVersion", "listingVersion", "createdBy", "approvedBy", "approvedAt",
    ]));
    expect(listingCompleteSnapshotPayloadFieldNames).toEqual(Object.keys(getTableColumns(listings)));
    expect(migrationSql).toContain("UNIQUE KEY `uk_listing_review_candidate_revision` (`candidateId`,`reviewRevision`)");
    expect(migrationSql).toContain("UNIQUE KEY `uk_listing_complete_listing_version` (`listingId`,`contentVersion`)");
  });

  it("keeps migration 0204 strictly additive and registered in the governed plan", async () => {
    for (const tableName of [
      "listing_fact_revisions",
      "listing_core_revisions",
      "listing_bullet_candidates",
      "listing_review_revisions",
      "listing_complete_snapshots",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS \`${tableName}\``);
    }
    expect(migrationSql).not.toMatch(/^\s*(?:ALTER|DROP|UPDATE|DELETE|INSERT|REPLACE|TRUNCATE)\b/gim);

    const migrationRunner = await import("../scripts/run-database-migrations.mjs");
    expect(migrationRunner.loadMigrationPlan().map((item: { fileName: string }) => item.fileName))
      .toContain("0204_listing_revision_governance.sql");
  });
});
