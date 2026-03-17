import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

const PROFILE_SECTIONS = [
  "appearance", "function", "cost", "package", "packageDesign",
  "userPersona", "usageScenarios", "productMap",
] as const;

type SectionKey = typeof PROFILE_SECTIONS[number];

// Map section key to DB column names
const SECTION_DB_MAP: Record<SectionKey, { data: string; ai: string; confirmed: string }> = {
  appearance: { data: "appearanceColors", ai: "appearanceAiSuggestion", confirmed: "appearanceConfirmed" },
  function: { data: "mainFunctions", ai: "functionsAiSuggestion", confirmed: "functionsConfirmed" },
  cost: { data: "costBreakdown", ai: "costAiSuggestion", confirmed: "costConfirmed" },
  package: { data: "packageDimensions", ai: "packageAiSuggestion", confirmed: "packageConfirmed" },
  packageDesign: { data: "packageDesign", ai: "packageDesignAiSuggestion", confirmed: "packageDesignConfirmed" },
  userPersona: { data: "userPersona", ai: "userPersonaAiSuggestion", confirmed: "userPersonaConfirmed" },
  usageScenarios: { data: "usageScenarios", ai: "usageScenariosAiSuggestion", confirmed: "usageScenariosConfirmed" },
  productMap: { data: "productMap", ai: "productMapAiSuggestion", confirmed: "productMapConfirmed" },
};

const SECTION_LABELS: Record<SectionKey, { cn: string; en: string }> = {
  appearance: { cn: "外观设计", en: "Appearance Design" },
  function: { cn: "功能提升", en: "Function Enhancement" },
  cost: { cn: "产品成本", en: "Product Cost" },
  package: { cn: "包装设计", en: "Package Design" },
  packageDesign: { cn: "包装外观", en: "Package Appearance" },
  userPersona: { cn: "用户画像", en: "User Persona" },
  usageScenarios: { cn: "使用场景", en: "Usage Scenarios" },
  productMap: { cn: "产品地图", en: "Product Map" },
};

