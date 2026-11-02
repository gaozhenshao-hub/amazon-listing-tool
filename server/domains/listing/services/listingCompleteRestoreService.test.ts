import { describe, expect, it } from "vitest";

import {
  ListingCompleteRestoreError,
  restoreGovernedCompleteSnapshot,
  previewGovernedCompleteRestore,
  type ArtifactRegistration,
  type ListingCompleteRestoreSnapshot,
  type ListingCompleteRestoreStore,
  type ListingCompleteRestoreTx,
} from "./listingCompleteRestoreService";
import {
  hashCompleteListing,
  type LegacyListingRow,
} from "./listingCandidateSyncService";

const workspaceId = 7;
const projectId = 17;
const actorId = 31;
const listingId = 401;
const sourceSnapshotId = 901;
const fixedNow = new Date("2026-10-07T04:05:06.000Z");

function fullListing(overrides: Partial<LegacyListingRow> = {}): LegacyListingRow {
  return {
    id: listingId,
    projectId,
    title: "Current English Title",
    itemHighlights: "Current English highlights",
    bulletPoints: '[{"subtitle":"Current","fullText":"Current English bullet"}]',
    description: "Current English description",
    searchTerms: "current search terms",
    imageAdvice: '{"main":"current English image advice"}',
    imageAdviceCn: '{"main":"当前中文图片建议"}',
    titleCn: "当前中文标题",
    itemHighlightsCn: "当前中文亮点",
    bulletPointsCn: '["当前中文卖点"]',
    descriptionCn: "当前中文描述",
    searchTermsCn: "当前中文搜索词",
    qaContent: '[{"q":"Current question","a":"Current answer"}]',
    qaContentCn: '[{"q":"当前问题","a":"当前回答"}]',
    lockedSteps: "[4,5]",
    checklistScores: '{"4":{"passed":true}}',
    agentRunId: "run_current",
    version: 2,
    isActive: 1,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    updatedAt: new Date("2026-10-06T12:00:00.000Z"),
    ...overrides,
  };
}

