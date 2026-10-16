import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";

// Replace only external I/O dependencies. The service, schemas and full-row
// revision policy below are real; no application router or driver is imported.
vi.mock("../../../repositories/project/projectRepository", () => ({ getProjectById: vi.fn() }));
vi.mock("../../../repositories/project/projectAssetRepository", () => ({
  getCompetitorAnalysisById: vi.fn(), updateCompetitorAnalysisSummary: vi.fn(), deleteCompetitorAnalysis: vi.fn(),
}));
vi.mock("../../ai_os/services/businessArtifactRegistry", () => ({ registerCompetitorAnalysisArtifact: vi.fn() }));
import {
  competitorReviewScopeSchema, competitorSummaryWriteSchema, competitorReviewWorkspace,
  competitorWithRevision, createCompetitorSummaryReviewService,
} from "./competitorSummaryReview";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";

function row(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return {
    id: 3, projectId: 11, asin: "B000000001", title: "Saved source", bulletPoints: '["Original bullet"]',
    imageUrls: '["s3://private/original"]', price: "12", rating: "4", reviewCount: "2", reviewAnalysis: "{}", keywords: "[]",
    rawData: '{"source":"original","analysisStale":false,"captureOnly":false}',
    aiSummary: "AI draft", summary: "Human draft", summaryStatus: "draft", summaryVersion: 4,
    summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), ...overrides,
  };
}

function ctx(workspaceId: number | null = 9): TrpcContext {
  return {
    user: {
      id: 7, openId: null, organizationId: null, defaultWorkspaceId: 9, name: "Synthetic", email: null,
      phone: null, password: null, loginMethod: null, role: "ops_specialist", department: null, jobTitle: null,
      status: "active", mustChangePassword: 0, failedLoginAttempts: 0, lockedUntil: null, invitedBy: null,
      lastPasswordChangedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"), lastSignedIn: new Date("2026-01-01T00:00:00Z"),
    }, workspaceId,
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"],
  };
}

function scope(existing = row(), expectedWorkspaceId: number | null = 9) {
  return { projectId: 11, analysisId: 3, expectedWorkspaceId, expectedRevision: competitorRevision(existing) };
}

function setup(existing = row()) {
  const saved = row({ summary: "Saved draft", summaryVersion: 5, updatedAt: new Date("2026-01-03T00:00:00Z") });
  const dependencies = {
    getProjectById: vi.fn().mockResolvedValue({ id: 11, userId: 7, workspaceId: 9 }),
    getCompetitorAnalysisById: vi.fn().mockResolvedValue(existing),
    updateCompetitorAnalysisSummary: vi.fn().mockResolvedValue(saved),
    deleteCompetitorAnalysis: vi.fn().mockResolvedValue({ success: true }),
    registerCompetitorAnalysisArtifact: vi.fn().mockResolvedValue(null),
  };
  return { existing, saved, dependencies, service: createCompetitorSummaryReviewService(dependencies) };
}

function noWrites(dependencies: ReturnType<typeof setup>["dependencies"]) {
  expect(dependencies.updateCompetitorAnalysisSummary).not.toHaveBeenCalled();
  expect(dependencies.deleteCompetitorAnalysis).not.toHaveBeenCalled();
  expect(dependencies.registerCompetitorAnalysisArtifact).not.toHaveBeenCalled();
}

beforeEach(() => vi.clearAllMocks());

describe("competitor summary request schemas", () => {
  it.each([competitorReviewScopeSchema, competitorSummaryWriteSchema])("requires an explicit workspace and complete revision before I/O", schema => {
    const valid = { ...scope(), summary: "new" };
    const base = schema === competitorReviewScopeSchema ? scope() : valid;
    expect(schema.safeParse(base).success).toBe(true);
    for (const key of ["expectedWorkspaceId", "expectedRevision"] as const) {
      const missing = { ...base }; Reflect.deleteProperty(missing, key);
      expect(schema.safeParse(missing).success).toBe(false);
    }
    expect(schema.safeParse({ ...base, expectedWorkspaceId: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, workspaceId: 99 }).success).toBe(false);
  });

  it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64), null, 1])("rejects malformed revision %s", expectedRevision => {
    expect(competitorReviewScopeSchema.safeParse({ ...scope(), expectedRevision }).success).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid identifiers/workspace %s", bad => {
    for (const key of ["projectId", "analysisId", "expectedWorkspaceId"]) {
      expect(competitorReviewScopeSchema.safeParse({ ...scope(), [key]: bad }).success).toBe(false);
    }
  });

  it("requires a nonblank bounded summary, trims it, and rejects a summary on unlock", () => {
    expect(competitorSummaryWriteSchema.parse({ ...scope(), summary: "  text  " }).summary).toBe("text");
    for (const summary of ["", "  ", "x".repeat(20_001)]) expect(competitorSummaryWriteSchema.safeParse({ ...scope(), summary }).success).toBe(false);
    expect(competitorReviewScopeSchema.safeParse({ ...scope(), summary: "ignored?" }).success).toBe(false);
  });
});

