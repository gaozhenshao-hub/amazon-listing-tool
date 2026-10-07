import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  type LegacyListingRow,
  type ListingCandidateSyncCandidate,
  type ListingCandidateSyncCore,
  type ListingCandidateSyncError,
  type ListingCandidateSyncFact,
  type ListingCandidateSyncInput,
  type ListingCandidateSyncProject,
  type ListingCandidateSyncRawFile,
  type ListingCandidateSyncReview,
  type ListingCandidateSyncSnapshot,
  type ListingCandidateSyncStore,
  type ListingCandidateSyncTx,
  hashCompleteListing,
  listingFullPayloadFieldNames,
  stableJson,
  syncConfirmedListingCandidate,
  previewListingCandidateSync,
} from "./domains/listing/services/listingCandidateSyncService";

const workspaceId = 7;
const projectId = 17;
const actorId = 31;
const listingId = 401;
const candidateId = 301;
const coreRevisionId = 101;
const factId = 201;
const reviewId = 701;
const candidateInputHash = "a".repeat(64);
const sourceHash = "b".repeat(64);
const fixedNow = new Date("2026-10-07T01:02:03.000Z");

type State = {
  project: ListingCandidateSyncProject;
  candidate: ListingCandidateSyncCandidate;
  core: ListingCandidateSyncCore;
  fact: ListingCandidateSyncFact;
  rawFile: ListingCandidateSyncRawFile;
  review: ListingCandidateSyncReview;
  listing: LegacyListingRow;
  snapshots: ListingCandidateSyncSnapshot[];
  legacyVersions: Array<{ versionNumber: number; changeDescription: string }>;
  artifactRegistrations: Array<{ snapshotId: number; contentHash: string }>;
  forceCasFailure?: boolean;
  failSnapshotInsert?: boolean;
  failArtifactRegistration?: boolean;
};

