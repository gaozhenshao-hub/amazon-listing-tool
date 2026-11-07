vi.mock("./researchLocks", () => ({ setResearchLock: vi.fn() }));
import { beforeEach, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { blankImageOutline } from "../../../shared/imagePlanning";
import { emptyImageDocument } from "../../../shared/imageDocument";
const f = vi.hoisted(() => ({
  revision: 0,
  data: null as any,
  locked: false,
  writes: 0,
  outline: null as any,
}));
const dialect = new MySqlDialect();
const tx = {
  execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    if (sql.startsWith("SELECT * FROM projects"))
      return [
        params[0] === 11 && params[1] === 3 && params[2] === 7
          ? [{ id: 11 }]
          : [],
      ];
    if (sql.startsWith("SELECT data,revision,locked"))
      return [
        f.revision
          ? [
              {
                data: f.data,
                revision: f.revision,
                locked: f.locked,
                job_run_id: null,
              },
            ]
          : [],
      ];
    if (sql.startsWith("INSERT INTO listing_image_documents")) {
      f.data = JSON.parse(params[2] as string);
      f.revision = 1;
      f.locked = !!params[3];
      f.writes++;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE listing_image_documents SET data")) {
      f.data = JSON.parse(params[0] as string);
      f.revision++;
      f.writes++;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE listing_image_documents SET locked")) {
      f.locked = !!params[0];
      f.revision++;
      f.writes++;
      return [{ affectedRows: 1 }];
    }
    throw new Error(sql);
  },
};
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({ ...tx, transaction: async (fn: any) => fn(tx) }),
}));
vi.mock("./imagePlanningStore", async () => ({
  ...(await vi.importActual<typeof import("./imagePlanningStore")>(
    "./imagePlanningStore"
  )),
  readImagePlan: async () => ({ data: f.outline, revision: 1 }),
}));
import {
  saveImageDocument,
  lockImageDocument,
  synchronizeDocument,
} from "./imageDocumentStore";
const scope = { projectId: 11, workspaceId: 3, userId: 7 };
beforeEach(() => {
  f.revision = 0;
  f.data = null;
  f.locked = false;
  f.writes = 0;
  f.outline = blankImageOutline();
});
it("保存进行版本比较，旧编辑窗口不会覆盖已保存文档", async () => {
  const data = emptyImageDocument(f.outline);
  const first = await saveImageDocument(scope, 0, data);
  expect(first.revision).toBe(1);
  await expect(saveImageDocument(scope, 0, data)).rejects.toThrow("已更新");
  expect(f.writes).toBe(1);
});
it("工作区或项目所有者不符，在保存前拒绝", async () => {
  const data = emptyImageDocument(f.outline);
  await expect(
    saveImageDocument({ ...scope, userId: 8 }, 0, data)
  ).rejects.toThrow("项目不可访问");
  await expect(
    saveImageDocument({ ...scope, workspaceId: 4 }, 0, data)
  ).rejects.toThrow("项目不可访问");
  expect(f.writes).toBe(0);
});
it("锁定状态不能保存，解锁后继续按版本编辑", async () => {
  const initial = await lockImageDocument(scope, 0, true);
  expect(initial.locked).toBe(true);
  await expect(saveImageDocument(scope, 1, initial.data)).rejects.toThrow(
    "已锁定"
  );
  const unlocked = await lockImageDocument(scope, 1, false);
  expect(unlocked.revision).toBe(2);
  await expect(
    saveImageDocument(scope, 2, unlocked.data)
  ).resolves.toMatchObject({ revision: 3 });
});
it("拒绝注入其他大纲的图位，同时允许保留当前历史图位", async () => {
  const data = emptyImageDocument(f.outline);
  data.entries[0].imageId = crypto.randomUUID();
  await expect(saveImageDocument(scope, 0, data)).rejects.toThrow(
    "不属于当前大纲"
  );
  expect(f.writes).toBe(0);
});
it("保存或重新打开时保留AI细化内容，仅大纲实际改动时同步未保护字段", () => {
  const first = synchronizeDocument(emptyImageDocument(f.outline), f.outline);
  first.entries[0].content = "AI细化的六口袋、袖口场景";
  expect(synchronizeDocument(first, f.outline).entries[0].content).toBe(
    "AI细化的六口袋、袖口场景"
  );
  f.outline.groups[0].items[0].height = 2500;
  expect(synchronizeDocument(first, f.outline).entries[0].content).toBe(
    "AI细化的六口袋、袖口场景"
  );
  f.outline.groups[0].items[0].content = "新的模块分工";
  expect(synchronizeDocument(first, f.outline).entries[0].content).toBe(
    "新的模块分工"
  );
  first.entries[0].manualFields = ["content"];
  expect(synchronizeDocument(first, f.outline).entries[0].content).toBe(
    "AI细化的六口袋、袖口场景"
  );
});
