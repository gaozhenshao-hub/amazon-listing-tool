import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiStorageObjects } from "../drizzle/schema/ai_os";
import { kbImageSets } from "../drizzle/schema/image";
import { kbListingCopywriting, kbOperationSkills, kbProductInnovations, kbVideos } from "../drizzle/schema/knowledge";
import { opsLingxingSyncSchedules } from "../drizzle/schema/ops";
import { devImportBatches } from "../drizzle/schema/project";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(), getBatch: vi.fn(), listBatches: vi.fn(),
  snapshot: vi.fn(), updateBatch: vi.fn(), products: vi.fn(), reviews: vi.fn(),
  upsertProducts: vi.fn(), insertReviews: vi.fn(), resolveProject: vi.fn(), audit: vi.fn(),
  getDb: vi.fn(), storagePut: vi.fn(), artifactRead: vi.fn(),
}));

// Exercise the real tRPC parser/resolver, stubbing authorization and persistence
// boundaries only. These cases prove import compatibility, not permission/E2E
// coverage; integrationPermissions.behavior covers the separate access guards.
vi.mock("./domains/product_development/security/productDevelopmentProcedure", async () => {
  const { protectedProcedure } = await import("./_core/trpc");
  return { protectedProcedure };
});
vi.mock("./domains/product_development/security/productDevelopmentAccess", () => ({
  resolveDevProjectAccess: mocks.resolveProject,
  recordProductDevelopmentAudit: mocks.audit,
  productDevelopmentWorkspaceId: (ctx: { workspaceId: number }) => ctx.workspaceId,
}));
vi.mock("./devDb", () => ({
  createDevImportBatch: mocks.createBatch, getDevImportBatch: mocks.getBatch, listDevImportBatches: mocks.listBatches,
  createDevImportApplySnapshot: mocks.snapshot, updateDevImportBatch: mocks.updateBatch,
  getDevProductsByProject: mocks.products, getDevReviewsByProject: mocks.reviews,
  upsertDevProducts: mocks.upsertProducts, insertDevReviews: mocks.insertReviews,
}));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./domains/ai_os/services/artifactLifecycle", () => ({ listUnifiedArtifactVersions: mocks.artifactRead }));
vi.mock("./domains/product_development/projects/projectListService", () => ({
  listProjectProgress: vi.fn(), updateProjectProgress: vi.fn(),
}));

import { devProjectRouter } from "./routers/devProject";

const context = {
  user: { id: 7, role: "admin", openId: "schema-compatibility", email: "schema@example.test", name: "Schema test",
    loginMethod: "local", createdAt: new Date(0), updatedAt: new Date(0), lastSignedIn: new Date(0) },
  workspaceId: 42,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
} satisfies TrpcContext;

function compileOnly() {
  const transport = vi.fn(async () => { throw new Error("SQL compilation must not execute a query"); });
  return { db: drizzle(transport), transport };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveProject.mockResolvedValue({ id: 8, workspaceId: 42, userId: 7 });
  mocks.createBatch.mockResolvedValue(91);
  mocks.getDb.mockImplementation(() => { throw new Error("Unexpected database access"); });
});

