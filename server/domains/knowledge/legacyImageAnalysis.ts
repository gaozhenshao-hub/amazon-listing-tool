import { z } from "zod";
import { ImageTaggingTagsSchema, IMAGE_TAGGING_TAG_FIELDS } from "../../../shared/imageTagging";
import { IMAGE_BELONG_HIERARCHY, IMAGE_BELONG_OPTIONS } from "../../../shared/imageTagConstants";

/** Some compatible vision providers wrap otherwise valid JSON in Markdown. */
export function parseKnowledgeAnalysisJson(text: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
}

export function parseKnowledgeImageAnalysis(text: string) {
  const result = parseKnowledgeAnalysisJson(text);
  const tags = ImageTaggingTagsSchema.parse(Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, result[key] ?? ""])));
  // Reject an unrelated model response rather than clearing all existing tags.
  if (!tags.tagComposition || !tags.tagImageTypeMain || !tags.tagColorSchemeV2 || !tags.tagDesignStyleV2) throw new Error("图片分析未返回完整标签");
  const belong = z.string().refine(value => IMAGE_BELONG_OPTIONS.includes(value as never)).parse(result.tagImageBelong);
  const sub = z.string().max(100).parse(result.tagImageBelongSub ?? "");
  if (sub && (belong !== "A+" || !IMAGE_BELONG_HIERARCHY["A+"].includes(sub as never))) throw new Error("图片归属子类不匹配");
  return { ...result, ...tags, tagImageBelong: belong, tagImageBelongSub: sub,
    tagColorScheme: z.string().max(100).parse(result.tagColorScheme ?? tags.tagColorSchemeV2),
    tagImageType: z.string().max(100).parse(result.tagImageType ?? tags.tagImageTypeMain),
    tagDesignStyle: z.string().max(100).parse(result.tagDesignStyle ?? tags.tagDesignStyleV2),
    singleImageScore: z.number().min(0).max(10).parse(result.singleImageScore),
    highlights: z.array(z.string().max(1000)).max(20).parse(result.highlights ?? []) };
}