describe("real competitor summary service scope and revision", () => {
  it("preserves explicit authenticated NULL instead of falling back to the user's default workspace", async () => {
    const { service, dependencies } = setup();
    dependencies.getProjectById.mockResolvedValue({ id: 11, userId: 7, workspaceId: null });
    expect(competitorReviewWorkspace(ctx(null))).toBeNull();
    await service.review(ctx(null), "save", { ...scope(row(), null), summary: "saved" });
    expect(dependencies.getProjectById).toHaveBeenCalledWith(11, 7, null);
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledWith(3, expect.anything(), {
      projectId: 11, expectedRevision: competitorRevision(row()), userId: 7, workspaceId: null,
    });
  });

  it("uses default workspace only when context workspace is absent", async () => {
    const context = ctx(); context.workspaceId = undefined;
    expect(competitorReviewWorkspace(context)).toBe(9);
    const { service, dependencies } = setup();
    await service.review(context, "save", { ...scope(), summary: "saved" });
    expect(dependencies.getProjectById).toHaveBeenCalledWith(11, 7, 9);
  });

  it.each(["save", "confirm", "unlock"] as const)("%s rejects changed workspace before repository reads", async action => {
    const { service, dependencies } = setup();
    const input = action === "unlock" ? scope() : { ...scope(), summary: "saved" };
    await expect(service.review(ctx(10), action, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dependencies.getProjectById).not.toHaveBeenCalled();
    expect(dependencies.getCompetitorAnalysisById).not.toHaveBeenCalled();
    noWrites(dependencies);
  });

  it.each([null, 0, -1, NaN])("rejects missing/invalid actor %s before reads", async actorId => {
    const context = ctx(); context.user = actorId === null ? null : { ...context.user!, id: actorId };
    const { service, dependencies } = setup();
    await expect(service.review(context, "save", { ...scope(), summary: "saved" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dependencies.getProjectById).not.toHaveBeenCalled(); noWrites(dependencies);
  });

  it.each([0, -1, NaN, 1.5])("does not fall back from malformed explicit workspace %s", async workspaceId => {
    const { service, dependencies } = setup();
    await expect(service.review(ctx(workspaceId), "save", { ...scope(), summary: "saved" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dependencies.getProjectById).not.toHaveBeenCalled(); noWrites(dependencies);
  });

  it.each([
    null, { id: 12, userId: 7, workspaceId: 9 }, { id: 11, userId: 8, workspaceId: 9 }, { id: 11, userId: 7, workspaceId: 10 },
  ])("rejects foreign/missing parent %j without child reads or writes", async project => {
    const { service, dependencies } = setup(); dependencies.getProjectById.mockResolvedValue(project);
    await expect(service.review(ctx(), "save", { ...scope(), summary: "saved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dependencies.getCompetitorAnalysisById).not.toHaveBeenCalled(); noWrites(dependencies);
  });

  it.each([null, row({ id: 4 }), row({ projectId: 12 })])("rejects foreign/missing child without writes", async existing => {
    const { service, dependencies } = setup(); dependencies.getCompetitorAnalysisById.mockResolvedValue(existing);
    await expect(service.review(ctx(), "save", { ...scope(), summary: "saved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    noWrites(dependencies);
  });

  it.each(["save", "confirm", "unlock"] as const)("%s rejects a full-row source conflict even with unchanged summaryVersion", async action => {
    const { service, dependencies } = setup(row({ rawData: '{"source":"changed"}' }));
    const input = action === "unlock" ? scope() : { ...scope(), summary: "saved" };
    await expect(service.review(ctx(), action, input)).rejects.toMatchObject({ code: "CONFLICT" });
    noWrites(dependencies);
  });
});

describe("confirmation, saved drafts, guard forwarding and artifacts", () => {
  it.each([
    '{"analysisStale":true}', '{"captureOnly":true}', '{"analysisStale":"false"}', '{"captureOnly":0}',
    "{", "[]", "null", "1", '"text"',
  ])("blocks confirmation of unverifiable state %s but allows a saved draft", async rawData => {
    const existing = row({ rawData }); const { service, dependencies } = setup(existing);
    await expect(service.review(ctx(), "confirm", { ...scope(existing), summary: "saved" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    noWrites(dependencies);
    await service.review(ctx(), "save", { ...scope(existing), summary: "saved" });
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledTimes(1);
  });

  it.each([null, "", "  \n  ", "{}", '{"analysisStale":false,"captureOnly":false}'])("accepts legacy/explicit clear state %s without claiming deep-analysis completeness", async rawData => {
    const existing = row({ rawData }); const { service, dependencies } = setup(existing);
    await service.review(ctx(), "confirm", { ...scope(existing), summary: "Confirmed" });
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledWith(3, {
      summary: "Confirmed", summaryStatus: "confirmed", summaryConfirmedBy: 7,
      summaryConfirmedAt: expect.any(Date), incrementVersion: true,
    }, { projectId: 11, expectedRevision: competitorRevision(existing), userId: 7, workspaceId: 9 });
  });

  it("forwards explicit unlock and version increment without a replacement summary", async () => {
    const existing = row({ summaryStatus: "confirmed", summaryConfirmedBy: 7, summaryConfirmedAt: new Date("2026-01-03T00:00:00Z") });
    const { service, dependencies } = setup(existing);
    await service.review(ctx(), "unlock", scope(existing));
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledWith(3, {
      summaryStatus: "draft", summaryConfirmedBy: null, summaryConfirmedAt: null, incrementVersion: true,
    }, { projectId: 11, expectedRevision: competitorRevision(existing), userId: 7, workspaceId: 9 });
  });

  it.each(["save", "confirm", "unlock"] as const)("%s lets the locked repository reject a read-to-write change and publishes no artifact", async action => {
    const { service, dependencies } = setup();
    dependencies.updateCompetitorAnalysisSummary.mockRejectedValue(new TRPCError({ code: "CONFLICT", message: "changed under lock" }));
    const input = action === "unlock" ? scope() : { ...scope(), summary: "saved" };
    await expect(service.review(ctx(), action, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledWith(3, expect.anything(), {
      projectId: 11, expectedRevision: competitorRevision(row()), userId: 7, workspaceId: 9,
    });
    expect(dependencies.registerCompetitorAnalysisArtifact).not.toHaveBeenCalled();
  });

  it("returns the entire actually saved row with a fresh revision and does not rewrite the pre-read row", async () => {
    const { service, dependencies, existing, saved } = setup(); const original = structuredClone(existing);
    const result = await service.review(ctx(), "save", { ...scope(), summary: "Saved draft" });
    expect(result).toEqual({ ...saved, revision: competitorRevision(saved) });
    expect(result.revision).not.toBe(competitorRevision(existing));
    expect(existing).toEqual(original);
    expect(dependencies.registerCompetitorAnalysisArtifact).toHaveBeenCalledWith(3, "user_edit");
    expect(dependencies.updateCompetitorAnalysisSummary.mock.invocationCallOrder[0]).toBeLessThan(dependencies.registerCompetitorAnalysisArtifact.mock.invocationCallOrder[0]);
  });

  it("artifact failure does not discard an already saved database result", async () => {
    const { service, dependencies, saved } = setup();
    dependencies.registerCompetitorAnalysisArtifact.mockRejectedValue(new Error("synthetic artifact failure"));
    await expect(service.review(ctx(), "save", { ...scope(), summary: "Saved draft" })).resolves.toEqual(competitorWithRevision(saved));
    expect(dependencies.updateCompetitorAnalysisSummary).toHaveBeenCalledTimes(1);
    expect(dependencies.registerCompetitorAnalysisArtifact).toHaveBeenCalledTimes(1);
  });
});

describe("delete ownership and transaction guard", () => {
  it.each([
    { id: 11, userId: 8, workspaceId: 9 }, { id: 11, userId: 7, workspaceId: 10 }, null,
  ])("rejects foreign owner/workspace/missing parent before deletion: %j", async project => {
    const { service, dependencies } = setup(); dependencies.getProjectById.mockResolvedValue(project);
    await expect(service.remove(ctx(), 3)).rejects.toMatchObject({ code: "NOT_FOUND" });
    noWrites(dependencies);
  });

  it.each([row({ id: 4 }), row({ projectId: 12 }), null])("rejects a missing/moved child on the authorized reread", async second => {
    const { service, dependencies } = setup();
    dependencies.getCompetitorAnalysisById.mockResolvedValueOnce(row()).mockResolvedValueOnce(second);
    await expect(service.remove(ctx(), 3)).rejects.toMatchObject({ code: "NOT_FOUND" }); noWrites(dependencies);
  });

  it("uses explicit NULL for deletion rather than the default workspace", async () => {
    const { service, dependencies } = setup(); dependencies.getProjectById.mockResolvedValue({ id: 11, userId: 7, workspaceId: null });
    await expect(service.remove(ctx(null), 3)).resolves.toEqual({ success: true });
    expect(dependencies.getProjectById).toHaveBeenCalledWith(11, 7, null);
    expect(dependencies.deleteCompetitorAnalysis).toHaveBeenCalledWith(3, {
      projectId: 11, expectedRevision: competitorRevision(row()), userId: 7, workspaceId: null,
    });
    expect(dependencies.registerCompetitorAnalysisArtifact).not.toHaveBeenCalled();
  });

  it("passes the authoritative reread revision to the repository and propagates a later conflict", async () => {
    const { service, dependencies } = setup(); const fresh = row({ reviewCount: "20" });
    dependencies.getCompetitorAnalysisById.mockResolvedValueOnce(row()).mockResolvedValueOnce(fresh);
    dependencies.deleteCompetitorAnalysis.mockRejectedValue(new TRPCError({ code: "CONFLICT" }));
    await expect(service.remove(ctx(), 3)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dependencies.deleteCompetitorAnalysis).toHaveBeenCalledWith(3, {
      projectId: 11, expectedRevision: competitorRevision(fresh), userId: 7, workspaceId: 9,
    });
    expect(dependencies.registerCompetitorAnalysisArtifact).not.toHaveBeenCalled();
  });
});

describe("lightweight actual analysis router wiring (no heavy router import)", () => {
  const source = readFileSync(new URL("../../../routers/analysis.ts", import.meta.url), "utf8");
  it.each([
    ["updateSummary", "competitorSummaryWriteSchema", "save"],
    ["confirmSummary", "competitorSummaryWriteSchema", "confirm"],
    ["unlockSummary", "competitorReviewScopeSchema", "unlock"],
  ])("%s delegates protected input and authenticated context to the real service", (route, schema, action) => {
    expect(source).toMatch(new RegExp(`${route}: protectedProcedure\\s*\\.input\\(${schema}\\)\\s*\\.mutation\\(\\(\\{ ctx, input \\}\\) => competitorSummaryReview\\.review\\(ctx, "${action}", input\\)\\)`));
  });
  it("list binds the same explicit-null workspace and computes revision before delivery URL signing", () => {
    const list = source.slice(source.indexOf("listByProject:"), source.indexOf("updateSummary:"));
    expect(list).toContain("competitorReviewWorkspace(ctx)");
    expect(list).toContain("resolveCompetitorImagesForDelivery(competitorWithRevision(analysis))");
    expect(list).toContain("db.getProjectById(input.projectId, ctx.user.id, workspaceId)");
  });
  it("delete uses the owned service instead of the former unguarded repository call", () => {
    const remove = source.slice(source.indexOf("  delete: protectedProcedure"), source.indexOf("  listReviewImports:"));
    expect(remove).toContain("competitorSummaryReview.remove(ctx, input.id)");
    expect(remove).not.toContain("db.deleteCompetitorAnalysis");
  });
});
