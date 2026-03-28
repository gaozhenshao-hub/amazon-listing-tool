import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";

// ─── 3.4 利润深度分析 ──────────────────────────────────────────────

export const profitDeepRouter = router({

  // 父ASIN维度利润汇总
  getParentAsinProfit: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request<any[]>({
        path: "/bd/profit/report/open/report/parent/asin/list",
        body: {
          start_date: input.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          end_date: input.endDate || new Date().toISOString().slice(0, 10),
        },
      });

      const items = Array.isArray(res.data) ? res.data : [];

      // Aggregate totals
      let totalSales = 0, totalProfit = 0, totalAdsCost = 0, totalFbaFee = 0;
      let totalStorage = 0, totalCommission = 0, totalCogs = 0, totalShipping = 0, totalRefund = 0;

      for (const item of items) {
        totalSales += item.totalSalesAmount || 0;
        totalProfit += item.totalProfit || 0;
        totalAdsCost += item.totalAdsCost || 0;
        totalFbaFee += item.totalFbaDeliveryFee || 0;
        totalStorage += item.totalStorageFee || 0;
        totalCommission += item.totalCommission || 0;
        totalCogs += item.cgPriceTotal || 0;
        totalShipping += item.cgTransportCostsTotal || 0;
        totalRefund += item.totalRefund || 0;
      }

      const profitRate = totalSales > 0 ? +((totalProfit / totalSales) * 100).toFixed(2) : 0;

      // Cost breakdown for pie chart
      const costBreakdown = [
        { name: "采购成本", value: +totalCogs.toFixed(2), color: "#3b82f6" },
        { name: "头程运费", value: +totalShipping.toFixed(2), color: "#06b6d4" },
        { name: "FBA配送费", value: +totalFbaFee.toFixed(2), color: "#f59e0b" },
        { name: "仓储费", value: +totalStorage.toFixed(2), color: "#ef4444" },
        { name: "广告费", value: +totalAdsCost.toFixed(2), color: "#8b5cf6" },
        { name: "佣金", value: +totalCommission.toFixed(2), color: "#10b981" },
        { name: "退款", value: +totalRefund.toFixed(2), color: "#f97316" },
      ];

      const totalCost = costBreakdown.reduce((s, c) => s + c.value, 0);
      const costBreakdownWithPct = costBreakdown.map(c => ({
        ...c,
        pct: totalCost > 0 ? +((c.value / totalCost) * 100).toFixed(1) : 0,
      }));

      // Sort items by profit descending for ranking
      const rankedItems = items
        .map((item: any) => ({
          parentAsin: item.parent_asin,
          childCount: item.child_asin_count || 0,
          sales: +(item.totalSalesAmount || 0).toFixed(2),
          quantity: item.totalSalesQuantity || 0,
          profit: +(item.totalProfit || 0).toFixed(2),
          profitRate: +(item.profitRate || 0).toFixed(2),
          adsCost: +(item.totalAdsCost || 0).toFixed(2),
          fbaFee: +(item.totalFbaDeliveryFee || 0).toFixed(2),
          storageFee: +(item.totalStorageFee || 0).toFixed(2),
          commission: +(item.totalCommission || 0).toFixed(2),
          cogs: +(item.cgPriceTotal || 0).toFixed(2),
          shipping: +(item.cgTransportCostsTotal || 0).toFixed(2),
          refund: +(item.totalRefund || 0).toFixed(2),
        }))
        .sort((a: any, b: any) => b.profit - a.profit);

      return {
        items: rankedItems,
        kpi: {
          totalSales: +totalSales.toFixed(2),
          totalProfit: +totalProfit.toFixed(2),
          profitRate,
          totalAdsCost: +totalAdsCost.toFixed(2),
          totalCost: +totalCost.toFixed(2),
          itemCount: items.length,
        },
        costBreakdown: costBreakdownWithPct,
        _meta: res._meta,
      };
    }),

  // ASIN维度利润明细
  getAsinProfit: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      asin: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request<any[]>({
        path: "/bd/profit/report/open/report/asin/list",
        body: {
          start_date: input.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          end_date: input.endDate || new Date().toISOString().slice(0, 10),
          asin: input.asin,
        },
      });

      const items = Array.isArray(res.data) ? res.data : [];
      return { items, _meta: res._meta };
    }),

  // 财务流水明细
  getFinanceStatement: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.request<any[]>({
        path: "/erp/finance/data/inventory/getInventoryStatementList",
        body: {
          start_date: input.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          end_date: input.endDate || new Date().toISOString().slice(0, 10),
        },
      });

      const items = Array.isArray(res.data) ? res.data : [];
      return { items, _meta: res._meta };
    }),

  // AI利润诊断
  aiProfitDiagnosis: protectedProcedure
    .input(z.object({
      asin: z.string(),
      sales7d: z.number(),
      profit7d: z.number(),
      margin7d: z.number(),
      salesPrev: z.number(),
      profitPrev: z.number(),
      marginPrev: z.number(),
      cogs: z.number(),
      shipping: z.number(),
      fbaFee: z.number(),
      storageFee: z.number(),
      adCost: z.number(),
      commission: z.number(),
      refund: z.number(),
      returnRate: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位亚马逊财务分析专家。请基于以下单个ASIN的利润数据诊断利润变化原因。

## 产品信息（单ASIN维度）
- ASIN: ${input.asin}
- 本期（近7天）：销售额$${input.sales7d}、毛利$${input.profit7d}、利润率${input.margin7d}%
- 上期（前7天）：销售额$${input.salesPrev}、毛利$${input.profitPrev}、利润率${input.marginPrev}%
- 成本明细：采购$${input.cogs}、头程$${input.shipping}、FBA$${input.fbaFee}、仓储$${input.storageFee}、
            广告$${input.adCost}、佣金$${input.commission}、退款$${input.refund}
- 退货率: ${input.returnRate || 0}%

## 输出格式（JSON）`
          },
          {
            role: "user",
            content: "请诊断该ASIN的利润变化原因，并给出优化建议。"
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "profit_diagnosis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                asin: { type: "string" },
                diagnosis: { type: "string", description: "利润诊断摘要（150字以内）" },
                margin_change: {
                  type: "object",
                  properties: {
                    current: { type: "number" },
                    previous: { type: "number" },
                    change: { type: "number" },
                    trend: { type: "string" },
                  },
                  required: ["current", "previous", "change", "trend"],
                  additionalProperties: false,
                },
                cost_drivers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      item: { type: "string" },
                      current_pct: { type: "number" },
                      previous_pct: { type: "number" },
                      is_abnormal: { type: "boolean" },
                      benchmark: { type: "string" },
                    },
                    required: ["item", "current_pct", "previous_pct", "is_abnormal", "benchmark"],
                    additionalProperties: false,
                  },
                },
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string" },
                      action: { type: "string" },
                      expected_saving: { type: "string" },
                      difficulty: { type: "string" },
                    },
                    required: ["priority", "action", "expected_saving", "difficulty"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["asin", "diagnosis", "margin_change", "cost_drivers", "recommendations"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),
});
