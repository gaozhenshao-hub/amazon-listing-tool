import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SECURITY_PERMISSION_MATRIX } from "@shared/const";
import { devProductProfiles, devProjects, projectAssignments } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), authorize: vi.fn(), audit: vi.fn(), skill: vi.fn(), storage: vi.fn(),
  target: vi.fn(), createFile: vi.fn(), version: vi.fn(), artifacts: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./repositories", () => ({ getProjectById: mocks.target, getProjectByIdAdmin: mocks.target,
  createProjectFile: mocks.createFile, createAnalysisVersion: mocks.version }));
vi.mock("./services/securityGovernance", () => ({
  workspaceIdFromContext: (ctx: TrpcContext) => ctx.workspaceId ?? ctx.user?.defaultWorkspaceId ?? null,
  actorFromContext: (ctx: TrpcContext) => ({ id: ctx.user!.id, role: ctx.user!.role, defaultWorkspaceId: ctx.user!.defaultWorkspaceId }),
  assertResourceAction: mocks.authorize, recordSecurityAuditLog: mocks.audit,
}));
vi.mock("./domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.skill }));
vi.mock("./storage", () => ({ storagePut: mocks.storage }));
vi.mock("./domains/ai_os/services/artifactLifecycle", () => ({
  createContentHash: (value: unknown) => JSON.stringify(value), registerProjectFileArtifactBundle: mocks.artifacts,
  resolveUnifiedArtifact: vi.fn(),
}));

import { convertProfileSourceToText, flattenProfileSource, listProfileImportSources, loadProfileImportSource,
  profileImportSourceHash, profileImportWorkspace } from "./domains/listing/services/profileImportSource";
import { projectAssignmentRouter } from "./routers/projectAssignment";
import { projectFileRouter } from "./routers/projectFile";

type Project = typeof devProjects.$inferSelect;
type Profile = typeof devProductProfiles.$inferSelect;
type Assignment = typeof projectAssignments.$inferSelect;
const stamp = new Date("2026-10-16T00:00:00.000Z");
const project = (patch: Partial<Project> = {}): Project => ({ id: 20, workspaceId: 7, userId: 5, name: "合成来源",
  description: null, targetMarket: "US", platform: "amazon", keywords: null, status: "draft", phase: "project_execution",
  approvedAt: null, approvedScore: null, createdAt: stamp, updatedAt: stamp, ...patch });
const profile = (patch: Partial<Profile> = {}): Profile => ({ id: 30, workspaceId: 7, projectId: 20, userId: 5,
  appearanceColors: "红色", appearanceAiSuggestion: "AI不应成为原始事实", appearanceConfirmed: 0,
  mainFunctions: null, functionsAiSuggestion: null, functionsConfirmed: 0,
  costBreakdown: null, costAiSuggestion: null, costConfirmed: 0,
  packageDimensions: null, packageAiSuggestion: null, packageConfirmed: 0,
  packageDesign: null, packageDesignAiSuggestion: null, packageDesignConfirmed: 0,
  userPersona: null, userPersonaAiSuggestion: null, userPersonaConfirmed: 0,
  usageScenarios: null, usageScenariosAiSuggestion: null, usageScenariosConfirmed: 0,
  productMap: null, productMapAiSuggestion: null, productMapConfirmed: 0,
  status: "draft", createdAt: stamp, updatedAt: stamp, ...patch });
const assignment = (patch: Partial<Assignment> = {}): Assignment => ({ id: 40, workspaceId: 7, projectId: 20,
  projectType: "dev_project", assignedUserId: 19, assignedBy: 5, permission: "read", createdAt: stamp, ...patch });
function context(role = "admin", workspaceId: number | null = 7): TrpcContext {
  return { user: { id: 19, role, defaultWorkspaceId: workspaceId } as TrpcContext["user"], workspaceId,
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], requestId: "synthetic-profile" };
}
let projects: Project[];
let profiles: Profile[];
let assignments: Assignment[];
const queries: { table: unknown; predicate: Parameters<MySqlDialect["sqlToQuery"]>[0] }[] = [];
beforeEach(() => {
  Object.values(mocks).forEach(fn => fn.mockReset());
  projects = [project()]; profiles = [profile()]; assignments = [assignment()]; queries.length = 0;
  mocks.getDb.mockResolvedValue({ select: () => ({ from: (table: unknown) => {
    const rows = () => table === devProjects ? projects : table === devProductProfiles ? profiles : assignments;
    const chain = { where: (predicate: Parameters<MySqlDialect["sqlToQuery"]>[0]) => { queries.push({ table, predicate }); return chain; },
      limit: (count: number) => Promise.resolve(rows().slice(0, count)), orderBy: () => Promise.resolve(rows()),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject) };
    return chain;
  } }) });
  mocks.authorize.mockResolvedValue(undefined);
  mocks.target.mockResolvedValue({ id: 10, workspaceId: 7, userId: 19 });
  mocks.skill.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
  mocks.createFile.mockImplementation(async value => ({ id: 50, ...value }));
  mocks.version.mockResolvedValue({ id: 51 }); mocks.artifacts.mockResolvedValue({});
});

