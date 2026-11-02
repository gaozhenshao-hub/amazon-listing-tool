import { describe, expect, it } from "vitest";
import { filterLingxingDraftRows } from "./lingxingSyncViewModel";

describe("领星同步预览状态筛选", () => {
  const rows = [{ rowStatus: "new", id: 1 }, { rowStatus: "changed", id: 2 }, { rowStatus: "needs_review", id: 3 }, { rowStatus: "skipped", id: 4 }];

  it("显示全部草稿或仅显示指定状态", () => {
    expect(filterLingxingDraftRows(rows, "all")).toHaveLength(4);
    expect(filterLingxingDraftRows(rows, "needs_review").map((row) => row.id)).toEqual([3]);
    expect(filterLingxingDraftRows(rows, "unchanged")).toEqual([]);
  });
});
