import { sql, type SQL } from "drizzle-orm";

import {
  buildUnifiedArtifactCurrentRef,
  buildUnifiedArtifactRef,
  registerUnifiedArtifact,
} from "../../ai_os/services/artifactLifecycle";
import { requireDb, type DbExecutor } from "../../../repositories/dbClient";
import type {
  LegacyListingRow,
  LegacyListingVersion,
  ListingCandidateSyncCandidate,
  ListingCandidateSyncCore,
  ListingCandidateSyncFact,
  ListingCandidateSyncProject,
  ListingCandidateSyncRawFile,
  ListingCandidateSyncReview,
  ListingCandidateSyncSnapshot,
  ListingCandidateSyncStore,
  ListingCandidateSyncTx,
} from "./listingCandidateSyncService";

type DateValue = Date | string;
type Row = Record<string, unknown>;

/**
 * Small structural boundary around Drizzle's MySQL executor.  It deliberately
 * requires `transaction`: this adapter must never silently degrade to
 * autocommit when a caller gives it a non-transactional executor.
 */
export type ListingCandidateSyncDrizzleExecutor = {
  execute(query: SQL): Promise<unknown>;
  transaction?: <T>(
    operation: (tx: ListingCandidateSyncDrizzleExecutor) => Promise<T>
  ) => Promise<T>;
};

/**
 * Public sync is enabled only because the same Drizzle transaction executor is
 * passed to registerUnifiedArtifact with failOnError=true. The registered
 * content is a compact DB snapshot pointer (never the full Listing payload), so
 * the lifecycle API cannot perform a large S3 upload inside the Listing CAS
 * transaction. Any lifecycle failure escapes this transaction and rolls back
 * Listing CAS, full snapshot, and legacy version together.
 */
export const listingCandidateSyncDrizzleStoreRoutePolicy = Object.freeze({
  publicSync: "enabled_with_transactional_artifact_registration" as const,
  reason:
    "Listing CAS, complete snapshot, legacy version, and compact ai_artifacts snapshot pointer share one Drizzle transaction.",
});

function asRows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  const possibleRows = Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(possibleRows)) return [];
  return possibleRows.filter(
    (row): row is Row =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}

function resultHeader(result: unknown): Row | null {
  const possibleHeader = Array.isArray(result) ? result[0] : result;
  return possibleHeader &&
    typeof possibleHeader === "object" &&
    !Array.isArray(possibleHeader)
    ? (possibleHeader as Row)
    : null;
}

function toFiniteInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(
      `Listing candidate sync DB contract violation: ${field} is not an integer`
    );
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `Listing candidate sync DB contract violation: ${field} is not a string`
    );
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return toFiniteInteger(value, field);
}

function dateValue(value: unknown, field: string): DateValue {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  ) {
    return value;
  }
  throw new Error(
    `Listing candidate sync DB contract violation: ${field} is not a valid date`
  );
}

function firstRow(result: unknown): Row | null {
  return asRows(result)[0] ?? null;
}

function affectedRows(result: unknown, operation: string): number {
  const header = resultHeader(result);
  const value = header?.affectedRows;
  return toFiniteInteger(value, `${operation}.affectedRows`);
}

function insertId(result: unknown, operation: string): number {
  const header = resultHeader(result);
  const value = toFiniteInteger(header?.insertId, `${operation}.insertId`);
  if (value < 1) {
    throw new Error(
      `Listing candidate sync DB contract violation: ${operation}.insertId is not positive`
    );
  }
  return value;
}

function requireSingleInsert(
  result: unknown,
  operation: string
): { insertId: number } {
  if (affectedRows(result, operation) !== 1) {
    throw new Error(
      `Listing candidate sync ${operation} did not affect exactly one row`
    );
  }
  return { insertId: insertId(result, operation) };
}

function jsonParameter(value: unknown, field: string): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error(
      `Listing candidate sync DB contract violation: ${field} is not JSON serializable`
    );
  }
  return serialized;
}

function mapProject(row: Row): ListingCandidateSyncProject {
  return {
    id: toFiniteInteger(row.id, "projects.id"),
    workspaceId: nullableInteger(row.workspaceId, "projects.workspaceId"),
    userId: toFiniteInteger(row.userId, "projects.userId"),
  };
}