describe("profile sources: shared real workspace/legacy-parent/assignment authorization", () => {
  it.each(["admin", "super_admin", "ops_manager"])("%s sees only eligible active-workspace sources", async role => {
    projects.push(project({ id: 21, workspaceId: 8 }), project({ id: 22, workspaceId: null }), project({ id: 23, workspaceId: null, userId: 19 }));
    expect((await listProfileImportSources(context(role))).map(row => row.id)).toEqual([20, 23]);
  });
  it.each(["admin", "super_admin", "ops_manager", "ops_specialist"])("%s cannot read a foreign parent even with an assignment", async role => {
    projects = [project({ workspaceId: 8 })];
    await expect(loadProfileImportSource(context(role), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queries.some(query => query.table === devProductProfiles)).toBe(false);
  });
  it("assigned read users retain their same-workspace list/detail path", async () => {
    expect(await listProfileImportSources(context("ops_specialist"))).toHaveLength(1);
    expect((await loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 })).profile?.id).toBe(30);
    expect(mocks.authorize).not.toHaveBeenCalled(); // The assignment is the existing cross-module read grant.
  });
  it.each(["ops_manager", "ops_specialist"])("preserves %s cross-module access despite its real missing development-module default", async role => {
    expect(SECURITY_PERMISSION_MATRIX[role].product_development?.includes("read") ?? false).toBe(false);
    // Deliberately deny the generic module checker: this source read is granted by
    // the pre-existing manager/assignment rule, not a permissive policy mock.
    mocks.authorize.mockRejectedValue(new Error("development module denied"));
    if (role === "ops_manager") assignments = [];
    expect(await listProfileImportSources(context(role))).toHaveLength(1);
    expect((await loadProfileImportSource(context(role), { devProjectId: 20 })).profile?.id).toBe(30);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("being the owner does not newly bypass the original assignment rule", async () => {
    projects = [project({ userId: 19 })]; assignments = [];
    expect(await listProfileImportSources(context("ops_specialist"))).toEqual([]);
    await expect(loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each([{ workspaceId: 8 }, { assignedUserId: 20 }, { projectId: 21 }, { projectType: "listing_project" as const }])("rejects an unrelated assignment %j", async patch => {
    assignments = [assignment(patch)];
    await expect(loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("a legacy NULL assignment inherits only an already authorized parent scope", async () => {
    assignments = [assignment({ workspaceId: null })];
    expect((await loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 })).project.id).toBe(20);
    projects = [project({ workspaceId: 8 })];
    await expect(loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("NULL parents remain owner-only even for admins", async () => {
    projects = [project({ workspaceId: null })]; profiles = [profile({ workspaceId: null })];
    await expect(loadProfileImportSource(context(), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    projects = [project({ workspaceId: null, userId: 19 })]; profiles = [profile({ workspaceId: null, userId: 19 })];
    expect((await loadProfileImportSource(context(), { devProjectId: 20 })).profile?.id).toBe(30);
  });
  it("NULL children require the exact parent owner, not merely a matching project ID", async () => {
    profiles = [profile({ workspaceId: null })];
    expect((await loadProfileImportSource(context(), { devProjectId: 20 })).profile?.id).toBe(30);
    profiles = [profile({ workspaceId: null, userId: 99 })];
    await expect(loadProfileImportSource(context(), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each([{ workspaceId: 8 }, { projectId: 21 }])("rejects a foreign profile %j", async patch => {
    profiles = [profile(patch)];
    await expect(loadProfileImportSource(context(), { devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not guess among multiple scoped profiles", async () => {
    profiles.push(profile({ id: 31 }));
    await expect(loadProfileImportSource(context(), { devProjectId: 20 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("missing profile is explicit and does not initialize anything", async () => {
    profiles = [];
    expect(await loadProfileImportSource(context(), { devProjectId: 20 })).toMatchObject({ profile: null, sourceHash: null });
    expect(mocks.createFile).not.toHaveBeenCalled(); expect(mocks.skill).not.toHaveBeenCalled();
  });
  it("builds actual SQL scope predicates for all three tables", async () => {
    await loadProfileImportSource(context("ops_specialist"), { devProjectId: 20 });
    const sql = queries.map(row => new MySqlDialect().sqlToQuery(row.predicate));
    expect(sql).toHaveLength(3);
    for (const query of sql) { expect(query.sql).toContain("workspaceId"); expect(query.params).toContain(7); }
    expect(sql[0].sql).toContain("is null"); expect(sql[0].params).toContain(19);
    expect(sql[1].params).toContain("dev_project"); expect(sql[1].params).toContain(20);
  });
});

describe("profile source snapshots and user-entered facts", () => {
  it("is stable under object-key ordering but covers the whole stored source", () => {
    const original = profileImportSourceHash(7, project(), profile());
    const reversed = Object.fromEntries(Object.entries(profile()).reverse()) as Profile;
    expect(profileImportSourceHash(7, project(), reversed)).toBe(original);
    for (const patch of [{ status: "confirmed" as const }, { appearanceConfirmed: 1 }, { appearanceColors: "蓝色" },
      { appearanceAiSuggestion: "different draft" }, { id: 31 }, { userId: 6 }, { updatedAt: new Date(stamp.getTime() + 1) }]) {
      expect(profileImportSourceHash(7, project(), profile(patch))).not.toBe(original);
    }
    expect(profileImportSourceHash(8, project(), profile())).not.toBe(original);
    expect(profileImportSourceHash(7, project({ name: "changed" }), profile())).not.toBe(original);
  });
  it("rejects a stale preview hash", async () => {
    await expect(loadProfileImportSource(context(), { devProjectId: 20, expectedSourceHash: "0".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([0, false, [0, false], { count: 0, enabled: false }])("preserves zero/false values: %j", value => {
    const text = flattenProfileSource(value);
    expect(text).not.toBe(""); expect(text).toMatch(/0|false/);
  });
  it("does not include AI suggestions or require every profile confirmation flag", () => {
    const text = convertProfileSourceToText(profile({ appearanceColors: "0", mainFunctions: "false" }), "合成来源");
    expect(text).toContain("0"); expect(text).toContain("false"); expect(text).not.toContain("AI不应成为原始事实");
  });
  it("refuses an AI-only profile instead of promoting its draft to facts", () => {
    expect(() => convertProfileSourceToText(profile({ appearanceColors: null }), "合成来源")).toThrow("AI建议不能代替本品事实");
  });
  it.each(["null", "[]", "{}", '[null,"",{},[]]', '{"empty":{"nested":[]}}'])("empty nested user data %s cannot make AI-only input eligible", appearanceColors => {
    expect(() => convertProfileSourceToText(profile({ appearanceColors }), "合成来源")).toThrow("AI建议不能代替本品事实");
  });
  it("distinguishes inherited authenticated workspace from client scope choice", () => {
    const ctx = context(); ctx.workspaceId = undefined;
    expect(profileImportWorkspace(ctx, 7)).toBe(7);
    expect(() => profileImportWorkspace(ctx, 8)).toThrow("工作区已变化");
    expect(profileImportWorkspace(context("admin", null), null)).toBeNull();
  });
});

describe("real source-selection router wiring, with synthetic DB/Skill only", () => {
  it("preserves the no-argument list and detail response while adding a preview hash", async () => {
    const caller = projectAssignmentRouter.createCaller(context());
    expect(await caller.listImportableDevProjects()).toEqual([{ id: 20, name: "合成来源", targetMarket: "US", status: "draft" }]);
    expect(await caller.getDevProjectProfile({ devProjectId: 20, expectedWorkspaceId: 7 })).toMatchObject({
      project: { id: 20 }, profile: { id: 30 }, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.skill).not.toHaveBeenCalled();
  });
  it("all three APIs reject workspace drift before I/O", async () => {
    const reads = projectAssignmentRouter.createCaller(context()); const writes = projectFileRouter.createCaller(context());
    await expect(reads.listImportableDevProjects({ expectedWorkspaceId: 8 })).rejects.toThrow("工作区已变化");
    await expect(reads.getDevProjectProfile({ devProjectId: 20, expectedWorkspaceId: 8 })).rejects.toThrow("工作区已变化");
    await expect(writes.importFromProfile({ listingProjectId: 10, devProjectId: 20, expectedWorkspaceId: 8 })).rejects.toThrow("工作区已变化");
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.target).not.toHaveBeenCalled();
  });
  it("rejects an authenticated but cross-workspace Listing target before source loading/Skill", async () => {
    mocks.target.mockResolvedValue({ id: 10, workspaceId: 8, userId: 19 });
    await expect(projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.skill).not.toHaveBeenCalled();
  });
  it.each(["admin", "ops_specialist"])("preserves %s authorized legacy NULL Listing targets in the active workspace", async role => {
    mocks.target.mockResolvedValue({ id: 10, workspaceId: null, userId: 19 });
    const result = await projectFileRouter.createCaller(context(role)).importFromProfile({
      listingProjectId: 10, devProjectId: 20, expectedWorkspaceId: 7,
    });
    expect(result).toMatchObject({ projectId: 10, workspaceId: 7 });
    expect(mocks.target).toHaveBeenCalledTimes(2);
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.authorize.mock.calls) expect(request).toMatchObject({
      resource: "file", action: "import", workspaceId: 7, projectId: 10, ownerUserId: 19,
    });
  });
  it("preserves an authenticated NULL workspace and owned legacy source without inventing a scope", async () => {
    projects = [project({ workspaceId: null, userId: 19 })];
    profiles = [profile({ workspaceId: null, userId: 19 })];
    mocks.target.mockResolvedValue({ id: 10, workspaceId: null, userId: 19 });
    const result = await projectFileRouter.createCaller(context("admin", null)).importFromProfile({
      listingProjectId: 10, devProjectId: 20, expectedWorkspaceId: null,
    });
    expect(result).toMatchObject({ projectId: 10, workspaceId: null });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: null, action: "import" }));
  });
  it("does not bypass file.import authorization for a legacy NULL Listing target", async () => {
    mocks.target.mockResolvedValue({ id: 10, workspaceId: null, userId: 19 });
    mocks.authorize.mockRejectedValue(new Error("synthetic legacy file.import denial"));
    await expect(projectFileRouter.createCaller(context()).importFromProfile({
      listingProjectId: 10, devProjectId: 20, expectedWorkspaceId: 7,
    })).rejects.toThrow("synthetic legacy file.import denial");
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.skill).not.toHaveBeenCalled();
    expect(mocks.createFile).not.toHaveBeenCalled();
  });
  it("rechecks an explicit foreign Listing scope after analysis before persistence", async () => {
    mocks.skill.mockImplementation(async () => {
      mocks.target.mockResolvedValue({ id: 10, workspaceId: 8, userId: 19 });
      return { choices: [{ message: { content: "{}" } }] };
    });
    await expect(projectFileRouter.createCaller(context()).importFromProfile({
      listingProjectId: 10, devProjectId: 20, expectedWorkspaceId: 7,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.skill).toHaveBeenCalledTimes(1); expect(mocks.createFile).not.toHaveBeenCalled();
  });
  it("preserves the existing Listing file.import permission guard", async () => {
    mocks.authorize.mockRejectedValue(new Error("synthetic file.import denial"));
    await expect(projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toThrow("synthetic file.import denial");
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.skill).not.toHaveBeenCalled();
  });
  it("a stale preview fails before the expensive call or persistence", async () => {
    await expect(projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20,
      expectedSourceHash: "0".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.skill).not.toHaveBeenCalled(); expect(mocks.createFile).not.toHaveBeenCalled();
  });
  it("saves source provenance without silently confirming Listing facts", async () => {
    const sourceHash = profileImportSourceHash(7, project(), profile());
    const result = await projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20,
      expectedWorkspaceId: 7, expectedSourceHash: sourceHash });
    expect(result).toMatchObject({ id: 50, fileType: "product_attributes", status: "completed", fileUrl: "" });
    const parsed = JSON.parse(mocks.createFile.mock.calls[0][0].parsedData);
    expect(parsed.provenance).toMatchObject({ kind: "dev_product_profile", devProjectId: 20, profileId: 30, sourceHash,
      previewVersionBound: true, factReviewRequired: true, aiSuggestionsIncluded: false });
    expect(mocks.skill).toHaveBeenCalledTimes(1); expect(mocks.target).toHaveBeenCalledTimes(2);
    expect(mocks.createFile).toHaveBeenCalledTimes(1); expect(mocks.version).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: parsed.provenance }));
  });
  it("old no-hash calls remain current-source imports, not preview-version proof", async () => {
    await projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20 });
    expect(JSON.parse(mocks.createFile.mock.calls[0][0].parsedData).provenance.previewVersionBound).toBe(false);
  });
  it("a source edit during analysis rejects before any persistence, with no retry", async () => {
    mocks.skill.mockImplementation(async () => { profiles = [profile({ appearanceColors: "changed" })]; return { choices: [{ message: { content: "{}" } }] }; });
    await expect(projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.skill).toHaveBeenCalledTimes(1); expect(mocks.createFile).not.toHaveBeenCalled(); expect(mocks.artifacts).not.toHaveBeenCalled();
  });
  it("source assignment revocation during analysis rejects before persistence", async () => {
    mocks.skill.mockImplementation(async () => { assignments = []; return { choices: [{ message: { content: "{}" } }] }; });
    await expect(projectFileRouter.createCaller(context("ops_specialist")).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.createFile).not.toHaveBeenCalled();
  });
  it("target revocation during analysis rejects before persistence", async () => {
    mocks.skill.mockImplementation(async () => { mocks.target.mockResolvedValue(null); return { choices: [{ message: { content: "{}" } }] }; });
    await expect(projectFileRouter.createCaller(context()).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toThrow("Project not found");
    expect(mocks.createFile).not.toHaveBeenCalled();
  });
  it("all three selection APIs still require authentication", async () => {
    const ctx = context(); ctx.user = null;
    await expect(projectAssignmentRouter.createCaller(ctx).listImportableDevProjects()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(projectAssignmentRouter.createCaller(ctx).getDevProjectProfile({ devProjectId: 20 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(projectFileRouter.createCaller(ctx).importFromProfile({ listingProjectId: 10, devProjectId: 20 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
