import { beforeEach, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const f = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  rows: [] as any[],
  writes: 0,
}));
const dialect = new MySqlDialect();
const db = {
  execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    f.queries.push(q);
    if (q.sql.startsWith("INSERT INTO research_bookmarks")) {
      const p = q.params;
      let row = f.rows.find(
        r =>
          r.workspace_id === p[1] &&
          r.user_id === p[2] &&
          r.kind === p[3] &&
          r.identity_hash === p[4]
      );
      if (!row) {
        row = {
          id: p[0],
          workspace_id: p[1],
          user_id: p[2],
          kind: p[3],
          identity_hash: p[4],
          site: p[5],
          asin: p[6],
          title: p[7],
          url: p[8],
          thumbnail: p[9],
          price: p[10],
          brand: p[11],
          note: "",
          state: "pending",
          revision: 1,
          created_at: new Date(),
          collector: "员工",
        };
        f.rows.push(row);
      }
      f.writes++;
      return [{ affectedRows: 1 }];
    }
    if (q.sql.startsWith("SELECT id,title"))
      return [
        [
          f.rows.find(
            r =>
              r.workspace_id === q.params[0] &&
              r.user_id === q.params[1] &&
              r.kind === q.params[2] &&
              r.identity_hash === q.params[3]
          ),
        ],
      ];
    if (q.sql.startsWith("SELECT COUNT")) return [[{ n: 0 }]];
    if (q.sql.startsWith("SELECT b.*")) return [[]];
    if (q.sql.startsWith("SELECT id,user_id"))
      return [
        f.rows.filter(
          r => r.id === q.params[0] && r.workspace_id === q.params[1]
        ),
      ];
    if (q.sql.startsWith("UPDATE research_bookmarks")) {
      const p = q.params,
        row = f.rows.find(
          r =>
            r.id === p[2] &&
            r.workspace_id === p[3] &&
            r.user_id === p[4] &&
            r.revision === p[5]
        );
      if (row) {
        row.note = p[0];
        row.state = p[1];
        row.revision++;
        f.writes++;
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error(q.sql);
  },
};
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({ ...db, transaction: async (fn: any) => fn(db) }),
}));
import {
  collectResearch,
  listResearch,
  updateResearch,
} from "./researchLibrary";
const scope = { workspaceId: 3, userId: 7, role: "product_dev" },
  product = {
    kind: "product" as const,
    url: "https://www.amazon.com/dp/B082TMBYR6?tag=tracking",
    title: "示例产品",
    thumbnail: "",
    price: "$99",
    brand: "示例品牌",
  };
beforeEach(() => {
  f.queries = [];
  f.rows = [];
  f.writes = 0;
});
it("deduplicates within each collector while preserving separate users and their notes", async () => {
  const first = await collectResearch(scope, product);
  await updateResearch(scope, {
    id: first.id,
    note: "运营判断值得研究",
    state: "valuable",
    revision: 1,
  });
  const repeat = await collectResearch(scope, {
    ...product,
    title: "其他页面标题",
  });
  const another = await collectResearch({ ...scope, userId: 8 }, product);
  expect(repeat.id).toBe(first.id);
  expect(another.id).not.toBe(first.id);
  expect(f.rows).toHaveLength(2);
  expect(f.rows[0]).toMatchObject({
    note: "运营判断值得研究",
    title: "示例产品",
    state: "valuable",
  });
  expect(f.rows[0].url).not.toContain("tracking");
});
it("employees cannot query or modify another collector and every list stays in its workspace", async () => {
  await expect(
    listResearch(scope, { kind: "product", query: "", page: 1, ownerId: 8 })
  ).rejects.toThrow("自己");
  const other = await collectResearch({ ...scope, userId: 8 }, product);
  await expect(
    updateResearch(scope, {
      id: other.id,
      note: "不允许",
      state: "pending",
      revision: 1,
    })
  ).rejects.toThrow("无权编辑");
  await listResearch(scope, { kind: "product", query: "", page: 1 });
  const count = f.queries.find(q => q.sql.startsWith("SELECT COUNT"))!;
  expect(count.sql).toContain("workspace_id=?");
  expect(count.sql).toContain("user_id=?");
  expect(count.params).toContain(3);
  expect(count.params).toContain(7);
});
it("admins may filter all collectors but cannot cross workspaces or overwrite newer notes", async () => {
  const row = await collectResearch(scope, product),
    admin = { ...scope, userId: 2, role: "super_admin" };
  await updateResearch(admin, {
    id: row.id,
    note: "已确认",
    state: "valuable",
    revision: 1,
  });
  await expect(
    updateResearch(scope, {
      id: row.id,
      note: "旧窗口",
      state: "pending",
      revision: 1,
    })
  ).rejects.toThrow("已更新");
  expect(f.rows[0].note).toBe("已确认");
  await expect(
    updateResearch(
      { ...admin, workspaceId: 9 },
      { id: row.id, note: "跨工作区", state: "pending", revision: 2 }
    )
  ).rejects.toThrow("不存在");
});
it("rejects non-Amazon collection addresses before any database write", async () => {
  await expect(
    collectResearch(scope, {
      ...product,
      url: "https://example.com/dp/B082TMBYR6",
    })
  ).rejects.toThrow("亚马逊");
  expect(f.writes).toBe(0);
});
