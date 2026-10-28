import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  remove: vi.fn(),
  asset: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    execute: mocks.execute,
    transaction: mocks.transaction,
  }),
}));
vi.mock("../../storage", () => ({ storageDeleteOwnedObject: mocks.remove }));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: vi.fn(),
}));
vi.mock("./assetTargets", async original => ({
  ...(await original<any>()),
  loadAsset: mocks.asset,
}));
import {
  deleteAsset,
  restoreAsset,
  purgeRecycled,
  listRecycled,
  cleanupKnowledgeObjects,
} from "./assetLifecycle";
const admin = { workspaceId: 2, userId: 7, role: "admin" },
  dialect = new MySqlDialect();
let statements: Array<{ sql: string; params: unknown[] }>;
beforeEach(() => {
  vi.stubEnv("KNOWLEDGE_CACHE_CLEANUP_ENABLED", undefined);
  vi.clearAllMocks();
  statements = [];
  mocks.transaction.mockImplementation(fn => fn({ execute: mocks.execute }));
  mocks.execute.mockImplementation(async query => {
    const q = dialect.sqlToQuery(query);
    statements.push(q);
    return q.sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("knowledge deletion authorization and lifecycle", () => {
  it("preserves pending object cleanup and stored bytes while deployment cleanup is disabled", async () => {
    vi.stubEnv("KNOWLEDGE_CACHE_CLEANUP_ENABLED", "false");
    expect(await cleanupKnowledgeObjects({ execute: mocks.execute }, new AbortController().signal)).toEqual({ checked: 0, disabled: true });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["operator", "designer", "user"])(
    "denies %s all deletion and recycle routes before touching data",
    async role => {
      const scope = { ...admin, role };
      for (const action of [
        () => deleteAsset(scope, "image", 1),
        () => deleteAsset(scope, "set", 1, true),
        () => restoreAsset(scope, "a"),
        () => purgeRecycled(scope, "a"),
        () => listRecycled(scope, 1),
      ])
        await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  );
  it("moves all members of one composite module together without deleting files", async () => {
    mocks.asset.mockResolvedValue({
      set: null,
      unit: { images: [{ id: 10 }, { id: 11 }, { id: 12 }] },
      title: "三图文",
    });
    expect(await deleteAsset(admin, "image", 11)).toMatchObject({
      count: 3,
      permanent: false,
    });
    const update = statements.find(q =>
      q.sql.startsWith("UPDATE `kb_images`")
    )!;
    expect(update.params.slice(1)).toEqual([10, 11, 12]);
    expect(statements.some(q => q.sql.startsWith("DELETE"))).toBe(false);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("requires the parent to exist and be active before restoring a child", async () => {
    mocks.execute.mockImplementation(async query => {
      const q = dialect.sqlToQuery(query);
      statements.push(q);
      return q.sql.includes("FROM knowledge_recycle_bin")
        ? [[{ id: "a", kind: "image", parentSetId: 9 }]]
        : q.sql.includes("FROM kb_image_sets")
          ? [[{ id: 9, recycleId: "parent-trash" }]]
          : [[]];
    });
    await expect(restoreAsset(admin, "a")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(statements.some(q => q.sql.startsWith("UPDATE"))).toBe(false);
    expect(
      statements.find(q => q.sql.includes("FROM kb_image_sets"))!.params
    ).toEqual([9, 2]);
  });
  it("never removes a shared object still referenced by another business record", async () => {
    mocks.execute.mockImplementation(async query => {
      const q = dialect.sqlToQuery(query);
      statements.push(q);
      if (q.sql.includes("FROM knowledge_object_cleanup"))
        return [[{ id: 1, reference: "storage://local/shared.webp" }]];
      if (q.sql.includes("information_schema"))
        return [[{ TABLE_NAME: "kb_images", COLUMN_NAME: "imageUrl" }]];
      if (q.sql.includes("SELECT 1")) return [[{ found: 1 }]];
      return [{ affectedRows: 1 }];
    });
    await cleanupKnowledgeObjects(
      { execute: mocks.execute },
      new AbortController().signal
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(statements.at(-1)!.sql).toContain("state='shared'");
  });
  it("deletes unreferenced managed files and records completion", async () => {
    mocks.execute.mockImplementation(async query => {
      const q = dialect.sqlToQuery(query);
      statements.push(q);
      if (q.sql.includes("FROM knowledge_object_cleanup"))
        return [[{ id: 1, reference: "storage://local/orphan.webp" }]];
      if (q.sql.includes("information_schema"))
        return [[{ TABLE_NAME: "kb_images", COLUMN_NAME: "imageUrl" }]];
      if (q.sql.includes("SELECT 1")) return [[]];
      return [{ affectedRows: 1 }];
    });
    await cleanupKnowledgeObjects(
      { execute: mocks.execute },
      new AbortController().signal
    );
    expect(mocks.remove).toHaveBeenCalledWith("storage://local/orphan.webp");
    expect(statements.at(-1)!.sql).toContain("state='deleted'");
  });
});
