import { sql, type SQL } from "drizzle-orm";

import {
  buildUnifiedArtifactCurrentRef,
  buildUnifiedArtifactRef,
  registerUnifiedArtifact,
} from "../../ai_os/services/artifactLifecycle";
import { requireDb, type DbExecutor } from "../../../repositories/dbClient";
import type {
  ArtifactRegistration,
  LegacyListingVersion,
  ListingCompleteRestoreProject,
  ListingCompleteRestoreSnapshot,
  ListingCompleteRestoreSnapshotSummary,
  ListingCompleteRestoreStore,
  ListingCompleteRestoreTx,
} from "./listingCompleteRestoreService";
import type { LegacyListingRow } from "./listingCandidateSyncService";

type DateValue = Date | string;
type Row = Record<string, unknown>;

/** A strict structural boundary: governed restore must never fall back to autocommit. */
export type ListingCompleteRestoreDrizzleExecutor = {
  execute(query: SQL): Promise<unknown>;
  transaction?: <T>(
    operation: (tx: ListingCompleteRestoreDrizzleExecutor) => Promise<T>
  ) => Promise<T>;
};

/**
 * Public restore is permitted only with this transaction-capable adapter. A DB
 * failure caused by absent 0204 tables, an Artifact registration failure, or a
 * concurrent CAS miss aborts the complete transaction; no old partial version is
 * ever used as a fallback source or write target.
 */
export const listingCompleteRestoreDrizzleStoreRoutePolicy = Object.freeze({
  publicRestore: "enabled_with_transactional_artifact_registration" as const,
  reason:
    "Full Listing CAS, immutable rollback snapshot, compact ai_artifacts pointer, and legacy compatibility audit share one Drizzle transaction.",
});

function asRows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  const candidate = Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}

function firstRow(result: unknown): Row | null {
  return asRows(result)[0] ?? null;
}

function resultHeader(result: unknown): Row | null {
  const header = Array.isArray(result) ? result[0] : result;
  return header && typeof header === "object" && !Array.isArray(header)
    ? (header as Row)
    : null;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Listing complete restore DB contract violation: ${field} is not an integer`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Listing complete restore DB contract violation: ${field} is not a string`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : requiredString(value, field);
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : integer(value, field);
}

function dateValue(value: unknown, field: string): DateValue {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Date.parse(value))) return value;
  throw new Error(`Listing complete restore DB contract violation: ${field} is not a valid date`);
}

function nullableDateValue(value: unknown, field: string): DateValue | null {
  return value === null ? null : dateValue(value, field);
}

function affectedRows(result: unknown, operation: string): number {
  return integer(resultHeader(result)?.affectedRows, `${operation}.affectedRows`);
}

function insertId(result: unknown, operation: string): number {
  const id = integer(resultHeader(result)?.insertId, `${operation}.insertId`);
  if (id < 1) throw new Error(`Listing complete restore DB contract violation: ${operation}.insertId is not positive`);
  return id;
}

function requireSingleInsert(result: unknown, operation: string): { insertId: number } {
  if (affectedRows(result, operation) !== 1) {
    throw new Error(`Listing complete restore ${operation} did not affect exactly one row`);
  }
  return { insertId: insertId(result, operation) };
}

function jsonParameter(value: unknown, field: string): string {
  const json = JSON.stringify(value);
  if (typeof json !== "string") {
    throw new Error(`Listing complete restore DB contract violation: ${field} is not JSON serializable`);
  }
  return json;
}

function mapProject(row: Row): ListingCompleteRestoreProject {
  return {
    id: integer(row.id, "projects.id"),
    workspaceId: nullableInteger(row.workspaceId, "projects.workspaceId"),
    userId: integer(row.userId, "projects.userId"),
  };
}

function mapSnapshot(row: Row): ListingCompleteRestoreSnapshot {
  return {
    id: integer(row.id, "listing_complete_snapshots.id"),
    workspaceId: integer(row.workspaceId, "listing_complete_snapshots.workspaceId"),
    projectId: integer(row.projectId, "listing_complete_snapshots.projectId"),
    listingId: integer(row.listingId, "listing_complete_snapshots.listingId"),
    contentVersion: integer(row.contentVersion, "listing_complete_snapshots.contentVersion"),
    fullPayloadJson: row.fullPayloadJson,
    fullHash: requiredString(row.fullHash, "listing_complete_snapshots.fullHash"),
    humanApprovalRef: nullableString(row.humanApprovalRef, "listing_complete_snapshots.humanApprovalRef"),
    changeType: requiredString(row.changeType, "listing_complete_snapshots.changeType"),
    status: requiredString(row.status, "listing_complete_snapshots.status"),
    expectedListingVersion: integer(row.expectedListingVersion, "listing_complete_snapshots.expectedListingVersion"),
    listingVersion: integer(row.listingVersion, "listing_complete_snapshots.listingVersion"),
    createdBy: integer(row.createdBy, "listing_complete_snapshots.createdBy"),
    approvedBy: nullableInteger(row.approvedBy, "listing_complete_snapshots.approvedBy"),
    approvedAt: nullableDateValue(row.approvedAt, "listing_complete_snapshots.approvedAt"),
    createdAt: dateValue(row.createdAt, "listing_complete_snapshots.createdAt"),
  };
}

