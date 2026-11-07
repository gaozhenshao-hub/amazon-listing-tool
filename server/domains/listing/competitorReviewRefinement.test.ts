import { beforeEach, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: run }));
import { refineExistingReviewGroups } from "./competitorReviewsV2";
import { reviewKey } from "./supplementalReviews";
const reviews = [
  { title: "Broken zip", body: "Zipper broke", rating: 1 },
  { title: "Split seam", body: "Seam split and zipper broke", rating: 1 },
  { title: "Solid fabric", body: "Thick fabric", rating: 5 },
];
const ids = reviews.map(reviewKey);
const input = () => ({
  userId: 2,
  workspaceId: 1,
  asin: "B012345678",
  reviews,
  imported: [],
  study: {
    reviewSampleCount: 10,
    reviews: [
      {
        name: "质量与做工",
        reason: "拉链坏、缝线脱落",
        sentiment: "negative",
        reviewIds: ids.slice(0, 2),
      },
      {
        name: "质量与做工",
        reason: "做工扎实，面料厚",
        sentiment: "positive",
        reviewIds: [ids[2]],
      },
    ],
  },
});
beforeEach(() => {
  run.mockReset();
  run.mockImplementation(async (request: any) => {
    const c = JSON.parse(request.context);
    return {
      parsed: request.validate(
        JSON.stringify(
          c.mode === "zipperEvidence"
            ? {
                items: c.reviews.map((r: any, i: number) => ({
                  id: r.id,
                  zipperProblem: true,
                  otherQualityProblem: i === 1,
                  reason: i === 0 ? "拉链断裂" : "拉链断裂且缝线开裂",
                })),
              }
            : {
                groups: c.groups.map((g: any) => ({
                  index: g.index,
                  name:
                    g.sentiment === "positive"
                      ? "做工扎实、面料厚"
                      : g.name.includes("拉链")
                        ? "拉链易坏、卡顿脱轨"
                        : "缝线易脱落开裂",
                  reason: g.reason,
                })),
              }
        )
      ),
    };
  });
});
it("splits zipper evidence without losing multi-issue reviews or moving existing indices", async () => {
  const result = await refineExistingReviewGroups(input());
  expect(result[0].reviewIds).toEqual([ids[1]]);
  expect(result[1].name).toBe("做工扎实、面料厚");
  expect(result[2]).toMatchObject({
    count: 2,
    percentage: 20,
    reviewIds: ids.slice(0, 2),
  });
  const context = JSON.parse(run.mock.calls[0][0].context);
  expect(context.reviews.map((r: any) => r.id)).toEqual(ids.slice(0, 2));
});
it("does not reclassify raw reviews when a zipper theme already exists", async () => {
  const value = input();
  value.study.reviews.push({
    name: "拉链问题",
    reason: "易坏",
    sentiment: "negative",
    reviewIds: [ids[0]],
  });
  await refineExistingReviewGroups(value);
  expect(run).toHaveBeenCalledTimes(1);
  expect(JSON.parse(run.mock.calls[0][0].context).mode).toBe("refineTitles");
});
it("rejects fabricated or omitted review IDs in the zipper split", async () => {
  run.mockImplementationOnce(async (request: any) => ({
    parsed: request.validate(
      JSON.stringify({
        items: [
          {
            id: "invented",
            zipperProblem: true,
            otherQualityProblem: false,
            reason: "虚构",
          },
        ],
      })
    ),
  }));
  await expect(refineExistingReviewGroups(input())).rejects.toThrow(
    "引用不完整"
  );
});
