import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";


// Helper: resolve dev project access based on user role
async function resolveDevProjectAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    const project = await devDb.getDevProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }
  const project = await devDb.getDevProjectById(projectId, user.id);
  if (!project) throw new Error("Project not found");
  return project;
}

export const devScoringRouter = router({
  generate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const reviewStats = await devDb.getDevReviewStats(input.projectId);
      const reports = await devDb.getDevReports(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);

      // Build comprehensive context
      const context = `项目: ${project.name}
目标市场: ${project.targetMarket}
关键词: ${project.keywords}
产品数: ${products.length}
评论统计: 总${reviewStats.total}条, 好评${reviewStats.positive}, 差评${reviewStats.negative}
已有报告: ${reports.map(r => r.reportType).join(", ")}
产品画像: ${profile ? "已完成" : "未完成"}

TOP产品:
${products.slice(0, 10).map(p => `${p.asin} | ${p.title} | $${p.price} | ${p.rating}★ | BSR:${p.bsr}`).join("\n")}`;

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品开发评审专家。请根据项目数据，对以下6个维度进行评分（每项0-20分）：
1. 市场容量：市场规模和增长潜力
2. 差异化：产品差异化空间
3. 竞争力：进入后的竞争优势
4. 进入虚位：市场进入机会窗口
5. 利润：预期利润空间
6. 风险：综合风险评估（分数越高风险越低）

评分标准：
- 18-20分：优秀
- 15-17分：良好
- 12-14分：一般
- 10-11分：较差
- 0-9分：很差

总分低于80分不建议立项，单项低于14分需要重点关注。`,
          },
          { role: "user", content: context },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "project_score",
            strict: true,
            schema: {
              type: "object",
              properties: {
                marketCapacity: { type: "number" },
                differentiation: { type: "number" },
                competitiveness: { type: "number" },
                entryOpportunity: { type: "number" },
                profit: { type: "number" },
                risk: { type: "number" },
                reasoning: {
                  type: "object",
                  properties: {
                    marketCapacity: { type: "string" },
                    differentiation: { type: "string" },
                    competitiveness: { type: "string" },
                    entryOpportunity: { type: "string" },
                    profit: { type: "string" },
                    risk: { type: "string" },
                    overall: { type: "string" },
                  },
                  required: ["marketCapacity", "differentiation", "competitiveness", "entryOpportunity", "profit", "risk", "overall"],
                  additionalProperties: false,
                },
              },
              required: ["marketCapacity", "differentiation", "competitiveness", "entryOpportunity", "profit", "risk", "reasoning"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content as string) : null;
      if (!parsed) throw new Error("AI scoring failed");

      const totalScore = parsed.marketCapacity + parsed.differentiation + parsed.competitiveness +
        parsed.entryOpportunity + parsed.profit + parsed.risk;
      const recommendation = totalScore >= 80 ? "approve" : totalScore >= 60 ? "review" : "reject";

      await devDb.upsertDevProjectScore({
        projectId: input.projectId,
        userId: ctx.user.id,
        marketCapacity: parsed.marketCapacity,
        differentiation: parsed.differentiation,
        competitiveness: parsed.competitiveness,
        entryOpportunity: parsed.entryOpportunity,
        profit: parsed.profit,
        risk: parsed.risk,
        totalScore,
        aiReasoning: JSON.stringify(parsed.reasoning),
        recommendation,
      });

      return { ...parsed, totalScore, recommendation };
    }),

  getScore: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevProjectScore(input.projectId);
    }),

  // Approve project: move from market_analysis to project_execution phase
  // Uses admin-level update to bypass userId constraint (admins can approve any project)
  approveProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const score = await devDb.getDevProjectScore(input.projectId);
      if (!score) throw new Error("请先完成AI评分");

      // Use admin-level update: allows super_admin/admin to approve projects they don't own
      await devDb.updateDevProjectAdmin(input.projectId, {
        phase: "project_execution" as any,
        approvedAt: new Date() as any,
        approvedScore: score.totalScore as any,
        status: "completed" as any,
      });

      return { success: true, totalScore: score.totalScore };
    }),

  // Revoke approval: move back to market_analysis phase
  revokeApproval: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Use admin-level update: allows super_admin/admin to revoke any project
      await devDb.updateDevProjectAdmin(input.projectId, {
        phase: "market_analysis" as any,
        approvedAt: null as any,
        approvedScore: null as any,
        status: "scoring" as any,
      });
      return { success: true };
    }),
});
