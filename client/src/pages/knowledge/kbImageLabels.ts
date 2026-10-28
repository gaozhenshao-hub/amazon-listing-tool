/** Display-only aliases: stored tags and filter values are never rewritten. */
export function imageTagLabel(value?: string | null): string {
  const label = value?.trim() || "";
  if (/^(?:a\+|a[\s_-]*plus)(?:[\s·/_-]*(?:a\+|a[\s_-]*plus))*$/i.test(label)) return "A+";
  const aliases: Record<string, string> = { main: "主图", secondary: "套图", brand_story: "品牌故事" };
  const key = label.toLowerCase();
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : label;
}

export function distinctImageTags(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(imageTagLabel).filter(Boolean))];
}

export function joinImageTags(...values: Array<string | null | undefined>): string {
  return distinctImageTags(values).join("·");
}

export function imageBelongLabel(image: {
  imageSetId?: number | null;
  tagImageBelong?: string | null;
  tagImageBelongSub?: string | null;
  imagePosition?: string | null;
}): string {
  return joinImageTags(imageTagLabel(image.tagImageBelong) || (image.imageSetId === null ? "" : image.imagePosition), image.tagImageBelongSub);
}
