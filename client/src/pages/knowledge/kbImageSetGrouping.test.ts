import { describe, expect, it } from "vitest";
import { groupImageSets } from "./kbImageSetGrouping";

describe("ASIN image-set grouping", () => {
  it("groups by the existing set style and keeps unset records last", () => {
    const grouped = groupImageSets([
      { id: 1, setStyle: "工业极简" },
      { id: 2, setStyle: null },
      { id: 3, setStyle: "工业极简" },
      { id: 4, setStyle: "自然清新" },
    ], "style");
    expect(grouped.map((group) => [group.key, group.items.length])).toEqual([
      ["工业极简", 2],
      ["自然清新", 1],
      ["未设置风格", 1],
    ]);
  });

  it("uses set-level category before the crawled category", () => {
    const grouped = groupImageSets([
      { id: 1, setCategory: "五金工具", category: "工业品" },
      { id: 2, setCategory: null, category: "工业品" },
    ], "category");
    expect(grouped.map((group) => group.key)).toEqual(["工业品", "五金工具"]);
  });

  it("groups by the existing primary and accent color fields", () => {
    const sets = [
      { id: 1, setPrimaryColor: "黑色", setAccentColor: "金色" },
      { id: 2, setPrimaryColor: "白色", setAccentColor: "金色" },
    ];
    expect(groupImageSets(sets, "primaryColor").map((group) => group.key)).toEqual(["白色", "黑色"]);
    expect(groupImageSets(sets, "accentColor").map((group) => [group.key, group.items.length])).toEqual([["金色", 2]]);
  });
});