function sourceListing(): LegacyListingRow {
  return fullListing({
    title: "Restored English Title",
    itemHighlights: "Restored English highlights",
    bulletPoints: '[{"subtitle":"Restored","fullText":"Restored English bullet"}]',
    description: "Restored English description",
    searchTerms: "restored search terms",
    imageAdvice: '{"main":"restored English image advice"}',
    imageAdviceCn: '{"main":"恢复中文图片建议"}',
    titleCn: "恢复中文标题",
    itemHighlightsCn: "恢复中文亮点",
    bulletPointsCn: '["恢复中文卖点"]',
    descriptionCn: "恢复中文描述",
    searchTermsCn: "恢复中文搜索词",
    qaContent: '[{"q":"Restored question","a":"Restored answer"}]',
    qaContentCn: '[{"q":"恢复问题","a":"恢复回答"}]',
    lockedSteps: "[1,2,3,4,5]",
    checklistScores: '{"1":{"passed":true},"5":{"passed":true}}',
    agentRunId: "run_restored",
    version: 1,
    updatedAt: new Date("2026-10-06T08:00:00.000Z"),
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function artifact(snapshotId: number, contentHash: string): ArtifactRegistration {
  return {
    artifactId: `art_listing_${snapshotId}`,
    artifactKey: "listing.complete_snapshot",
    version: snapshotId,
    ref: `ai-artifact://art_listing_${snapshotId}@${snapshotId}`,
    currentRef: "ai-artifact-scope://listing.complete_snapshot@current",
    contentHash,
  };
}

class InMemoryRestoreStore {
  listing = fullListing();
  source = sourceListing();
  sourceHash = hashCompleteListing(this.source);
  snapshots: ListingCompleteRestoreSnapshot[] = [
    {
      id: sourceSnapshotId,
      workspaceId,
      projectId,
      listingId,
      contentVersion: 1,
      fullPayloadJson: clone(this.source),
      fullHash: this.sourceHash,
      humanApprovalRef: "listing_review:701",
      changeType: "candidate_apply",
      status: "approved",
      expectedListingVersion: 1,
      listingVersion: 1,
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: fixedNow,
      createdAt: fixedNow,
    },
  ];
  artifacts = new Map<string, ArtifactRegistration>([
    [`${sourceSnapshotId}:${this.sourceHash}`, artifact(sourceSnapshotId, this.sourceHash)],
  ]);
  legacyVersions: number[] = [];
  project = { id: projectId, workspaceId, userId: actorId };
  failArtifactRegistration = false;
  failCas = false;

  private key(snapshotId: number, hash: string) {
    return `${snapshotId}:${hash}`;
  }

  private tx(): ListingCompleteRestoreTx {
    return {
      lockProjectForUpdate: async () => clone(this.project),
      lockCompleteSnapshotForUpdate: async input => {
        const snapshot = this.snapshots.find(row =>
          row.id === input.snapshotId &&
          row.workspaceId === input.workspaceId &&
          row.projectId === input.projectId
        );
        return snapshot ? clone(snapshot) : null;
      },
      lockListingForUpdate: async input =>
        input.listingId === this.listing.id && input.projectId === this.listing.projectId
          ? clone(this.listing)
          : null,
      lockLatestCompleteSnapshotForUpdate: async input => {
        const rows = this.snapshots
          .filter(row => row.workspaceId === input.workspaceId && row.projectId === input.projectId && row.listingId === input.listingId)
          .sort((left, right) => right.contentVersion - left.contentVersion || right.id - left.id);
        return rows[0] ? clone(rows[0]) : null;
      },
      lockLatestLegacyListingVersionForUpdate: async () => {
        const versionNumber = this.legacyVersions.at(-1);
        return versionNumber ? { versionNumber } : null;
      },
      compareAndSwapCompleteListing: async input => {
        if (this.failCas || input.expectedListingVersion !== this.listing.version) {
          return { affectedRows: 0, listing: null };
        }
        this.listing = clone(input.restoredListing);
        return { affectedRows: 1, listing: clone(this.listing) };
      },
      insertCompleteSnapshot: async input => {
        const id = Math.max(...this.snapshots.map(row => row.id)) + 1;
        this.snapshots.push({ id, createdAt: fixedNow, ...clone(input) });
        return { insertId: id };
      },
      registerCompleteSnapshotArtifact: async input => {
        if (this.failArtifactRegistration) throw new Error("simulated Artifact failure");
        const registered = artifact(input.snapshotId, input.fullHash);
        this.artifacts.set(this.key(input.snapshotId, input.fullHash), registered);
        return registered;
      },
      findCompleteSnapshotArtifact: async input =>
        this.artifacts.get(this.key(input.snapshotId, input.fullHash)) ?? null,
      insertLegacyListingVersion: async input => {
        this.legacyVersions.push(input.versionNumber);
        return { insertId: this.legacyVersions.length };
      },
      listApprovedCompleteSnapshots: async input => this.snapshots
        .filter(row => row.workspaceId === input.workspaceId && row.projectId === input.projectId && row.status === "approved")
        .slice(0, input.limit)
        .map(row => ({
          id: row.id,
          listingId: row.listingId,
          contentVersion: row.contentVersion,
          fullHash: row.fullHash,
          humanApprovalRef: row.humanApprovalRef,
          changeType: row.changeType,
          status: row.status,
          expectedListingVersion: row.expectedListingVersion,
          listingVersion: row.listingVersion,
          createdBy: row.createdBy,
          approvedBy: row.approvedBy,
          approvedAt: row.approvedAt,
          createdAt: row.createdAt,
        })),
    };
  }

  readonly store: ListingCompleteRestoreStore = {
    withTransaction: async operation => {
      const before = clone({
        listing: this.listing,
        snapshots: this.snapshots,
        artifacts: [...this.artifacts.entries()],
        legacyVersions: this.legacyVersions,
      });
      try {
        return await operation(this.tx());
      } catch (error) {
        this.listing = before.listing;
        this.snapshots = before.snapshots;
        this.artifacts = new Map(before.artifacts);
        this.legacyVersions = before.legacyVersions;
        throw error;
      }
    },
  };
}

function input(state: InMemoryRestoreStore, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    projectId,
    actorId,
    actorRole: "user",
    sourceSnapshotId,
    listingId,
    expectedListingVersion: state.listing.version,
    expectedFullHash: hashCompleteListing(state.listing),
    expectedSourceFullHash: state.sourceHash,
    ...overrides,
  };
}

describe("governed complete Listing restore", () => {
  it("previews and atomically restores every governed English/Chinese/QA/image/lock/checklist/run field", async () => {
    const state = new InMemoryRestoreStore();
    const request = input(state);

    const preview = await previewGovernedCompleteRestore(state.store, request);
    expect(preview.sourceFullPayload).toMatchObject({
      title: "Restored English Title",
      titleCn: "恢复中文标题",
      imageAdvice: '{"main":"restored English image advice"}',
      imageAdviceCn: '{"main":"恢复中文图片建议"}',
      qaContent: '[{"q":"Restored question","a":"Restored answer"}]',
      qaContentCn: '[{"q":"恢复问题","a":"恢复回答"}]',
      lockedSteps: "[1,2,3,4,5]",
      checklistScores: '{"1":{"passed":true},"5":{"passed":true}}',
      agentRunId: "run_restored",
    });
    expect(preview.serverAssignedFields).toEqual(["version", "updatedAt"]);

    const result = await restoreGovernedCompleteSnapshot(state.store, request, { now: () => fixedNow });

    expect(result).toMatchObject({ outcome: "restored", sourceSnapshotId, listingVersion: 3 });
    expect(state.listing).toMatchObject({
      ...state.source,
      createdAt: "2026-10-06T00:00:00.000Z",
      version: 3,
      updatedAt: fixedNow.toJSON(),
    });
    expect(state.snapshots).toHaveLength(2);
    expect(state.snapshots[1]).toMatchObject({
      changeType: "rollback",
      status: "approved",
      expectedListingVersion: 2,
      listingVersion: 3,
      fullPayloadJson: state.listing,
    });
    expect(state.legacyVersions).toEqual([1]);
  });

  it("rejects a cross-workspace snapshot before any Listing write", async () => {
    const state = new InMemoryRestoreStore();
    const original = clone(state.listing);

    await expect(restoreGovernedCompleteSnapshot(state.store, input(state, { workspaceId: 8 })))
      .rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ListingCompleteRestoreError>);

    expect(state.listing).toEqual(original);
    expect(state.snapshots).toHaveLength(1);
  });

  it("rejects an unauthorized actor before any Listing write", async () => {
    const state = new InMemoryRestoreStore();
    state.project.userId = 99;

    await expect(restoreGovernedCompleteSnapshot(state.store, input(state)))
      .rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ListingCompleteRestoreError>);

    expect(state.listing.version).toBe(2);
    expect(state.snapshots).toHaveLength(1);
  });

  it("fails closed when a selected complete snapshot is missing even one full-payload field", async () => {
    const state = new InMemoryRestoreStore();
    const payload = state.snapshots[0].fullPayloadJson as Record<string, unknown>;
    delete payload.agentRunId;
    // The stored hash can be syntactically valid while the payload itself is
    // malformed; field completeness must fail before any source hash is trusted.
    state.snapshots[0].fullHash = "b".repeat(64);
    state.sourceHash = state.snapshots[0].fullHash;
    state.artifacts = new Map([[`${sourceSnapshotId}:${state.sourceHash}`, artifact(sourceSnapshotId, state.sourceHash)]]);

    await expect(restoreGovernedCompleteSnapshot(state.store, input(state)))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" } satisfies Partial<ListingCompleteRestoreError>);

    expect(state.listing.title).toBe("Current English Title");
    expect(state.snapshots).toHaveLength(1);
  });

  it("returns a conflict for a stale full-hash/version CAS request without overwriting concurrent content", async () => {
    const state = new InMemoryRestoreStore();
    const staleRequest = input(state);
    state.listing = fullListing({
      title: "Concurrent operator title",
      version: 3,
      updatedAt: new Date("2026-10-07T04:00:00.000Z"),
    });

    await expect(restoreGovernedCompleteSnapshot(state.store, staleRequest))
      .rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<ListingCompleteRestoreError>);

    expect(state.listing.title).toBe("Concurrent operator title");
    expect(state.snapshots).toHaveLength(1);
  });

  it("rolls back the complete Listing CAS and immutable snapshot when governed Artifact registration fails", async () => {
    const state = new InMemoryRestoreStore();
    state.failArtifactRegistration = true;
    const original = clone(state.listing);

    await expect(restoreGovernedCompleteSnapshot(state.store, input(state), { now: () => fixedNow }))
      .rejects.toThrow("simulated Artifact failure");

    expect(state.listing).toEqual(original);
    expect(state.snapshots).toHaveLength(1);
    expect(state.legacyVersions).toEqual([]);
  });

  it("replays the identical approved request idempotently without a second snapshot, Artifact, or legacy audit row", async () => {
    const state = new InMemoryRestoreStore();
    const request = input(state);

    await expect(restoreGovernedCompleteSnapshot(state.store, request, { now: () => fixedNow }))
      .resolves.toMatchObject({ outcome: "restored" });
    await expect(restoreGovernedCompleteSnapshot(state.store, request, { now: () => fixedNow }))
      .resolves.toMatchObject({ outcome: "already_restored", contentVersion: 2 });

    expect(state.snapshots).toHaveLength(2);
    expect(state.artifacts).toHaveLength(2);
    expect(state.legacyVersions).toEqual([1]);
  });
});
