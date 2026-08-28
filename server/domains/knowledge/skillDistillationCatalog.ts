import { DISTILLATION_SKILL_CATALOG, type DistillationSkillType } from "./skillDistillationContracts";

const nodeMap: Record<string, string[]> = {
  "knowledge.evidence.curate": ["蒸馏工作台：来源与证据"],
  "listing.structure.distill": ["蒸馏工作台：Listing规则草案"],
  "image.visual-system.distill": ["蒸馏工作台：图片规则草案"],
  "listing.image.pattern.distill": ["Claim Ledger：协同模式"],
  "knowledge.rule.conflict.review": ["草案审查：冲突清单"],
  "knowledge.skill.evaluation": ["Skill治理：反馈与评估"],
  "listing.positioning.plan": ["Listing：定位规划"],
  "listing.title.structure.plan": ["Listing：标题规划"],
  "listing.bullet.fabe.plan": ["Listing：五点精雕"],
  "listing.aplus.narrative.plan": ["Listing：A+规划"],
  "listing.qa.objection.plan": ["Listing：QA规划"],
  "listing.compliance.claim.gate": ["Listing：发布前合规检查"],
  "image.selling-point.plan": ["图片 Step 1：卖点梳理"],
  "image.outline.storyboard.plan": ["图片 Step 2：图片大纲"],
  "image.style-system.plan": ["图片 Step 3：风格确认"],
  "image.reference-brief.plan": ["图片 Step 4：参考图"],
  "image.content-spec.plan": ["图片 Step 5：内容建议"],
  "image.prompt-brief.plan": ["图片 Step 6：提示词"],
  "listing.image.claim-ledger": ["Listing与图片：主张账本"],
  "listing.image.coherence.check": ["Listing与图片：一致性检查"],
  "listing.image.change-impact": ["Listing与图片：解锁/变更影响"],
  "knowledge.skill.source-health": ["Skill治理：来源健康度"],
};

const boundaries: Record<string, string> = {
  "knowledge.evidence.curate": "只选择已确认且共享的知识引用，不读取皇帝记忆，不自动创建证据。",
  "knowledge.rule.conflict.review": "只生成冲突提示，人工决定保留、拆分或拒绝。",
  "knowledge.skill.evaluation": "只记录人工采纳与编辑反馈，不自动改写已发布版本。",
  "listing.image.claim-ledger": "只在人工锁定后提供给下游，不能覆盖五点、A+或图片内容。",
  "listing.image.coherence.check": "只输出差异与缺证据提示，不自动调整业务内容。",
  "listing.image.change-impact": "只展示解锁/修改影响，不执行联动修改。",
};

export function getDistillationCatalog() {
  return DISTILLATION_SKILL_CATALOG.map(([skillTypeKey, name, group, priority]) => ({
    skillTypeKey,
    name,
    group,
    priority,
    workflowNodes: nodeMap[skillTypeKey] || [],
    humanBoundary: boundaries[skillTypeKey] || "所有输出均为可编辑候选；只有经超级管理员审批的版本可以发布。",
    lifecycle: "blueprint_only" as const,
  }));
}

export function defaultManifestForSkillType(skillTypeKey: DistillationSkillType) {
  const definition = getDistillationCatalog().find((entry) => entry.skillTypeKey === skillTypeKey);
  return {
    implementation: {
      systemPrompt: `你正在执行“${definition?.name || skillTypeKey}”。只可使用经人工批准的Evidence Card；输出严格符合契约；不得编造数据、覆盖用户内容或发布Skill。`,
      userPromptTemplate: "{{context}}",
      modelPolicy: "manual_selection_required",
      tools: [],
      knowledge: { source: "approved_evidence_only" },
    },
    contract: {
      mode: "review_required",
      inputSchema: { profile: "DistillationProfile", evidenceKeys: "string[]" },
      outputSchema: { rules: "array", rationale: "array", conflicts: "array", requiresHumanReview: true },
      timeoutMs: 120000,
    },
  };
}
