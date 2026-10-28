import { describe, expect, it } from "vitest";
import { IMAGE_TAGGING_OPTIONS, ImageTaggingTagsSchema } from "../shared/imageTagging";
import { IMAGE_BELONG_HIERARCHY, IMAGE_STYLES, COLOR_TAG_OPTIONS, COMPOSITION_GUIDANCE } from "../shared/imageTagConstants";

describe("established image library vocabulary", () => {
  it("keeps the established categories, two-level image/selling-point tags and sixteen styles", () => {
    expect(IMAGE_TAGGING_OPTIONS.categories).toHaveLength(18);
    expect(IMAGE_STYLES).toHaveLength(16);
    expect(Object.keys(IMAGE_BELONG_HIERARCHY)).toEqual(["主图", "套图", "A+", "品牌故事"]);
    expect(IMAGE_TAGGING_OPTIONS.imageTypes["对比"]).toContain("细节对比");
    expect(IMAGE_TAGGING_OPTIONS.sellingPoints["质量"]).toContain("防水");
  });
  it("uses actual colors instead of palette names and distinguishes panels from rule-of-thirds", () => {
    expect(IMAGE_TAGGING_OPTIONS.colors).toEqual(COLOR_TAG_OPTIONS);
    const tags = { tagCategory: "家居", tagImageTypeMain: "场景", tagImageTypeSub: "近景", tagSellingPointCategory: "", tagSellingPointDetail: "", tagComposition: "一拖二", tagColorSchemeV2: "白色", tagDesignStyleV2: "温馨家居风" };
    expect(ImageTaggingTagsSchema.safeParse(tags).success).toBe(true);
    expect(ImageTaggingTagsSchema.safeParse({ ...tags, tagColorSchemeV2: "莫兰迪色系" }).success).toBe(false);
    expect(COMPOSITION_GUIDANCE).toContain("三分构图不是摄影三分法");
  });
});
