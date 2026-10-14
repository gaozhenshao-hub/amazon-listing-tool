import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

// Real tRPC middleware, security policy evaluation and route bodies are used.
// Only persistence/effect boundaries are mocked: this is not a database/E2E test.
const mocks = vi.hoisted(() => ({
  execute: vi.fn(), requireDb: vi.fn(),
  getOwnedImageSet: vi.fn(), getImageInOwnedSet: vi.fn(),
  getReadableImageSet: vi.fn(), getReadableImageWithAnalysis: vi.fn(),
  listImagesBySet: vi.fn(), listImagesBySetLight: vi.fn(),
  deleteImageInOwnedSet: vi.fn(), reorderImagesInOwnedSet: vi.fn(),
  deleteOwnedImageSet: vi.fn(), updateOwnedImageSet: vi.fn(), createImage: vi.fn(),
  findImageSetByAsin: vi.fn(),
  getProjectByIdAdmin: vi.fn(), getProjectById: vi.fn(),
  getExpressionGroupsByProject: vi.fn(), getExpressionGroupByProject: vi.fn(),
  getExpressionGroupImageByProject: vi.fn(), getImageWorkflowSessionByProject: vi.fn(),
  updateExpressionGroup: vi.fn(), deleteExpressionGroup: vi.fn(),
  countExpressionGroupImages: vi.fn(), insertExpressionGroupImage: vi.fn(),
  deleteExpressionGroupImage: vi.fn(), updateImageWorkflowSession: vi.fn(),
  ensureImageWorkflowAgentRun: vi.fn(), startImageStepGenerationJob: vi.fn(),
  startAmazonAcquisitionJob: vi.fn(), invokeBusinessSkill: vi.fn(),
  storagePut: vi.fn(), resolveStoredObjectUrl: vi.fn(), createPrivateEvidencePreviewUrl: vi.fn(), safeHttpRequest: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({
  getDb: async () => ({ execute: mocks.execute }),
  requireDb: mocks.requireDb,
}));
vi.mock("./kbDb", () => ({
  getOwnedImageSet: mocks.getOwnedImageSet,
  getImageInOwnedSet: mocks.getImageInOwnedSet,
  getReadableImageSet: mocks.getReadableImageSet,
  getReadableImageWithAnalysis: mocks.getReadableImageWithAnalysis,
  listImagesBySet: mocks.listImagesBySet,
  listImagesBySetLight: mocks.listImagesBySetLight,
  deleteImageInOwnedSet: mocks.deleteImageInOwnedSet,
  reorderImagesInOwnedSet: mocks.reorderImagesInOwnedSet,
  deleteOwnedImageSet: mocks.deleteOwnedImageSet,
  updateOwnedImageSet: mocks.updateOwnedImageSet,
  createImage: mocks.createImage,
  findImageSetByAsin: mocks.findImageSetByAsin,
}));
vi.mock("./domains/acquisition/acquisitionJobs", () => ({ startAmazonAcquisitionJob: mocks.startAmazonAcquisitionJob }));
vi.mock("./domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.invokeBusinessSkill }));
vi.mock("./storage", () => ({ storagePut: mocks.storagePut, resolveStoredObjectUrl: mocks.resolveStoredObjectUrl,
  createPrivateEvidencePreviewUrl: mocks.createPrivateEvidencePreviewUrl }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.safeHttpRequest }));
vi.mock("./domains/image/repository", () => ({
  getProjectByIdAdmin: mocks.getProjectByIdAdmin,
  getProjectById: mocks.getProjectById,
  getExpressionGroupsByProject: mocks.getExpressionGroupsByProject,
  getExpressionGroupByProject: mocks.getExpressionGroupByProject,
  getExpressionGroupImageByProject: mocks.getExpressionGroupImageByProject,
  getImageWorkflowSessionByProject: mocks.getImageWorkflowSessionByProject,
  updateExpressionGroup: mocks.updateExpressionGroup,
  deleteExpressionGroup: mocks.deleteExpressionGroup,
  countExpressionGroupImages: mocks.countExpressionGroupImages,
  insertExpressionGroupImage: mocks.insertExpressionGroupImage,
  deleteExpressionGroupImage: mocks.deleteExpressionGroupImage,
  updateImageWorkflowSession: mocks.updateImageWorkflowSession,
  devDb: {}, kbDb: {},
}));
vi.mock("./domains/image/imageWorkflowAgentBridge", () => ({
  ensureImageWorkflowAgentRun: mocks.ensureImageWorkflowAgentRun,
  syncStepJobFailedToAgent: vi.fn(), syncStepJobRunningToAgent: vi.fn(),
  syncStepJobWaitingHumanToAgent: vi.fn(),
}));
vi.mock("./domains/image/services/stepGenerationJob", () => ({ startImageStepGenerationJob: mocks.startImageStepGenerationJob }));

import { router } from "./_core/trpc";
import { kbImagesRouter } from "./routers/kbImages";
import { imageExpressionGroupProcedures } from "./domains/image/routers/expressionGroups";
import { opsSyncProcedures } from "./domains/ops/routers/sync";

const routes = router({ kbImages: kbImagesRouter, imageWorkflow: router(imageExpressionGroupProcedures), ops: router(opsSyncProcedures) });
const dialect = new MySqlDialect();
const security = { member: true, readOnly: false, deny: false };
const securityQueries: Array<{ sql: string; params: unknown[] }> = [];
const ownSet = { id: 12, userId: 7, workspaceId: 42, asin: "B000000001", status: "confirmed", visibility: "private" };

function context(role: NonNullable<TrpcContext["user"]>["role"] = "admin", workspaceId: number | null = 42): TrpcContext {
  return {
    user: {
      id: 7, role, openId: "integration-permissions", email: "permissions@example.test",
      name: "Permissions test", loginMethod: "local",
      createdAt: new Date(0), updatedAt: new Date(0), lastSignedIn: new Date(0),
    },
    workspaceId,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function expectNoBusinessEffects() {
  for (const spy of [mocks.deleteImageInOwnedSet, mocks.reorderImagesInOwnedSet, mocks.deleteOwnedImageSet,
    mocks.updateOwnedImageSet, mocks.createImage, mocks.updateExpressionGroup, mocks.deleteExpressionGroup,
    mocks.insertExpressionGroupImage, mocks.deleteExpressionGroupImage, mocks.updateImageWorkflowSession,
    mocks.ensureImageWorkflowAgentRun, mocks.startImageStepGenerationJob, mocks.startAmazonAcquisitionJob,
    mocks.invokeBusinessSkill, mocks.storagePut, mocks.safeHttpRequest, mocks.resolveStoredObjectUrl,
    mocks.createPrivateEvidencePreviewUrl]) {
    expect(spy).not.toHaveBeenCalled();
  }
  // Denial auditing is allowed, but the mocked DB must see no business DML.
  expect(securityQueries.filter(query => /^(INSERT|UPDATE|DELETE)/u.test(query.sql.trim()))
    .every(query => query.sql.includes("INSERT INTO security_audit_logs"))).toBe(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  security.member = true; security.readOnly = false; security.deny = false;
  securityQueries.length = 0;
  mocks.execute.mockImplementation(async (statement: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    securityQueries.push({ sql: query.sql, params: query.params });
    if (query.sql.includes("FROM workspace_memberships")) return [security.member ? [{ id: 1 }] : []];
    if (query.sql.includes("FROM security_access_policies")) return [security.deny ? [{ effect: "deny" }] : []];
    if (query.sql.includes("FROM role_permissions")) return [security.readOnly ? [{
      modules: "[]", detailedPermissions: JSON.stringify([
        { moduleId: "knowledge", operations: ["read"] }, { moduleId: "ops", operations: ["read"] },
      ]),
    }] : []];
    if (query.sql.includes("INSERT INTO security_audit_logs")) return [[]];
    throw new Error("Unexpected persistence call in permission-only fixture");
  });
  mocks.getOwnedImageSet.mockImplementation(async (id: number, userId: number, workspaceId: number) =>
    id === ownSet.id && userId === ownSet.userId && workspaceId === ownSet.workspaceId ? ownSet : null);
  mocks.getImageInOwnedSet.mockImplementation(async (id: number, setId: number, userId: number, workspaceId: number) =>
    id === 91 && setId === ownSet.id && userId === ownSet.userId && workspaceId === ownSet.workspaceId
      ? { id, imageSetId: setId } : null);
  mocks.getReadableImageSet.mockResolvedValue(null);
  mocks.getReadableImageWithAnalysis.mockResolvedValue(null);
  mocks.listImagesBySetLight.mockResolvedValue([]);
  mocks.getProjectByIdAdmin.mockResolvedValue({ id: 101, userId: 7, workspaceId: 42 });
  mocks.getExpressionGroupsByProject.mockResolvedValue([]);
  mocks.requireDb.mockRejectedValue(new Error("No real database is permitted"));
  for (const spy of [mocks.invokeBusinessSkill, mocks.storagePut, mocks.safeHttpRequest,
    mocks.startAmazonAcquisitionJob, mocks.startImageStepGenerationJob, mocks.ensureImageWorkflowAgentRun]) {
    spy.mockRejectedValue(new Error("External or queued work is forbidden in permission fixtures"));
  }
});

describe("integration T24: real tRPC authorization with controlled persistence boundaries", () => {
  it("rejects unauthenticated reads before security, object lookup or signing", async () => {
    await expect(routes.createCaller({ ...context(), user: null }).kbImages.getSet({ id: 12 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.getReadableImageSet).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("rejects a missing workspace before object lookup even for a super admin", async () => {
    await expect(routes.createCaller(context("super_admin", null)).kbImages.deleteSet({ id: 12 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getOwnedImageSet).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("checks current membership again after access is revoked on the same caller", async () => {
    const caller = routes.createCaller(context());
    await expect(caller.kbImages.getSet({ id: 12 })).resolves.toBeNull();
    security.member = false;
    await expect(caller.kbImages.deleteSet({ id: 12 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getOwnedImageSet).not.toHaveBeenCalled();
    const memberships = securityQueries.filter(query => query.sql.includes("FROM workspace_memberships"));
    expect(memberships).toHaveLength(2);
    expect(memberships.every(query => JSON.stringify(query.params) === JSON.stringify([42, 7]))).toBe(true);
    expectNoBusinessEffects();
  });

  it("applies a workspace read-only role override to reads but denies import, upload, crawl, AI and deletion", async () => {
    security.readOnly = true;
    const caller = routes.createCaller(context());
    await expect(caller.kbImages.getSet({ id: 12 })).resolves.toBeNull();
    for (const operation of [
      () => caller.kbImages.importByAsin({ asin: ownSet.asin }),
      () => caller.kbImages.uploadImages({ setId: 12, images: [{ filename: "test.png", base64: "AA==", position: "main" }] }),
      () => caller.kbImages.reCrawlByPosition({ setId: 12, positions: ["main"] }),
      () => caller.kbImages.reAnalyze({ setId: 12 }),
      () => caller.kbImages.deleteSet({ id: 12 }),
    ]) await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getOwnedImageSet).not.toHaveBeenCalled();
    expect(mocks.findImageSetByAsin).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("enforces a deny policy before object ownership for a non-super administrator", async () => {
    security.deny = true;
    await expect(routes.createCaller(context()).kbImages.deleteImage({ setId: 12, imageId: 91 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getOwnedImageSet).not.toHaveBeenCalled();
    expect(securityQueries.some(query => query.sql.includes("FROM security_access_policies")
      && JSON.stringify(query.params.slice(0, 3)) === JSON.stringify(["knowledge", "delete", 42]))).toBe(true);
    expectNoBusinessEffects();
  });

  it("rejects a forged parent ID before child lookup or child deletion", async () => {
    await expect(routes.createCaller(context()).kbImages.deleteImage({ setId: 88, imageId: 91 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getOwnedImageSet).toHaveBeenCalledWith(88, 7, 42);
    expect(mocks.getImageInOwnedSet).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("rejects a valid owned parent paired with another parent's image", async () => {
    await expect(routes.createCaller(context()).kbImages.deleteImage({ setId: 12, imageId: 92 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getImageInOwnedSet).toHaveBeenCalledWith(92, 12, 7, 42);
    expectNoBusinessEffects();
  });

  it("checks every reorder child before making any write when a later image belongs elsewhere", async () => {
    await expect(routes.createCaller(context()).kbImages.reorderImages({ setId: 12, imageOrders: [
      { id: 91, positionIndex: 0 }, { id: 92, positionIndex: 1 },
    ] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getImageInOwnedSet.mock.calls).toEqual([[91, 12, 7, 42], [92, 12, 7, 42]]);
    expectNoBusinessEffects();
  });

  it.each(["delete", "upload", "crawl", "analyze"])("rejects a set outside the active workspace before %s effects", async operation => {
    const caller = routes.createCaller(context("admin", 43));
    const action = operation === "delete" ? () => caller.kbImages.deleteSet({ id: 12 })
      : operation === "upload" ? () => caller.kbImages.uploadImages({ setId: 12, images: [{ filename: "test.png", base64: "AA==", position: "main" }] })
        : operation === "crawl" ? () => caller.kbImages.reCrawlByPosition({ setId: 12, positions: ["main"] })
          : () => caller.kbImages.reAnalyze({ setId: 12 });
    await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getOwnedImageSet).toHaveBeenCalledWith(12, 7, 43);
    expect(mocks.listImagesBySet).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("does not enumerate images or sign URLs when readable-set lookup denies access", async () => {
    const caller = routes.createCaller(context());
    await expect(caller.kbImages.getSet({ id: 88 })).resolves.toBeNull();
    await expect(caller.kbImages.getImageAnalysis({ imageId: 92 })).resolves.toBeNull();
    expect(mocks.getReadableImageSet).toHaveBeenCalledWith(88, 7, 42);
    expect(mocks.getReadableImageWithAnalysis).toHaveBeenCalledWith(92, 7, 42);
    expect(mocks.listImagesBySetLight).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("allows a valid owned image delete with the same full scope passed to the write", async () => {
    await expect(routes.createCaller(context()).kbImages.deleteImage({ setId: 12, imageId: 91 }))
      .resolves.toEqual({ success: true });
    expect(mocks.deleteImageInOwnedSet).toHaveBeenCalledTimes(1);
    expect(mocks.deleteImageInOwnedSet).toHaveBeenCalledWith(91, 12, 7, 42);
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
    expect(mocks.invokeBusinessSkill).not.toHaveBeenCalled();
  });

  it("rejects an out-of-project expression group before looking up sessions or queuing AI", async () => {
    mocks.getExpressionGroupsByProject.mockResolvedValue([{ id: 202, projectId: 101, images: [{ id: 301 }] }]);
    await expect(routes.createCaller(context()).imageWorkflow.analyzeExpressionGroup({ projectId: 101, groupId: 999 }))
      .rejects.toThrow("Group not found");
    expect(mocks.getExpressionGroupsByProject).toHaveBeenCalledWith(101);
    expect(mocks.getImageWorkflowSessionByProject).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("allows designer read access but denies modifying or analyzing another owner's project", async () => {
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 101, userId: 8, workspaceId: 42 });
    const caller = routes.createCaller(context("designer"));
    await expect(caller.imageWorkflow.getExpressionGroups({ projectId: 101 })).resolves.toEqual([]);
    const readCount = mocks.getExpressionGroupsByProject.mock.calls.length;
    for (const operation of [
      () => caller.imageWorkflow.updateExpressionGroup({ projectId: 101, groupId: 202, userEdit: "denied" }),
      () => caller.imageWorkflow.removeImageFromGroup({ projectId: 101, imageId: 301 }),
      () => caller.imageWorkflow.analyzeExpressionGroup({ projectId: 101, groupId: 202 }),
    ]) await expect(operation()).rejects.toThrow("Designer角色只能查看");
    expect(mocks.getExpressionGroupByProject).not.toHaveBeenCalled();
    expect(mocks.getExpressionGroupImageByProject).not.toHaveBeenCalled();
    expect(mocks.getExpressionGroupsByProject).toHaveBeenCalledTimes(readCount);
    expectNoBusinessEffects();
  });

  it("rejects cross-workspace expression analysis before loading group contents", async () => {
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 101, userId: 7, workspaceId: 43 });
    await expect(routes.createCaller(context()).imageWorkflow.analyzeExpressionGroup({ projectId: 101, groupId: 202 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getExpressionGroupsByProject).not.toHaveBeenCalled();
    expectNoBusinessEffects();
  });

  it("denies the actual legacy sync endpoint to an ops read-only user before its resolver", async () => {
    await expect(routes.createCaller(context("ops_specialist")).ops.syncFromLingxing())
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "没有权限执行 ops_data.sync" });
    expect(securityQueries.some(query => query.sql.includes("FROM security_access_policies")
      && JSON.stringify(query.params.slice(0, 3)) === JSON.stringify(["ops_data", "sync", 42]))).toBe(true);
    expectNoBusinessEffects();
  });
});
