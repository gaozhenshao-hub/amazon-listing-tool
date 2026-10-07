import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const routerMocks = vi.hoisted(() => ({ resolveProjectAccess: vi.fn() }));
vi.mock("./domains/listing/routerContext", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./domains/listing/routerContext")>();
  return { ...actual, resolveProjectAccess: routerMocks.resolveProjectAccess };
});

import { router } from "./_core/trpc";
import { listingCandidateReviewProcedures } from "./domains/listing/routers/candidates";
import {
  createListingCandidateReviewService,
  stableJson,
} from "./domains/listing/services/listingCandidateReviewService";

type Call = {
  table: unknown;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

function mockTransaction(reads: unknown[], insertIds: number[] = [501]) {
  const inserts: Call[] = [];
  const updates: Call[] = [];
  const values = [...reads];
  const ids = [...insertIds];
  const chain = (value: unknown) => {
    const result = {
      from: () => result,
      where: () => result,
      orderBy: () => result,
      limit: () => result,
      for: () => result,
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ) => Promise.resolve(value).then(onfulfilled, onrejected),
    };
    return result;
  };
  const tx = {
    select: vi.fn(() => chain(values.shift() ?? [])),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (data: Record<string, unknown>) => {
        inserts.push({ table, values: data });
        return [{ insertId: ids.shift() ?? 999 }];
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((data: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push({ table, data });
          return [{ affectedRows: 1 }];
        }),
      })),
    })),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    ),
  };
  return { db, tx, inserts, updates };
}

const workspaceId = 7;
const projectId = 17;
const actorId = 31;
const inputHash = "a".repeat(64);
const sourceHash = "b".repeat(64);

const project = { id: projectId, workspaceId, userId: actorId };
const core = {
  id: 101,
  coreId: "core-a",
  workspaceId,
  projectId,
  status: "confirmed",
  inputHash,
  factRevisionIdsJson: [201],
  confirmedBy: actorId,
  confirmedAt: new Date("2026-10-07T00:00:00.000Z"),
};
const currentCore = { id: core.id };
const sourceFile = { id: 9, hash: sourceHash };
const confirmedFact = {
  id: 201,
  attributeKey: "Material",
  status: "confirmed",
  confirmedBy: actorId,
  confirmedAt: new Date("2026-10-07T00:00:00.000Z"),
  sourceFileId: sourceFile.id,
  rawHash: sourceHash,
  value: "304 stainless steel",
};

function contentHash(
  gateResult: Record<string, unknown>,
  fullText = "Built for daily use",
  subtitle: string | null = "DURABLE BUILD"
) {
  return createHash("sha256")
    .update(
      stableJson({
        coreRevisionId: core.id,
        inputHash,
        subtitle,
        fullText,
        evidenceFactIds: [201],
        gateResult,
      })
    )
    .digest("hex");
}

function candidate(overrides: Record<string, unknown> = {}) {
  const gateResult = {
    status: "needs_review",
    provenance: { source: "human" },
  };
  return {
    id: 301,
    candidateKey: "candidate-a",
    candidateRevision: 1,
    workspaceId,
    projectId,
    coreRevisionId: core.id,
    jobId: null,
    skillRunId: null,
    promptVersion: null,
    actualModel: null,
    inputHash,
    subtitle: "DURABLE BUILD",
    fullText: "Built for daily use",
    evidenceFactIdsJson: [201],
    gateResultJson: gateResult,
    status: "review_required",
    contentHash: contentHash(gateResult),
    ...overrides,
  };
}

function serviceFor(db: unknown) {
  return createListingCandidateReviewService({
    getDb: async () => db as never,
    createId: () => "candidate-new",
    now: () => new Date("2026-10-07T01:02:03.000Z"),
  });
}

const actor = { workspaceId, projectId, actorId, actorRole: "user" };
const candidateRouterCaller = router(listingCandidateReviewProcedures);