function mapCandidate(row: Row): ListingCandidateSyncCandidate {
  return {
    id: toFiniteInteger(row.id, "listing_bullet_candidates.id"),
    candidateKey: requiredString(
      row.candidateKey,
      "listing_bullet_candidates.candidateKey"
    ),
    candidateRevision: toFiniteInteger(
      row.candidateRevision,
      "listing_bullet_candidates.candidateRevision"
    ),
    workspaceId: toFiniteInteger(
      row.workspaceId,
      "listing_bullet_candidates.workspaceId"
    ),
    projectId: toFiniteInteger(
      row.projectId,
      "listing_bullet_candidates.projectId"
    ),
    coreRevisionId: toFiniteInteger(
      row.coreRevisionId,
      "listing_bullet_candidates.coreRevisionId"
    ),
    inputHash: requiredString(
      row.inputHash,
      "listing_bullet_candidates.inputHash"
    ),
    subtitle: nullableString(
      row.subtitle,
      "listing_bullet_candidates.subtitle"
    ),
    fullText: nullableString(
      row.fullText,
      "listing_bullet_candidates.fullText"
    ),
    evidenceFactIdsJson: row.evidenceFactIdsJson,
    gateResultJson: row.gateResultJson,
    status: requiredString(row.status, "listing_bullet_candidates.status"),
    contentHash: requiredString(
      row.contentHash,
      "listing_bullet_candidates.contentHash"
    ),
    staleAt:
      row.staleAt === null
        ? null
        : dateValue(row.staleAt, "listing_bullet_candidates.staleAt"),
  };
}

function mapCore(row: Row): ListingCandidateSyncCore {
  return {
    id: toFiniteInteger(row.id, "listing_core_revisions.id"),
    coreId: requiredString(row.coreId, "listing_core_revisions.coreId"),
    workspaceId: toFiniteInteger(
      row.workspaceId,
      "listing_core_revisions.workspaceId"
    ),
    projectId: toFiniteInteger(
      row.projectId,
      "listing_core_revisions.projectId"
    ),
    sellingPointIndex: toFiniteInteger(
      row.sellingPointIndex,
      "listing_core_revisions.sellingPointIndex"
    ),
    buyerReason: requiredString(
      row.buyerReason,
      "listing_core_revisions.buyerReason"
    ),
    factRevisionIdsJson: row.factRevisionIdsJson,
    status: requiredString(row.status, "listing_core_revisions.status"),
    revision: toFiniteInteger(row.revision, "listing_core_revisions.revision"),
    inputHash: requiredString(
      row.inputHash,
      "listing_core_revisions.inputHash"
    ),
    confirmedBy: nullableInteger(
      row.confirmedBy,
      "listing_core_revisions.confirmedBy"
    ),
    confirmedAt:
      row.confirmedAt === null
        ? null
        : dateValue(row.confirmedAt, "listing_core_revisions.confirmedAt"),
    staleAt:
      row.staleAt === null
        ? null
        : dateValue(row.staleAt, "listing_core_revisions.staleAt"),
  };
}

function mapFact(row: Row): ListingCandidateSyncFact {
  return {
    id: toFiniteInteger(row.id, "listing_fact_revisions.id"),
    workspaceId: toFiniteInteger(
      row.workspaceId,
      "listing_fact_revisions.workspaceId"
    ),
    projectId: toFiniteInteger(
      row.projectId,
      "listing_fact_revisions.projectId"
    ),
    attributeKey: requiredString(
      row.attributeKey,
      "listing_fact_revisions.attributeKey"
    ),
    value: row.valueJson ?? row.value,
    sourceFileId: nullableInteger(
      row.sourceFileId,
      "listing_fact_revisions.sourceFileId"
    ),
    rawHash: nullableString(row.rawHash, "listing_fact_revisions.rawHash"),
    status: requiredString(row.status, "listing_fact_revisions.status"),
    revision: toFiniteInteger(row.revision, "listing_fact_revisions.revision"),
    confirmedBy: nullableInteger(
      row.confirmedBy,
      "listing_fact_revisions.confirmedBy"
    ),
    confirmedAt:
      row.confirmedAt === null
        ? null
        : dateValue(row.confirmedAt, "listing_fact_revisions.confirmedAt"),
    staleAt:
      row.staleAt === null
        ? null
        : dateValue(row.staleAt, "listing_fact_revisions.staleAt"),
  };
}

