import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import {
  createListingCompleteRestoreDrizzleStore,
  listingCompleteRestoreDrizzleStoreRoutePolicy,
  type ListingCompleteRestoreDrizzleExecutor,
} from "./listingCompleteRestoreDrizzleStore";

const dialect = new MySqlDialect();
const modulePath = fileURLToPath(
  new URL("./listingCompleteRestoreDrizzleStore.ts", import.meta.url)
);

type CapturedQuery = { sql: string; params: unknown[] };

function render(
  query: Parameters<ListingCompleteRestoreDrizzleExecutor["execute"]>[0]
): CapturedQuery {
  return dialect.sqlToQuery(query);
}

function listingRow() {
  return {
    id: 401,
    projectId: 17,
    title: "Restored title",
    itemHighlights: "Restored highlights",
    bulletPoints: '["one","two","three","four","five"]',
    description: "Restored description",
    searchTerms: "restored terms",
    imageAdvice: '{"main":"restored"}',
    imageAdviceCn: '{"main":"恢复"}',
    titleCn: "恢复标题",
    itemHighlightsCn: "恢复亮点",
    bulletPointsCn: '["一","二","三","四","五"]',
    descriptionCn: "恢复描述",
    searchTermsCn: "恢复关键词",
    qaContent: '[{"q":"Q","a":"A"}]',
    qaContentCn: '[{"q":"问","a":"答"}]',
    lockedSteps: "[1,2,3,4,5]",
    checklistScores: '{"1":{"passed":true}}',
    agentRunId: "run_restored",
    version: 4,
    isActive: 1,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    updatedAt: new Date("2026-10-07T00:00:00.000Z"),
  };
}

class TransactionMock implements ListingCompleteRestoreDrizzleExecutor {
  readonly calls: CapturedQuery[] = [];
  commits = 0;
  rollbacks = 0;
  updateAffectedRows = 1;

  async execute(
    query: Parameters<ListingCompleteRestoreDrizzleExecutor["execute"]>[0]
  ): Promise<unknown> {
    const captured = render(query);
    this.calls.push(captured);
    if (/^UPDATE `listings`/u.test(captured.sql.trim())) {
      return [{ affectedRows: this.updateAffectedRows }, []];
    }
    if (/FROM `listings`/u.test(captured.sql)) return [[listingRow()], []];
    if (/^INSERT /u.test(captured.sql.trim())) return [{ affectedRows: 1, insertId: 91 }, []];
    return [[], []];
  }