export const devProfileRouter = router({
  get: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevProductProfile(input.projectId);
    }),

  // Save user-edited data for a specific section
  saveSection: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
      data: z.string(), // JSON string
    }))
    .mutation(async ({ ctx, input }) => {
      const cols = SECTION_DB_MAP[input.section];
      const updateData: any = {
        projectId: input.projectId,
        userId: ctx.user.id,
        [cols.data]: input.data,
      };
      return devDb.upsertDevProductProfile(updateData);
    }),

  // Confirm a section (lock it permanently)
  confirmSection: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
      data: z.string(), // final confirmed data
    }))
    .mutation(async ({ ctx, input }) => {
      const cols = SECTION_DB_MAP[input.section];
      const updateData: any = {
        projectId: input.projectId,
        userId: ctx.user.id,
        [cols.data]: input.data,
        [cols.confirmed]: 1,
      };
      return devDb.upsertDevProductProfile(updateData);
    }),

  // Unconfirm a section (unlock it for re-editing)
  unconfirmSection: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
    }))
    .mutation(async ({ ctx, input }) => {
      const cols = SECTION_DB_MAP[input.section];
      const updateData: any = {
        projectId: input.projectId,
        userId: ctx.user.id,
        [cols.confirmed]: 0,
      };
      return devDb.upsertDevProductProfile(updateData);
    }),

  // Legacy save (for backward compatibility)
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

  // Legacy confirm all
  confirm: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.upsertDevProductProfile({
        projectId: input.projectId,
        userId: ctx.user.id,
        status: "confirmed",
      });
    }),

  // AI generate suggestions for a specific section
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

      const context = buildProfileContext(project, products, profile, score);
      const sectionPrompt = getSectionPrompt(input.section);
      const label = SECTION_LABELS[input.section];

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个专业的亚马逊产品开发顾问，精通美国市场的产品设计、包装设计和市场定位。
当前分析模块：${label.cn}（${label.en}）
请基于提供的竞品数据和市场分析，给出专业、具体、可执行的建议。
所有建议应该考虑美国消费者的偏好和习惯。
请严格按照要求的JSON格式返回结果，不要包含markdown代码块标记。`,
          },
          { role: "user", content: `${context}\n\n${sectionPrompt}` },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
      } catch {
        parsed = { raw: content };
      }

      // Save AI suggestion to DB
      const cols = SECTION_DB_MAP[input.section];
      await devDb.upsertDevProductProfile({
        projectId: input.projectId,
        userId: ctx.user.id,
        [cols.ai]: JSON.stringify(parsed),
      });

      return parsed;
    }),

  // Generate more suggestions (different angle)
  generateMore: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      section: z.enum(PROFILE_SECTIONS),
      existingData: z.string(),
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
    if (profile.appearanceColors) ctx += `\n外观设计: ${profile.appearanceColors}`;
    if (profile.mainFunctions) ctx += `\n功能提升: ${profile.mainFunctions}`;
    if (profile.costBreakdown) ctx += `\n产品成本: ${profile.costBreakdown}`;
    if (profile.packageDimensions) ctx += `\n包装设计: ${profile.packageDimensions}`;
    if (profile.packageDesign) ctx += `\n包装外观: ${profile.packageDesign}`;
    if (profile.userPersona) ctx += `\n用户画像: ${profile.userPersona}`;
    if (profile.usageScenarios) ctx += `\n使用场景: ${profile.usageScenarios}`;
    if (profile.productMap) ctx += `\n产品地图: ${profile.productMap}`;
  }

  if (score) {
    ctx += `\n\n立项评分: 总分${score.totalScore}, 建议${score.recommendation}`;
  }

  return ctx;
}

function getSectionPrompt(section: string): string {
  const prompts: Record<string, string> = {
    appearance: `请为产品外观设计提供详细建议，返回JSON格式：
{"colors": [{"color": "颜色名", "hex": "#十六进制", "reason": "选择原因"}], "materialSuggestion": "材质建议", "surfaceFinish": "表面处理建议", "differentiationDesign": "差异化外观设计方案", "designInspiration": "设计灵感来源", "colorMatching": "配色方案建议", "otherNotes": "其他外观建议"}`,
    function: `请为产品功能提升提供建议，返回JSON格式：
{"mainFunctions": [{"name": "功能名", "desc": "描述", "priority": "高/中/低"}], "upgrades": [{"name": "升级点", "desc": "描述", "difficulty": "容易/中等/困难", "costImpact": "成本影响"}], "differentiationFeatures": "差异化功能设计", "userFeedbackInsights": "用户反馈洞察"}`,
    cost: `请为产品成本提供详细分析，返回JSON格式：
{"breakdown": [{"item": "成本项", "estimatedCost": "预估金额(元)", "percentage": "占比", "note": "说明"}], "targetRetailPrice": "建议零售价(美元)", "targetMargin": "目标利润率", "costOptimizationTips": ["优化建议1", "优化建议2"], "volumeDiscountNotes": "批量采购折扣说明"}`,
    package: `请为产品包装设计提供建议，返回JSON格式：
{"dimensions": {"length": "长(cm)", "width": "宽(cm)", "height": "高(cm)"}, "weight": "预估重量(g)", "boxType": "盒型建议", "innerStructure": "内部结构", "fillingMaterial": "填充物", "fbaPackageRequirements": "FBA包装要求", "shippingConsiderations": "运输注意事项"}`,
    packageDesign: `请为包装外观设计提供建议，返回JSON格式：
{"designStyle": "设计风格", "colorScheme": {"primary": "主色", "secondary": "辅色", "accent": "点缀色"}, "printingProcess": "印刷工艺", "brandElements": "品牌元素建议", "labelInfo": "标签信息", "unboxingExperience": "开箱体验设计", "sustainabilityNotes": "环保包装建议"}`,
    userPersona: `请为目标用户画像提供详细分析，返回JSON格式：
{"demographics": {"ageRange": "年龄段", "gender": "性别分布", "income": "收入水平", "education": "教育水平", "location": "地理位置"}, "psychographics": {"lifestyle": "生活方式", "values": "价值观", "interests": ["兴趣爱好"]}, "painPoints": [{"pain": "痛点", "severity": "严重程度", "currentSolution": "当前解决方案"}], "purchaseMotivation": ["购买动机"], "buyingBehavior": "购买行为特征", "personaDescription": "用户画像描述"}`,
    usageScenarios: `请为产品使用场景提供建议，返回JSON格式：
{"scenarios": [{"name": "场景名称", "description": "场景描述", "frequency": "使用频率", "environment": "使用环境", "relatedProducts": "关联产品", "marketingAngle": "营销切入点"}], "seasonalTrends": "季节性趋势", "crossSellingOpportunities": "交叉销售机会"}`,
    productMap: `请为产品定位地图提供建议，返回JSON格式：
{"positioning": {"priceRange": "价格区间", "qualityLevel": "品质定位", "targetSegment": "目标细分市场"}, "competitors": [{"brand": "品牌", "priceRange": "价格区间", "strengths": "优势", "weaknesses": "劣势"}], "marketGaps": [{"gap": "市场空白", "opportunity": "机会描述"}], "differentiationStrategy": "差异化策略", "entryStrategy": "市场进入策略"}`,
  };
  return prompts[section] || "请提供建议";
}
