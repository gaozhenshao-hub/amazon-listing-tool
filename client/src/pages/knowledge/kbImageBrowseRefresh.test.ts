import { describe, expect, it } from "vitest";
import { shouldRefreshImageBrowse } from "./kbImageBrowseRefresh";

describe("图片知识库图片浏览缓存刷新", () => {
  it("在ASIN图片集视图不刷新图片级查询", () => {
    expect(shouldRefreshImageBrowse("asin")).toBe(false);
  });

  it("在瀑布流与网格视图刷新图片级查询", () => {
    expect(shouldRefreshImageBrowse("waterfall")).toBe(true);
    expect(shouldRefreshImageBrowse("grid")).toBe(true);
  });
});
