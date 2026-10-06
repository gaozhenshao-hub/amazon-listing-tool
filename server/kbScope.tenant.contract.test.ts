import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const whereClauses: unknown[] = [];

function selectBuilder() {
  return {
    from: () => ({
      where: (condition: unknown) => {
        whereClauses.push(condition);
        const rows: unknown[] & { orderBy?: () => Promise<unknown[]>; limit?: () => Promise<unknown[]> } = [];
        rows.orderBy = async () => [];
        rows.limit = async () => [];
        return rows;
      },
    }),
  };
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
};

vi.mock("./repositories/dbClient", () => ({ getDb: vi.fn(async () => dbMock) }));

import * as kbDb from "./kbDb";

const dialect = new MySqlDialect();

function renderedSql(condition: unknown) {
  return dialect.sqlToQuery(condition as Parameters<MySqlDialect["sqlToQuery"]>[0]).sql;
}

describe("knowledge-base tenant scope SQL contract", () => {
  beforeEach(() => {
    whereClauses.length = 0;
    vi.clearAllMocks();
  });

  it("limits all-scope skills to the caller's workspace and excludes another user's private drafts", async () => {
    await kbDb.listOperationSkills(7, 42, "all");

    const predicate = renderedSql(whereClauses.at(-1));
    expect(predicate).toContain("`kb_operation_skills`.`workspaceId` = ?");
    expect(predicate).toContain("`kb_operation_skills`.`userId` = ?");
    expect(predicate).toContain("`kb_operation_skills`.`status` = ?");
    expect(predicate).toContain("`kb_operation_skills`.`visibility` <> ?");
  });

  it("limits shared videos to confirmed, non-private records in the requested workspace", async () => {
    await kbDb.listVideos(7, 42, "shared");

    const predicate = renderedSql(whereClauses.at(-1));
    expect(predicate).toContain("`kb_videos`.`workspaceId` = ?");
    expect(predicate).toContain("`kb_videos`.`status` = ?");
    expect(predicate).toContain("`kb_videos`.`visibility` <> ?");
  });

  it("propagates the workspace predicate to every search and stats query", async () => {
    await kbDb.searchKnowledgeBase(7, 42, "", "all");
    await kbDb.getKbStats(7, 42, "all");

    expect(whereClauses).toHaveLength(10);
    for (const condition of whereClauses) {
      const predicate = renderedSql(condition);
      expect(predicate).toContain("`workspaceId` = ?");
      expect(predicate).toContain("`status` = ?");
      expect(predicate).toContain("`visibility` <> ?");
    }
  });
});
