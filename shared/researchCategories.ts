/** The same purpose-based classification is used throughout product research. */
export const RESEARCH_CATEGORIES = [
  "core",
  "design",
  "details",
  "information",
] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];
export const researchCategories = {
  core: {
    name: "核心功能与质量",
    description:
      "产品最基本要完成的任务，以及保障任务完成的关键性能和基础质量。",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  design: {
    name: "设计与使用体验",
    description: "通过结构和使用方式的设计，让产品用起来更舒适、方便、顺手。",
    className: "border-blue-200 bg-blue-50 text-blue-900",
  },
  details: {
    name: "细节把控与配件",
    description:
      "产品局部细节、操作小设计及随附配件，体现使用便利和细节完成度。",
    className: "border-purple-200 bg-purple-50 text-purple-900",
  },
  information: {
    name: "必要性描述",
    description:
      "帮助买家了解、选择和正确使用产品的信息，包括说明书、适配清单、配件清单、产品尺寸及产品标注。",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
} satisfies Record<
  ResearchCategory,
  { name: string; description: string; className: string }
>;
/** Legacy data keeps every original word. This fallback is used only until a
 * person or the research assistant assigns a purpose-aware category. */
export function researchCategory(node: {
  category?: ResearchCategory;
  group?: string;
  text: string;
}): ResearchCategory {
  if (node.category) return node.category;
  if (node.group === "quality") return "core";
  if (node.group === "design") return "design";
  if (node.group === "detail") return "details";
  if (node.group === "information" || node.group === "necessary")
    return "information";
  if (/说明书|适配清单|配件清单|尺码表|尺寸表|标注图|使用指引/.test(node.text))
    return "information";
  if (/拉链|缝线|魔术贴|口袋|挂钩|附件|手套|配件/.test(node.text))
    return "details";
  if (/舒适|透气|视野|合身|穿脱|便捷|轻便|人体工学/.test(node.text))
    return "design";
  return "core";
}
export const differentiationClass =
  "border-yellow-400 bg-yellow-200 text-yellow-950 font-semibold";
export const PAGE_KEYS = [
  "selling",
  "reviews",
  "questions",
  "listing",
  "planning",
  "outline",
  "references",
] as const;
export type ResearchPage = (typeof PAGE_KEYS)[number];
