import { describe, it, expect } from "vitest";
import { libraryFacets } from "../../../shared/libraryFacets";
describe("library facet counts", () => {
  it("counts the full set and ignores only each facet's own selection", () => {
    const rows = [
      { type: "场景", style: "北欧", accentColor: "" },
      { type: "细节", style: "北欧", accentColor: "橙色" },
      { type: "细节", style: "工业", accentColor: null },
    ];
    expect(
      libraryFacets(
        rows,
        { style: "北欧", type: "场景" },
        ["style", "type", "accentColor"],
        "type"
      )
    ).toEqual({
      total: 1,
      counts: {
        style: { 北欧: 1 },
        type: { 场景: 1, 细节: 1 },
        accentColor: { __none: 1 },
      },
      totals: { style: 1, type: 2, accentColor: 1 },
      groups: { 场景: 1 },
    });
  });
  it("counts repeated video content once per video and distinguishes empty from unknown accent", () => {
    const r = libraryFacets(
      [
        { content: ["使用场景", "使用场景", "核心使用"], accentColor: "" },
        { content: ["核心使用"], accentColor: null },
      ],
      {},
      ["content", "accentColor"]
    );
    expect(r.counts).toEqual({
      content: { 使用场景: 1, 核心使用: 2 },
      accentColor: { __none: 1 },
    });
  });
});