function sha(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function candidateContentHash(candidate: {
  coreRevisionId: number;
  inputHash: string;
  subtitle: string | null;
  fullText: string | null;
  evidenceFactIdsJson: unknown;
  gateResultJson: unknown;
}) {
  return sha({
    coreRevisionId: candidate.coreRevisionId,
    inputHash: candidate.inputHash,
    subtitle: candidate.subtitle,
    fullText: candidate.fullText,
    evidenceFactIds: candidate.evidenceFactIdsJson,
    gateResult: candidate.gateResultJson,
  });
}

function listing(overrides: Partial<LegacyListingRow> = {}): LegacyListingRow {
  const createdAt = new Date("2026-10-06T00:00:00.000Z");
  const updatedAt = new Date("2026-10-06T12:00:00.000Z");
  return {
    id: listingId,
    projectId,
    title: "Original Title",
    itemHighlights: "Original highlights",
    bulletPoints: JSON.stringify([
      { subtitle: "B1", fullText: "Original 1" },
      { subtitle: "B2", fullText: "Original 2" },
      { subtitle: "B3", fullText: "Original 3" },
      { subtitle: "B4", fullText: "Original 4" },
      { subtitle: "B5", fullText: "Original 5" },
    ]),
    description: "Original description",
    searchTerms: "original terms",
    imageAdvice: '{"main":"original"}',
    imageAdviceCn: '{"main":"原始"}',
    titleCn: "原始标题",
    itemHighlightsCn: "原始亮点",
    bulletPointsCn: '["原始一","原始二","原始三","原始四","原始五"]',
    descriptionCn: "原始描述",
    searchTermsCn: "原始关键词",
    qaContent: '[{"q":"Q","a":"A"}]',
    qaContentCn: '[{"q":"问","a":"答"}]',
    lockedSteps: "[1,2,3,4,5]",
    checklistScores: '{"1":{"passed":true}}',
    agentRunId: "run_listing_1",
    version: 3,
    isActive: 1,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function initialState(overrides: Partial<State> = {}): State {
  const candidate: ListingCandidateSyncCandidate = {
    id: candidateId,
    candidateKey: "candidate-lineage-a",
    candidateRevision: 2,
    workspaceId,
    projectId,
    coreRevisionId,
    inputHash: candidateInputHash,
    subtitle: "DURABLE BUILD",
    fullText:
      "Built from confirmed 304 stainless steel for reliable daily use.",
    evidenceFactIdsJson: [factId],
    gateResultJson: {
      status: "passed",
      eligibleForConfirmation: true,
      provenance: { source: "human" },
    },
    status: "confirmed",
    contentHash: "",
    staleAt: null,
  };
  candidate.contentHash = candidateContentHash(candidate);

  return {
    project: { id: projectId, workspaceId, userId: actorId },
    candidate,
    core: {
      id: coreRevisionId,
      coreId: "core-lineage-a",
      workspaceId,
      projectId,
      sellingPointIndex: 2,
      buyerReason: "Durable daily use",
      factRevisionIdsJson: [factId],
      status: "confirmed",
      revision: 4,
      inputHash: candidateInputHash,
      confirmedBy: actorId,
      confirmedAt: fixedNow,
      staleAt: null,
    },
    fact: {
      id: factId,
      workspaceId,
      projectId,
      attributeKey: "Material",
      value: "304 stainless steel",
      sourceFileId: 9,
      rawHash: sourceHash,
      status: "confirmed",
      revision: 5,
      confirmedBy: actorId,
      confirmedAt: fixedNow,
      staleAt: null,
    },
    rawFile: {
      id: 9,
      workspaceId,
      projectId,
      fileType: "product_attributes",
      rawContentHash: sourceHash,
      status: "completed",
      lifecycleState: "hot",
    },
    review: {
      id: reviewId,
      candidateId,
      reviewRevision: 3,
      decision: "accepted",
      status: "recorded",
      expectedRevision: 2,
      actorId,
      createdAt: fixedNow,
    },
    listing: listing(),
    snapshots: [],
    legacyVersions: [{ versionNumber: 12, changeDescription: "legacy" }],
    artifactRegistrations: [],
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The only persistence object used in this file. It copies state before every
 * transaction and commits the copy only after the service resolves, so it proves
 * that neither a real DB nor a partial write is needed by these tests.
 */
class InMemoryListingCandidateSyncStore implements ListingCandidateSyncStore {
  state: State;
  commits = 0;
  rollbacks = 0;
  lockLog: string[] = [];
  casCalls = 0;

  constructor(state: State) {
    this.state = clone(state);
  }

  async withTransaction<T>(
    operation: (tx: ListingCandidateSyncTx) => Promise<T>
  ): Promise<T> {
    const trial = clone(this.state);
    try {
      const result = await operation(this.tx(trial));
      this.state = trial;
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }

  private tx(state: State): ListingCandidateSyncTx {
    const lock = (name: string) => this.lockLog.push(name);
    return {
      lockProjectForUpdate: async () => {
        lock("project FOR UPDATE");
        return clone(state.project);
      },
      lockCandidateForUpdate: async input => {
        lock("candidate FOR UPDATE");
        return state.candidate.id === input.candidateId &&
          state.candidate.workspaceId === input.workspaceId &&
          state.candidate.projectId === input.projectId
          ? clone(state.candidate)
          : null;
      },
      lockLatestCandidateForUpdate: async input => {
        lock("latest candidate FOR UPDATE");
        return state.candidate.candidateKey === input.candidateKey &&
          state.candidate.workspaceId === input.workspaceId &&
          state.candidate.projectId === input.projectId
          ? {
              id: state.candidate.id,
              candidateRevision: state.candidate.candidateRevision,
            }
          : null;
      },
      lockLatestCandidateReviewForUpdate: async input => {
        lock("candidate review FOR UPDATE");
        return state.review.candidateId === input.candidateId &&
          state.candidate.workspaceId === input.workspaceId &&
          state.candidate.projectId === input.projectId
          ? clone(state.review)
          : null;
      },
      lockCoreForUpdate: async input => {
        lock("core FOR UPDATE");
        return state.core.id === input.coreRevisionId &&
          state.core.workspaceId === input.workspaceId &&
          state.core.projectId === input.projectId
          ? clone(state.core)
          : null;
      },
      lockLatestCoreForUpdate: async input => {
        lock("latest core FOR UPDATE");
        return state.core.coreId === input.coreId &&
          state.core.workspaceId === input.workspaceId &&
          state.core.projectId === input.projectId
          ? { id: state.core.id, revision: state.core.revision }
          : null;
      },
      lockFactsForUpdate: async input => {
        lock("facts FOR UPDATE");
        return input.factRevisionIds.includes(state.fact.id) &&
          state.fact.workspaceId === input.workspaceId &&
          state.fact.projectId === input.projectId
          ? [clone(state.fact)]
          : [];
      },
      lockLatestFactForUpdate: async input => {
        lock("latest fact FOR UPDATE");
        return state.fact.attributeKey === input.attributeKey &&
          state.fact.workspaceId === input.workspaceId &&
          state.fact.projectId === input.projectId
          ? { id: state.fact.id, revision: state.fact.revision }
          : null;
      },
      lockLatestProductAttributesFileForUpdate: async input => {
        lock("raw file FOR UPDATE");
        return state.rawFile.workspaceId === input.workspaceId &&
          state.rawFile.projectId === input.projectId
          ? clone(state.rawFile)
          : null;
      },
      lockListingForUpdate: async input => {
        lock("listing FOR UPDATE");
        return state.listing.id === input.listingId &&
          state.listing.projectId === input.projectId
          ? clone(state.listing)
          : null;
      },
      lockLatestCompleteSnapshotForUpdate: async input => {
        lock("complete snapshot FOR UPDATE");
        const latest = state.snapshots
          .filter(
            snapshot =>
              snapshot.workspaceId === input.workspaceId &&
              snapshot.projectId === input.projectId &&
              snapshot.listingId === input.listingId
          )
          .sort((left, right) => right.contentVersion - left.contentVersion)[0];
        return latest ? clone(latest) : null;
      },
      lockLatestLegacyListingVersionForUpdate: async input => {
        lock("legacy version FOR UPDATE");
        if (
          input.listingId !== state.listing.id ||
          input.projectId !== state.listing.projectId
        )
          return null;
        const latest = state.legacyVersions.sort(
          (left, right) => right.versionNumber - left.versionNumber
        )[0];
        return latest ? { versionNumber: latest.versionNumber } : null;
      },
      compareAndSwapListing: async input => {
        this.casCalls += 1;
        if (
          state.forceCasFailure ||
          input.listingId !== state.listing.id ||
          input.projectId !== state.listing.projectId ||
          input.expectedListingVersion !== state.listing.version
        ) {
          return { affectedRows: 0, listing: null };
        }
        state.listing = {
          ...state.listing,
          ...input.changes,
        };
        return { affectedRows: 1, listing: clone(state.listing) };
      },
      insertCompleteSnapshot: async input => {
        if (state.failSnapshotInsert)
          throw new Error("simulated snapshot failure");
        const snapshot: ListingCandidateSyncSnapshot = {
          id: state.snapshots.length + 1,
          ...input,
        };
        state.snapshots.push(snapshot);
        return { insertId: snapshot.id };
      },
      registerCompleteSnapshotArtifact: async input => {
        if (state.failArtifactRegistration)
          throw new Error("simulated Artifact registration failure");
        state.artifactRegistrations.push({
          snapshotId: input.snapshotId,
          contentHash: input.fullHash,
        });
        return {
          artifactId: `art_listing_${input.snapshotId}`,
          artifactKey: "listing.complete_snapshot",
          version: input.contentVersion,
          ref: `ai-artifact://art_listing_${input.snapshotId}@${input.contentVersion}`,
          currentRef: "ai-artifact-scope://listing-complete-snapshot@current",
          contentHash: input.fullHash,
        };
      },
      findCompleteSnapshotArtifact: async input => {
        const match = state.artifactRegistrations.find(
          registration =>
            registration.snapshotId === input.snapshotId &&
            registration.contentHash === input.fullHash
        );
        if (!match) return null;
        return {
          artifactId: `art_listing_${match.snapshotId}`,
          artifactKey: "listing.complete_snapshot",
          version: match.snapshotId,
          ref: `ai-artifact://art_listing_${match.snapshotId}@${match.snapshotId}`,
          currentRef: "ai-artifact-scope://listing-complete-snapshot@current",
          contentHash: match.contentHash,
        };
      },
      insertLegacyListingVersion: async input => {
        state.legacyVersions.push({
          versionNumber: input.versionNumber,
          changeDescription: input.changeDescription,
        });
        return { insertId: state.legacyVersions.length };
      },
    };
  }
}

function syncInput(source: State): ListingCandidateSyncInput {
  return {
    workspaceId,
    projectId,
    actorId,
    actorRole: "user",
    candidateId,
    expectedCandidateRevision: source.candidate.candidateRevision,
    listingId,
    sellingPointIndex: source.core.sellingPointIndex,
    expectedListingVersion: source.listing.version,
    expectedFullHash: hashCompleteListing(source.listing),
  };
}

function expectSyncError(error: unknown, code: string) {
  expect(error).toMatchObject({ name: "ListingCandidateSyncError", code });
}

describe("Phase B formal Listing candidate sync (in-memory transactional store)", () => {
  it("creates a readonly preview with the necessary CAS tokens and performs no writes", async () => {
    const state = initialState();
    const store = new InMemoryListingCandidateSyncStore(state);

    const preview = await previewListingCandidateSync(store, syncInput(state));

    expect(preview).toMatchObject({
      listingId,
      projectId,
      sellingPointIndex: 2,
      existingBulletCount: 5,
      expectedListingVersion: 3,
      expectedFullHash: hashCompleteListing(state.listing),
      currentFullHash: hashCompleteListing(state.listing),
      nextListingVersion: 4,
      humanApprovalRef: `listing_review:${reviewId}`,
      candidate: { id: candidateId, candidateRevision: 2, coreRevisionId },
      core: { id: coreRevisionId, revision: 4, inputHash: candidateInputHash },
    });
    expect(preview.currentBullet).toEqual({
      subtitle: "B3",
      fullText: "Original 3",
    });
    expect(preview.candidateBullet).toEqual({
      subtitle: "DURABLE BUILD",
      fullText:
        "Built from confirmed 304 stainless steel for reliable daily use.",
    });
    expect(preview.changedFields).toEqual([
      "bulletPoints",
      "version",
      "updatedAt",
    ]);
    expect(Object.keys(preview.currentFullPayload).sort()).toEqual(
      [...listingFullPayloadFieldNames].sort()
    );
    expect(Object.keys(preview.proposedFullPayload).sort()).toEqual(
      [...listingFullPayloadFieldNames].sort()
    );
    expect(preview.proposedFullPayload).toMatchObject({ version: 4 });
    expect(store.state).toEqual(state);
    expect(store.casCalls).toBe(0);
    expect(store.commits).toBe(1);
    expect(store.lockLog).toContain("listing FOR UPDATE");
  });

  it("atomically replaces only the approved target bullet, mirrors every Listing field, and records approved audit snapshots", async () => {
    const state = initialState();
    const before = clone(state.listing);
    const store = new InMemoryListingCandidateSyncStore(state);

    const result = await syncConfirmedListingCandidate(
      store,
      syncInput(state),
      {
        now: () => fixedNow,
      }
    );

    expect(result).toMatchObject({
      outcome: "applied",
      listingId,
      candidateId,
      sellingPointIndex: 2,
      contentVersion: 1,
      expectedListingVersion: 3,
      listingVersion: 4,
      humanApprovalRef: `listing_review:${reviewId}`,
      artifactRegistration: {
        status: "registered",
        artifactId: "art_listing_1",
        artifactKey: "listing.complete_snapshot",
        version: 1,
      },
    });
    const appliedBullets = JSON.parse(store.state.listing.bulletPoints!);
    expect(appliedBullets).toEqual([
      { subtitle: "B1", fullText: "Original 1" },
      { subtitle: "B2", fullText: "Original 2" },
      {
        subtitle: "DURABLE BUILD",
        fullText:
          "Built from confirmed 304 stainless steel for reliable daily use.",
      },
      { subtitle: "B4", fullText: "Original 4" },
      { subtitle: "B5", fullText: "Original 5" },
    ]);
    for (const field of listingFullPayloadFieldNames) {
      if (["bulletPoints", "version", "updatedAt"].includes(field)) continue;
      expect(store.state.listing[field]).toEqual(before[field]);
    }
    expect(store.state.listing).toMatchObject({
      version: 4,
      updatedAt: fixedNow,
    });
    expect(store.state.snapshots).toHaveLength(1);
    expect(store.state.snapshots[0]).toMatchObject({
      workspaceId,
      projectId,
      listingId,
      contentVersion: 1,
      changeType: "candidate_apply",
      status: "approved",
      humanApprovalRef: `listing_review:${reviewId}`,
      expectedListingVersion: 3,
      listingVersion: 4,
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: fixedNow,
    });
    expect(
      Object.keys(store.state.snapshots[0].fullPayloadJson as object).sort()
    ).toEqual([...listingFullPayloadFieldNames].sort());
    expect(store.state.snapshots[0].fullHash).toBe(
      hashCompleteListing(store.state.listing)
    );
    expect(store.state.artifactRegistrations).toEqual([
      {
        snapshotId: 1,
        contentHash: store.state.snapshots[0].fullHash,
      },
    ]);
    expect(store.state.legacyVersions.at(-1)).toEqual({
      versionNumber: 13,
      changeDescription: "受控候选应用：候选 #301，卖点 3",
    });
    expect(store.lockLog).toContain("listing FOR UPDATE");
    expect(store.casCalls).toBe(1);
    expect(store.commits).toBe(1);
  });

  it("rejects a stale full-payload hash even when legacy version is unchanged and never overwrites content", async () => {
    const state = initialState({
      listing: listing({
        description: "Changed through a legacy path without version increment",
      }),
    });
    const staleInput = {
      ...syncInput(initialState()),
      expectedListingVersion: state.listing.version,
    };
    const before = clone(state);
    const store = new InMemoryListingCandidateSyncStore(state);

    await expect(
      syncConfirmedListingCandidate(store, staleInput)
    ).rejects.toSatisfy(error => {
      expectSyncError(error, "CONFLICT");
      expect((error as ListingCandidateSyncError).message).toContain(
        "全文已变化"
      );
      return true;
    });

    expect(store.state).toEqual(before);
    expect(store.casCalls).toBe(0);
    expect(store.rollbacks).toBe(1);
  });

  it("rejects a Listing version CAS miss and transactionally preserves the old Listing, snapshots, and legacy versions", async () => {
    const state = initialState({ forceCasFailure: true });
    const before = clone(state);
    const store = new InMemoryListingCandidateSyncStore(state);

    await expect(
      syncConfirmedListingCandidate(store, syncInput(state))
    ).rejects.toSatisfy(error => {
      expectSyncError(error, "CONFLICT");
      expect((error as ListingCandidateSyncError).message).toContain(
        "CAS 失败"
      );
      return true;
    });

    expect(store.casCalls).toBe(1);
    expect(store.state).toEqual(before);
    expect(store.rollbacks).toBe(1);
  });

  it("returns an explicit backfill requirement rather than writing into a Listing with fewer than five bullets", async () => {
    const state = initialState({
      listing: listing({
        bulletPoints: JSON.stringify([
          { subtitle: "B1", fullText: "Original 1" },
          { subtitle: "B2", fullText: "Original 2" },
        ]),
      }),
    });
    const before = clone(state);
    const store = new InMemoryListingCandidateSyncStore(state);

    await expect(
      previewListingCandidateSync(store, syncInput(state))
    ).rejects.toSatisfy(error => {
      expectSyncError(error, "PRECONDITION_FAILED");
      expect((error as ListingCandidateSyncError).details).toMatchObject({
        existingBulletCount: 2,
        requiredBulletCount: 5,
        needsBackfill: true,
      });
      return true;
    });

    expect(store.state).toEqual(before);
    expect(store.casCalls).toBe(0);
  });

  it("rolls back the Listing CAS when a later same-transaction audit write fails; this suite uses no real DB", async () => {
    const state = initialState({ failSnapshotInsert: true });
    const before = clone(state);
    const store = new InMemoryListingCandidateSyncStore(state);

    await expect(
      syncConfirmedListingCandidate(store, syncInput(state))
    ).rejects.toThrow("simulated snapshot failure");

    expect(store.casCalls).toBe(1);
    expect(store.state).toEqual(before);
    expect(store.state.snapshots).toEqual([]);
    expect(store.state.legacyVersions).toEqual([
      { versionNumber: 12, changeDescription: "legacy" },
    ]);
    expect(store.rollbacks).toBe(1);
  });

  it("rolls back Listing CAS, complete snapshot, and legacy version if transactional Artifact registration fails", async () => {
    const state = initialState({ failArtifactRegistration: true });
    const before = clone(state);
    const store = new InMemoryListingCandidateSyncStore(state);

    await expect(
      syncConfirmedListingCandidate(store, syncInput(state))
    ).rejects.toThrow("simulated Artifact registration failure");

    expect(store.casCalls).toBe(1);
    expect(store.state).toEqual(before);
    expect(store.rollbacks).toBe(1);
  });

  it("builds a second candidate preview from the first committed Listing row, not an older projection", async () => {
    const state = initialState();
    const store = new InMemoryListingCandidateSyncStore(state);
    const first = await syncConfirmedListingCandidate(store, syncInput(state), {
      now: () => fixedNow,
    });

    store.state.candidate = {
      ...store.state.candidate,
      id: 302,
      candidateKey: "candidate-lineage-b",
      candidateRevision: 1,
      subtitle: "EASY CLEAN",
      fullText: "Confirmed smooth surfaces wipe clean after daily use.",
    };
    store.state.candidate.contentHash = candidateContentHash(
      store.state.candidate
    );
    store.state.core = {
      ...store.state.core,
      sellingPointIndex: 3,
      revision: 5,
    };
    store.state.review = {
      ...store.state.review,
      candidateId: 302,
      reviewRevision: 4,
      expectedRevision: 1,
    };
    const secondInput: ListingCandidateSyncInput = {
      ...syncInput(store.state),
      candidateId: 302,
      expectedCandidateRevision: 1,
      sellingPointIndex: 3,
      expectedListingVersion: first.listingVersion,
      expectedFullHash: hashCompleteListing(store.state.listing),
    };

    const secondPreview = await previewListingCandidateSync(store, secondInput);

    expect(secondPreview.currentFullHash).toBe(first.fullHash);
    expect(secondPreview.currentFullPayload).toMatchObject({ version: 4 });
    expect(secondPreview.currentBullet).toEqual({
      subtitle: "B4",
      fullText: "Original 4",
    });
    expect(
      JSON.parse(secondPreview.currentFullPayload.bulletPoints as string)[2]
    ).toEqual({
      subtitle: "DURABLE BUILD",
      fullText:
        "Built from confirmed 304 stainless steel for reliable daily use.",
    });
    expect(secondPreview.candidateBullet).toEqual({
      subtitle: "EASY CLEAN",
      fullText: "Confirmed smooth surfaces wipe clean after daily use.",
    });
  });

  it("returns already_applied for a duplicate confirmed request without a second CAS or version write", async () => {
    const state = initialState();
    const store = new InMemoryListingCandidateSyncStore(state);
    const input = syncInput(state);

    const first = await syncConfirmedListingCandidate(store, input, {
      now: () => fixedNow,
    });
    const retry = await syncConfirmedListingCandidate(store, input, {
      now: () => fixedNow,
    });

    expect(first.outcome).toBe("applied");
    expect(retry).toMatchObject({
      outcome: "already_applied",
      contentVersion: 1,
      artifactRegistration: {
        status: "registered",
        contentHash: first.fullHash,
      },
    });
    expect(store.casCalls).toBe(1);
    expect(store.state.snapshots).toHaveLength(1);
    expect(store.state.legacyVersions).toHaveLength(2);
    // The idempotent path verifies the same immutable Artifact pointer without
    // selecting a new current version or writing a duplicate registration.
    expect(store.state.artifactRegistrations).toHaveLength(1);
  });
});