function mapRawFile(row: Row): ListingCandidateSyncRawFile {
  return {
    id: toFiniteInteger(row.id, "projectFiles.id"),
    workspaceId: nullableInteger(row.workspaceId, "projectFiles.workspaceId"),
    projectId: toFiniteInteger(row.projectId, "projectFiles.projectId"),
    fileType: requiredString(row.fileType, "projectFiles.fileType"),
    rawContentHash: nullableString(
      row.rawContentHash,
      "projectFiles.rawContentHash"
    ),
    status: requiredString(row.status, "projectFiles.status"),
    lifecycleState: nullableString(
      row.lifecycleState,
      "projectFiles.lifecycleState"
    ),
  };
}

function mapReview(row: Row): ListingCandidateSyncReview {
  return {
    id: toFiniteInteger(row.id, "listing_review_revisions.id"),
    candidateId: toFiniteInteger(
      row.candidateId,
      "listing_review_revisions.candidateId"
    ),
    reviewRevision: toFiniteInteger(
      row.reviewRevision,
      "listing_review_revisions.reviewRevision"
    ),
    decision: requiredString(row.decision, "listing_review_revisions.decision"),
    status: requiredString(row.status, "listing_review_revisions.status"),
    expectedRevision: toFiniteInteger(
      row.expectedRevision,
      "listing_review_revisions.expectedRevision"
    ),
    actorId: toFiniteInteger(row.actorId, "listing_review_revisions.actorId"),
    createdAt: dateValue(row.createdAt, "listing_review_revisions.createdAt"),
  };
}

function mapSnapshot(row: Row): ListingCandidateSyncSnapshot {
  return {
    id: toFiniteInteger(row.id, "listing_complete_snapshots.id"),
    workspaceId: toFiniteInteger(
      row.workspaceId,
      "listing_complete_snapshots.workspaceId"
    ),
    projectId: toFiniteInteger(
      row.projectId,
      "listing_complete_snapshots.projectId"
    ),
    listingId: toFiniteInteger(
      row.listingId,
      "listing_complete_snapshots.listingId"
    ),
    contentVersion: toFiniteInteger(
      row.contentVersion,
      "listing_complete_snapshots.contentVersion"
    ),
    fullPayloadJson: row.fullPayloadJson,
    fullHash: requiredString(
      row.fullHash,
      "listing_complete_snapshots.fullHash"
    ),
    humanApprovalRef: nullableString(
      row.humanApprovalRef,
      "listing_complete_snapshots.humanApprovalRef"
    ),
    changeType: requiredString(
      row.changeType,
      "listing_complete_snapshots.changeType"
    ),
    status: requiredString(row.status, "listing_complete_snapshots.status"),
    expectedListingVersion: toFiniteInteger(
      row.expectedListingVersion,
      "listing_complete_snapshots.expectedListingVersion"
    ),
    listingVersion: toFiniteInteger(
      row.listingVersion,
      "listing_complete_snapshots.listingVersion"
    ),
  };
}

/**
 * Explicitly select every `listings` field that the service hashes into the
 * immutable full payload.  Do not replace this list with `*`: the service and
 * drizzle/schema/listing.ts deliberately make payload drift detectable.
 */
const listingColumns = sql.raw(
  "`id`, `projectId`, `title`, `itemHighlights`, `bulletPoints`, `description`, " +
    "`searchTerms`, `imageAdvice`, `imageAdviceCn`, `titleCn`, `itemHighlightsCn`, " +
    "`bulletPointsCn`, `descriptionCn`, `searchTermsCn`, `qaContent`, `qaContentCn`, " +
    "`lockedSteps`, `checklistScores`, `agentRunId`, `version`, `isActive`, `createdAt`, `updatedAt`"
);

function mapListing(row: Row): LegacyListingRow {
  return {
    id: toFiniteInteger(row.id, "listings.id"),
    projectId: toFiniteInteger(row.projectId, "listings.projectId"),
    title: row.title,
    itemHighlights: row.itemHighlights,
    bulletPoints: nullableString(row.bulletPoints, "listings.bulletPoints"),
    description: row.description,
    searchTerms: row.searchTerms,
    imageAdvice: row.imageAdvice,
    imageAdviceCn: row.imageAdviceCn,
    titleCn: row.titleCn,
    itemHighlightsCn: row.itemHighlightsCn,
    bulletPointsCn: row.bulletPointsCn,
    descriptionCn: row.descriptionCn,
    searchTermsCn: row.searchTermsCn,
    qaContent: row.qaContent,
    qaContentCn: row.qaContentCn,
    lockedSteps: row.lockedSteps,
    checklistScores: row.checklistScores,
    agentRunId: row.agentRunId,
    version: toFiniteInteger(row.version, "listings.version"),
    isActive: toFiniteInteger(row.isActive, "listings.isActive"),
    createdAt: dateValue(row.createdAt, "listings.createdAt"),
    updatedAt: dateValue(row.updatedAt, "listings.updatedAt"),
  };
}

