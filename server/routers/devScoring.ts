import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

export const devScoringRouter = router({
  generate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
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
});
