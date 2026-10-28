import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";

type Image = { imagePosition: string; tagCategory?: string | null; tagDesignStyleV2?: string | null; tagColorSchemeV2?: string | null; accentColor?: string | null };
function dominant(values: Array<string | null | undefined>, allowed: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) if (value && allowed.includes(value)) counts.set(value, (counts.get(value) || 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return ranked.length && (!ranked[1] || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}

/** Derive missing card/group labels from actual image tags; never invent a score or a recommended palette. */
export function summarizeSetTags(images: Image[]) {
  const content = images.filter(image => image.imagePosition !== "brand_story");
  const primary = dominant(content.map(image => image.tagColorSchemeV2), IMAGE_TAGGING_OPTIONS.colors);
  return {
    setCategory: dominant(content.map(image => image.tagCategory), IMAGE_TAGGING_OPTIONS.categories),
    setStyle: dominant(content.map(image => image.tagDesignStyleV2), IMAGE_TAGGING_OPTIONS.styles),
    setPrimaryColor: primary,
    setAccentColor: dominant(content.map(image => image.accentColor === primary ? null : image.accentColor), IMAGE_TAGGING_OPTIONS.colors),
  };
}
