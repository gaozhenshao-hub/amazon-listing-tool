import { describe, expect, it } from "vitest";
import { buildStep5OutlineSafetyFallback } from "./routerContext";

describe("Step 5 outline safety fallback", () => {
  it("retains legacy main-image and brand-story fields after normalizing the Step 2 outline", () => {
    const fallback = buildStep5OutlineSafetyFallback({
      productName: "测试产品",
      outline: {
        mainImage: { purpose: "展示产品全貌" },
        secondaryImages: [2, 3, 4, 5, 6, 7].map((imageNumber) => ({
          imageNumber,
          purpose: `辅图${imageNumber}卖点`,
          contentBrief: `辅图${imageNumber}内容`,
          expressionType: "信息图",
        })),
        aPlusModules: [],
        brandStoryModule: { title: "品牌传承", purpose: "品牌承诺" },
      },
    });

    expect(fallback.mainImage).toMatchObject({ concept: "展示产品全貌", primary: "展示产品全貌" });
    expect(fallback.brandStory).toMatchObject({ title: "品牌传承", content: "品牌承诺" });
  });
});
