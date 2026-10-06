import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const whereClauses: unknown[] = [];
const queryRows: unknown[][] = [];

function selectBuilder() {
  return {
    from: () => ({
      where: (condition: unknown) => {
        whereClauses.push(condition);
        return {
          limit: async () => queryRows.shift() ?? [],
          orderBy: async () => queryRows.shift() ?? [],
        };
      },
    }),
  };
}

function writeBuilder() {
  return {
    set: () => ({
      where: async (condition: unknown) => {
        whereClauses.push(condition);
      },
    }),
  };
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => writeBuilder()),
  delete: vi.fn(() => ({
    where: async (condition: unknown) => {
      whereClauses.push(condition);
    },
  })),
};

vi.mock("./repositories/dbClient", () => ({ getDb: vi.fn(async () => dbMock) }));

import * as kbDb from "./kbDb";

const dialect = new MySqlDialect();

function renderedSql(condition: unknown) {
  return dialect.sqlToQuery(condition as Parameters<MySqlDialect["sqlToQuery"]>[0]).sql;
}

describe("KB image tenant SQL predicates", () => {
  beforeEach(() => {
    whereClauses.length = 0;
    queryRows.length = 0;
    vi.clearAllMocks();
  });

  it("rejects cross-tenant single-image updates in the database predicate", async () => {
    await kbDb.updateOwnedImage(91, 7, 42, { singleImageScore: 8 });

    const predicate = renderedSql(whereClauses.at(-1));
    expect(predicate).toContain("`kb_images`.`id` = ?");
    expect(predicate).toContain("`kb_images`.`imageSetId` IN (SELECT `kb_image_sets`.`id` FROM `kb_image_sets`");
    expect(predicate).toContain("`kb_image_sets`.`userId` = ?");
    expect(predicate).toContain("`kb_image_sets`.`workspaceId` = ?");
  });

  it("binds delete and reorder writes to both the requested image set and its owner workspace", async () => {
    await kbDb.deleteImageInOwnedSet(91, 12, 7, 42);
    await kbDb.reorderImagesInOwnedSet(12, 7, 42, [{ id: 92, positionIndex: 3 }]);

    const [deletePredicate, reorderPredicate] = whereClauses.map(renderedSql);
    for (const predicate of [deletePredicate, reorderPredicate]) {
      expect(predicate).toContain("`kb_images`.`id` = ?");
      expect(predicate).toContain("`kb_images`.`imageSetId` = ?");
      expect(predicate).toContain("`kb_image_sets`.`id` = ?");
      expect(predicate).toContain("`kb_image_sets`.`userId` = ?");
      expect(predicate).toContain("`kb_image_sets`.`workspaceId` = ?");
    }
  });

  it("does not delete child images until the owner/workspace set check succeeds", async () => {
    queryRows.push([]);
    await expect(kbDb.deleteOwnedImageSet(12, 7, 42)).resolves.toBe(false);
    expect(dbMock.delete).not.toHaveBeenCalled();

    queryRows.push([{ id: 12 }]);
    await expect(kbDb.deleteOwnedImageSet(12, 7, 42)).resolves.toBe(true);
    expect(dbMock.delete).toHaveBeenCalledTimes(2);
    const predicates = whereClauses.map(renderedSql).join("\n");
    expect(predicates).toContain("`kb_image_sets`.`userId` = ?");
    expect(predicates).toContain("`kb_image_sets`.`workspaceId` = ?");
    expect(predicates).toContain("`kb_images`.`imageSetId` = ?");
  });
});
