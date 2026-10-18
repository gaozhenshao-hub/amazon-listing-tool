import { describe, expect, it } from "vitest";
import { ImageTaggingCandidateSchema, ImageTaggingExistingTagsSchema, ImageTaggingApplyInputSchema,
  imageTaggingEligibility, imageTaggingHash, IMAGE_TAGGING_TAG_FIELDS, ImageTaggingSourceSchema } from "./imageTagging";

const current = Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, null]));
const tags = { tagCategory: "五金工具", tagImageTypeMain: "细节", tagImageTypeSub: "单一特写", tagSellingPointCategory: "质量",
  tagSellingPointDetail: "防水", tagComposition: "居中构图", tagColorSchemeV2: "纯白极简", tagDesignStyleV2: "大厂工业极简风" };
const candidate = { ...tags, accentColor: "蓝色", evidence: "图中展示工具接头特写；未展示的性能不作推断。" };
const identity = { userId: 3, workspaceId: 7 }, operationId = "33333333-3333-4333-8333-333333333333";
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
  it("keeps unknown manual and intentionally blank legacy tags without charging again", () => {
    const existing = ImageTaggingExistingTagsSchema.parse({ ...current, tagCategory: "legacy-custom", tagImageTypeMain: "", tagDesignStyleV2: "" });
    expect(imageTaggingEligibility({ tags: existing, tagsConfirmed: false, analysisConfirmed: false }, "missing")).toBe("skipped_complete");
    expect(imageTaggingEligibility({ tags: existing, tagsConfirmed: false, analysisConfirmed: false }, "all_unconfirmed")).toBe("pending");
    for (const key of ["tagsConfirmed", "analysisConfirmed"]) expect(imageTaggingEligibility({ tags: existing, tagsConfirmed: false, analysisConfirmed: false, [key]: true }, "all_unconfirmed")).toBe("skipped_confirmed");
  });
  it("requires exact immutable source and unique complete image membership", () => {
    const body = { version: 1, identity, imageSetId: 9, set: { id: 9, userId: 3, workspaceId: 7, asin: "B000000001", title: "Tool", status: "confirmed", visibility: "private", originInstanceId: null, remoteId: null, syncVersion: 0, revisionHash: "a".repeat(64) },
      images: [{ id: 10, imageSetId: 9, imageUrl: "storage://oss/kb-images/tool.jpg", imagePosition: "main", positionIndex: 0, originalContentHash: null, revisionHash: "b".repeat(64), tagsConfirmed: false, analysisConfirmed: false, tags: current }] };
    expect(ImageTaggingSourceSchema.parse({ ...body, sourceHash: imageTaggingHash(body) }).images).toHaveLength(1);
    for (const patch of [{ sourceHash: "0".repeat(64) }, { images: [...body.images, ...body.images] }, { identity: { ...identity, userId: 4 } }]) expect(ImageTaggingSourceSchema.safeParse({ ...body, sourceHash: imageTaggingHash(body), ...patch }).success).toBe(false);
  });
  it("binds apply to a separate UUID and disallows duplicate decisions or unknown tags", () => {
    const value = { expectedWorkspaceId: 7, imageSetId: 9, operationId, runOperationId: "44444444-4444-4444-8444-444444444444", expectedSourceHash: "a".repeat(64), expectedResultHash: "b".repeat(64), decisions: [{ imageId: 10, candidateHash: imageTaggingHash(candidate), decision: "accept", tags }] };
    expect(ImageTaggingApplyInputSchema.safeParse(value).success).toBe(true);
    expect(ImageTaggingApplyInputSchema.safeParse({ ...value, decisions: [...value.decisions, ...value.decisions] }).success).toBe(false);
  });
});
