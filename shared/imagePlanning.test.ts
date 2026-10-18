import { describe, expect, it } from "vitest";
import { ImagePlanningStartInputSchema, ImagePlanningApplyInputSchema, ImagePlanningOutlineSchema, normalizeImagePlanningOutline, imagePlanningCanonical } from "./imagePlanning";
const operationId = "11111111-1111-4111-8111-111111111111", runOperationId = "22222222-2222-4222-8222-222222222222", hash = "a".repeat(64);
const start = { expectedWorkspaceId: 7, projectId: 8, sessionId: 9, operationId, expectedSourceHash: hash, expectedRuntimeHash: hash, maxCostCents: 100, chargeConfirmed: true };
const outline = () => ({ mainImage: { purpose: "完整主图", contentBrief: "完整主图内容", retainedDetail: { noLoss: true } },
  secondaryImages: Array.from({ length: 6 }, (_, index) => ({ imageNumber: index + 2, purpose: "副图目的", contentBrief: `副图完整内容${index}` })),
  aPlusModules: Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 1, purpose: "A+目的", contentBrief: `A+完整内容${index}` })),
  brandStory: { theme: "品牌主题", contentBrief: "完整品牌故事" }, extraHumanField: "不得删除" });
describe("full Image Step2 domain contracts", () => {
  it("preserves full existing outline fields rather than reducing it to a summary", () => {
    const value = normalizeImagePlanningOutline(outline()); expect(value.extraHumanField).toBe("不得删除"); expect(value.mainImage.retainedDetail).toEqual({ noLoss: true }); expect(value.secondaryImages).toHaveLength(6); expect(value.aPlusModules).toHaveLength(7);
  });
  it.each(["main", "secondary", "aplus", "brand", "number", "oversize"])("rejects %s gaps before normalization can fill them", kind => {
    const value = outline();
    if (kind === "main") value.mainImage.contentBrief = " ";
    if (kind === "secondary") value.secondaryImages.pop();
    if (kind === "aplus") value.aPlusModules.pop();
    if (kind === "brand") value.brandStory.contentBrief = "";
    if (kind === "number") value.secondaryImages[0].imageNumber = 3;
    if (kind === "oversize") value.extraHumanField = "界".repeat(22000);
    expect(ImagePlanningOutlineSchema.safeParse(value).success).toBe(false); expect(() => normalizeImagePlanningOutline(value)).toThrow();
  });
  it.each(["modelSlug", "skillSlug", "source", "owner", "force"])("does not accept client authority %s", key => expect(ImagePlanningStartInputSchema.safeParse({ ...start, [key]: "client" }).success).toBe(false));
  it("requires explicit charge and separate human-apply UUID and confirmation", () => {
    expect(ImagePlanningStartInputSchema.safeParse({ ...start, chargeConfirmed: false }).success).toBe(false);
    const apply = { expectedWorkspaceId: 7, projectId: 8, sessionId: 9, operationId, runOperationId, expectedSourceHash: hash, expectedResultHash: hash, replaceDraftConfirmed: true };
    expect(ImagePlanningApplyInputSchema.parse(apply)).toEqual(apply);
    expect(ImagePlanningApplyInputSchema.safeParse({ ...apply, runOperationId: operationId }).success).toBe(false);
    expect(ImagePlanningApplyInputSchema.safeParse({ ...apply, replaceDraftConfirmed: false }).success).toBe(false);
  });
  it("rejects a whole oversized source instead of truncating it", () => expect(() => imagePlanningCanonical({ full: "x".repeat(2097152) })).toThrow());
});
