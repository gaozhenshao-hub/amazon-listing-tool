import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

export const devBomRouter = router({
  // ─── BOM CRUD ──────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevBomItems(input.projectId);
    }),

  add: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      partName: z.string().min(1),
      partCategory: z.string().optional(),
      material: z.string().optional(),
      specification: z.string().optional(),
      quantity: z.number().default(1),
      unitCost: z.string().optional(),
      supplier: z.string().optional(),
      supplierGlobalId: z.number().optional(),
      supplierName: z.string().optional(),
      moq: z.number().optional(),
      leadTime: z.number().optional(),
      notes: z.string().optional(),
      parentId: z.number().nullable().optional(),
      level: z.number().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.saveDevBomItem({
        projectId: input.projectId,
        userId: ctx.user.id,
        partName: input.partName,
        material: input.material ?? null,
        process: input.partCategory ?? null,
        specification: input.specification ?? null,
        quantity: input.quantity,
        unitPrice: input.unitCost ?? null,
        remark: input.notes ?? null,
        supplierGlobalId: input.supplierGlobalId ?? null,
        supplierName: input.supplierName ?? null,
        parentId: input.parentId ?? null,
        level: input.level ?? 0,
        sortOrder: input.sortOrder ?? 0,
      });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      partName: z.string().optional(),
      partCategory: z.string().optional(),
      material: z.string().optional(),
      specification: z.string().optional(),
      quantity: z.number().optional(),
      unitCost: z.string().optional(),
      supplier: z.string().optional(),
      supplierGlobalId: z.number().optional(),
      supplierName: z.string().optional(),
      moq: z.number().optional(),
      leadTime: z.number().optional(),
      notes: z.string().optional(),
      parentId: z.number().nullable().optional(),
      level: z.number().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, partName, partCategory, material, specification, quantity, unitCost, notes, supplierGlobalId, supplierName, parentId, level, sortOrder } = input;
      return devDb.saveDevBomItem({
        id,
        partName,
        material: material ?? undefined,
        process: partCategory ?? undefined,
        specification: specification ?? undefined,
        quantity,
        unitPrice: unitCost ?? undefined,
        remark: notes ?? undefined,
        supplierGlobalId: supplierGlobalId ?? null,
        supplierName: supplierName ?? null,
        parentId: parentId ?? undefined,
        level: level ?? undefined,
        sortOrder: sortOrder ?? undefined,
      } as any);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevBomItem(input.id);
    }),

  // ─── AI BOM Suggestion (Multi-level + Mold + Timeline) ────
  aiSuggest: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const existingBom = await devDb.getDevBomItems(input.projectId);

      const context = `项目: ${project.name}
竞品数据:
${products.slice(0, 5).map(p => `${p.title} | $${p.price} | ${p.bulletPoints || ""}`).join("\n")}
${profile ? `产品画像: 外观=${profile.appearanceColors || ""}, 功能=${profile.mainFunctions || ""}, 材质=${(profile as any).materialStructure || ""}` : ""}
${existingBom.length > 0 ? `已有BOM: ${existingBom.map(b => b.partName).join(", ")}` : ""}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个资深的产品工程师和供应链专家。请根据竞品信息和产品画像，建议一份完整的多层级BOM清单。

请提供：
1. **多层级BOM结构**：主件(level=0) → 子件(level=1) → 原材料(level=2)。每个部件包含：物料名称、材质、工艺（注塑/冲压/CNC/SMT等）、规格尺寸、单件用量、单价（人民币）。
2. **模具方案**：对需要开模的零部件，推荐模具类型（注塑模/冲压模/压铸模等）、模具材质（P20/718H/NAK80等）、穴数、预估费用、开模周期。
3. **时间规划**：打样时间、模具开发时间、首批量产时间、总开发周期（天数）。
4. **成本汇总**：物料总成本、包装成本预估。`,
          },
          { role: "user", content: context },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "bom_suggestion_v2",
            strict: true,
            schema: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      partName: { type: "string" },
                      partCategory: { type: "string", description: "工艺类型" },
                      material: { type: "string" },
                      specification: { type: "string" },
                      quantity: { type: "number" },
                      unitCost: { type: "string" },
                      moq: { type: "number" },
                      leadTime: { type: "number" },
                      notes: { type: "string" },
                      level: { type: "number", description: "0=主件, 1=子件, 2=原材料" },
                      parentName: { type: "string", description: "父级部件名称，顶级为空" },
                    },
                    required: ["partName", "partCategory", "material", "specification", "quantity", "unitCost", "moq", "leadTime", "notes", "level", "parentName"],
                    additionalProperties: false,
                  },
                },
                molds: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      partName: { type: "string" },
                      moldType: { type: "string" },
                      moldMaterial: { type: "string" },
                      cavities: { type: "number" },
                      estimatedCost: { type: "string" },
                      leadTimeDays: { type: "number" },
                      remark: { type: "string" },
                    },
                    required: ["partName", "moldType", "moldMaterial", "cavities", "estimatedCost", "leadTimeDays", "remark"],
                    additionalProperties: false,
                  },
                },
                timeline: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      phaseName: { type: "string" },
                      estimatedDays: { type: "number" },
                      startOffset: { type: "number" },
                      description: { type: "string" },
                    },
                    required: ["phaseName", "estimatedDays", "startOffset", "description"],
                    additionalProperties: false,
                  },
                },
                totalCost: { type: "string" },
                packagingCost: { type: "string" },
                suggestions: { type: "string" },
              },
              required: ["items", "molds", "timeline", "totalCost", "packagingCost", "suggestions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      return content ? JSON.parse(content as string) : { items: [], molds: [], timeline: [], totalCost: "0", packagingCost: "0", suggestions: "" };
    }),

  // ─── AI Supplier Recommendation ───────────────────────────
  aiSupplierRecommend: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const bomItems = await devDb.getDevBomItems(input.projectId);
      const moldCosts = await devDb.getDevMoldCosts(input.projectId);
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);

      const context = `项目: ${project?.name || "未命名"}
BOM物料清单:
${bomItems.map(b => `${b.partName} | 材质:${b.material || "未知"} | 工艺:${b.process || "未知"} | 规格:${b.specification || ""}`).join("\n")}
模具需求:
${moldCosts.map(m => `${m.partName} | ${m.moldType || ""} | ${m.moldMaterial || ""}`).join("\n")}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个资深的供应链专家。根据BOM中的材质和工艺需求，推荐匹配的供应商类型。
对每个推荐的供应商类型，分析以下维度：
- 工厂规模（员工数/年产值）
- 产品质量（良品率/认证要求）
- 研发能力（研发人员占比/专利数）
- 交期表现（标准交期范围）
- 价格竞争力（价格区间）

请基于BOM中的不同材质和工艺，推荐3-5类供应商。`,
          },
          { role: "user", content: context },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "supplier_recommendation",
            strict: true,
            schema: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      supplierType: { type: "string" },
                      matchedParts: { type: "string" },
                      factoryScale: { type: "string" },
                      qualityStandard: { type: "string" },
                      rdCapability: { type: "string" },
                      deliveryPerformance: { type: "string" },
                      priceRange: { type: "string" },
                      overallScore: { type: "number" },
                      searchKeywords: { type: "string" },
                    },
                    required: ["supplierType", "matchedParts", "factoryScale", "qualityStandard", "rdCapability", "deliveryPerformance", "priceRange", "overallScore", "searchKeywords"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["recommendations", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      return content ? JSON.parse(content as string) : { recommendations: [], summary: "" };
    }),

  // ─── Profit Calculator ─────────────────────────────────────
  calculateProfit: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sellingPrice: z.number(),
      productCost: z.number(),
      shippingCost: z.number(),
      fbaFee: z.number().optional(),
      referralFee: z.number().optional(),
      advertisingCost: z.number().optional(),
      otherCosts: z.number().optional(),
      monthlySalesEstimate: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Amazon referral fee is typically 15%
      const referralFee = input.referralFee ?? (input.sellingPrice * 0.15);
      const fbaFee = input.fbaFee ?? 0;
      const advertisingCost = input.advertisingCost ?? 0;
      const otherCosts = input.otherCosts ?? 0;

      const totalCost = input.productCost + input.shippingCost + referralFee + fbaFee + advertisingCost + otherCosts;
      const profit = input.sellingPrice - totalCost;
      const profitMargin = input.sellingPrice > 0 ? (profit / input.sellingPrice) * 100 : 0;
      const monthlySales = input.monthlySalesEstimate ?? 0;
      const monthlyProfit = profit * monthlySales;
      const yearlyProfit = monthlyProfit * 12;

      // Save to profit analysis
      await devDb.saveDevProfitCalculation({
        userId: ctx.user.id,
        projectId: input.projectId,
        name: `Project ${input.projectId} Profit`,
        sellingPrice: input.sellingPrice.toString(),
        productCost: input.productCost.toString(),
        fbaFee: fbaFee.toString(),
        referralFeeRate: (referralFee / input.sellingPrice * 100).toFixed(1),
        adSpend: advertisingCost.toString(),
        otherCost: otherCosts.toString(),
        profit: profit.toString(),
        profitMargin: profitMargin.toFixed(2),
      });

      return {
        totalCost: Math.round(totalCost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        profitMargin: Math.round(profitMargin * 100) / 100,
        monthlyProfit: Math.round(monthlyProfit * 100) / 100,
        yearlyProfit: Math.round(yearlyProfit * 100) / 100,
        breakdown: {
          productCost: input.productCost,
          shippingCost: input.shippingCost,
          referralFee: Math.round(referralFee * 100) / 100,
          fbaFee,
          advertisingCost,
          otherCosts,
        },
      };
    }),

  getProfitAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevProfitCalculations(ctx.user.id);
    }),

  // BOM cost summary - auto-calculate from BOM items
  getBomCostSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const bomItems = await devDb.getDevBomItems(input.projectId);
      const moldCosts = await devDb.getDevMoldCosts(input.projectId);
      const summary = await devDb.getDevBomSummary(input.projectId);

      // Calculate total material cost from BOM items
      let totalMaterialCost = 0;
      for (const item of bomItems) {
        const price = parseFloat(item.unitPrice || "0");
        const qty = item.quantity || 1;
        totalMaterialCost += price * qty;
      }

      // Calculate total mold cost
      let totalMoldCost = 0;
      for (const mold of moldCosts) {
        totalMoldCost += parseFloat(mold.estimatedCost || "0");
      }

      return {
        totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
        totalMoldCost: Math.round(totalMoldCost * 100) / 100,
        bomItemCount: bomItems.length,
        moldCount: moldCosts.length,
        summary,
      };
    }),

  // Batch profit simulation with different order quantities
  // Get exchange rate CNY→USD
  getExchangeRate: protectedProcedure
    .query(async () => {
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/CNY");
        if (res.ok) {
          const data = await res.json();
          if (data.rates?.USD) {
            return { rate: data.rates.USD, source: "er-api.com", updatedAt: Date.now() };
          }
        }
      } catch {}
      // Fallback rate
      return { rate: 0.137, source: "fallback", updatedAt: Date.now() };
    }),

  batchSimulate: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sellingPrice: z.number(),
      productCostCny: z.number(), // BOM cost in CNY
      exchangeRate: z.number(), // CNY to USD rate
      shippingCost: z.number(),
      fbaFee: z.number().optional(),
      referralFeeRate: z.number().optional(), // percentage
      advertisingCost: z.number().optional(),
      otherCosts: z.number().optional(),
      totalMoldCostCny: z.number().optional(), // mold cost in CNY
      quantities: z.array(z.number()).default([100, 500, 1000, 5000]),
    }))
    .mutation(async ({ ctx, input }) => {
      const rate = input.exchangeRate;
      const productCostUsd = input.productCostCny * rate;
      const totalMoldCostUsd = (input.totalMoldCostCny ?? 0) * rate;
      const referralRate = (input.referralFeeRate ?? 15) / 100;
      const referralFee = input.sellingPrice * referralRate;
      const fbaFee = input.fbaFee ?? 0;
      const advertisingCost = input.advertisingCost ?? 0;
      const otherCosts = input.otherCosts ?? 0;

      const simulations = input.quantities.map(qty => {
        const moldPerUnitUsd = qty > 0 ? totalMoldCostUsd / qty : 0;
        const moldPerUnitCny = qty > 0 ? (input.totalMoldCostCny ?? 0) / qty : 0;
        const totalUnitCost = productCostUsd + moldPerUnitUsd + input.shippingCost + referralFee + fbaFee + advertisingCost + otherCosts;
        const profit = input.sellingPrice - totalUnitCost;
        const profitMargin = input.sellingPrice > 0 ? (profit / input.sellingPrice) * 100 : 0;
        const roi = totalUnitCost > 0 ? (profit / totalUnitCost) * 100 : 0;

        return {
          quantity: qty,
          moldPerUnitCny: Math.round(moldPerUnitCny * 100) / 100,
          moldPerUnit: Math.round(moldPerUnitUsd * 100) / 100,
          productCostUsd: Math.round(productCostUsd * 100) / 100,
          totalUnitCost: Math.round(totalUnitCost * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          profitMargin: Math.round(profitMargin * 100) / 100,
          roi: Math.round(roi * 100) / 100,
          totalProfit: Math.round(profit * qty * 100) / 100,
          totalRevenue: Math.round(input.sellingPrice * qty * 100) / 100,
          totalCost: Math.round(totalUnitCost * qty * 100) / 100,
        };
      });

      return {
        simulations,
        exchangeRate: rate,
        baseParams: {
          sellingPrice: input.sellingPrice,
          productCostCny: input.productCostCny,
          productCostUsd: Math.round(productCostUsd * 100) / 100,
          shippingCost: input.shippingCost,
          referralFee: Math.round(referralFee * 100) / 100,
          fbaFee,
          advertisingCost,
          otherCosts,
          totalMoldCostCny: input.totalMoldCostCny ?? 0,
          totalMoldCostUsd: Math.round(totalMoldCostUsd * 100) / 100,
        },
      };
    }),

  // Generate full project report data for PDF export
  getProjectReportData: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const score = await devDb.getDevProjectScore(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bomItems = await devDb.getDevBomItems(input.projectId);
      const moldCosts = await devDb.getDevMoldCosts(input.projectId);
      const bomSummary = await devDb.getDevBomSummary(input.projectId);
      const manual = await devDb.getDevManual(input.projectId);
      const testReport = await devDb.getDevTestReport(input.projectId);
      const reports = await devDb.getDevReports(input.projectId);

      return {
        project,
        products: products.slice(0, 20),
        score,
        profile,
        bomItems,
        moldCosts,
        bomSummary,
        manual: manual ? { brandName: manual.brandName, contentStatus: manual.contentStatus } : null,
        testReport: testReport ? { status: testReport.status, testItems: testReport.testItems } : null,
        reports,
      };
    }),

  // ─── Supplier Management ───────────────────────────────────
  listSuppliers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevSuppliers(input.projectId);
    }),

  addSupplier: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      category: z.string().optional(),
      rating: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.saveDevSupplier({
        projectId: input.projectId,
        userId: ctx.user.id,
        name: input.name,
        factoryScale: input.contactPerson ?? null,
        qualityCerts: input.email ?? null,
        specialties: input.category ?? null,
        overallScore: input.rating ?? null,
      });
    }),

  updateSupplier: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      category: z.string().optional(),
      rating: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return devDb.saveDevSupplier({ id, ...data } as any);
    }),

  deleteSupplier: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevSupplier(input.id);
    }),
});
