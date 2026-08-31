import { resolveWorkflowGuidance } from "../../knowledge/claimLedgerService";
import { listUnifiedArtifactVersions, registerUnifiedArtifact } from "../../ai_os/services/artifactLifecycle";
import {
  TRPCError,
  buildProductContext,
  db,
  ensureWriteAccess,
  loadEnrichedData,
  parseJsonOrThrow,
  protectedProcedure,
  resolveProjectAccess,
  runEmperorSkill,
  z,
} from "../routerContext";

const planningTypeSchema = z.enum([
  "listing.positioning.plan",
  "listing.title.structure.plan",
  "listing.bullet.fabe.plan",
  "listing.aplus.narrative.plan",
  "listing.qa.objection.plan",
  "listing.compliance.claim.gate",
]);

const distillationBindingSchema = z.object({
  ledgerKey: z.string().min(1).max(80).nullable().optional(),
  skillSlugs: z.array(z.string().min(1).max(128)).max(12).optional(),
});

const PLANNING_CONFIG: Record<z.infer<typeof planningTypeSchema>, { label: string; focus: string }> = {
  "listing.positioning.plan": { label: "Listing定位规划", focus: "输出目标受众、核心购买动机、差异化、优先主张和待验证风险。" },
  "listing.title.structure.plan": { label: "标题结构规划", focus: "输出标题信息优先级、关键词位置和合规约束；不得直接替换当前标题。" },
  "listing.bullet.fabe.plan": { label: "五点FABE规划", focus: "输出五点主题、Feature-Advantage-Benefit-Evidence映射及每点承载主张；不得直接生成或覆盖五点正文。" },
  "listing.aplus.narrative.plan": { label: "A+叙事规划", focus: "输出A+模块叙事、模块主张与证据需求；品牌故事必须单列，不能被当作A+第1至7模块。" },
  "listing.qa.objection.plan": { label: "QA异议规划", focus: "输出高价值买家异议、回答证据和风险边界；不得覆盖现有QA。" },
  "listing.compliance.claim.gate": { label: "主张合规门禁", focus: "输出主张证据覆盖、禁用表述、需人工确认项及通过条件；它是建议门禁，不自动删除文案。" },
};

function compact(value: unknown, max = 26_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max - 300)}\n[上下文已截断]` : text;
}

export const listingPlanningProcedures = {
  generatePlanningArtifact: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), planningType: planningTypeSchema, emphasis: z.string().max(4_000).optional(), distillationBinding: distillationBindingSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!input.distillationBinding.ledgerKey && !(input.distillationBinding.skillSlugs || []).length) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "生成规划前必须由用户显式选择至少一个已发布蒸馏Skill或已锁定Claim Ledger" });
      }
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      ensureWriteAccess(project, ctx.user);
      const workspaceId = Number(ctx.workspaceId || project.workspaceId || 0);
      if (!workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前项目缺少工作空间，无法解析受治理指导" });
      const [analyses, enrichedData, guidance] = await Promise.all([
        db.getCompetitorAnalysesByProject(input.projectId),
        loadEnrichedData(input.projectId),
        resolveWorkflowGuidance({ workspaceId, ...input.distillationBinding }),
      ]);
      const config = PLANNING_CONFIG[input.planningType];
      const baseContext = buildProductContext(project, analyses, enrichedData);
      const prompt = compact(`${baseContext}\n\n--- 用户显式选择的蒸馏指导（只读） ---\n${JSON.stringify(guidance)}\n\n--- 规划任务：${config.label} ---\n${config.focus}\n${input.emphasis?.trim() ? `用户重点：${input.emphasis.trim()}` : ""}\n仅输出一个JSON对象：{schema,planningType,summary,items,claimMappings,risks,requiresHumanReview:true}。items必须是可编辑建议数组；没有证据支持时标记为待验证，不得编造。`);
      const result = await runEmperorSkill<any>({
        skillSlug: "listing.sellingpoints.generate",
        userId: ctx.user.id,
        workspaceId,
        context: prompt,
        emphasis: input.emphasis,
        variables: { project, analyses, enrichedData, planningType: input.planningType, distillationGuidance: guidance },
        validate: parseJsonOrThrow,
      });
      const planning = { ...result.parsed, schema: "listing.planning-artifact/1.0", planningType: input.planningType, requiresHumanReview: true };
      const artifact = await registerUnifiedArtifact({
        workspaceId,
        domain: "listing",
        artifactKey: input.planningType,
        artifactType: "json",
        sourceType: "ai_output",
        sourceTable: "listing_projects",
        sourceRowId: input.projectId,
        projectId: input.projectId,
        runId: result.runId,
        userId: ctx.user.id,
        status: "draft",
        content: planning,
        metadata: { guidanceMode: "manual_selection_only", ledgerKey: input.distillationBinding.ledgerKey || null, skillSlugs: input.distillationBinding.skillSlugs || [] },
        failOnError: true,
      });
      return { planning, artifactRef: artifact?.ref || null, runId: result.runId, advisory: "规划工件仅供人工审阅和编辑；未写入、替换或解锁任何标题、五点、A+或QA内容。" };
    }),

  planningArtifacts: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), planningType: planningTypeSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      const workspaceId = Number(ctx.workspaceId || project.workspaceId || 0);
      if (!workspaceId) return [];
      const keys = input.planningType ? [input.planningType] : Object.keys(PLANNING_CONFIG);
      const versions = await Promise.all(keys.map((artifactKey) => listUnifiedArtifactVersions({ workspaceId, domain: "listing", artifactKey, sourceTable: "listing_projects", sourceRowId: input.projectId, projectId: input.projectId, includeContent: true, limit: 10 })));
      return versions.flat().map((artifact: any) => ({ ...artifact, advisory: "此规划仅供人工使用，不会自动覆盖现有Listing内容。" }));
    }),

  savePlanningArtifact: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), planningType: planningTypeSchema, planning: z.record(z.string(), z.unknown()), distillationBinding: distillationBindingSchema, editNote: z.string().max(2_000).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!input.distillationBinding.ledgerKey && !(input.distillationBinding.skillSlugs || []).length) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "保存规划版本时必须保留用户显式选择的蒸馏Skill或锁定Claim Ledger" });
      }
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      ensureWriteAccess(project, ctx.user);
      const workspaceId = Number(ctx.workspaceId || project.workspaceId || 0);
      const guidance = await resolveWorkflowGuidance({ workspaceId, ...input.distillationBinding });
      const planning = { ...input.planning, schema: "listing.planning-artifact/1.0", planningType: input.planningType, requiresHumanReview: true, editedAt: new Date().toISOString() };
      const artifact = await registerUnifiedArtifact({
        workspaceId,
        domain: "listing",
        artifactKey: input.planningType,
        artifactType: "json",
        sourceType: "user_edit",
        sourceTable: "listing_projects",
        sourceRowId: input.projectId,
        projectId: input.projectId,
        userId: ctx.user.id,
        status: "draft",
        content: planning,
        metadata: { guidanceMode: "manual_selection_only", ledgerKey: input.distillationBinding.ledgerKey || null, skillSlugs: input.distillationBinding.skillSlugs || [], editNote: input.editNote || null, selectedSkillCount: guidance.selectedSkills.length },
        failOnError: true,
      });
      return { planning, artifactRef: artifact?.ref || null, advisory: "人工修订已保存为新的规划草案版本；不会改写任何现有Listing内容。" };
    }),
};
