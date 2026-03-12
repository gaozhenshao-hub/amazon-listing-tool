import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

const PROFILE_SECTIONS = [
  "appearance", "function", "cost", "package", "packageDesign",
  "userPersona", "usageScenarios", "productMap",
] as const;

export const devProfileRouter = router({
  get: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevProductProfile(input.projectId);
    }),

  save: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      appearanceColors: z.string().optional(),
      mainFunctions: z.string().optional(),
      costBreakdown: z.string().optional(),
      packageDimensions: z.string().optional(),
      packageDesign: z.string().optional(),
      userPersona: z.string().optional(),
      usageScenarios: z.string().optional(),
      productMap: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...data } = input;
      return devDb.upsertDevProductProfile({
        projectId,
        userId: ctx.user.id,
        ...data,
      });
    }),

  confirm: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.upsertDevProductProfile({
        projectId: input.projectId,
        userId: ctx.user.id,
        status: "confirmed",
      });
    }),

  generateSuggestions: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const score = await devDb.getDevProjectScore(input.projectId);

      // Build context
      const context = buildProfileContext(project, products, profile, score);
      const sectionPrompt = getSectionPrompt(input.section);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个专业的亚马逊产品开发顾问，精通美国市场的产品设计、包装设计和市场定位。
请基于提供的竞品数据和市场分析，给出专业、具体、可执行的建议。
所有建议应该考虑美国消费者的偏好和习惯。
请严格按照要求的JSON格式返回结果，不要包含markdown代码块标记。`,
          },
          { role: "user", content: `${context}\n\n${sectionPrompt}` },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "{}";
      try {
        return JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
      } catch {
        return { raw: content };
      }
    }),

  generateMore: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
      existingData: z.string(), // JSON of existing suggestions
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const score = await devDb.getDevProjectScore(input.projectId);

      const context = buildProfileContext(project, products, profile, score);
      const sectionPrompt = getSectionPrompt(input.section);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个专业的亚马逊产品开发顾问。请提供与已有建议不同的新角度、新思路，避免重复。
已有建议：${input.existingData}
请严格按照要求的JSON格式返回结果。`,
          },
          { role: "user", content: `${context}\n\n${sectionPrompt}` },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "{}";
      try {
        return JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
      } catch {
        return { raw: content };
      }
    }),
});

function buildProfileContext(project: any, products: any[], profile: any, score: any): string {
  const top10 = products.slice(0, 10).map(p =>
    `${p.asin} | ${p.title} | $${p.price} | ${p.rating}★ | ${p.brand}`
  ).join("\n");

  let ctx = `项目: ${project.name}\n目标市场: ${project.targetMarket}\n\nTOP10竞品:\n${top10}`;

  if (profile) {
    ctx += `\n\n已有产品画像数据:`;
    if (profile.appearanceColors) ctx += `\n外观: ${profile.appearanceColors}`;
    if (profile.mainFunctions) ctx += `\n功能: ${profile.mainFunctions}`;
    if (profile.costBreakdown) ctx += `\n成本: ${profile.costBreakdown}`;
  }

  if (score) {
    ctx += `\n\n立项评分: 总分${score.totalScore}, 建议${score.recommendation}`;
  }

  return ctx;
}

function getSectionPrompt(section: string): string {
  const prompts: Record<string, string> = {
    appearance: `请为产品外观设计提供建议，返回JSON格式：
{"colors": [{"color": "颜色名", "hex": "#十六进制", "note": "说明"}], "diff": "差异化设计建议", "matching": "配色方案建议", "other": "其他外观建议"}`,
    function: `请为产品功能提供建议，返回JSON格式：
{"mainFunctions": [{"name": "功能名", "desc": "描述"}], "upgrades": [{"name": "升级点", "desc": "描述"}], "diffDesign": "差异化功能设计"}`,
    cost: `请为产品成本提供建议，返回JSON格式：
{"breakdown": [{"item": "成本项", "cost": "金额", "note": "说明"}], "targetPrice": "建议售价", "targetMargin": "目标利润率"}`,
    package: `请为产品包装尺寸提供建议，返回JSON格式：
{"dimensions": {"length": "长", "width": "宽", "height": "高", "unit": "cm"}, "boxType": "盒型", "filling": "填充物", "weight": "重量"}`,
    packageDesign: `请为包装外观设计提供建议，返回JSON格式：
{"style": "设计风格", "colorScheme": "配色方案", "printInfo": "印刷信息"}`,
    userPersona: `请为目标用户画像提供建议，返回JSON格式：
{"age": "年龄段", "gender": "性别", "income": "收入水平", "interests": ["兴趣1"], "painPoints": ["痛点1"], "description": "用户描述"}`,
    usageScenarios: `请为使用场景提供建议，返回JSON格式：
{"scenarios": [{"scenario": "场景名", "desc": "描述", "frequency": "使用频率"}]}`,
    productMap: `请为产品定位地图提供建议，返回JSON格式：
{"positioning": "定位描述", "competitors": [{"brand": "品牌", "asin": "ASIN", "position": "定位"}], "advantages": ["优势1"], "gaps": ["市场空白1"]}`,
  };
  return prompts[section] || "请提供建议";
}
