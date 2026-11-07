import { it, expect } from "vitest";
import {
  emptyImageOutline,
  makeOutlineGroup,
} from "../../../shared/imagePlanning";
import {
  recordManualOutline,
  applyOutlineRefinement,
  hasOutlineResult,
} from "../../../shared/imageOutlineEditing";
it("protects edited image content and dimensions while permitting AI-owned fields to improve", () => {
  const group = makeOutlineGroup("主图", "附图", 1),
    base = {
      ...emptyImageOutline(),
      manualTrackingVersion: 1 as const,
      groups: [group],
    };
  group.items[0].content = "原画面";
  group.items[0].title = "原标题";
  const edited = structuredClone(base);
  edited.groups[0].items[0].content = "运营确认的六个口袋";
  edited.groups[0].items[0].width = 1800;
  const saved = recordManualOutline(base, edited),
    item = saved.groups[0].items[0];
  const result = applyOutlineRefinement(saved, [
    {
      key: `item:${item.id}:content`,
      original: item.content,
      value: "竞品八个口袋",
    },
    { key: `item:${item.id}:width`, original: 1800, value: 2000 },
    { key: `item:${item.id}:title`, original: "原标题", value: "细节近景" },
  ]);
  expect(result.protectedCount).toBe(2);
  expect(result.data.groups[0].items[0]).toMatchObject({
    id: item.id,
    content: "运营确认的六个口袋",
    width: 1800,
    title: "细节近景",
  });
  expect(saved.groups[0].items[0].title).toBe("原标题");
});
it("keeps chosen references, structure and ordering and rejects stale field patches", () => {
  const group = makeOutlineGroup("高级A+", "全宽背景图"),
    base = { ...emptyImageOutline(), referenceSets: [3], groups: [group] };
  group.items[0].content = "原画面";
  group.items[0].references = [{ setId: 3, imageId: 10 }];
  const result = applyOutlineRefinement(base, [
    {
      key: `item:${group.items[0].id}:content`,
      original: "原画面",
      value: "改进画面",
    },
  ]);
  expect(result.data.groups[0].items[0].references).toEqual([
    { setId: 3, imageId: 10 },
  ]);
  expect(result.data.groups[0].id).toBe(group.id);
  expect(() =>
    applyOutlineRefinement(result.data, [
      {
        key: `item:${group.items[0].id}:content`,
        original: "原画面",
        value: "旧窗口修改",
      },
    ])
  ).toThrow("已变化");
  expect(hasOutlineResult(emptyImageOutline())).toBe(false);
  expect(hasOutlineResult(result.data)).toBe(true);
});
