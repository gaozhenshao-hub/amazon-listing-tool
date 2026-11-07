import { beforeEach, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { blankImageOutline } from "../../../shared/imagePlanning";
import { emptyImageDocument } from "../../../shared/imageDocument";
const f = vi.hoisted(() => ({
  doc: null as any,
  previous: null as any,
  sql: [] as string[],
  params: [] as any[],
  scope: vi.fn(),
}));
const dialect = new MySqlDialect();
const tx = {
  execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    f.sql.push(sql);
    f.params.push(params);
    if (sql.startsWith("SELECT s.id")) return [f.previous ? [f.previous] : []];
    if (sql.startsWith("SELECT COUNT")) return [[{ n: 0 }]];
    return [{ affectedRows: 1 }];
  },
};
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({ ...tx, transaction: async (fn: any) => fn(tx) }),
}));
vi.mock("./imagePlanningStore", () => ({
  lockPlanningProject: f.scope,
  planningRows: async (_: any, q: any) => (await tx.execute(q))[0],
}));
vi.mock("./imageDocumentStore", () => ({
  readImageDocument: async () => f.doc,
  assertDocumentEditable: (v: any) => {
    if (v.locked) throw Error("锁定");
  },
  documentConflict: () => Error("资料已更新"),
}));
vi.mock("../design/provider", () => ({
  designModel: async () => ({ id: 42 }),
}));
vi.mock("../design/assets", () => ({
  assetDirectory: async () => "unused",
  assetBytes: vi.fn(),
}));
vi.mock("../../_core/context", () => ({ createContext: vi.fn() }));
vi.mock("../../repositories", () => ({ getProjectById: vi.fn() }));
vi.mock("../../services/securityGovernance", () => ({
  assertResourceAction: vi.fn(),
  actorFromContext: vi.fn(),
}));
import { queueCompositionSketch } from "./compositionSketches";
const scope = { projectId: 1, workspaceId: 3, userId: 7 };
beforeEach(() => {
  f.sql = [];
  f.params = [];
  f.previous = null;
  f.doc = {
    revision: 2,
    locked: false,
    data: emptyImageDocument(blankImageOutline()),
  };
  f.doc.data.entries[0].layout = "一拖一";
  f.doc.data.entries[0].layoutNote = "主1：小孩睡觉。辅1：底部透明电机原理框。";
});
it("真实排入已有Image2.5持久队列，绑定项目及当前图片，不在请求中重复调用付费接口", async () => {
  await queueCompositionSketch(scope, {
    revision: 2,
    entry: f.doc.data.entries[0],
  });
  expect(f.sql.filter(s => s.startsWith("INSERT"))).toHaveLength(3);
  expect(f.params.flat()).toContain(42);
  expect(f.scope).toHaveBeenCalledWith(expect.anything(), scope);
  expect(f.sql.join("\n")).toContain("listing_image_composition_sketches");
});
it("同一内容重复点击复用任务，未知付费提交只允许查进度", async () => {
  f.previous = { id: "saved", status: "running" };
  await expect(
    queueCompositionSketch(scope, { revision: 2, entry: f.doc.data.entries[0] })
  ).resolves.toEqual({ id: "saved" });
  f.previous.status = "unknown";
  await expect(
    queueCompositionSketch(scope, {
      revision: 2,
      entry: f.doc.data.entries[0],
      retry: true,
    })
  ).rejects.toThrow("避免重复生成");
  expect(f.sql.some(s => s.startsWith("INSERT"))).toBe(false);
});
it("锁定、旧修订或与已保存画面不符均不能产生草图费用", async () => {
  await expect(
    queueCompositionSketch(scope, { revision: 1, entry: f.doc.data.entries[0] })
  ).rejects.toThrow("已更新");
  await expect(
    queueCompositionSketch(scope, {
      revision: 2,
      entry: { ...f.doc.data.entries[0], layoutNote: "未保存布局" },
    })
  ).rejects.toThrow("已更新");
  f.doc.locked = true;
  await expect(
    queueCompositionSketch(scope, { revision: 2, entry: f.doc.data.entries[0] })
  ).rejects.toThrow("锁定");
  expect(f.sql.some(s => s.startsWith("INSERT"))).toBe(false);
});

it("已有构图参考时不允许产生额外线框费用", async () => {
  f.doc.data.entries[0].references.composition = [{ reference: { source: "knowledge", imageId: 1, label: "参考" }, purpose: "整体布局" }];
  await expect(queueCompositionSketch(scope, { revision: 2, entry: f.doc.data.entries[0] })).rejects.toThrow("已有构图参考");
  expect(f.sql.some(s => s.startsWith("INSERT"))).toBe(false);
});
