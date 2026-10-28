import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const whereClauses: unknown[] = [];
const queryRows: unknown[][] = [];

function selectBuilder() {
  const builder = {
    from: () => builder, innerJoin: () => builder, leftJoin: () => builder,
    where: (condition: unknown) => { whereClauses.push(condition); return builder; },
    limit: () => builder, offset: () => builder, for: () => builder, orderBy: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(queryRows.shift() ?? []).then(resolve),
  };
  return builder;
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
  transaction: vi.fn(async (body: (tx: unknown) => Promise<unknown>) => body(dbMock)),
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
  it("limits administrator tag edits to owned or confirmed shared sets in the same workspace", async () => {
    queryRows.push([{setId:12,layout:null}], [{id:91,imagePosition:"main"}]);
    await kbDb.updateImageTagsForEditor(91, 7, 42, true, { tagComposition: "一分构图" });
    const predicate = renderedSql(whereClauses.at(-1));
    expect(predicate).toContain("`kb_image_sets`.`workspaceId` = ?");
    expect(predicate).toContain("`kb_image_sets`.`visibility` <> ?");
    expect(predicate).toContain("`kb_image_sets`.`status` = ?");
    expect(predicate).toContain("`kb_image_sets`.`userId` = ?");
  });
  it("saves an edit from the fourth image only to the module owner", async () => {
    const hashes = [1,2,3,4].map(n=>String(n).repeat(64));
    queryRows.push([{setId:12,layout:{version:1,modules:[{id:"four",section:"aplus",kind:"grid",cards:hashes.map(hash=>({images:[{hash}]}))}]}}],
      hashes.map((hash,index)=>({id:91+index,imagePosition:"aplus",sourceUrlHash:hash})));
    expect(await kbDb.updateImageTagsForEditor(94,7,42,true,{tagComposition:"多分构图"})).toBe(91);
    const write = dialect.sqlToQuery(whereClauses.at(-1) as Parameters<MySqlDialect["sqlToQuery"]>[0]);
    expect(write.params[0]).toBe(91); expect(dbMock.update).toHaveBeenCalledTimes(1);
  });
  it("cannot use a member image to bypass scope or replace a missing primary", async () => {
    queryRows.push([]);
    await expect(kbDb.updateImageTagsForEditor(94,7,42,true,{tagCategory:"宠物"})).rejects.toThrow("无权限");
    expect(dbMock.update).not.toHaveBeenCalled();
    queryRows.push([{setId:12,layout:{version:1,modules:[{id:"four",section:"aplus",kind:"grid",cards:[{images:[{hash:"1".repeat(64)},{hash:"2".repeat(64)}]}]}]}}], [{id:94,imagePosition:"aplus",sourceUrlHash:"2".repeat(64)}]);
    await expect(kbDb.updateImageTagsForEditor(94,7,42,true,{tagCategory:"宠物"})).rejects.toThrow("首图");
    expect(dbMock.update).not.toHaveBeenCalled();
  });
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

it("filters independent and linked image colors in SQL before pagination",async()=>{
  await kbDb.listAllImages(7,42,"shared",{tagCategory:"宠物",tagAccentColor:"__none",tagColorSchemeV2:"白色",groupBy:"type"});
  const q=dialect.sqlToQuery(whereClauses.at(-1) as Parameters<MySqlDialect["sqlToQuery"]>[0]);
  expect(q.sql).toContain("`kb_images`.`imageSetId` IS NULL");
  expect(q.sql).toContain("`kb_images`.`workspaceId` = ?");
  expect(q.sql).toContain("`kb_image_sets`.`workspaceId` = ?");
  expect(q.sql).toContain("`kb_images`.`tagAccentColor`,`kb_image_sets`.`setAccentColor`");
  expect(q.params).toContain("宠物");expect(q.params).toContain("");
});