describe("real ORM definitions retain published storage, import and privacy semantics", () => {
  it("retains OSS in its original enum position and can compile an OSS lifecycle object", () => {
    expect(aiStorageObjects.provider.enumValues).toEqual(["forge", "s3", "oss", "local", "external"]);
    expect(aiStorageObjects.provider.getSQLType()).toBe("enum('forge','s3','oss','local','external')");
    expect(aiStorageObjects.provider.notNull).toBe(true);
    expect(aiStorageObjects.provider.default).toBe("forge");
    const { db, transport } = compileOnly();
    const query = db.insert(aiStorageObjects).values({ storageId: "synthetic-oss", provider: "oss",
      objectKey: "images/synthetic.png", storageUri: "storage://oss/images/synthetic.png" }).toSQL();
    expect(query.params).toContain("oss");
    expect(query.params).toContain("storage://oss/images/synthetic.png");
    expect(transport).not.toHaveBeenCalled();
  });

  it("models both legacy import metadata columns as nullable without inventing defaults", async () => {
    for (const column of [devImportBatches.fileType, devImportBatches.fileName]) {
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
      expect(column.default).toBeUndefined();
    }
    expect(devImportBatches.fileType.enumValues).toEqual(["sales", "reviews"]);
    expect(devImportBatches.fileName.getSQLType()).toBe("varchar(500)");
    const transport = vi.fn(async (_sql: string, params: unknown[]) => {
      expect(params).toEqual([91]);
      return { rows: [[null, null]] };
    });
    const db = drizzle(transport);
    const rows = await db.select({ fileType: devImportBatches.fileType, fileName: devImportBatches.fileName })
      .from(devImportBatches).where(eq(devImportBatches.id, 91));
    expect(rows).toEqual([{ fileType: null, fileName: null }]);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("defaults image sets to private while preserving explicit team-sharing writes", () => {
    expect(kbImageSets.visibility.enumValues).toEqual(["private", "team", "public"]);
    expect(kbImageSets.visibility.default).toBe("private");
    expect(kbImageSets.visibility.notNull).toBe(true);
    const { db, transport } = compileOnly();
    const query = db.insert(kbImageSets).values({ userId: 7, workspaceId: 42, asin: "B000000001",
      status: "confirmed", visibility: "team" }).toSQL();
    expect(query.params).toContain("team");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ["image sets", kbImageSets], ["listing copywriting", kbListingCopywriting],
    ["operation skills", kbOperationSkills], ["product innovations", kbProductInnovations], ["videos", kbVideos],
  ] as const)("requires explicit workspace identity for %s without defaulting to workspace 1", (_name, table) => {
    expect(table.workspaceId.getSQLType()).toBe("int");
    expect(table.workspaceId.notNull).toBe(true);
    expect(table.workspaceId.hasDefault).toBe(false);
    expect(table.workspaceId.default).toBeUndefined();
    expect(table.workspaceId.defaultFn).toBeUndefined();
  });

  it("keeps auto_apply as numeric tinyint, disabled by default rather than a boolean driver mapping", () => {
    const column = opsLingxingSyncSchedules.autoApply;
    expect(column.getSQLType()).toBe("tinyint");
    expect(column.dataType).toBe("number");
    expect(column.notNull).toBe(true);
    expect(column.default).toBe(0);
    for (const value of [0, 1]) {
      expect(column.mapFromDriverValue(String(value))).toBe(value);
      expect(column.mapToDriverValue(value)).toBe(value);
    }
    const { db, transport } = compileOnly();
    const query = db.insert(opsLingxingSyncSchedules).values({ workspaceId: 42, dataDomain: "parent_asin_weekly_mcp",
      cadence: "weekly", cronExpression: "0 8 * * 1", ownerUserId: 7, autoApply: 1 }).toSQL();
    expect(query.params).toContain(1);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("nullable legacy metadata does not relax new-import runtime guards", () => {
  it.each([
    { fileType: undefined, fileName: "reviews.csv" }, { fileType: "reviews", fileName: undefined },
    { fileType: null, fileName: "reviews.csv" }, { fileType: "reviews", fileName: null },
    { fileType: "reviews", fileName: "" },
  ])("rejects missing/empty new-upload metadata before creating a batch: %j", async metadata => {
    await expect(devProjectRouter.createCaller(context).prepareImportBatch({ projectId: 8, rows: [], ...metadata } as never))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.createBatch).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("continues to prepare valid new uploads with explicit file metadata and workspace/project identity", async () => {
    const result = await devProjectRouter.createCaller(context).prepareImportBatch({ projectId: 8,
      fileType: "reviews", fileName: "reviews.csv", rows: [{ asin: "B000000001", content: "Synthetic review" }] });
    expect(result).toMatchObject({ batchId: 91, status: "validated", errorRows: 0 });
    expect(mocks.createBatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 42, projectId: 8, userId: 7,
      fileType: "reviews", fileName: "reviews.csv", status: "validated" }));
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("lists historical null metadata unchanged, but refuses applying it before any business mutation", async () => {
    const legacy = { id: 91, workspaceId: 42, projectId: 8, status: "validated", fileType: null, fileName: null,
      normalizedRows: "[]" };
    mocks.listBatches.mockResolvedValue([legacy]);
    mocks.getBatch.mockResolvedValue(legacy);
    const caller = devProjectRouter.createCaller(context);
    expect(await caller.listImportBatches({ projectId: 8 })).toEqual([legacy]);
    expect(mocks.listBatches).toHaveBeenCalledWith(42, 8);
    await expect(caller.applyImportBatch({ projectId: 8, batchId: 91 })).rejects.toThrow();
    expect(mocks.getBatch).toHaveBeenCalledWith(91, 42, 8);
    for (const effect of [mocks.snapshot, mocks.updateBatch, mocks.products, mocks.reviews, mocks.upsertProducts,
      mocks.insertReviews, mocks.audit, mocks.getDb, mocks.storagePut, mocks.artifactRead]) expect(effect).not.toHaveBeenCalled();
  });
});