function routerContext(workspace = workspaceId): TrpcContext {
  return {
    user: {
      id: actorId,
      role: "user",
      openId: "candidate-reviewer",
      email: "reviewer@test.local",
      name: "Reviewer",
      loginMethod: "manus",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    workspaceId: workspace,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("listing candidate review service (pure mock persistence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.resolveProjectAccess.mockResolvedValue(project);
  });

  it("persists a human candidate against the current confirmed core with content and provenance hashes", async () => {
    const state = mockTransaction(
      [[project], [core], [currentCore], [confirmedFact], [sourceFile]],
      [601]
    );
    const result = await serviceFor(state.db).createCandidate({
      ...actor,
      coreRevisionId: core.id,
      coreInputHash: inputHash,
      source: "human",
      subtitle: "DURABLE BUILD",
      fullText: "Built for daily use",
      evidenceFactIds: [201],
      gateResult: { status: "needs_review", gateVersion: "human-review-v1" },
    });

    expect(result).toMatchObject({
      id: 601,
      candidateKey: "candidate-new",
      candidateRevision: 1,
      status: "review_required",
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.values).toMatchObject({
      candidateKey: "candidate-new",
      candidateRevision: 1,
      workspaceId,
      projectId,
      coreRevisionId: core.id,
      inputHash,
      status: "review_required",
      createdBy: actorId,
      evidenceFactIdsJson: [201],
    });
    expect(state.inserts[0]?.values?.gateResultJson).toMatchObject({
      status: "needs_review",
      provenance: { source: "human", skillRunId: null, actualModel: null },
    });
    expect(state.inserts[0]?.values?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("requires and persists AI Skill Run, model, prompt, and routing metadata", async () => {
    const state = mockTransaction(
      [[project], [core], [currentCore], [confirmedFact], [sourceFile]],
      [602]
    );
    await serviceFor(state.db).createCandidate({
      ...actor,
      coreRevisionId: core.id,
      coreInputHash: inputHash,
      source: "ai",
      skillRunId: 88,
      jobId: 77,
      promptVersion: "listing-bullet-v8",
      actualModel: "quality-model-v2",
      modelMetadata: {
        plannedModel: "quality-model-v3",
        fallbackReason: "capacity",
        schemaVersion: "candidate-v1",
      },
      subtitle: "DURABLE BUILD",
      fullText: "Built for daily use",
      evidenceFactIds: [201],
      gateResult: { status: "needs_review" },
    });

    expect(state.inserts[0]?.values).toMatchObject({
      jobId: 77,
      skillRunId: 88,
      promptVersion: "listing-bullet-v8",
      actualModel: "quality-model-v2",
    });
    expect(state.inserts[0]?.values?.gateResultJson).toMatchObject({
      provenance: {
        source: "ai",
        plannedModel: "quality-model-v3",
        fallbackReason: "capacity",
        schemaVersion: "candidate-v1",
      },
    });
  });

  it("creates an immutable human edit revision and records a CAS audit instead of overwriting the source candidate", async () => {
    const original = candidate();
    const state = mockTransaction(
      [
        [original],
        [project],
        [core],
        [currentCore],
        [confirmedFact],
        [sourceFile],
        [],
      ],
      [302, 701]
    );
    const result = await serviceFor(state.db).editCandidate({
      ...actor,
      candidateId: original.id,
      expectedCandidateRevision: original.candidateRevision,
      subtitle: "DURABLE 304 STEEL",
      fullText: "Made for repeat daily use",
      evidenceFactIds: [201],
      reason: "Clarified the material claim",
    });

    expect(result).toMatchObject({
      id: 302,
      candidateKey: original.candidateKey,
      candidateRevision: 2,
      reviewRevision: 1,
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.data).toMatchObject({ status: "stale" });
    expect(state.inserts[0]?.values).toMatchObject({
      candidateKey: original.candidateKey,
      candidateRevision: 2,
      parentCandidateId: original.id,
      status: "review_required",
      createdBy: actorId,
    });
    expect(state.inserts[0]?.values?.gateResultJson).toMatchObject({
      status: "needs_review",
      invalidatedReason: "human_content_edit",
      provenance: { source: "human", parentCandidateId: original.id },
    });
    expect(state.inserts[1]?.values).toMatchObject({
      candidateId: original.id,
      decision: "edited",
      expectedRevision: 1,
      resultingCandidateId: 302,
      actorId,
      reason: "Clarified the material claim",
    });
  });

  it("rejects a stale browser CAS token before any write", async () => {
    const state = mockTransaction([
      [project],
      [candidate({ candidateRevision: 2 })],
    ]);
    await expect(
      serviceFor(state.db).rejectCandidate({
        ...actor,
        candidateId: 301,
        expectedCandidateRevision: 1,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a current candidate with a versioned human audit record", async () => {
    const existing = candidate();
    const state = mockTransaction([[project], [existing], []], [702]);
    const result = await serviceFor(state.db).rejectCandidate({
      ...actor,
      candidateId: existing.id,
      expectedCandidateRevision: existing.candidateRevision,
      reason: "Duplicate buyer angle",
    });

    expect(result).toMatchObject({
      id: existing.id,
      status: "rejected",
      reviewRevision: 1,
    });
    expect(state.updates[0]?.data).toEqual({ status: "rejected" });
    expect(state.inserts[0]?.values).toMatchObject({
      candidateId: existing.id,
      decision: "rejected",
      expectedRevision: existing.candidateRevision,
      beforeHash: existing.contentHash,
      afterHash: null,
      reason: "Duplicate buyer angle",
    });
  });

  it("fails closed when the candidate's previously confirmed fact is no longer current", async () => {
    const staleFact = { ...confirmedFact, status: "stale" };
    const state = mockTransaction([
      [candidate()],
      [project],
      [core],
      [currentCore],
      [staleFact],
      [sourceFile],
    ]);
    await expect(
      serviceFor(state.db).confirmCandidate({
        ...actor,
        candidateId: 301,
        expectedCandidateRevision: 1,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("confirms only a current governed candidate and records the human acceptance audit", async () => {
    const fullText = "A simple, durable build for daily routines, made with 304 stainless steel to keep the design grounded in a clear material detail and give shoppers an easy way to judge whether the finish suits their everyday setup and preferences";
    const subtitle = "Durable Everyday Design:";
    const initial = candidate();
    const existing = candidate({ subtitle, fullText, contentHash: contentHash(initial.gateResultJson, fullText, subtitle) });
    const state = mockTransaction(
      [
        [existing],
        [project],
        [core],
        [currentCore],
        [confirmedFact],
        [sourceFile],
        [confirmedFact],
        [],
      ],
      [801]
    );
    const result = await serviceFor(state.db).confirmCandidate({
      ...actor,
      candidateId: existing.id,
      expectedCandidateRevision: existing.candidateRevision,
      reason: "Approved after evidence review",
    });

    expect(result).toMatchObject({
      id: existing.id,
      status: "confirmed",
      reviewRevision: 1,
      listingSync: "not_started",
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.data).toEqual({ status: "confirmed" });
    expect(state.inserts[0]?.values).toMatchObject({
      candidateId: existing.id,
      decision: "accepted",
      beforeHash: existing.contentHash,
      afterHash: existing.contentHash,
      expectedRevision: 1,
      actorId,
      reason: "Approved after evidence review",
    });
  });

  it("rejects a manually edited unsupported waterproof claim even with a genuine cited material fact", async () => {
    const subtitle = "Durable Everyday Design:";
    const fullText = "A simple, waterproof build for daily routines, made with 304 stainless steel to keep the design grounded in a clear material detail and give shoppers an easy way to judge whether the finish suits their everyday setup and preferences";
    const initial = candidate();
    const existing = candidate({ subtitle, fullText, contentHash: contentHash(initial.gateResultJson, fullText, subtitle) });
    const state = mockTransaction([
      [existing], [project], [core], [currentCore], [confirmedFact], [sourceFile], [confirmedFact],
    ]);
    await expect(serviceFor(state.db).confirmCandidate({ ...actor, candidateId: existing.id,
      expectedCandidateRevision: existing.candidateRevision })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects an otherwise supported candidate that repeats another confirmed bullet title", async () => {
    const subtitle = "Durable Everyday Design:";
    const fullText = "A simple, durable build for daily routines, made with 304 stainless steel to keep the design grounded in a clear material detail and give shoppers an easy way to judge whether the finish suits their everyday setup and preferences";
    const initial = candidate();
    const existing = candidate({ subtitle, fullText, contentHash: contentHash(initial.gateResultJson, fullText, subtitle) });
    const state = mockTransaction([
      [existing], [project], [core], [currentCore], [confirmedFact], [sourceFile], [confirmedFact],
      [{ coreRevisionId: 999, subtitle, fullText: "Another confirmed purchasing reason" }],
    ]);
    await expect(serviceFor(state.db).confirmCandidate({ ...actor, candidateId: existing.id,
      expectedCandidateRevision: existing.candidateRevision })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.updates).toHaveLength(0);
  });

  it("keeps formal Listing synchronization explicitly closed until atomic legacy CAS integration exists", async () => {
    await expect(
      serviceFor(mockTransaction([]).db).syncConfirmedCandidateToListing({
        ...actor,
        candidateId: 301,
        expectedCandidateRevision: 1,
        listingId: 401,
        expectedListingVersion: 3,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("does not expose candidates from a different workspace through the router", async () => {
    routerMocks.resolveProjectAccess.mockResolvedValueOnce({
      ...project,
      workspaceId: workspaceId + 1,
    });
    await expect(
      candidateRouterCaller
        .createCaller(routerContext())
        .listCandidates({ projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
