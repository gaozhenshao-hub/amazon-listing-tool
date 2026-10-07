import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import {
  createListingCandidateSyncDrizzleStore,
  listingCandidateSyncDrizzleStoreRoutePolicy,
  type ListingCandidateSyncDrizzleExecutor,
} from "./listingCandidateSyncDrizzleStore";

const dialect = new MySqlDialect();
const modulePath = fileURLToPath(
  new URL("./listingCandidateSyncDrizzleStore.ts", import.meta.url)
);

type CapturedQuery = { sql: string; params: unknown[] };

function render(
  query: Parameters<ListingCandidateSyncDrizzleExecutor["execute"]>[0]
): CapturedQuery {
  return dialect.sqlToQuery(query);
}

function listingRow() {
  return {
    id: 401,
    projectId: 17,
    title: "Original Title",
    itemHighlights: "Original highlights",
    bulletPoints: '["one","two","three","four","five"]',
    description: "Original description",
    searchTerms: "original terms",
    imageAdvice: '{"main":"original"}',
    imageAdviceCn: '{"main":"原始"}',
    titleCn: "原始标题",
    itemHighlightsCn: "原始亮点",
    bulletPointsCn: '["一","二","三","四","五"]',
    descriptionCn: "原始描述",
    searchTermsCn: "原始关键词",
    qaContent: '[{"q":"Q","a":"A"}]',
    qaContentCn: '[{"q":"问","a":"答"}]',
    lockedSteps: "[1,2,3,4,5]",
    checklistScores: '{"1":{"passed":true}}',
    agentRunId: "run_listing_1",
    version: 3,
    isActive: 1,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    updatedAt: new Date("2026-10-06T12:00:00.000Z"),
  };
}

class TransactionMock implements ListingCandidateSyncDrizzleExecutor {
  readonly calls: CapturedQuery[] = [];
  commits = 0;
  rollbacks = 0;
  updateAffectedRows = 1;

  async execute(
    query: Parameters<ListingCandidateSyncDrizzleExecutor["execute"]>[0]
  ): Promise<unknown> {
    const rendered = render(query);
    this.calls.push(rendered);
    if (/^UPDATE `listings`/u.test(rendered.sql.trim())) {
      return [{ affectedRows: this.updateAffectedRows }, []];
    }
    if (/FROM `listings`/u.test(rendered.sql)) {
      return [[listingRow()], []];
    }
    if (/^INSERT /u.test(rendered.sql.trim()))
      return [{ affectedRows: 1, insertId: 91 }, []];
    return [[], []];
  }

