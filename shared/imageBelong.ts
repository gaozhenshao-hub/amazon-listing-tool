import { IMAGE_BELONG_HIERARCHY } from "./imageTagConstants";
import { AmazonImageLayoutSchema } from "./amazonImageLayout";

export function imageBelongForPosition(position: string): string {
  return ({ main: "主图", secondary: "套图", aplus: "A+", brand_story: "品牌故事" } as Record<string, string>)[position] || "";
}

/** A position token is not a module subtype. Unknown source structures stay unset. */
export function validImageBelongSubtype(belong: string, value: unknown): string | null {
  const options: readonly string[] = (IMAGE_BELONG_HIERARCHY as Record<string, readonly string[]>)[belong] || [];
  return typeof value === "string" && options.includes(value) ? value : null;
}

export function imageSubtypeFromLayout(layout: unknown, role: string, hash: string): string | null {
  if (role !== "aplus" && role !== "brand_story") return null;
  const parsed = AmazonImageLayoutSchema.safeParse(layout);
  if (!parsed.success) return null;
  for (const module of parsed.data.modules.filter(m => m.section === role)) {
    const card = module.cards.find(c => c.images.some(i => i.hash === hash));
    if (!card) continue; // Backgrounds are not story cards.
    if (role === "brand_story") return card.images.length === 4 ? "四图组合" : card.images.length === 1 ? "单图" : null;
    return validImageBelongSubtype("A+", module.subtype)
      || (module.kind === "carousel" ? "图片轮播" : module.kind === "comparison" ? "对比表格" : null);
  }
  return null;
}