function scopedIdList(ids: number[]): SQL {
  if (ids.length === 0 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error(
      "Listing candidate sync requires at least one positive fact revision id to lock"
    );
  }
  return sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  );
}

function transactionStore(
  executor: ListingCandidateSyncDrizzleExecutor
): ListingCandidateSyncTx {
  const execute = (query: SQL) => executor.execute(query);

  return {
    async lockProjectForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`userId\`
        FROM \`projects\`
        WHERE \`id\` = ${input.projectId}
        FOR UPDATE
      `)
      );
      return row ? mapProject(row) : null;
    },

    async lockCandidateForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`candidateKey\`, \`candidateRevision\`, \`workspaceId\`, \`projectId\`,
               \`coreRevisionId\`, \`inputHash\`, \`subtitle\`, \`fullText\`, \`evidenceFactIdsJson\`,
               \`gateResultJson\`, \`status\`, \`contentHash\`, \`staleAt\`
        FROM \`listing_bullet_candidates\`
        WHERE \`id\` = ${input.candidateId}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `)
      );
      return row ? mapCandidate(row) : null;
    },

    async lockLatestCandidateForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`candidateRevision\`
        FROM \`listing_bullet_candidates\`
        WHERE \`candidateKey\` = ${input.candidateKey}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`candidateRevision\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row
        ? {
            id: toFiniteInteger(row.id, "listing_bullet_candidates.id"),
            candidateRevision: toFiniteInteger(
              row.candidateRevision,
              "listing_bullet_candidates.candidateRevision"
            ),
          }
        : null;
    },

    async lockLatestCandidateReviewForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`candidateId\`, \`reviewRevision\`, \`decision\`, \`status\`,
               \`expectedRevision\`, \`actorId\`, \`createdAt\`
        FROM \`listing_review_revisions\`
        WHERE \`candidateId\` = ${input.candidateId}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`reviewRevision\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row ? mapReview(row) : null;
    },

    async lockCoreForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`coreId\`, \`workspaceId\`, \`projectId\`, \`sellingPointIndex\`,
               \`buyerReason\`, \`factRevisionIdsJson\`, \`status\`, \`revision\`, \`inputHash\`,
               \`confirmedBy\`, \`confirmedAt\`, \`staleAt\`
        FROM \`listing_core_revisions\`
        WHERE \`id\` = ${input.coreRevisionId}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `)
      );
      return row ? mapCore(row) : null;
    },

    async lockLatestCoreForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`revision\`
        FROM \`listing_core_revisions\`
        WHERE \`coreId\` = ${input.coreId}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`revision\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row
        ? {
            id: toFiniteInteger(row.id, "listing_core_revisions.id"),
            revision: toFiniteInteger(
              row.revision,
              "listing_core_revisions.revision"
            ),
          }
        : null;
    },

    async lockFactsForUpdate(input) {
      const rowIds = scopedIdList(input.factRevisionIds);
      const rows = asRows(
        await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`attributeKey\`, \`value\`, \`valueJson\`,
               \`sourceFileId\`, \`rawHash\`, \`status\`, \`revision\`, \`confirmedBy\`, \`confirmedAt\`, \`staleAt\`
        FROM \`listing_fact_revisions\`
        WHERE \`id\` IN (${rowIds})
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`id\` ASC
        FOR UPDATE
      `)
      );
      return rows.map(mapFact);
    },

    async lockLatestFactForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`revision\`
        FROM \`listing_fact_revisions\`
        WHERE \`attributeKey\` = ${input.attributeKey}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`revision\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row
        ? {
            id: toFiniteInteger(row.id, "listing_fact_revisions.id"),
            revision: toFiniteInteger(
              row.revision,
              "listing_fact_revisions.revision"
            ),
          }
        : null;
    },

    async lockLatestProductAttributesFileForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`fileType\`, \`rawContentHash\`, \`status\`, \`lifecycleState\`
        FROM \`projectFiles\`
        WHERE \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
          AND \`fileType\` = 'product_attributes'
        ORDER BY \`createdAt\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row ? mapRawFile(row) : null;
    },

    async lockListingForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT ${listingColumns}
        FROM \`listings\`
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `)
      );
      return row ? mapListing(row) : null;
    },

    async lockLatestCompleteSnapshotForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`listingId\`, \`contentVersion\`, \`fullPayloadJson\`,
               \`fullHash\`, \`humanApprovalRef\`, \`changeType\`, \`status\`, \`expectedListingVersion\`, \`listingVersion\`
        FROM \`listing_complete_snapshots\`
        WHERE \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
          AND \`listingId\` = ${input.listingId}
        ORDER BY \`contentVersion\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row ? mapSnapshot(row) : null;
    },

    async lockLatestLegacyListingVersionForUpdate(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`versionNumber\`
        FROM \`listingVersions\`
        WHERE \`listingId\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`versionNumber\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      return row
        ? {
            versionNumber: toFiniteInteger(
              row.versionNumber,
              "listingVersions.versionNumber"
            ),
          }
        : null;
    },

    async compareAndSwapListing(input) {
      const updateResult = await execute(sql`
        UPDATE \`listings\`
        SET \`bulletPoints\` = ${input.changes.bulletPoints},
            \`version\` = ${input.changes.version},
            \`updatedAt\` = ${input.changes.updatedAt}
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
          AND \`version\` = ${input.expectedListingVersion}
      `);
      const rowsChanged = affectedRows(updateResult, "listings CAS update");
      if (rowsChanged === 0) return { affectedRows: 0, listing: null };
      if (rowsChanged !== 1) {
        throw new Error(
          "Listing candidate sync CAS update affected more than one row"
        );
      }

      const row = firstRow(
        await execute(sql`
        SELECT ${listingColumns}
        FROM \`listings\`
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `)
      );
      if (!row) {
        throw new Error(
          "Listing candidate sync CAS update succeeded but its locked Listing row is missing"
        );
      }
      return { affectedRows: 1, listing: mapListing(row) };
    },

    async insertCompleteSnapshot(input) {
      const fullPayloadJson = jsonParameter(
        input.fullPayloadJson,
        "listing_complete_snapshots.fullPayloadJson"
      );
      const result = await execute(sql`
        INSERT INTO \`listing_complete_snapshots\`
          (\`workspaceId\`, \`projectId\`, \`listingId\`, \`contentVersion\`, \`fullPayloadJson\`, \`fullHash\`,
           \`humanApprovalRef\`, \`changeType\`, \`status\`, \`expectedListingVersion\`, \`listingVersion\`,
           \`createdBy\`, \`approvedBy\`, \`approvedAt\`)
        VALUES
          (${input.workspaceId}, ${input.projectId}, ${input.listingId}, ${input.contentVersion},
           ${fullPayloadJson}, ${input.fullHash}, ${input.humanApprovalRef}, ${input.changeType},
           ${input.status}, ${input.expectedListingVersion}, ${input.listingVersion}, ${input.createdBy},
           ${input.approvedBy}, ${input.approvedAt})
      `);
      return requireSingleInsert(result, "listing_complete_snapshots insert");
    },

    async registerCompleteSnapshotArtifact(input) {
      const artifactKey = "listing.complete_snapshot";
      const pointer = {
        schema: "listing.complete_snapshot.pointer/1",
        snapshotId: input.snapshotId,
        listingId: input.listingId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        contentVersion: input.contentVersion,
        listingVersion: input.listingVersion,
        humanApprovalRef: input.humanApprovalRef,
      };
      const artifact = await registerUnifiedArtifact({
        executor: executor as unknown as DbExecutor,
        failOnError: true,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        domain: "listing",
        artifactKey,
        artifactType: "json",
        sourceType: "system",
        sourceTable: "listings",
        sourceRowId: input.listingId,
        userId: input.createdBy,
        selectedBy: input.createdBy,
        status: "final",
        isCurrent: true,
        // Explicitly bind immutable Artifact contentHash to the complete Listing,
        // not merely the compact pointer serialized above.
        contentHash: input.fullHash,
        content: pointer,
        searchableText: `Listing ${input.listingId} complete snapshot ${input.contentVersion}`,
        summary: `Immutable Listing snapshot pointer #${input.snapshotId} (v${input.contentVersion})`,
        metadata: {
          schema: pointer.schema,
          snapshotId: input.snapshotId,
          listingId: input.listingId,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          contentVersion: input.contentVersion,
          listingVersion: input.listingVersion,
          humanApprovalRef: input.humanApprovalRef,
          contentHash: input.fullHash,
        },
      });
      if (!artifact) {
        throw new Error(
          "Listing candidate sync Artifact registration returned no result"
        );
      }
      return {
        artifactId: artifact.artifactId,
        artifactKey,
        version: artifact.version,
        ref: artifact.ref,
        currentRef: artifact.currentRef,
        contentHash: input.fullHash,
      };
    },

    async findCompleteSnapshotArtifact(input) {
      const row = firstRow(
        await execute(sql`
        SELECT \`artifactId\`, \`version\`, \`contentHash\`
        FROM \`ai_artifacts\`
        WHERE \`workspaceId\` = ${input.workspaceId}
          AND \`domain\` = 'listing'
          AND \`artifactKey\` = 'listing.complete_snapshot'
          AND \`sourceTable\` = 'listings'
          AND \`sourceRowId\` = ${String(input.listingId)}
          AND \`projectId\` = ${input.projectId}
          AND \`contentHash\` = ${input.fullHash}
          AND JSON_UNQUOTE(JSON_EXTRACT(\`contentJson\`, '$.snapshotId')) = ${String(input.snapshotId)}
          AND \`status\` IN ('final', 'superseded')
        ORDER BY \`version\` DESC
        LIMIT 1
        FOR UPDATE
      `)
      );
      if (!row) return null;
      const artifactId = requiredString(
        row.artifactId,
        "ai_artifacts.artifactId"
      );
      const version = toFiniteInteger(row.version, "ai_artifacts.version");
      const contentHash = requiredString(
        row.contentHash,
        "ai_artifacts.contentHash"
      );
      return {
        artifactId,
        artifactKey: "listing.complete_snapshot",
        version,
        ref: buildUnifiedArtifactRef(artifactId, version),
        currentRef: buildUnifiedArtifactCurrentRef({
          workspaceId: input.workspaceId,
          domain: "listing",
          artifactKey: "listing.complete_snapshot",
          sourceTable: "listings",
          sourceRowId: input.listingId,
        }),
        contentHash,
      };
    },

    async insertLegacyListingVersion(input) {
      const result = await execute(sql`
        INSERT INTO \`listingVersions\`
          (\`listingId\`, \`projectId\`, \`userId\`, \`versionNumber\`, \`changeType\`, \`changeDescription\`,
           \`title\`, \`itemHighlights\`, \`bulletPoints\`, \`description\`, \`searchTerms\`, \`titleCn\`,
           \`itemHighlightsCn\`, \`bulletPointsCn\`, \`descriptionCn\`, \`searchTermsCn\`)
        VALUES
          (${input.listingId}, ${input.projectId}, ${input.userId}, ${input.versionNumber}, ${input.changeType},
           ${input.changeDescription}, ${input.title}, ${input.itemHighlights}, ${input.bulletPoints},
           ${input.description}, ${input.searchTerms}, ${input.titleCn}, ${input.itemHighlightsCn},
           ${input.bulletPointsCn}, ${input.descriptionCn}, ${input.searchTermsCn})
      `);
      return requireSingleInsert(result, "listingVersions insert");
    },
  };
}

