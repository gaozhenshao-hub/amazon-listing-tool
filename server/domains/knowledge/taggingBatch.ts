import { ImageTaggingCandidateSchema, IMAGE_TAGGING_TAG_FIELDS, IMAGE_TAGGING_OPTIONS, type ImageTaggingCandidate } from "../../../shared/imageTagging";
import { parseKnowledgeAnalysisJson } from "./legacyImageAnalysis";

/** The controlled vocabulary, rather than the model, owns an exact child's parent. */
function parentForChild(parent: string, child: string, hierarchy: Record<string, readonly string[]>) {
  if (!child || hierarchy[parent]?.includes(child)) return parent;
  const matches = Object.entries(hierarchy).filter(([, children]) => children.includes(child));
  return matches.length === 1 ? matches[0][0] : parent;
}

/** Validate each image independently: one malformed answer must not discard its neighbours. */
export function parseTaggingBatch(content: string, expectedIds: number[]): Map<number, ImageTaggingCandidate> {
  const parsed = parseKnowledgeAnalysisJson(content);
  const items = Array.isArray(parsed.items) ? parsed.items : expectedIds.length === 1 ? [{ ...parsed, imageId: expectedIds[0] }] : [];
  const result = new Map<number, ImageTaggingCandidate>(), seen = new Set<number>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>, id = Number(row.imageId);
    if (!Number.isSafeInteger(id) || !expectedIds.includes(id)) continue;
    if (seen.has(id)) { result.delete(id); continue; }
    seen.add(id);
    const value = Object.fromEntries([...IMAGE_TAGGING_TAG_FIELDS, "accentColor", "evidence"].map(key => [key, typeof row[key] === "string" ? row[key].trim() : ""]));
    value.tagImageTypeMain = parentForChild(value.tagImageTypeMain, value.tagImageTypeSub, IMAGE_TAGGING_OPTIONS.imageTypes);
    value.tagSellingPointCategory = parentForChild(value.tagSellingPointCategory, value.tagSellingPointDetail, IMAGE_TAGGING_OPTIONS.sellingPoints);
    // The first colour is the model's primary colour; preserve the original response in the run log.
    for (const key of ["tagColorSchemeV2", "accentColor"]) {
      if (!(IMAGE_TAGGING_OPTIONS.colors as readonly string[]).includes(value[key])) {
        const colors = value[key].split(/[,，、/]/).map(color => color.trim());
        if (colors.length > 1 && colors.every(color => (IMAGE_TAGGING_OPTIONS.colors as readonly string[]).includes(color))) value[key] = colors[0];
      }
    }
    const candidate = ImageTaggingCandidateSchema.safeParse(value);
    if (candidate.success && candidate.data.tagComposition && candidate.data.tagImageTypeMain) result.set(id, candidate.data);
  }
  return result;
}
