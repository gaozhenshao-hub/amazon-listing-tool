import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

function getDateNDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function getYesterday() { return getDateNDaysAgo(1); }

export const dashboardUpgradeRouter = router({
  // 4.1.1 促销日历数据（秒杀+优惠券）
  getPromotionCalendar: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const [dealsRes, couponsRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);
      const deals = Array.isArray(dealsRes.data) ? dealsRes.data : (dealsRes.data as any)?.list || [];
      const coupons = Array.isArray(couponsRes.data) ? couponsRes.data : (couponsRes.data as any)?.list || [];

      // Merge into calendar events
      const events = [
        ...deals.map((d: any) => ({
          id: d.deal_id,
          type: 'deal' as const,
          subType: d.deal_type || 'LIGHTNING_DEAL',
          asin: d.asin,
          title: d.title || `秒杀 - ${d.asin}`,
          startTime: d.start_time,
          endTime: d.end_time,
          status: d.status,
          dealPrice: d.deal_price,
          regularPrice: d.regular_price,
          unitsSold: d.units_sold,
          claimedPct: d.claimed_pct,
          fee: d.fee,
        })),
        ...coupons.map((c: any) => ({
          id: c.coupon_id,
          type: 'coupon' as const,
          subType: c.discount_type || 'PERCENTAGE',
          asin: c.asin,
          title: c.title || `优惠券 - ${c.asin}`,
          startTime: c.start_time,
          endTime: c.end_time,
          status: c.status,
          discountValue: c.discount_value,
          budget: c.budget,
          budgetUsed: c.budget_used,
          clips: c.clips,
          redemptions: c.redemptions,
          orders: c.orders,
          sales: c.sales,
        })),
      ];

      return { events, dealCount: deals.length, couponCount: coupons.length };
    }),

  // 4.1.2 店铺健康度
  getShopHealth: protectedProcedure
    .input(z.object({ sid: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const [perfRes, perfDetailRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);
      const perfList = Array.isArray(perfRes.data) ? perfRes.data : (perfRes.data as any)?.list || [];
      const perfDetails = Array.isArray(perfDetailRes.data) ? perfDetailRes.data : (perfDetailRes.data as any)?.list || [];

      // Calculate health score
      const metrics = {
        orderDefectRate: perfDetails[0]?.order_defect_rate || 0.5,
        lateShipmentRate: perfDetails[0]?.late_shipment_rate || 1.2,
        cancellationRate: perfDetails[0]?.cancellation_rate || 0.8,
        validTrackingRate: perfDetails[0]?.valid_tracking_rate || 98.5,
        policyViolations: perfDetails[0]?.policy_violations || 0,
        intellectualPropertyComplaints: perfDetails[0]?.ip_complaints || 0,
      };

      // Score: 100 - penalties
      let score = 100;
      if (metrics.orderDefectRate > 1) score -= 20;
      else if (metrics.orderDefectRate > 0.5) score -= 10;
      if (metrics.lateShipmentRate > 4) score -= 15;
      else if (metrics.lateShipmentRate > 2) score -= 8;
      if (metrics.cancellationRate > 2.5) score -= 15;
      else if (metrics.cancellationRate > 1) score -= 8;
      if (metrics.validTrackingRate < 95) score -= 10;
      score -= metrics.policyViolations * 5;
      score -= metrics.intellectualPropertyComplaints * 10;
      score = Math.max(0, Math.min(100, score));

      const riskItems = [];
      if (metrics.orderDefectRate > 1) riskItems.push({ metric: '订单缺陷率', value: `${metrics.orderDefectRate}%`, threshold: '1%', severity: 'critical' as const });
      if (metrics.lateShipmentRate > 4) riskItems.push({ metric: '迟发率', value: `${metrics.lateShipmentRate}%`, threshold: '4%', severity: 'critical' as const });
      if (metrics.cancellationRate > 2.5) riskItems.push({ metric: '取消率', value: `${metrics.cancellationRate}%`, threshold: '2.5%', severity: 'critical' as const });
      if (metrics.validTrackingRate < 95) riskItems.push({ metric: '有效追踪率', value: `${metrics.validTrackingRate}%`, threshold: '95%', severity: 'warning' as const });
      if (metrics.policyViolations > 0) riskItems.push({ metric: '政策违规', value: `${metrics.policyViolations}次`, threshold: '0次', severity: 'critical' as const });

      return {
        score,
        level: score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'warning' : 'critical',
        metrics,
        riskItems,
        shops: perfList,
      };
    }),

  // 4.1.3 库存预警列表（低库存+退货率异常）
  getAlertsList: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const [inventoryRes, returnRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);
      const inventory = Array.isArray(inventoryRes.data) ? inventoryRes.data : (inventoryRes.data as any)?.list || [];
      const returns = Array.isArray(returnRes.data) ? returnRes.data : (returnRes.data as any)?.list || [];

      const lowStockAlerts = inventory
        .filter((i: any) => {
          const days = Number(i.sellable_days) || Number(i.days_of_supply) || 0;
          return days < 14;
        })
        .map((i: any) => ({
          type: 'low_stock' as const,
          asin: i.asin || i.fnsku || '',
          sku: i.msku || i.seller_sku || '',
          title: i.product_name || i.title || '',
          daysOfSupply: Number(i.sellable_days) || Number(i.days_of_supply) || 0,
          quantity: Number(i.fulfillable_quantity) || 0,
          severity: (Number(i.sellable_days) || 0) < 7 ? 'critical' as const : 'warning' as const,
        }))
        .sort((a: any, b: any) => a.daysOfSupply - b.daysOfSupply)
        .slice(0, 20);

      const returnAlerts = returns
        .filter((r: any) => Number(r.return_rate || r.returnRate || 0) > 5)
        .map((r: any) => ({
          type: 'high_return' as const,
          asin: r.asin || '',
          sku: r.sku || r.msku || '',
          title: r.product_name || r.title || '',
          returnRate: Number(r.return_rate || r.returnRate || 0),
          returnCount: Number(r.return_quantity || r.returnCount || 0),
          severity: Number(r.return_rate || r.returnRate || 0) > 10 ? 'critical' as const : 'warning' as const,
        }))
        .sort((a: any, b: any) => b.returnRate - a.returnRate)
        .slice(0, 10);

      return { lowStockAlerts, returnAlerts };
    }),

  // 4.1.4 AI每日运营简报
  aiDailyBriefing: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      // Gather key data for briefing
      const [profitRes, inventoryRes, adRes, returnRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);

      const profitData = Array.isArray(profitRes.data) ? profitRes.data : (profitRes.data as any)?.records || [];
      const inventoryData = Array.isArray(inventoryRes.data) ? inventoryRes.data : (inventoryRes.data as any)?.list || [];
      const adData = Array.isArray(adRes.data) ? adRes.data : (adRes.data as any)?.list || [];
      const returnData = Array.isArray(returnRes.data) ? returnRes.data : (returnRes.data as any)?.list || [];

      const totalRevenue = profitData.reduce((s: number, d: any) => s + Number(d.totalSalesAmount || 0), 0);
      const totalProfit = profitData.reduce((s: number, d: any) => s + Number(d.grossProfit || 0), 0);
      const totalOrders = profitData.reduce((s: number, d: any) => s + Number(d.totalSalesQuantity || 0), 0);
      const lowStockCount = inventoryData.filter((i: any) => (Number(i.sellable_days) || 0) < 14).length;
      const totalAdSpend = adData.reduce((s: number, d: any) => s + (Number(d.cost) || 0), 0);
      const totalAdSales = adData.reduce((s: number, d: any) => s + (Number(d.sales) || 0), 0);
      const highReturnAsins = returnData.filter((r: any) => Number(r.return_rate || r.returnRate || 0) > 5).length;

      // [Emperor] 优先调用 Emperor Skill: ops.profit.analysis

      try {

        const _emperorRes = await runSkillViaEmperor("ops.profit.analysis", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] dashboardUpgrade.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位资深亚马逊运营顾问，请根据以下数据生成今日运营简报。
输出JSON格式：
{
  "date": "YYYY-MM-DD",
  "salesSummary": "销售总结（50字以内）",
  "adSummary": "广告总结（50字以内）",
  "inventorySummary": "库存总结（50字以内）",
  "returnSummary": "退货总结（50字以内）",
  "priorityActions": [
    { "priority": "P0/P1/P2", "action": "具体行动", "reason": "原因", "category": "sales/ads/inventory/returns" }
  ],
  "opportunities": ["机会点1", "机会点2"],
  "risks": ["风险点1", "风险点2"]
}`
          },
          {
            role: "user",
            content: `近7天运营数据：
- 销售额: $${totalRevenue.toFixed(2)}, 利润: $${totalProfit.toFixed(2)}, 订单数: ${totalOrders}
- 利润率: ${totalRevenue > 0 ? (totalProfit / totalRevenue * 100).toFixed(1) : 0}%
- 广告花费: $${totalAdSpend.toFixed(2)}, 广告销售额: $${totalAdSales.toFixed(2)}, ACoS: ${totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100).toFixed(1) : 'N/A'}%
- 低库存SKU数: ${lowStockCount}, 总SKU数: ${inventoryData.length}
- 高退货率ASIN数: ${highReturnAsins}
请生成今日运营简报。`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "daily_briefing",
            strict: true,
            schema: {
              type: "object",
              properties: {
                date: { type: "string" },
                salesSummary: { type: "string" },
                adSummary: { type: "string" },
                inventorySummary: { type: "string" },
                returnSummary: { type: "string" },
                priorityActions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string" },
                      action: { type: "string" },
                      reason: { type: "string" },
                      category: { type: "string" },
                    },
                    required: ["priority", "action", "reason", "category"],
                    additionalProperties: false,
                  }
                },
                opportunities: { type: "array", items: { type: "string" } },
                risks: { type: "array", items: { type: "string" } },
              },
              required: ["date", "salesSummary", "adSummary", "inventorySummary", "returnSummary", "priorityActions", "opportunities", "risks"],
              additionalProperties: false,
            }
          }
        }
      });

      const content = typeof response.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content : JSON.stringify(response.choices?.[0]?.message?.content || '{}');
      return JSON.parse(content);
    }),
});
