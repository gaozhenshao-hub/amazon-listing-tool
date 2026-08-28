export const DISTILLATION_SKILL_CATALOG = [
  ["knowledge.evidence.curate", "知识证据筛选", "蒸馏治理", "P0"],
  ["listing.structure.distill", "Listing结构蒸馏", "蒸馏治理", "P0"],
  ["image.visual-system.distill", "图片视觉系统蒸馏", "蒸馏治理", "P0"],
  ["listing.image.pattern.distill", "文图协同模式蒸馏", "蒸馏治理", "P1"],
  ["knowledge.rule.conflict.review", "规则冲突审查", "蒸馏治理", "P0"],
  ["knowledge.skill.evaluation", "Skill反馈评估", "蒸馏治理", "P3"],
  ["listing.positioning.plan", "Listing定位规划", "Listing", "P1"],
  ["listing.title.structure.plan", "标题结构规划", "Listing", "P1"],
  ["listing.bullet.fabe.plan", "五点FABE规划", "Listing", "P1"],
  ["listing.aplus.narrative.plan", "A+叙事规划", "Listing", "P1"],
  ["listing.qa.objection.plan", "QA异议规划", "Listing", "P2"],
  ["listing.compliance.claim.gate", "主张合规门禁", "Listing", "P1"],
  ["image.selling-point.plan", "图片卖点规划", "图片", "P2"],
  ["image.outline.storyboard.plan", "图片大纲分镜规划", "图片", "P2"],
  ["image.style-system.plan", "视觉风格系统规划", "图片", "P2"],
  ["image.reference-brief.plan", "参考图任务简报", "图片", "P2"],
  ["image.content-spec.plan", "图片内容规格规划", "图片", "P2"],
  ["image.prompt-brief.plan", "图片提示词简报", "图片", "P2"],
  ["listing.image.claim-ledger", "文图主张账本", "协同治理", "P1"],
  ["listing.image.coherence.check", "文图一致性检查", "协同治理", "P2"],
  ["listing.image.change-impact", "文图变更影响分析", "协同治理", "P2"],
  ["knowledge.skill.source-health", "来源健康度监测", "协同治理", "P3"],
] as const;

export type SkillPriority = (typeof DISTILLATION_SKILL_CATALOG)[number][3];
export type DistillationSkillType = (typeof DISTILLATION_SKILL_CATALOG)[number][0];

export const PROFILE_DIMENSIONS = ["domain", "descriptionMode", "expressionDirection", "productCategory", "style", "market", "audience", "productConditions"] as const;
export type DistillationProfile = Record<(typeof PROFILE_DIMENSIONS)[number], string | string[]>;

export const DISTILLATION_DRAFT_TRANSITIONS = {
  draft: ["conflict", "review", "rejected"],
  conflict: ["draft", "review", "rejected"],
  review: ["approved", "rejected", "conflict"],
  approved: ["published", "review"],
  rejected: ["draft"],
  published: ["superseded"],
  superseded: [],
} as const;

export type DistillationDraftStatus = keyof typeof DISTILLATION_DRAFT_TRANSITIONS;

export function isDistillationSkillType(value: string): value is DistillationSkillType {
  return DISTILLATION_SKILL_CATALOG.some(([skillTypeKey]) => skillTypeKey === value);
}

export function canTransitionDraft(from: DistillationDraftStatus, to: DistillationDraftStatus) {
  return (DISTILLATION_DRAFT_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function normalizeDistillationProfile(input: Partial<DistillationProfile>): DistillationProfile {
  return {
    domain: input.domain || "product_knowledge",
    descriptionMode: input.descriptionMode || "fact_specification",
    expressionDirection: input.expressionDirection || "core_value",
    productCategory: input.productCategory || "unclassified",
    style: input.style || "professional_trust",
    market: input.market || "US",
    audience: input.audience || "general",
    productConditions: input.productConditions || [],
  };
}

export function buildCatalogSummary() {
  return DISTILLATION_SKILL_CATALOG.map(([skillTypeKey, name, group, priority]) => ({ skillTypeKey, name, group, priority }));
}
