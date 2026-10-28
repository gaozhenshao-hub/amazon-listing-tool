import { describe, expect, it } from "vitest";
import { summarizeSetTags } from "./setTagSummary";
import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";

describe("image-backed set labels", () => {
  const image = { imagePosition: "secondary", tagCategory: IMAGE_TAGGING_OPTIONS.categories[0], tagDesignStyleV2: IMAGE_TAGGING_OPTIONS.styles[0], tagColorSchemeV2: "黑色", accentColor: "黄色" };
  it("uses actual non-brand images without changing palette to match a style", () => {
    expect(summarizeSetTags([image, image, { ...image, imagePosition: "brand_story", tagColorSchemeV2: "白色" }])).toEqual({ setCategory: image.tagCategory, setStyle: image.tagDesignStyleV2, setPrimaryColor: "黑色", setAccentColor: "黄色" });
  });
  it("does not invent a winning label for ties or invalid values", () => {
    expect(summarizeSetTags([image, { ...image, tagColorSchemeV2: "白色", accentColor: "蓝色" }]).setPrimaryColor).toBeNull();
    expect(summarizeSetTags([{ imagePosition: "main", tagCategory: "unsupported" }]).setCategory).toBeNull();
  });
});
