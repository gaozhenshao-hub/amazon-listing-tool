import { expect, it } from "vitest";
import { emptyImageDocument } from "../../../shared/imageDocument";
import { blankImageOutline } from "../../../shared/imagePlanning";
import { reviewDocumentCandidate } from "./imageDocumentReview";
import { documentModelSources } from "./imageDocumentFacts";
const fixture = () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  const original = emptyImageDocument(outline),
    data = structuredClone(original),
    current = structuredClone(original);
  data.entries[0].layout = "一拖一";
  data.entries[0].content = "AI候选画面";
  const context = {
    sourceHash: "same",
    sources: {
      input: {
        product: {},
        selling: [],
        features: [],
        competitors: [],
        productNotes: "六个口袋",
      },
    },
    plan: { data: outline },
    tags: { categories: ["农业品"], styles: ["田园自然风"] },
    referenceSets: [],
    materials: [],
  };
  return {
    draft: { source_hash: "same", original, data, input_data: [] },
    current,
    context,
  };
};
it("锁定或助手规则版本变化不改变资料，候选仍可采用", () => {
  const f = fixture();
  const result = reviewDocumentCandidate(f.draft, f.current, f.context);
  expect(result.stale).toBe(false);
  expect(result.data.entries[0].layout).toBe("一拖一");
});
it("候选完成后人工改成6口袋时，整张图片的人工方案优先，不混入不一致布局", () => {
  const f = fixture();
  f.current.entries[0].content = "人工确认六个口袋";
  f.current.entries[0].manualFields = ["content"];
  const result = reviewDocumentCandidate(f.draft, f.current, f.context);
  expect(result.stale).toBe(false);
  expect(result.preservedImages).toBe(1);
  expect(result.data.entries[0]).toEqual(f.current.entries[0]);
});
it("仅新增知识库标签不丢弃有效预览，真正变更产品资料仍要求重新生成", () => {
  const f = fixture();
  f.draft.source_hash = "old";
  f.draft.input_data = [
    {
      upstream: documentModelSources(f.context.sources.input),
      outline: f.context.plan.data.groups.flatMap(g =>
        g.items.map(i => ({ ...i, family: g.family, moduleType: g.moduleType }))
      ),
      selectedReferenceSets: [],
      materials: [],
    },
  ] as any;
  expect(reviewDocumentCandidate(f.draft, f.current, f.context).stale).toBe(
    false
  );
  f.context.sources.input.productNotes = "八个口袋";
  expect(reviewDocumentCandidate(f.draft, f.current, f.context).stale).toBe(
    true
  );
});
it("调整系统说明或人工标记不误判产品事实过期", () => {
  const f = fixture();
  f.draft.source_hash = "old";
  const upstream = documentModelSources(f.context.sources.input);
  f.draft.input_data = [
    {
      upstream: { ...upstream, factRules: "旧版说明", manualFields: ["note"] },
      outline: f.context.plan.data.groups.flatMap(g =>
        g.items.map(i => ({ ...i, family: g.family, moduleType: g.moduleType }))
      ),
      selectedReferenceSets: [],
      materials: [],
    },
  ] as any;
  expect(reviewDocumentCandidate(f.draft, f.current, f.context).stale).toBe(
    false
  );
  f.context.sources.input.productNotes = "真实产品变成八个口袋";
  const result = reviewDocumentCandidate(f.draft, f.current, f.context);
  expect(result.stale).toBe(true);
  expect(result.reason).toContain("本品补充信息");
});
