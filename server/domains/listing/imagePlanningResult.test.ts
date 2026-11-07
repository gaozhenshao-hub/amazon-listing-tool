import { it, expect, vi } from "vitest";
vi.mock("./imagePlanningSources", async () => {
  const actual = await vi.importActual<typeof import("./imagePlanningSources")>(
    "./imagePlanningSources"
  );
  return { validateOutlineLinks: actual.validateOutlineLinks };
});
import { parseImagePlanningResult } from "./imagePlanningResult";
import {
  blankImageOutline,
  makeOutlineGroup,
} from "../../../shared/imagePlanning";
import { emptyListingAggregation } from "../../../shared/listingAggregation";
import { validateOutlineLinks } from "./imagePlanningSources";
const outputItem = (item: any) => {
  const { id, references, ...fields } = item;
  return { ...fields, content: fields.content || "用实物特写展示画面" };
};
it("resolves old buyer-question references to the merged question without changing picture content", () => {
  const first = "11111111-1111-4111-8111-111111111111",
    second = "22222222-2222-4222-8222-222222222222";
  const data = blankImageOutline();
  data.groups[0].items[0].questionIds = [first, second];
  data.groups[0].items[0].content = "原有构图";
  validateOutlineLinks(data, {
    ...emptyListingAggregation(),
    questions: [
      {
        id: first,
        text: "综合选码问题",
        note: "",
        source: "inferred",
        mergedQuestionIds: [second],
      },
    ],
  });
  expect(data.groups[0].items[0]).toMatchObject({
    questionIds: [first],
    content: "原有构图",
  });
});
it("validates the complete first outline and resolves IDs only against upstream conclusions", () => {
  const base = blankImageOutline(),
    upstream = emptyListingAggregation();
  const output = {
    reply: "完成",
    groups: base.groups.map(g => {
      const { id, ...fields } = g;
      return { ...fields, items: g.items.map(outputItem) };
    }),
  };
  const result = parseImagePlanningResult(
    output,
    "generate",
    base,
    upstream,
    4
  );
  expect(result.data.sourceRevision).toBe(4);
  expect(result.data.groups[0].items[0].id).not.toBe(
    base.groups[0].items[0].id
  );
  output.groups.find(group => group.moduleType === "附图")!.items[0].benefitIds = [
    "11111111-1111-4111-8111-111111111111",
  ];
  expect(() =>
    parseImagePlanningResult(output, "generate", base, upstream, 4)
  ).toThrow("关联的上一级结论");
});
it("adjusts only the selected image and preserves dimensions elsewhere and all manual reference choices", () => {
  const base = blankImageOutline();
  base.referenceSets = [2];
  base.groups[0].items[0].references = [{ setId: 2, imageId: 9 }];
  const item = base.groups[0].items[0],
    selection = { groupId: base.groups[0].id, itemId: item.id };
  const result = parseImagePlanningResult(
    {
      reply: "调整当前图片",
      item: { ...outputItem(item), content: "正面白底，展示整体服装与配件" },
    },
    "adjust",
    base,
    emptyListingAggregation(),
    4,
    selection
  );
  expect(result.data.groups[0].items[0]).toMatchObject({
    id: item.id,
    content: "正面白底，展示整体服装与配件",
    references: item.references,
  });
  expect(result.data.groups[0].items.slice(1)).toEqual(
    base.groups[0].items.slice(1)
  );
  expect(result.data.groups.slice(1)).toEqual(base.groups.slice(1));
  expect(base.groups[0].items[0].content).toBe("");
});
it("can clarify without silently changing any result", () => {
  const base = blankImageOutline(),
    selection = {
      groupId: base.groups[0].id,
      itemId: base.groups[0].items[0].id,
    };
  expect(
    parseImagePlanningResult(
      { reply: "希望展示哪个角度？", item: null },
      "adjust",
      base,
      emptyListingAggregation(),
      4,
      selection
    ).data
  ).toEqual(base);
});
it("ignores model-provided identities and references while accepting absent mobile dimensions", () => {
  const base = blankImageOutline(),
    item = base.groups[0].items[0],
    selection = { groupId: base.groups[0].id, itemId: item.id };
  const output = {
    ...outputItem(item),
    id: "model-id",
    references: [{ setId: 99, imageId: 9 }],
    mobileWidth: null,
    mobileHeight: null,
  };
  const result = parseImagePlanningResult(
    { reply: "完成", item: output },
    "adjust",
    base,
    emptyListingAggregation(),
    1,
    selection
  );
  expect(result.data.groups[0].items[0]).toMatchObject({
    id: item.id,
    references: [],
  });
  expect(result.data.groups[0].items[0].mobileWidth).toBeUndefined();
});
it("keeps every FAQ paragraph in one text slot and unfolds sibling Brand Story cards", () => {
  const base = blankImageOutline();
  const groups = base.groups.map(g => {
    const { id, ...fields } = g;
    return { ...fields, items: g.items.map(outputItem) };
  });
  const aplus = groups.findIndex(g => g.family === "高级A+");
  groups[aplus] = {
    ...groups[aplus],
    moduleType: "常见问题",
    items: [
      {
        ...outputItem(base.groups[0].items[0]),
        content: "问题一：如何选码？",
        width: 0,
        height: 0,
      },
      {
        ...outputItem(base.groups[0].items[0]),
        content: "问题二：如何清洁？",
        width: 0,
        height: 0,
      },
    ],
  };
  const story = groups.filter(
    g => g.family === "品牌故事" && g.moduleType === "品牌焦点图片"
  );
  const merged = groups.filter(g => !story.includes(g));
  merged.push({ ...story[0], items: story.flatMap(g => g.items) });
  const result = parseImagePlanningResult(
    { reply: "完成", groups: merged },
    "generate",
    base,
    emptyListingAggregation(),
    1
  );
  const faq = result.data.groups.find(g => g.moduleType === "常见问题")!;
  expect(faq.items).toHaveLength(1);
  expect(faq.items[0].content).toContain("如何选码");
  expect(faq.items[0].content).toContain("如何清洁");
  expect(
    result.data.groups.filter(
      g => g.family === "品牌故事" && g.moduleType === "品牌焦点图片"
    )
  ).toHaveLength(4);
});
it("accepts both official hotspot modules with one desktop image and three mobile details", () => {
  for (const type of ["热点图片", "热点图文"]) {
    const base = blankImageOutline(),
      hotspot = makeOutlineGroup("高级A+", type);
    expect(hotspot.items).toHaveLength(4);
    expect(hotspot.items[0]).toMatchObject({ width: 1464, height: 600 });
    expect(
      hotspot.items.slice(1).every(i => i.width === 600 && i.height === 450)
    ).toBe(true);
    base.groups[base.groups.findIndex(g => g.family === "高级A+")] = hotspot;
    const groups = base.groups.map(g => {
      const { id, ...fields } = g;
      return { ...fields, items: g.items.map(outputItem) };
    });
    const result = parseImagePlanningResult(
      { reply: "完成", groups },
      "generate",
      base,
      emptyListingAggregation(),
      1
    );
    expect(
      result.data.groups.find(g => g.moduleType === type)!.items
    ).toHaveLength(4);
  }
});
it("supports two through six hotspot detail images and rejects a seventh detail", () => {
  for (const count of [3, 7, 8]) {
    const base = blankImageOutline();
    base.groups[base.groups.findIndex(g => g.family === "高级A+")] =
      makeOutlineGroup("高级A+", "热点图片", count);
    const groups = base.groups.map(g => {
      const { id, ...fields } = g;
      return { ...fields, items: g.items.map(outputItem) };
    });
    const parse = () =>
      parseImagePlanningResult(
        { reply: "完成", groups },
        "generate",
        base,
        emptyListingAggregation(),
        1
      );
    if (count === 8) expect(parse).toThrow("图片数量与模块不匹配");
    else
      expect(
        parse().data.groups.find(g => g.moduleType === "热点图片")!.items
      ).toHaveLength(count);
  }
});
it("unpacks a whole Brand Story container into its exact documented background and card slots", () => {
  const base = blankImageOutline(),
    groups = base.groups.map(g => {
      const { id, ...fields } = g;
      return { ...fields, items: g.items.map(outputItem) };
    });
  const stories = groups.filter(g => g.family === "品牌故事"),
    other = groups.filter(g => g.family !== "品牌故事");
  const output = {
    reply: "完成",
    groups: [
      ...other,
      {
        ...stories[0],
        moduleType: "品牌故事",
        items: stories.flatMap(g => g.items),
      },
    ],
  };
  const result = parseImagePlanningResult(
    output,
    "generate",
    base,
    emptyListingAggregation(),
    1
  );
  expect(
    result.data.groups
      .filter(g => g.family === "品牌故事")
      .map(g => g.moduleType)
  ).toEqual([
    "轮播背景",
    "品牌焦点图片",
    "品牌焦点图片",
    "品牌焦点图片",
    "品牌焦点图片",
  ]);
  output.groups.at(-1)!.items[1].width = 999;
  expect(() =>
    parseImagePlanningResult(
      output,
      "generate",
      base,
      emptyListingAggregation(),
      1
    )
  ).toThrow("品牌故事需要分别规划轮播背景与卡片");
});
it("trusts saved product research without adding attribute-sheet warnings", () => {
  const base = blankImageOutline(),
    item = base.groups[0].items[0],
    selection = { groupId: base.groups[0].id, itemId: item.id },
    featureId = "11111111-1111-4111-8111-111111111111";
  const upstream = emptyListingAggregation();
  upstream.features = [
    {
      id: featureId,
      text: "三层面料",
      group: "quality",
      note: "",
      evidence: [
        {
          kind: "image",
          sourceKey: "competitor:image",
          quote: "竞品三层网",
          basis: "direct",
        },
      ],
    },
  ];
  const output = {
    reply: "完成",
    item: {
      ...outputItem(item),
      content: "面料剖面图",
      featureIds: [featureId],
    },
  };
  const pending = parseImagePlanningResult(
    output,
    "adjust",
    base,
    upstream,
    1,
    selection
  );
  expect(pending.data.groups[0].items[0].content).toBe("面料剖面图");
  expect(pending.data.groups[0].items.slice(1)).toEqual(
    base.groups[0].items.slice(1)
  );
  upstream.features[0].evidence![0] = {
    kind: "user",
    sourceKey: "PRODUCT:notes",
    quote: "本品三层面料",
    basis: "user",
  };
  expect(
    parseImagePlanningResult(output, "adjust", base, upstream, 1, selection)
      .data.groups[0].items[0].content
  ).toBe("面料剖面图");
});

it("accepts complete individual parts and rejects mixed or incomplete parts", () => {
  const base = blankImageOutline(),
    upstream = emptyListingAggregation();
  const family = "品牌故事";
  const groups = base.groups
    .filter(group => group.family === family)
    .map(({ id, ...group }) => ({
      ...group,
      items: group.items.map(outputItem),
    }));
  const parse = (value: unknown) =>
    parseImagePlanningResult(
      value,
      "generate",
      base,
      upstream,
      4,
      undefined,
      undefined,
      family
    );
  const result = parse({ reply: "品牌故事", groups });
  expect(result.data.groups).toHaveLength(5);
  expect(result.data.groups.every(group => group.family === family)).toBe(true);
  expect(() =>
    parse({ reply: "少一个卡片", groups: groups.slice(0, 4) })
  ).toThrow("后面4组");
});
