import { z } from "zod";
import { CATEGORY_OPTIONS, COMPOSITION_OPTIONS, STYLE_NAME_OPTIONS,
  IMAGE_TYPE_HIERARCHY, SELLING_POINT_HIERARCHY, COLOR_TAG_OPTIONS } from "./imageTagConstants";


const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
export const IMAGE_TAGGING_TAG_FIELDS = ["tagCategory", "tagImageTypeMain", "tagImageTypeSub", "tagSellingPointCategory",
  "tagSellingPointDetail", "tagComposition", "tagColorSchemeV2", "tagDesignStyleV2"] as const;
const allowed = (options: readonly string[]) => z.string().max(100).refine(value => value === "" || options.includes(value), "Unknown tag option");
const typeMain = Object.keys(IMAGE_TYPE_HIERARCHY);
const sellingMain = Object.keys(SELLING_POINT_HIERARCHY);
export const IMAGE_TAGGING_OPTIONS = Object.freeze({ categories: CATEGORY_OPTIONS, imageTypes: IMAGE_TYPE_HIERARCHY,
  sellingPoints: Object.fromEntries(Object.entries(SELLING_POINT_HIERARCHY).map(([key, values]) => [key, values.filter(value => value !== "更牛逼")])),
  compositions: COMPOSITION_OPTIONS, colors: COLOR_TAG_OPTIONS, styles: STYLE_NAME_OPTIONS, accents: COLOR_TAG_OPTIONS });
const tags = z.object({ tagCategory: allowed(CATEGORY_OPTIONS), tagImageTypeMain: allowed(typeMain),
  tagImageTypeSub: z.string().max(100), tagSellingPointCategory: allowed(sellingMain), tagSellingPointDetail: z.string().max(100),
  tagComposition: allowed(COMPOSITION_OPTIONS), tagColorSchemeV2: allowed(COLOR_TAG_OPTIONS), tagDesignStyleV2: allowed(STYLE_NAME_OPTIONS) }).strict();
function hierarchy(value: z.infer<typeof tags>, ctx: z.RefinementCtx) {
  const sub = (IMAGE_TYPE_HIERARCHY as Record<string, readonly string[]>)[value.tagImageTypeMain] ?? [];
  const detail: readonly string[] = IMAGE_TAGGING_OPTIONS.sellingPoints[value.tagSellingPointCategory] ?? [];
  if (value.tagImageTypeSub !== "" && !sub.includes(value.tagImageTypeSub)) ctx.addIssue({ code: "custom", path: ["tagImageTypeSub"], message: "Image subtype does not belong to its parent" });
  if (value.tagSellingPointDetail !== "" && !detail.includes(value.tagSellingPointDetail)) ctx.addIssue({ code: "custom", path: ["tagSellingPointDetail"], message: "Selling point does not belong to its parent" });
}
export const ImageTaggingTagsSchema = tags.superRefine(hierarchy);
export type ImageTaggingTags = z.infer<typeof ImageTaggingTagsSchema>;
export const ImageTaggingCandidateSchema = tags.extend({ accentColor: allowed(COLOR_TAG_OPTIONS), evidence: text(1000) }).strict().superRefine(hierarchy);
export type ImageTaggingCandidate = z.infer<typeof ImageTaggingCandidateSchema>;
