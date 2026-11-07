import { it, expect } from "vitest";
import {
  blankImageOutline,
  emptyImageOutline,
  makeOutlineGroup,
  imageOutlineSchema,
} from "../../../shared/imagePlanning";
import {
  moduleOutline,
  moduleLabels,
  mergeAplusModules,
  documentForOutline,
} from "../../../shared/modulePlanning";
import {
  emptyImageDocument,
  imageDocumentSchema,
} from "../../../shared/imageDocument";
import {
  hasOutlineResult,
  recordManualOutline,
} from "../../../shared/imageOutlineEditing";
it("starts with 20 modules, three main alternatives, seven separate secondary images and five story modules", () => {
  const data = blankImageOutline();
  expect(data.groups).toHaveLength(20);
  expect(data.groups[0].items).toHaveLength(3);
  expect(data.groups.filter(g => g.moduleType === "附图")).toHaveLength(7);
  expect(data.groups.filter(g => g.family === "品牌故事")).toHaveLength(5);
  expect(data.groups.filter(g => g.family === "品牌故事")[0].moduleType).toBe(
    "轮播背景"
  );
});
it("reorganizes legacy wrappers deterministically without changing image IDs or manual content", () => {
  const groups = [
    makeOutlineGroup("主图", "主图", 1),
    makeOutlineGroup("主图", "主图", 1),
    makeOutlineGroup("主图", "主图", 1),
    makeOutlineGroup("主图", "附图", 7),
  ];
  groups[1].items[0].content = "运营的第二个主图方案";
  groups[1].items[0].manualFields = ["content"];
  const old = { ...emptyImageOutline(), groups },
    next = moduleOutline(old);
  expect(next.groups).toHaveLength(8);
  expect(next.groups.flatMap(g => g.items)).toEqual(
    old.groups.flatMap(g => g.items)
  );
  expect(moduleOutline(old)).toEqual(next);
  expect(moduleOutline(next)).toEqual(next);
  expect(imageOutlineSchema.safeParse(next).success).toBe(true);
});
it("merges adjacent A+ content, associations and reference choices into a double-height canvas", () => {
  const data = {
    ...emptyImageOutline(),
    referenceSets: [7],
    groups: [
      makeOutlineGroup("高级A+", "四列图片"),
      makeOutlineGroup("高级A+", "全宽背景图"),
      makeOutlineGroup("高级A+", "全宽背景图"),
    ],
  };
  data.groups.forEach((g, index) =>
    g.items.forEach((item, i) => {
      item.content = `模块${index + 1}内容${i + 1}`;
      item.references = [{ setId: 7, imageId: index * 10 + i + 1 }];
    })
  );
  const next = mergeAplusModules(
      data,
      data.groups[0].id,
      data.groups[1].id,
      "full"
    ),
    first = next.groups[0];
  expect(moduleLabels(next.groups)).toEqual(["A+1+2", "A+3"]);
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({
    width: 1464,
    height: 1200,
    mobileHeight: 900,
  });
  for (const item of data.groups.slice(0, 2).flatMap(g => g.items))
    expect(first.items[0].content).toContain(item.content);
  expect(first.mergedParts?.flatMap(p => p.items)).toHaveLength(5);
  expect(first.items[0].references).toHaveLength(5);
  const again = mergeAplusModules(
    next,
    next.groups[0].id,
    next.groups[1].id,
    "full"
  );
  expect(again.groups[0].items[0].height).toBe(1800);
  expect(moduleLabels(again.groups)).toEqual(["A+1+2+3"]);
});
it("turns two carousel modules into one carousel and preserves every original frame", () => {
  const a = makeOutlineGroup("高级A+", "图片轮播", 4),
    b = makeOutlineGroup("高级A+", "图片轮播", 6);
  [a, b].forEach((g, gi) =>
    g.items.forEach((i, n) => (i.content = `组${gi}图${n}`))
  );
  const result = mergeAplusModules(
    { ...emptyImageOutline(), groups: [a, b] },
    a.id,
    b.id,
    "carousel"
  );
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].moduleType).toBe("图片轮播");
  expect(result.groups[0].items).toHaveLength(6);
  for (const frame of result.groups[0].items) {
    expect(frame.content).toContain("组0");
    expect(frame.content).toContain("组1");
  }
  for (const i of [...a.items, ...b.items])
    expect(result.groups[0].items.map(v => v.content).join("\n")).toContain(
      i.content
    );
});
it("rejects non-adjacent merges and non-full-width layouts for merged modules", () => {
  const data = blankImageOutline(),
    groups = data.groups.filter(g => g.family === "高级A+");
  expect(() =>
    mergeAplusModules(data, groups[0].id, groups[2].id, "full")
  ).toThrow("相邻");
  const merged = mergeAplusModules(data, groups[0].id, groups[1].id, "full");
  merged.groups.find(g => g.mergedParts)!.moduleType = "四列图片";
  expect(imageOutlineSchema.safeParse(merged).success).toBe(false);
});
it("keeps orphaned detail documents and their manual reference purposes after merging", () => {
  const data = {
      ...emptyImageOutline(),
      groups: [
        makeOutlineGroup("高级A+", "全宽背景图"),
        makeOutlineGroup("高级A+", "全宽背景图"),
      ],
    },
    doc = emptyImageDocument(data);
  doc.entries[1].content = "人工修改的旧图";
  doc.entries[1].manualFields = ["content"];
  doc.entries[0].references.effect = [
    {
      reference: { source: "knowledge", imageId: 7, label: "第一次选择" },
      purpose: "借鉴光影",
    },
  ];
  doc.entries[1].references.effect = [
    {
      reference: { source: "knowledge", imageId: 7, label: "第二次选择" },
      purpose: "借鉴氛围",
    },
  ];
  const next = documentForOutline(
    doc,
    mergeAplusModules(data, data.groups[0].id, data.groups[1].id, "full")
  );
  expect(
    next.entries.find(e => e.imageId === doc.entries[1].imageId)!.content
  ).toBe("人工修改的旧图");
  expect(
    next.entries.find(e => e.imageId === doc.entries[1].imageId)!.manualFields
  ).toEqual(["content"]);
  const active = next.entries.find(
    e =>
      e.imageId !== doc.entries[0].imageId &&
      e.imageId !== doc.entries[1].imageId
  )!;
  expect(active.height).toBe(1200);
  expect(active.content).toContain("人工修改的旧图");
  expect(active.scenes).toHaveLength(2);
  expect(active.references.effect).toHaveLength(1);
  expect(active.references.effect[0].purpose).toBe("借鉴光影\n借鉴氛围");
  expect(imageDocumentSchema.safeParse(next).success).toBe(true);
});
it("does not turn an untouched empty scaffold into a protected human result", () => {
  const blank = recordManualOutline(emptyImageOutline(), blankImageOutline());
  expect(hasOutlineResult(blank)).toBe(false);
  const changed = structuredClone(blank);
  changed.groups[0].brief = "只展示六个口袋，不要按竞品八个口袋规划";
  expect(recordManualOutline(blank, changed).groups[0].manualFields).toContain(
    "brief"
  );
  expect(hasOutlineResult(changed)).toBe(true);
});
it("removes only unused empty scaffolds after AI creates new image IDs", () => {
  const outline = blankImageOutline(),
    old = emptyImageDocument(outline);
  old.entries[0].copy.body = "手动输入的信息仍须保留";
  old.entries[0].manualFields = ["copy.body"];
  const next = documentForOutline(old, blankImageOutline());
  expect(next.entries).toHaveLength(23);
  expect(
    next.entries.find(e => e.imageId === old.entries[0].imageId)?.copy.body
  ).toBe("手动输入的信息仍须保留");
});
