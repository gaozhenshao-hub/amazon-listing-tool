import { AMAZON_MODULE_CATALOG } from "../../../shared/imageModuleSpecs";

/** Compact repeated competitor material, never the upstream association IDs or
 * the product facts supplied by the user. A marker makes every omission explicit. */
export function compactPlanningEvidence(value: unknown, limit = 9000) {
  let remaining = limit,
    omitted = false;
  const visit = (v: any, depth: number): any => {
    if (remaining <= 0 || depth > 7) {
      omitted = true;
      return "[资料已精简]";
    }
    if (typeof v === "string") {
      const size = Math.min(v.length, 800, remaining);
      remaining -= size;
      if (size < v.length) omitted = true;
      return v.slice(0, size) + (size < v.length ? "[后文已精简]" : "");
    }
    if (Array.isArray(v)) {
      if (v.length > 12) omitted = true;
      return v.slice(0, 12).map(x => visit(x, depth + 1));
    }
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(
            ([key]) =>
              !/url|storageKey|html|domSnapshot|position|bounds|coordinates/i.test(
                key
              )
          )
          .map(([key, x]) => [key, visit(x, depth + 1)])
      );
    return v;
  };
  const result = visit(value, 0);
  return { value: result, compacted: omitted };
}
const node = (n: any) => {
  const { position: _position, evidence, ...rest } = n;
  return {
    ...rest,
    claimScope:
      n.availability === "planned" || n.group === "improve"
        ? "待改进/待实现，不是本品当前能力"
        : "运营已保存确认的本品资料；人工修改优先，竞品原证据仅保留来源",
    evidence: evidence
      ?.slice(0, 3)
      .map((e: any) => ({
        ...e,
        quote: e.quote?.slice(0, 400),
        quoteTruncated: typeof e.quote === "string" && e.quote.length > 400,
      })),
    evidenceCount: evidence?.length,
  };
};
export function planningModelSources(input: any) {
  const { notes: _notes, ...product } = input.product;
  return {
    ...input,
    product,
    planningDefaults: {
      mainImageAlternatives: 3,
      secondaryImages: 7,
      premiumAPlusModules: 7,
      brandStorySections: 1,
      brandStoryModules: 5,
      secondaryModules: 7,
      explanation:
        "第一张主图提供3种备选构图方案，最终选1种；另有7张附图，因此规划10张商品图。默认7个高级A+模块位（允许相邻合并）和5个品牌故事模块（第1个为背景，其余为卡片）。图片策划先讨论方向，不提前输出整份大纲。",
    },
    contentRules:
      "模块brief写清模块目标与内部各图具体分工；逐图大纲content写清这张图要证明的事实和表现方向。功能与用户获益放关联卖点，好评差评与买家问题放用户关注；不得把两者写成长篇大纲正文。",
    factRules:
      "用户保存并编辑的卖点梳理就是完善的本品资料，不要求属性表。人工修改优先于竞品，如本品6口袋不可改回竞品8口袋。除明确待改进/待实现外，上级功能与获益可按本品已有能力规划，不要再标注本品资料待确认。原竞品证据仍属于竞品；不得另造认证、测试、品牌背景、配件或产品线。金属不等于黄铜，厚实不等于阻燃，不新增未确认的工艺、精确参数、使用年限、护理程序、价格优势或没有某配件的断言。历史AI建议不是本品事实，错误建议不延续。遵循planningDialogue中双方达成的方向。",
    selling: input.selling.map(node),
    features: input.features.map(node),
    competitors: input.competitors.map((c: any) => ({
      analysisId: c.analysisId,
      asin: c.asin,
      title: c.title,
      stale: c.stale,
      bullets: compactPlanningEvidence(c.bullets, 3500),
      imageFindings: compactPlanningEvidence(c.imageFindings, 4500),
      modules: compactPlanningEvidence(c.modules, 5500),
      layout: compactPlanningEvidence(c.layout, 2000),
    })),
  };
}
export const planningModelCatalog = AMAZON_MODULE_CATALOG.map(
  ({
    family,
    name,
    media,
    min,
    max,
    defaultCount,
    width,
    height,
    mobileWidth,
    mobileHeight,
    guidance,
    extraSizes,
  }) => ({
    family,
    name,
    media,
    min,
    max,
    defaultCount,
    width,
    height,
    mobileWidth,
    mobileHeight,
    guidance,
    extraSizes,
  })
);
