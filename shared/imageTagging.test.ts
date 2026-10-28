import { describe, expect, it } from "vitest";
import { ImageTaggingCandidateSchema } from "./imageTagging";

const tags = { tagCategory: "五金工具", tagImageTypeMain: "细节", tagImageTypeSub: "单一特写", tagSellingPointCategory: "质量",
  tagSellingPointDetail: "防水", tagComposition: "一分构图", tagColorSchemeV2: "白色", tagDesignStyleV2: "大厂工业极简风" };
const candidate = { ...tags, accentColor: "蓝色", evidence: "图中展示工具接头特写；未展示的性能不作推断。" };
describe("image tagging shared complete contract", () => {
  it("accepts all ten output fields without inventing empty missing evidence", () => {
    expect(ImageTaggingCandidateSchema.parse(candidate)).toEqual(candidate);
    const { evidence: _e, ...missing } = candidate; expect(ImageTaggingCandidateSchema.safeParse(missing).success).toBe(false);
  });
  it.each(["tagCategory", "tagImageTypeMain", "tagComposition", "tagColorSchemeV2", "tagDesignStyleV2", "accentColor"])("rejects invented %s", field => {
    expect(ImageTaggingCandidateSchema.safeParse({ ...candidate, [field]: "invented" }).success).toBe(false);
  });
  it.each([{ tagImageTypeMain: "", tagImageTypeSub: "单一特写" }, { tagSellingPointDetail: "更牛逼" }, { tagSellingPointCategory: "功能", tagSellingPointDetail: "防水" }])("rejects cross-parent or vague labels %j", patch => {
    expect(ImageTaggingCandidateSchema.safeParse({ ...candidate, ...patch }).success).toBe(false);
  });
});