  async transaction<T>(
    operation: (tx: ListingCompleteRestoreDrizzleExecutor) => Promise<T>
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

describe("ListingCompleteRestoreDrizzleStore (isolated MySQL/Drizzle contract)", () => {
  it("uses the executor transaction and propagates later Artifact/audit failure for rollback", async () => {
    const executor = new TransactionMock();
    const store = createListingCompleteRestoreDrizzleStore(executor);

    await expect(store.withTransaction(async tx => {
      await tx.lockCompleteSnapshotForUpdate({ snapshotId: 901, workspaceId: 7, projectId: 17 });
      throw new Error("later governed Artifact registration failed");
    })).rejects.toThrow("later governed Artifact registration failed");

    expect(executor).toMatchObject({ commits: 0, rollbacks: 1 });
    expect(executor.calls[0]?.sql).toMatch(/FROM `listing_complete_snapshots`/u);
    expect(executor.calls[0]?.sql).toMatch(/FOR UPDATE\s*$/u);
    expect(executor.calls[0]?.params).toEqual([901, 7, 17]);
  });

  it("fails closed instead of falling back to autocommit", async () => {
    const store = createListingCompleteRestoreDrizzleStore({ execute: async () => [[], []] });

    await expect(store.withTransaction(async () => "unreachable"))
      .rejects.toThrow("transaction-capable executor");
  });

  it("locks complete snapshots with workspace/project scope and writes every mutable formal Listing field under version CAS", async () => {
    const executor = new TransactionMock();
    const store = createListingCompleteRestoreDrizzleStore(executor);
    const restored = listingRow();

    await store.withTransaction(async tx => {
      await tx.lockProjectForUpdate({ projectId: 17 });
      await tx.lockCompleteSnapshotForUpdate({ snapshotId: 901, workspaceId: 7, projectId: 17 });
      await tx.lockListingForUpdate({ listingId: 401, projectId: 17 });
      await tx.lockLatestCompleteSnapshotForUpdate({ workspaceId: 7, projectId: 17, listingId: 401 });
      const cas = await tx.compareAndSwapCompleteListing({
        listingId: 401,
        projectId: 17,
        expectedListingVersion: 3,
        restoredListing: restored,
      });
      expect(cas).toMatchObject({ affectedRows: 1, listing: { id: 401, projectId: 17 } });
    });

    const sourceLock = executor.calls[1];
    expect(sourceLock?.sql).toContain("FROM `listing_complete_snapshots`");
    expect(sourceLock?.sql).toContain("`id` = ?");
    expect(sourceLock?.sql).toContain("`workspaceId` = ?");
    expect(sourceLock?.sql).toContain("`projectId` = ?");
    expect(sourceLock?.params).toEqual([901, 7, 17]);

    const update = executor.calls.find(call => /^UPDATE `listings`/u.test(call.sql.trim()));
    expect(update?.sql).toContain("`title` = ?");
    expect(update?.sql).toContain("`itemHighlights` = ?");
    expect(update?.sql).toContain("`bulletPoints` = ?");
    expect(update?.sql).toContain("`imageAdvice` = ?");
    expect(update?.sql).toContain("`imageAdviceCn` = ?");
    expect(update?.sql).toContain("`titleCn` = ?");
    expect(update?.sql).toContain("`qaContent` = ?");
    expect(update?.sql).toContain("`qaContentCn` = ?");
    expect(update?.sql).toContain("`lockedSteps` = ?");
    expect(update?.sql).toContain("`checklistScores` = ?");
    expect(update?.sql).toContain("`agentRunId` = ?");
    expect(update?.sql).toContain("`version` = ?");
    expect(update?.sql).toContain("`updatedAt` = ?");
    expect(update?.sql).toContain("WHERE `id` = ?");
    expect(update?.sql).toContain("AND `projectId` = ?");
    expect(update?.sql).toContain("AND `version` = ?");
    expect(update?.params?.slice(-3)).toEqual([401, 17, 3]);
  });

  it("only treats a zero-row CAS update as a conflict and rejects unsafe multi-row writes", async () => {
    const executor = new TransactionMock();
    const store = createListingCompleteRestoreDrizzleStore(executor);
    const input = {
      listingId: 401,
      projectId: 17,
      expectedListingVersion: 3,
      restoredListing: listingRow(),
    };

    executor.updateAffectedRows = 0;
    await store.withTransaction(async tx => {
      await expect(tx.compareAndSwapCompleteListing(input)).resolves.toEqual({ affectedRows: 0, listing: null });
    });

    executor.updateAffectedRows = 2;
    await expect(store.withTransaction(tx => tx.compareAndSwapCompleteListing(input)))
      .rejects.toThrow("affected more than one row");
    expect(executor.rollbacks).toBe(1);
  });

  it("uses 0204 complete snapshots and transactional compact Artifact pointers, never legacy listingVersions as a restore source", async () => {
    const source = await readFile(modulePath, "utf8");

    expect(source).toMatch(/async lockCompleteSnapshotForUpdate[\s\S]*?FROM \\`listing_complete_snapshots\\`[\s\S]*?FOR UPDATE/u);
    expect(source).toMatch(/async registerCompleteSnapshotArtifact[\s\S]*?registerUnifiedArtifact\(\{[\s\S]*?executor:[\s\S]*?failOnError: true/u);
    expect(source).toContain('artifactKey = "listing.complete_snapshot"');
    expect(source).toContain("changeType: \"rollback\"");
    expect(source).toContain("contentHash: input.fullHash");
    expect(source).toContain("snapshotId: input.snapshotId");
    expect(source).toContain("async insertLegacyListingVersion");
    expect(source).toContain("async lockLatestLegacyListingVersionForUpdate");
    const sourceLockBlock = source.split("async lockCompleteSnapshotForUpdate")[1]
      ?.split("async lockListingForUpdate")[0];
    expect(sourceLockBlock).toContain("FROM \\`listing_complete_snapshots\\`");
    expect(sourceLockBlock).not.toContain("listingVersions");
    expect(listingCompleteRestoreDrizzleStoreRoutePolicy).toMatchObject({
      publicRestore: "enabled_with_transactional_artifact_registration",
    });
  });
});