  async transaction<T>(
    operation: (tx: ListingCandidateSyncDrizzleExecutor) => Promise<T>
  ): Promise<T> {
    try {
      const result = await operation(this);
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

describe("ListingCandidateSyncDrizzleStore (isolated MySQL/Drizzle contract)", () => {
  it("uses the executor's transaction and propagates a callback failure for rollback", async () => {
    const executor = new TransactionMock();
    const store = createListingCandidateSyncDrizzleStore(executor);

    await expect(
      store.withTransaction(async tx => {
        await tx.lockProjectForUpdate({ projectId: 17 });
        throw new Error("later audit insert failed");
      })
    ).rejects.toThrow("later audit insert failed");

    expect(executor).toMatchObject({ commits: 0, rollbacks: 1 });
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toMatchObject({
      sql: expect.stringContaining("FROM `projects`"),
      params: [17],
    });
    expect(executor.calls[0]?.sql).toMatch(/FOR UPDATE\s*$/u);
  });

  it("fails closed rather than falling back to autocommit when the executor cannot transact", async () => {
    const executor: ListingCandidateSyncDrizzleExecutor = {
      execute: async () => [[], []],
    };
    const store = createListingCandidateSyncDrizzleStore(executor);

    await expect(
      store.withTransaction(async () => "unreachable")
    ).rejects.toThrow("transaction-capable executor");
  });

  it("renders workspace/project scoped locks and the exact Listing CAS predicate", async () => {
    const executor = new TransactionMock();
    const store = createListingCandidateSyncDrizzleStore(executor);

    await store.withTransaction(async tx => {
      await tx.lockCandidateForUpdate({
        candidateId: 301,
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockLatestCandidateForUpdate({
        candidateKey: "candidate-lineage",
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockLatestCandidateReviewForUpdate({
        candidateId: 301,
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockCoreForUpdate({
        coreRevisionId: 101,
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockLatestCoreForUpdate({
        coreId: "core-lineage",
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockFactsForUpdate({
        factRevisionIds: [201, 202],
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockLatestFactForUpdate({
        attributeKey: "Material",
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockLatestProductAttributesFileForUpdate({
        workspaceId: 7,
        projectId: 17,
      });
      await tx.lockListingForUpdate({ listingId: 401, projectId: 17 });
      await tx.lockLatestCompleteSnapshotForUpdate({
        workspaceId: 7,
        projectId: 17,
        listingId: 401,
      });
      await tx.lockLatestLegacyListingVersionForUpdate({
        listingId: 401,
        projectId: 17,
      });
      const cas = await tx.compareAndSwapListing({
        listingId: 401,
        projectId: 17,
        expectedListingVersion: 3,
        changes: {
          bulletPoints: '["replacement"]',
          version: 4,
          updatedAt: new Date("2026-10-07T01:02:03.000Z"),
        },
      });
      expect(cas).toMatchObject({
        affectedRows: 1,
        listing: { id: 401, projectId: 17, version: 3 },
      });
    });

    const readLocks = executor.calls.filter(call =>
      /^SELECT /u.test(call.sql.trim())
    );
    expect(readLocks).toHaveLength(12);
    for (const call of readLocks) expect(call.sql).toMatch(/FOR UPDATE\s*$/u);

    const candidates = executor.calls[0];
    expect(candidates?.sql).toContain("FROM `listing_bullet_candidates`");
    expect(candidates?.sql).toContain("`id` = ?");
    expect(candidates?.sql).toContain("`workspaceId` = ?");
    expect(candidates?.sql).toContain("`projectId` = ?");
    expect(candidates?.params).toEqual([301, 7, 17]);

    const facts = executor.calls[5];
    expect(facts?.sql).toContain("`id` IN (?, ?)");
    expect(facts?.sql).toContain("`workspaceId` = ?");
    expect(facts?.sql).toContain("`projectId` = ?");
    expect(facts?.params).toEqual([201, 202, 7, 17]);

    const rawFile = executor.calls[7];
    expect(rawFile?.sql).toContain("FROM `projectFiles`");
    expect(rawFile?.sql).toContain("`workspaceId` = ?");
    expect(rawFile?.sql).toContain("`projectId` = ?");
    expect(rawFile?.params).toEqual([7, 17]);

    const listing = executor.calls[8];
    expect(listing?.sql).toContain("FROM `listings`");
    expect(listing?.sql).toContain("`id` = ?");
    expect(listing?.sql).toContain("`projectId` = ?");
    expect(listing?.params).toEqual([401, 17]);

    const casUpdate = executor.calls[11];
    expect(casUpdate?.sql).toContain("UPDATE `listings`");
    expect(casUpdate?.sql).toContain("WHERE `id` = ?");
    expect(casUpdate?.sql).toContain("AND `projectId` = ?");
    expect(casUpdate?.sql).toContain("AND `version` = ?");
    expect(casUpdate?.params?.slice(-3)).toEqual([401, 17, 3]);
  });

  it("returns a CAS miss only for zero affected rows and rejects unsafe multi-row results", async () => {
    const executor = new TransactionMock();
    const store = createListingCandidateSyncDrizzleStore(executor);

    executor.updateAffectedRows = 0;
    await store.withTransaction(async tx => {
      await expect(
        tx.compareAndSwapListing({
          listingId: 401,
          projectId: 17,
          expectedListingVersion: 3,
          changes: { bulletPoints: "[]", version: 4, updatedAt: new Date() },
        })
      ).resolves.toEqual({ affectedRows: 0, listing: null });
    });

    executor.updateAffectedRows = 2;
    await expect(
      store.withTransaction(tx =>
        tx.compareAndSwapListing({
          listingId: 401,
          projectId: 17,
          expectedListingVersion: 3,
          changes: { bulletPoints: "[]", version: 4, updatedAt: new Date() },
        })
      )
    ).rejects.toThrow("affected more than one row");
    expect(executor.rollbacks).toBe(1);
  });

  it("locks versions and requires exactly-one-row snapshot and legacy-version inserts", async () => {
    const source = await readFile(modulePath, "utf8");
    expect(source).toMatch(
      /FROM \\`listing_complete_snapshots\\`[\s\S]*?ORDER BY \\`contentVersion\\` DESC[\s\S]*?FOR UPDATE/u
    );
    expect(source).toMatch(
      /FROM \\`listingVersions\\`[\s\S]*?ORDER BY \\`versionNumber\\` DESC[\s\S]*?FOR UPDATE/u
    );
    expect(source).toMatch(
      /async insertCompleteSnapshot[\s\S]*?requireSingleInsert\(result, "listing_complete_snapshots insert"\)/u
    );
    expect(source).toMatch(
      /async insertLegacyListingVersion[\s\S]*?requireSingleInsert\(result, "listingVersions insert"\)/u
    );
    expect(source).toMatch(
      /async registerCompleteSnapshotArtifact[\s\S]*?registerUnifiedArtifact\(\{[\s\S]*?executor:[\s\S]*?failOnError: true/u
    );
    expect(source).toContain('artifactKey = "listing.complete_snapshot"');
    expect(source).toContain('sourceTable: "listings"');
    expect(source).toContain("contentHash: input.fullHash");
    expect(source).toContain("snapshotId: input.snapshotId");
    expect(source).not.toContain(
      "blocked_pending_transactional_artifact_outbox"
    );
    expect(source).toContain("listingCandidateSyncDrizzleStoreRoutePolicy");
    expect(listingCandidateSyncDrizzleStoreRoutePolicy).toMatchObject({
      publicSync: "enabled_with_transactional_artifact_registration",
    });
  });

  it("looks up an already-applied request's exact immutable snapshot Artifact without re-registering it", async () => {
    const executor = new TransactionMock();
    const store = createListingCandidateSyncDrizzleStore(executor);

    await store.withTransaction(async tx => {
      await expect(
        tx.findCompleteSnapshotArtifact({
          snapshotId: 91,
          workspaceId: 7,
          projectId: 17,
          listingId: 401,
          fullHash: "a".repeat(64),
        })
      ).resolves.toBeNull();
    });

    const lookup = executor.calls[0];
    expect(lookup?.sql).toContain("FROM `ai_artifacts`");
    expect(lookup?.sql).toContain(
      "`artifactKey` = 'listing.complete_snapshot'"
    );
    expect(lookup?.sql).toContain("`sourceTable` = 'listings'");
    expect(lookup?.sql).toContain(
      "JSON_EXTRACT(`contentJson`, '$.snapshotId')"
    );
    expect(lookup?.sql).toContain("`status` IN ('final', 'superseded')");
    expect(lookup?.sql).toMatch(/FOR UPDATE\s*$/u);
    expect(lookup?.params).toEqual([7, "401", 17, "a".repeat(64), "91"]);
  });
});