async function runStrictTransaction<T>(
  executor: ListingCandidateSyncDrizzleExecutor,
  operation: (tx: ListingCandidateSyncTx) => Promise<T>
): Promise<T> {
  if (typeof executor.transaction !== "function") {
    throw new Error(
      "Listing candidate sync requires a Drizzle MySQL transaction-capable executor"
    );
  }
  return executor.transaction(async tx => operation(transactionStore(tx)));
}

/**
 * Factory for composition roots and isolated tests.  The executor is never
 * queried until `withTransaction` is invoked, and each invocation requires a
 * real transaction callback rather than the dbClient autocommit fallback.
 */
export function createListingCandidateSyncDrizzleStore(
  executor: ListingCandidateSyncDrizzleExecutor
): ListingCandidateSyncStore {
  return {
    withTransaction: operation => runStrictTransaction(executor, operation),
  };
}

/**
 * Production store. `requireDb` supplies the repository-owned Drizzle MySQL
 * client; transaction capability is checked again so a database configuration
 * mistake fails closed before any listing write can occur. This does not grant
 * permission to publish a router mutation: see
 * `listingCandidateSyncDrizzleStoreRoutePolicy`.
 */
export const listingCandidateSyncDrizzleStore: ListingCandidateSyncStore = {
  async withTransaction<T>(
    operation: (tx: ListingCandidateSyncTx) => Promise<T>
  ): Promise<T> {
    const db = (await requireDb("Listing candidate sync")) as DbExecutor;
    return runStrictTransaction(
      db as ListingCandidateSyncDrizzleExecutor,
      operation
    );
  },
};
