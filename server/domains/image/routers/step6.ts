import { resolveWorkflowGuidance } from "../../knowledge/claimLedgerService";
import {
  callImageWorkflowSkill,
  db,
  ensureWriteAccess,
  protectedProcedure,
  resolveProjectAccess,
  resolveSessionAccess,
  resolveSessionForExecution,
  z,
} from "../routerContext";

const bindingSchema = z.object({
  ledgerKey: z.string().min(1).max(80).nullable().optional(),
  skillSlugs: z.array(z.string().min(1).max(128)).max(12).optional(),
});

export function parsePromptDraft(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Step6必须返回结构化提示词JSON对象");
  const prompts = (value as any).prompts || (value as any).imagePrompts || (value as any).items;
  if (!Array.isArray(prompts) || prompts.length === 0) throw new Error("Step6结果缺少可编辑的prompts数组");
  return { ...(value as Record<string, unknown>), prompts, requiresHumanReview: true, schema: "image.prompt-pack/1.0" };
}

export const imageStep6Procedures = {
  generateStep6Prompts: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), distillationBinding: bindingSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step6.prompt:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5Confirmed) throw new Error("请先人工确认Step5图片建议，再生成Step6提示词");
      const workspaceId = Number(ctx.workspaceId || project.workspaceId || 0);
      const hasGuidance = Boolean(input.distillationBinding?.ledgerKey || input.distillationBinding?.skillSlugs?.length);
      const guidance = hasGuidance ? await resolveWorkflowGuidance({ workspaceId, ...input.distillationBinding }) : null;
      const step5 = String(session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult || "").slice(0, 24_000);
      const result = await callImageWorkflowSkill({
        skillSlug: "image.step6.prompt",
        userId: ctx.user.id,
        workspaceId,
        systemPrompt: "你是亚马逊图片制作提示词编排师。只输出结构化JSON，不生成图片。每条提示词必须是可由人编辑的生产建议，包含目标图片、英文prompt、负面约束、主张引用和人工复核标记。",
        context: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n\n--- 已人工确认的Step5图片建议 ---\n${step5}\n${guidance ? `\n--- 用户显式选择的知识蒸馏指导（只读） ---\n${JSON.stringify(guidance).slice(0, 6_000)}` : ""}\n\n请为主图、辅图2-7、每个A+模块以及独立品牌故事分别输出可编辑提示词。brandStory必须独立于A+模块。严格输出：{summary:string,prompts:[{target:string,englishPrompt:string,negativeConstraints:string[],claimKeys:string[],reviewNote:string}]}`,
        maxModelAttempts: 3,
        validate: parsePromptDraft,
      });
      await db.updateImageWorkflowSession(session.id, {
        step6AiResult: JSON.stringify(result),
        step6AiResultCn: null,
        step6UserEdit: null,
        step6Confirmed: 0,
        currentStep: 6,
        status: "in_progress",
      });
      return { prompts: result, advisory: "Step6提示词仅为可编辑草案；未生成图片、未替换任何已锁定内容。" };
    }),

  saveStep6Draft: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), userEdit: z.string().min(2).max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const draft = parsePromptDraft(JSON.parse(input.userEdit));
      await db.updateImageWorkflowSession(session.id, { step6UserEdit: JSON.stringify(draft), step6Confirmed: 0, currentStep: 6, status: "in_progress" });
      return { success: true };
    }),

  confirmStep6: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), userEdit: z.string().min(2).max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const draft = parsePromptDraft(JSON.parse(input.userEdit));
      await db.updateImageWorkflowSession(session.id, { step6UserEdit: JSON.stringify(draft), step6Confirmed: 1, currentStep: 6, status: "completed" });
      return { success: true };
    }),

  unlockStep6: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      await db.updateImageWorkflowSession(session.id, { step6Confirmed: 0, currentStep: 6, status: "in_progress" });
      return { success: true };
    }),
};
