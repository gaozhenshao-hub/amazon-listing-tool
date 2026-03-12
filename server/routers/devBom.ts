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
      moq: z.number().optional(),
      leadTime: z.number().optional(),
      notes: z.string().optional(),
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
      moq: z.number().optional(),
      leadTime: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return devDb.saveDevBomItem({ id, ...data } as any);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevBomItem(input.id);
    }),

  // ─── AI BOM Suggestion ─────────────────────────────────────
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
${profile ? `产品画像: 外观=${profile.appearanceColors || ""}, 功能=${profile.mainFunctions || ""}` : ""}
${existingBom.length > 0 ? `已有BOM: ${existingBom.map(b => b.partName).join(", ")}` : ""}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个资深的产品工程师和供应链专家。请根据竞品信息和产品画像，建议一份完整的BOM清单。
包括：主体部件、电子元件、包装材料、配件等。
为每个部件提供材质建议、规格参数、预估单价（人民币）、最小起订量。`,
          },
          { role: "user", content: context },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "bom_suggestion",
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
                      partCategory: { type: "string" },
                      material: { type: "string" },
                      specification: { type: "string" },
                      quantity: { type: "number" },
                      unitCost: { type: "string" },
                      moq: { type: "number" },
                      leadTime: { type: "number" },
                      notes: { type: "string" },
                    },
                    required: ["partName", "partCategory", "material", "specification", "quantity", "unitCost", "moq", "leadTime", "notes"],
                    additionalProperties: false,
                  },
                },
                totalCost: { type: "string" },
                suggestions: { type: "string" },
              },
              required: ["items", "totalCost", "suggestions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      return content ? JSON.parse(content as string) : { items: [], totalCost: "0", suggestions: "" };
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
