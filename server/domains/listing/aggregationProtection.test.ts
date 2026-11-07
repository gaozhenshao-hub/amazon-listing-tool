import { beforeEach, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  emptyListingAggregation,
  listingAggregationSchema,
} from "../../../shared/listingAggregation";
const f = vi.hoisted(() => ({ data: null as any, revision: 3 }));
const dialect = new MySqlDialect();
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => {
    const execute = async (q: any) => {
      const { sql, params } = dialect.sqlToQuery(q);
      if (sql.startsWith("SELECT id FROM projects")) return [[{ id: 11 }]];
      if (sql.startsWith("SELECT data,revision"))
        return [[{ data: JSON.stringify(f.data), revision: f.revision }]];
      if (sql.startsWith("SELECT a.data"))
        return [[{ data: JSON.stringify(f.data) }]];
      if (sql.startsWith("UPDATE listing_aggregations")) {
        f.data = JSON.parse(params[0] as string);
        f.revision++;
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    };
    return { execute, transaction: async (fn: any) => fn({ execute }) };
  },
}));
import { saveListingAggregation } from "./aggregationStore";
const scope = { projectId: 11, workspaceId: 3, userId: 7 },
  id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  f.revision = 3;
  f.data = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    features: [
      {
        id,
        text: "6个口袋",
        note: "运营确认",
        group: "detail",
        category: "details",
        manual: true,
        manualFields: ["text", "note"],
      },
    ],
    pageLocks: {},
  });
});
it("keeps manually corrected product values when a generated preview tries to restore competitor values", async () => {
  const proposed = structuredClone(f.data);
  proposed.features[0].text = "8个口袋";
  proposed.features[0].note = "竞品都是8个";
  const result = await saveListingAggregation(scope, 3, proposed, undefined, {
    generated: true,
  });
  expect(result.data.features![0]).toMatchObject({
    text: "6个口袋",
    note: "运营确认",
    manual: true,
  });
});
it("does not lose persisted photographs, conversation or locks through an older editor draft", async () => {
  f.data.planningConversation = {
    epoch: id,
    revision: 1,
    messages: [],
    opened: true,
    jobRunId: null,
  };
  f.data.pageLocks = { questions: true };
  const proposed = structuredClone(f.data);
  delete proposed.planningConversation;
  delete proposed.pageLocks;
  proposed.features[0].note = "新标注";
  const result = await saveListingAggregation(scope, 3, proposed);
  expect(result.data.planningConversation).toEqual(f.data.planningConversation);
  expect(result.data.pageLocks).toEqual({ questions: true });
  expect(result.data.features![0].manualFields).toContain("note");
});
it("rejects an edited payload after locking even if a caller submits an unlocked flag", async () => {
  f.data.pageLocks = { selling: true };
  const proposed = structuredClone(f.data);
  proposed.pageLocks = { selling: false };
  proposed.features[0].text = "伪造修改";
  await expect(saveListingAggregation(scope, 3, proposed)).rejects.toThrow(
    "已锁定"
  );
  expect(f.revision).toBe(3);
  expect(f.data.features[0].text).toBe("6个口袋");
});
