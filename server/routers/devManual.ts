import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

export const devManualRouter = router({
  // ─── Product Manual ────────────────────────────────────────
  getManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevManual(input.projectId);
    }),

  generateManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);

      const context = `产品: ${project.name}
目标市场: ${project.targetMarket}
竞品参考: ${products.slice(0, 3).map(p => p.title).join("; ")}
${profile ? `功能: ${profile.mainFunctions || ""}\n外观: ${profile.appearanceColors || ""}` : ""}
BOM: ${bom.map(b => b.partName).join(", ")}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个专业的产品说明书撰写专家。请根据产品信息生成一份完整的英文产品说明书大纲和内容。
说明书应包含：
1. 产品概述（Product Overview）
2. 包装清单（Package Contents）
3. 产品参数（Specifications）
4. 安装说明（Installation Guide）
5. 使用说明（Usage Instructions）
6. 安全警告（Safety Warnings）
7. 保养维护（Maintenance）
8. 故障排除（Troubleshooting）
9. 保修条款（Warranty）
10. 联系方式（Contact Information）

请用英文撰写，符合美国市场的说明书规范。`,
          },
          { role: "user", content: context },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "";

      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        contentSections: content,
        contentStatus: "draft",
      });

      return { content };
    }),

  saveManual: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      content: z.string(),
      status: z.enum(["draft", "confirmed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        contentSections: input.content,
        contentStatus: (input.status ?? "draft") as "draft" | "editing" | "confirmed",
      });
      return { success: true };
    }),

  // ─── Test Report ───────────────────────────────────────────
  getTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevTestReport(input.projectId);
    }),

  generateTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);

      const context = `产品: ${project.name}
目标市场: ${project.targetMarket}
竞品: ${products.slice(0, 3).map(p => `${p.title} | ${p.rating}★`).join("; ")}
${profile ? `功能: ${profile.mainFunctions || ""}\n材质: ${profile.appearanceColors || ""}` : ""}
BOM: ${bom.map(b => `${b.partName}(${b.material || ""})`).join(", ")}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个产品质量检测专家。请根据产品信息，生成一份完整的产品测试报告模板和建议。
报告应包含：
1. 外观检测项目（Appearance Inspection）
2. 功能测试项目（Function Test）
3. 安全测试项目（Safety Test）
4. 耐久性测试（Durability Test）
5. 环境测试（Environmental Test）
6. 包装测试（Packaging Test）
7. 需要的认证标准（Required Certifications）
8. 第三方检测机构推荐（Recommended Labs）

每个测试项目需要包含：测试名称、测试标准、合格标准、测试方法。
请考虑美国市场的法规要求（CPSC、FDA、FCC等）。`,
          },
          { role: "user", content: context },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "";

      await devDb.upsertDevTestReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportContent: content,
        status: "draft",
      });

      return { content };
    }),

  saveTestReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      content: z.string(),
      status: z.enum(["draft", "confirmed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevTestReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportContent: input.content,
        status: (input.status ?? "draft") as "draft" | "editing" | "confirmed",
      });
      return { success: true };
    }),
});
