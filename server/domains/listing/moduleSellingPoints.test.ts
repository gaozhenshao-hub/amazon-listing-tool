import { expect, it, vi } from "vitest";
vi.mock("../ai_os/services/skillRunner", () => ({
  safeParseSkillJSON: JSON.parse,
}));
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: vi.fn() }));
vi.mock("../knowledge/richContentTranslation", () => ({
  MEDIA_TRANSLATION_SKILL: "knowledge.media.translation.v1",
}));
import { prepareModuleSellingPoints } from "./moduleSellingPoints";
const hash = "a".repeat(64),
  bg = "b".repeat(64);
const input = {
  layout: {
    version: 2,
    modules: [
      {
        id: "story",
        section: "brand_story",
        kind: "brand_story",
        background: { hash: bg },
        cards: [
          {
            images: [{ hash }],
            blocks: [{ id: "body", text: "70% Cotton and 30% Polyester" }],
          },
        ],
      },
    ],
  },
  presentation: {
    version: 1 as const,
    generatedAt: "now",
    images: [],
    texts: [
      {
        id: "body",
        source: "70% Cotton and 30% Polyester",
        translation: "70%棉和30%涤纶",
        sellingPoints: ["涤棉面料"],
        sellingPointCategories: ["质量" as const],
      },
    ],
  },
  findings: [{ hash, sellingPoints: ["舒适面料", "全身防护"] }],
};
it("provides all sources to one synthesis call without OCR or modifying translations", async () => {
  const before = JSON.stringify(input);
  const run = vi.fn(async (c: any, s: any) => {
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0].copy).not.toContain("From the brand");
    expect(c.sources[0].images.map((i: any) => i.hash)).toEqual([hash]);
    expect(c.sources[0].images[0].observations).toContain("全身防护");
    expect(c.sources[0].texts[0].source).toContain("70%");
    return s.parse({
      reply: "统一整理",
      changes: [
        {
          key: "U1:sellingPoints",
          original: "",
          value: "70%棉30%涤纶、全身防护",
        },
        { key: "U1:sellingPointCategories", original: "", value: "质量、功能" },
      ],
    });
  });
  const result = await prepareModuleSellingPoints(input, run);
  expect(run).toHaveBeenCalledOnce();
  expect(result).toHaveLength(1);
  expect(result[0].sellingPoints).toEqual(["70%棉30%涤纶", "全身防护"]);
  expect(JSON.stringify(input)).toBe(before);
  expect(
    await prepareModuleSellingPoints(
      {
        ...input,
        presentation: { ...input.presentation, modulePoints: result },
      },
      run
    )
  ).toEqual(result);
  expect(run).toHaveBeenCalledOnce();
});
it("rejects invented fields, invalid categories and missing category pairs", async () => {
  for (const changes of [
    [{ key: "unknown", original: "", value: "杜撰" }],
    [
      { key: "U1:sellingPoints", original: "", value: "防护" },
      { key: "U1:sellingPointCategories", original: "", value: "医学" },
    ],
    [
      { key: "U1:sellingPoints", original: "", value: "防护、透气" },
      { key: "U1:sellingPointCategories", original: "", value: "功能" },
    ],
  ])
    await expect(
      prepareModuleSellingPoints(input, async (_c, s) =>
        s.parse({ reply: "", changes })
      )
    ).rejects.toThrow();
});
it("generates separate result identities for carousel cards", async () => {
  const layout = {
    version: 2,
    modules: [
      {
        id: "carousel",
        section: "aplus",
        kind: "carousel",
        cards: [{ images: [{ hash }] }, { images: [{ hash: bg }] }],
      },
    ],
  };
  const result = await prepareModuleSellingPoints(
    { ...input, layout },
    async (c: any, s) =>
      s.parse({
        reply: "",
        changes: c.sources.flatMap((source: any) => [
          {
            key: `${source.id}:sellingPoints`,
            original: "",
            value: `卡片${source.id}`,
          },
          {
            key: `${source.id}:sellingPointCategories`,
            original: "",
            value: "设计",
          },
        ]),
      })
  );
  expect(result.map(r => r.cardIndex)).toEqual([0, 1]);
  expect(new Set(result.map(r => r.id)).size).toBe(2);
});