function snapshotSummary(row: Row): ListingCompleteRestoreSnapshotSummary {
  const snapshot = mapSnapshot(row);
  return {
    id: snapshot.id,
    listingId: snapshot.listingId,
    contentVersion: snapshot.contentVersion,
    fullHash: snapshot.fullHash,
    humanApprovalRef: snapshot.humanApprovalRef,
    changeType: snapshot.changeType,
    status: snapshot.status,
    expectedListingVersion: snapshot.expectedListingVersion,
    listingVersion: snapshot.listingVersion,
    createdBy: snapshot.createdBy,
    approvedBy: snapshot.approvedBy,
    approvedAt: snapshot.approvedAt,
    createdAt: snapshot.createdAt,
  };
}

/** Explicit full mirror list; payload/schema drift must be visible in review. */
const listingColumns = sql.raw(
  "`id`, `projectId`, `title`, `itemHighlights`, `bulletPoints`, `description`, " +
    "`searchTerms`, `imageAdvice`, `imageAdviceCn`, `titleCn`, `itemHighlightsCn`, " +
    "`bulletPointsCn`, `descriptionCn`, `searchTermsCn`, `qaContent`, `qaContentCn`, " +
    "`lockedSteps`, `checklistScores`, `agentRunId`, `version`, `isActive`, `createdAt`, `updatedAt`"
);

function mapListing(row: Row): LegacyListingRow {
  return {
    id: integer(row.id, "listings.id"),
    projectId: integer(row.projectId, "listings.projectId"),
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
    version: integer(row.version, "listings.version"),
    isActive: integer(row.isActive, "listings.isActive"),
    createdAt: dateValue(row.createdAt, "listings.createdAt"),
    updatedAt: dateValue(row.updatedAt, "listings.updatedAt"),
  };
}

