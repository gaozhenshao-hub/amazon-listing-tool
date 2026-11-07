import { beforeEach, it, expect, vi } from "vitest";
import {
  blankImageOutline,
  emptyImageOutline,
} from "../../../shared/imagePlanning";
import { emptyImageDocument } from "../../../shared/imageDocument";
import { emptyListingAggregation } from "../../../shared/listingAggregation";
const f = vi.hoisted(() => ({
  plan: null as any,
  doc: null as any,
  fail: false,
  locked: false,
  writes: [] as string[],
  transaction: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    transaction: async (fn: any) => {
      const old = structuredClone({ plan: f.plan, doc: f.doc });
      try {
        return await fn({});
      } catch (error) {
        f.plan = old.plan;
        f.doc = old.doc;
        throw error;
      }
    },
  }),
}));
vi.mock("./researchLocks", () => ({
  assertResearchEditable: async () => {
    if (f.locked) throw Error("大纲已锁定");
  },
}));
vi.mock("./imagePlanningSources", () => ({
  imagePlanningSources: async () => ({ upstream: emptyListingAggregation() }),
  validateOutlineLinks: vi.fn(),
}));
vi.mock("./imagePlanningSave", () => ({ validatePlanningReferences: vi.fn() }));
vi.mock("./imageDocumentMaterials", () => ({
  documentReferences: () => [],
  resolveDocumentMaterials: vi.fn(),
}));
vi.mock("./imagePlanningStore", () => ({
  readImagePlan: async () => structuredClone(f.plan),
  lockPlanningProject: vi.fn(),
  saveImagePlan: async (_s: any, r: number, data: any) => {
    f.writes.push("outline");
    f.plan = { ...f.plan, data, revision: r + 1 };
    return f.plan;
  },
}));
vi.mock("./imageDocumentStore", async () => {
  const actual = await vi.importActual<typeof import("./imageDocumentStore")>(
    "./imageDocumentStore"
  );
  return {
    ...actual,
    readImageDocument: async () => structuredClone(f.doc),
    saveImageDocument: async (_s: any, r: number, data: any) => {
      if (f.fail) throw Error("保存失败");
      f.writes.push("document");
      f.doc = { ...f.doc, data, revision: r + 1 };
      return f.doc;
    },
  };
});
import { saveDocumentWorkspace } from "./imageDocumentWorkspace";
const scope = { projectId: 1, workspaceId: 1, userId: 2 };
beforeEach(() => {
  f.plan = { data: emptyImageOutline(), revision: 0 };
  f.doc = { data: emptyImageDocument(), revision: 0, locked: false };
  f.fail = false;
  f.locked = false;
  f.writes = [];
});
const input = () => ({
  outlineRevision: f.plan.revision,
  revision: f.doc.revision,
  outline: blankImageOutline(),
  data: emptyImageDocument(),
});
it("同一个事务保存模块与图片方案，空白模板不被误判为手工修改", async () => {
  const saved = await saveDocumentWorkspace(scope, input());
  expect(f.writes).toEqual(["outline", "document"]);
  expect(saved.outlineRevision).toBe(1);
  expect(saved.revision).toBe(1);
  expect(saved.outline.groups.every(g => !g.manualFields?.length)).toBe(true);
});
it("文档保存失败时大纲也回滚，旧版本窗口不能覆盖", async () => {
  f.fail = true;
  await expect(saveDocumentWorkspace(scope, input())).rejects.toThrow(
    "保存失败"
  );
  expect(f.plan.revision).toBe(0);
  f.fail = false;
  const request = input();
  await saveDocumentWorkspace(scope, request);
  await expect(saveDocumentWorkspace(scope, request)).rejects.toThrow("已更新");
});
it("任何一把编辑锁生效时均拒绝保存", async () => {
  f.locked = true;
  await expect(saveDocumentWorkspace(scope, input())).rejects.toThrow("锁定");
  f.locked = false;
  f.doc.locked = true;
  await expect(saveDocumentWorkspace(scope, input())).rejects.toThrow("锁定");
  expect(f.writes).toEqual([]);
});
it("AI候选改进前相同资料保存不会空增版本、让候选立即过期", async () => {
  const saved = await saveDocumentWorkspace(scope, input());
  f.writes = [];
  const next = await saveDocumentWorkspace(scope, {
    outlineRevision: 1,
    revision: 1,
    outline: saved.outline,
    data: saved.data,
  });
  expect(next.revision).toBe(1);
  expect(f.writes).toEqual([]);
});
