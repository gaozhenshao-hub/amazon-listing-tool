import { IMAGE_BELONG_HIERARCHY } from "./imageTagConstants";
import { AmazonImageLayoutSchema } from "./amazonImageLayout";
import { AMAZON_MODULE_CATALOG,LEGACY_IMAGE_BELONG_HIERARCHY } from "./imageModuleSpecs";

export function imageBelongForPosition(position: string): string {
  return ({ main: "主图", secondary: "套图", aplus: "A+", brand_story: "品牌故事" } as Record<string, string>)[position] || "";
}

/** A position token is not a module subtype. Unknown source structures stay unset. */
export function validImageBelongSubtype(belong: string, value: unknown): string | null {
  const current=IMAGE_BELONG_HIERARCHY[belong],legacy=LEGACY_IMAGE_BELONG_HIERARCHY[belong];
  const options: readonly string[] = [...(Array.isArray(current)?current:[]),...(Array.isArray(legacy)?legacy:[])];
  return typeof value === "string" && options.includes(value) ? value : null;
}

/** Safe display normalization of the old gallery vocabulary, without writing
 * or guessing Basic/Premium from the appearance of an individual image. */
export function normalizedImageBelong(belong: string, sub: unknown, position?: string) {
  if (belong === "套图" || (!belong && position === "secondary")) return { belong:"主图",sub:"附图" };
  if (belong === "主图" || (!belong && position === "main")) return {belong:"主图",sub:validImageBelongSubtype("主图",sub)|| (position === "secondary"?"附图":"主图")};
  const parent=belong||imageBelongForPosition(position||"");
  return {belong:parent,sub:validImageBelongSubtype(parent,sub)||""};
}

/** Classification uses the captured module identity, never its pixels. */
export function imageBelongFromSource(role:string,layout:unknown,hash:string){
  if(role==="main"||role==="secondary")return {belong:"主图",sub:role==="main"?"主图":"附图"};
  const parsed=AmazonImageLayoutSchema.safeParse(layout);if(!parsed.success)return null;
  for(const module of parsed.data.modules.filter(m=>m.section===role)){
    if(module.background?.hash===hash&&role==="brand_story")return {belong:"品牌故事",sub:"轮播背景"};
    const card=module.cards.find(c=>c.images.some(i=>i.hash===hash));if(!card)continue;
    const type=role==="brand_story"?card.subtype:module.sourceType;
    const spec=AMAZON_MODULE_CATALOG.find(m=>m.officialType===type);
    if(spec)return {belong:spec.family,sub:spec.name};
  }return null;
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
