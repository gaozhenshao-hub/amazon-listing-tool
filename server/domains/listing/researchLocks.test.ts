import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  locked: false,
  owner: true,
  revision: 4,
  data: {
    selling: [],
    reviews: [],
    questions: [],
    marks: [],
    pageLocks: { selling: false },
  } as any,
  queries: [] as string[],
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => {
    const execute = async (q: any) => {
      const text = JSON.stringify(q.queryChunks);
      f.queries.push(text);
      if (text.includes("SELECT id FROM projects"))
        return [f.owner ? [{ id: 1 }] : []];
      if (text.includes("SELECT a.data FROM projects"))
        return [
          f.owner
            ? [
                {
                  data: JSON.stringify({
                    ...f.data,
                    pageLocks: { selling: f.locked },
                  }),
                },
              ]
            : [],
        ];
      if (text.includes("SELECT data,revision"))
        return [[{ data: JSON.stringify(f.data), revision: f.revision }]];
      if (text.includes("UPDATE listing_aggregations"))
        return [{ affectedRows: 1 }];
      throw new Error("Unexpected SQL");
    };
    return { execute, transaction: async (fn: any) => fn({ execute }) };
  },
}));
import { assertResearchEditable, setResearchLock } from "./researchLocks";
const scope = { projectId: 1, workspaceId: 3, userId: 7 };
beforeEach(() => {
  f.locked = false;
  f.owner = true;
  f.queries = [];
});
it("rejects a direct server write to a locked page while other pages remain editable", async () => {
  f.locked = true;
  await expect(assertResearchEditable(scope, "selling")).rejects.toThrow(
    "已锁定"
  );
  await expect(
    assertResearchEditable(scope, "reviews")
  ).resolves.toBeUndefined();
});
it("checks ownership and workspace and serializes lock changes on the project row", async () => {
  f.owner = false;
  await expect(setResearchLock(scope, "selling", true)).rejects.toThrow(
    "不可访问"
  );
  f.owner = true;
  const result = await setResearchLock(scope, "selling", true);
  expect(result.revision).toBe(5);
  expect(result.pageLocks.selling).toBe(true);
  expect(
    f.queries.some(q => q.includes("userId=") && q.includes("FOR UPDATE"))
  ).toBe(true);
});
