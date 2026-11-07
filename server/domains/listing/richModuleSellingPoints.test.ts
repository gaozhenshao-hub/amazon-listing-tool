import { expect, it } from "vitest";
import { isAmazonPageNavigation } from "../../../shared/amazonContentText";
import {
  richTextSources,
  applyRichContentEdits,
  RichContentPresentationSchema,
} from "../../../shared/richContentPresentation";
import {
  moduleSellingPoints,
  richModuleTargets,
} from "../../../shared/richModuleSellingPoints";
import { competitorCurrentValues } from "../../../shared/competitorStudyFields";
const hash = (n: number) => String(n).repeat(64);
const block = (id: string, text: string) => ({ id, text, kind: "paragraph" });
const card = (n: number) => ({
  id: `card-${n}`,
  images: [{ hash: hash(n) }],
  blocks: [block(`text-${n}`, `Material ${n}`)],
});
const layout = {
  version: 2,
  modules: [
    {
      id: "aplus-1",
      section: "aplus",
      kind: "image",
      cards: [card(1)],
      blocks: [block("nav-prev", "Previous page"), block("heading", "Safety")],
    },
  ],
};
const study = {
  images: [
    {
      hash: hash(1),
      sellingPoints: ["优质面料", "全身防护"],
      sellingPointCategories: ["质量", "功能"],
    },
  ],
  richContent: {
    images: [],
    texts: [
      {
        id: "text-1",
        source: "Material 1",
        translation: "材料1",
        sellingPoints: ["优质面料", "透气"],
        sellingPointCategories: ["质量", "功能"],
      },
      {
        id: "heading",
        source: "Safety",
        translation: "安全",
        sellingPoints: ["全身防护"],
        sellingPointCategories: ["功能"],
      },
    ],
  },
};
it("combines image and native observations into one deduplicated legacy group", () => {
  const [target] = richModuleTargets(layout);
  expect(moduleSellingPoints(target, study).sellingPoints).toEqual([
    "优质面料",
    "全身防护",
    "透气",
  ]);
  expect(target.blocks.map(b => b.id)).toEqual(["heading", "text-1"]);
  expect(richTextSources(layout).map(b => b.id)).not.toContain("nav-prev");
});
it("treats four brand images as one card and excludes the background from its evidence", () => {
  const targets = richModuleTargets({
    version: 2,
    modules: [
      {
        id: "brand",
        section: "brand_story",
        kind: "brand_story",
        title: "From the brand",
        background: { hash: hash(5) },
        cards: [
          { images: [1, 2, 3, 4].map(n => ({ hash: hash(n) })) },
          card(6),
        ],
      },
    ],
  });
  expect(targets).toHaveLength(2);
  expect(targets[0].imageHashes).toEqual([1, 2, 3, 4].map(hash));
  expect(targets[0].copy).toEqual([]);
  expect(targets[1].cardIndex).toBe(1);
});
it("binds unified results to the exact copy and image bytes", () => {
  const [target] = richModuleTargets(layout, [
    { sourceHash: hash(1), contentHash: hash(7) },
  ]);
  const saved = {
    ...study,
    richContent: {
      ...study.richContent,
      modulePoints: [
        {
          id: target.id,
          moduleId: target.moduleId,
          sourceHash: target.sourceHash,
          sellingPoints: ["统一防护标签"],
          sellingPointCategories: ["功能"],
        },
      ],
    },
  };
  expect(moduleSellingPoints(target, saved).sellingPoints).toEqual([
    "统一防护标签",
  ]);
  const [changed] = richModuleTargets(layout, [
    { sourceHash: hash(1), contentHash: hash(8) },
  ]);
  expect(changed.id).toBe(target.id);
  expect(changed.sourceHash).not.toBe(target.sourceHash);
  expect(moduleSellingPoints(changed, saved).sellingPoints).toEqual([
    "优质面料",
    "全身防护",
    "透气",
  ]);
});
it("preserves valid previous human edits and only applies a module edit to its original result", () => {
  const [target] = richModuleTargets(layout);
  const edits = {
    [`image:${hash(1)}:sellingPoints`]: {
      original: "优质面料、全身防护",
      value: "用户确认的材料",
    },
  };
  const result = moduleSellingPoints(target, study, edits);
  expect(result.sellingPoints).toContain("用户确认的材料");
  expect(
    competitorCurrentValues(study, layout, edits)[
      `module:${target.id}:sellingPoints`
    ]
  ).toContain("用户确认的材料");
  const original = moduleSellingPoints(target, study).sellingPoints.join("、");
  expect(
    moduleSellingPoints(target, study, {
      [`module:${target.id}:sellingPoints`]: {
        original,
        value: "用户统一卖点",
      },
    }).sellingPoints
  ).toEqual(["用户统一卖点"]);
  expect(
    moduleSellingPoints(target, study, {
      [`module:${target.id}:sellingPoints`]: {
        original: "旧结果",
        value: "过期纠正",
      },
    }).sellingPoints
  ).not.toContain("过期纠正");
});
it("removes only carousel navigation labels while retaining meaningful copy and questions", () => {
  for (const label of [
    "Previous page",
    "Next page",
    "上一页",
    "下一页",
    " Previous\u00a0page ",
    "Previous page Next page",
  ])
    expect(isAmazonPageNavigation(label)).toBe(true);
  for (const text of [
    "Next page shows measurements",
    "What comes in the package?",
    "Previous experience is unnecessary",
    "Step 1",
    "Next generation material",
  ])
    expect(isAmazonPageNavigation(text)).toBe(false);
});

it("keeps translated content valid for import after shortening a module selling-point list", () => {
  const [target] = richModuleTargets(layout);
  const presentation = {
    version: 1,
    generatedAt: "now",
    images: [],
    texts: [],
    modulePoints: [
      {
        id: target.id,
        moduleId: target.moduleId,
        sourceHash: target.sourceHash,
        sellingPoints: ["面料耐用", "透气"],
        sellingPointCategories: ["质量", "功能"],
      },
    ],
  };
  const edited = applyRichContentEdits(presentation, {
    [`module:${target.id}:sellingPoints`]: {
      original: "面料耐用、透气",
      value: "透气",
    },
  });
  expect(RichContentPresentationSchema.safeParse(edited).success).toBe(true);
  expect(edited?.modulePoints?.[0]).toMatchObject({
    sellingPoints: ["透气"],
    sellingPointCategories: ["功能"],
  });
});