function transactionStore(executor: ListingCompleteRestoreDrizzleExecutor): ListingCompleteRestoreTx {
  const execute = (query: SQL) => executor.execute(query);
  return {
    async lockProjectForUpdate(input) {
      const row = firstRow(await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`userId\`
        FROM \`projects\`
        WHERE \`id\` = ${input.projectId}
        FOR UPDATE
      `));
      return row ? mapProject(row) : null;
    },

    async lockCompleteSnapshotForUpdate(input) {
      const row = firstRow(await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`listingId\`, \`contentVersion\`, \`fullPayloadJson\`,
               \`fullHash\`, \`humanApprovalRef\`, \`changeType\`, \`status\`, \`expectedListingVersion\`, \`listingVersion\`,
               \`createdBy\`, \`approvedBy\`, \`approvedAt\`, \`createdAt\`
        FROM \`listing_complete_snapshots\`
        WHERE \`id\` = ${input.snapshotId}
          AND \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `));
      return row ? mapSnapshot(row) : null;
    },

    async lockListingForUpdate(input) {
      const row = firstRow(await execute(sql`
        SELECT ${listingColumns}
        FROM \`listings\`
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `));
      return row ? mapListing(row) : null;
    },

    async lockLatestCompleteSnapshotForUpdate(input) {
      const row = firstRow(await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`listingId\`, \`contentVersion\`, \`fullPayloadJson\`,
               \`fullHash\`, \`humanApprovalRef\`, \`changeType\`, \`status\`, \`expectedListingVersion\`, \`listingVersion\`,
               \`createdBy\`, \`approvedBy\`, \`approvedAt\`, \`createdAt\`
        FROM \`listing_complete_snapshots\`
        WHERE \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
          AND \`listingId\` = ${input.listingId}
        ORDER BY \`contentVersion\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `));
      return row ? mapSnapshot(row) : null;
    },

    async lockLatestLegacyListingVersionForUpdate(input) {
      const row = firstRow(await execute(sql`
        SELECT \`versionNumber\`
        FROM \`listingVersions\`
        WHERE \`listingId\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        ORDER BY \`versionNumber\` DESC, \`id\` DESC
        LIMIT 1
        FOR UPDATE
      `));
      return row ? { versionNumber: integer(row.versionNumber, "listingVersions.versionNumber") } : null;
    },

    async compareAndSwapCompleteListing(input) {
      const restored = input.restoredListing;
      const result = await execute(sql`
        UPDATE \`listings\`
        SET \`title\` = ${restored.title},
            \`itemHighlights\` = ${restored.itemHighlights},
            \`bulletPoints\` = ${restored.bulletPoints},
            \`description\` = ${restored.description},
            \`searchTerms\` = ${restored.searchTerms},
            \`imageAdvice\` = ${restored.imageAdvice},
            \`imageAdviceCn\` = ${restored.imageAdviceCn},
            \`titleCn\` = ${restored.titleCn},
            \`itemHighlightsCn\` = ${restored.itemHighlightsCn},
            \`bulletPointsCn\` = ${restored.bulletPointsCn},
            \`descriptionCn\` = ${restored.descriptionCn},
            \`searchTermsCn\` = ${restored.searchTermsCn},
            \`qaContent\` = ${restored.qaContent},
            \`qaContentCn\` = ${restored.qaContentCn},
            \`lockedSteps\` = ${restored.lockedSteps},
            \`checklistScores\` = ${restored.checklistScores},
            \`agentRunId\` = ${restored.agentRunId},
            \`isActive\` = ${restored.isActive},
            \`version\` = ${restored.version},
            \`updatedAt\` = ${restored.updatedAt}
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
          AND \`version\` = ${input.expectedListingVersion}
      `);
      const rowsChanged = affectedRows(result, "listings complete restore CAS update");
      if (rowsChanged === 0) return { affectedRows: 0, listing: null };
      if (rowsChanged !== 1) {
        throw new Error("Listing complete restore CAS update affected more than one row");
      }
      const row = firstRow(await execute(sql`
        SELECT ${listingColumns}
        FROM \`listings\`
        WHERE \`id\` = ${input.listingId}
          AND \`projectId\` = ${input.projectId}
        FOR UPDATE
      `));
      if (!row) throw new Error("Listing complete restore CAS succeeded but its locked Listing row is missing");
      return { affectedRows: 1, listing: mapListing(row) };
    },

    async insertCompleteSnapshot(input) {
      const fullPayloadJson = jsonParameter(input.fullPayloadJson, "listing_complete_snapshots.fullPayloadJson");
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
      return requireSingleInsert(result, "listing_complete_snapshots restore insert");
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
        contentHash: input.fullHash,
        content: pointer,
        searchableText: `Listing ${input.listingId} complete rollback snapshot ${input.contentVersion}`,
        summary: `Immutable governed Listing rollback snapshot pointer #${input.snapshotId} (v${input.contentVersion})`,
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
          changeType: "rollback",
        },
      });
      if (!artifact) throw new Error("Listing complete restore Artifact registration returned no result");
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
      const row = firstRow(await execute(sql`
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
      `));
      if (!row) return null;
      const artifactId = requiredString(row.artifactId, "ai_artifacts.artifactId");
      const version = integer(row.version, "ai_artifacts.version");
      const contentHash = requiredString(row.contentHash, "ai_artifacts.contentHash");
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
      return requireSingleInsert(result, "listingVersions restore compatibility insert");
    },

    async listApprovedCompleteSnapshots(input) {
      const rows = asRows(await execute(sql`
        SELECT \`id\`, \`workspaceId\`, \`projectId\`, \`listingId\`, \`contentVersion\`, \`fullPayloadJson\`,
               \`fullHash\`, \`humanApprovalRef\`, \`changeType\`, \`status\`, \`expectedListingVersion\`, \`listingVersion\`,
               \`createdBy\`, \`approvedBy\`, \`approvedAt\`, \`createdAt\`
        FROM \`listing_complete_snapshots\`
        WHERE \`workspaceId\` = ${input.workspaceId}
          AND \`projectId\` = ${input.projectId}
          AND \`status\` = 'approved'
          AND \`humanApprovalRef\` IS NOT NULL
          AND \`approvedBy\` IS NOT NULL
          AND \`approvedAt\` IS NOT NULL
        ORDER BY \`createdAt\` DESC, \`id\` DESC
        LIMIT ${input.limit}
        FOR UPDATE
      `));
      return rows.map(snapshotSummary);
    },
  };
}

async function runStrictTransaction<T>(
  executor: ListingCompleteRestoreDrizzleExecutor,
  operation: (tx: ListingCompleteRestoreTx) => Promise<T>
): Promise<T> {
  if (typeof executor.transaction !== "function") {
    throw new Error("Listing complete restore requires a Drizzle MySQL transaction-capable executor");
  }
  return executor.transaction(tx => operation(transactionStore(tx)));
}

/** Factory for composition roots and isolated SQL/transaction tests. */
export function createListingCompleteRestoreDrizzleStore(
  executor: ListingCompleteRestoreDrizzleExecutor
): ListingCompleteRestoreStore {
  return { withTransaction: operation => runStrictTransaction(executor, operation) };
}

/**
 * Production store. requireDb is intentionally invoked only at transaction time;
 * absent DB configuration or absent 0204 table failures propagate and leave the
 * legacy rollback endpoint closed rather than attempting an unsafe fallback.
 */
export const listingCompleteRestoreDrizzleStore: ListingCompleteRestoreStore = {
  async withTransaction<T>(operation: (tx: ListingCompleteRestoreTx) => Promise<T>): Promise<T> {
    const db = (await requireDb("Listing complete restore")) as DbExecutor;
    return runStrictTransaction(db as ListingCompleteRestoreDrizzleExecutor, operation);
  },
};
