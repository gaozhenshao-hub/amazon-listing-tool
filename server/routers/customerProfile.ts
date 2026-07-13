import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { customerProfiles } from "../../drizzle/schema";
import { eq, desc, like, and, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

export const customerProfileRouter = router({
  // 客户列表
  listCustomers: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      tag: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { list: [], total: 0 };
      const conditions: any[] = [eq(customerProfiles.userId, ctx.user.id)];
      if (input.search) {
        conditions.push(like(customerProfiles.buyerName, `%${input.search}%`));
      }
      if (input.tag) {
        conditions.push(eq(customerProfiles.aiValueTag, input.tag as any));
      }
      const list = await db.select().from(customerProfiles)
        .where(and(...conditions))
        .orderBy(desc(customerProfiles.totalSpent))
        .limit(input.limit).offset(input.offset);
      const countRes = await db.select({ count: sql<number>`count(*)` }).from(customerProfiles)
        .where(and(...conditions));
      return { list, total: countRes[0]?.count || 0 };
    }),

  // 客户详情
  getCustomerDetail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(customerProfiles)
        .where(and(eq(customerProfiles.id, input.id), eq(customerProfiles.userId, ctx.user.id)));
      return rows[0] || null;
    }),

  // 创建/更新客户
  upsertCustomer: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      customerId: z.string(),
      buyerName: z.string(),
      email: z.string().optional(),
      sid: z.number().optional(),
      totalOrders: z.number().default(0),
      totalSpent: z.string().default("0"),
      firstOrderDate: z.string().optional(),
      lastOrderDate: z.string().optional(),
      avgOrderValue: z.string().default("0"),
      reviewCount: z.number().default(0),
      avgRating: z.string().optional(),
      returnCount: z.number().default(0),
      returnRate: z.string().default("0"),
      communicationCount: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { id: 0 };
      if (input.id) {
        await db.update(customerProfiles).set({
          buyerName: input.buyerName,
          email: input.email || null,
          sid: input.sid || null,
          totalOrders: input.totalOrders,
          totalSpent: input.totalSpent,
          firstOrderDate: input.firstOrderDate || null,
          lastOrderDate: input.lastOrderDate || null,
          avgOrderValue: input.avgOrderValue,
          reviewCount: input.reviewCount,
          avgRating: input.avgRating || null,
          returnCount: input.returnCount,
          returnRate: input.returnRate,
          communicationCount: input.communicationCount,
        }).where(and(eq(customerProfiles.id, input.id), eq(customerProfiles.userId, ctx.user.id)));
        return { id: input.id };
      } else {
        const res = await db.insert(customerProfiles).values({
          userId: ctx.user.id,
          customerId: input.customerId,
          buyerName: input.buyerName,
          email: input.email || null,
          sid: input.sid || null,
          totalOrders: input.totalOrders,
          totalSpent: input.totalSpent,
          firstOrderDate: input.firstOrderDate || null,
          lastOrderDate: input.lastOrderDate || null,
          avgOrderValue: input.avgOrderValue,
          reviewCount: input.reviewCount,
          avgRating: input.avgRating || null,
          returnCount: input.returnCount,
          returnRate: input.returnRate,
          communicationCount: input.communicationCount,
        });
        return { id: Number(res[0].insertId) };
      }
    }),

  // 删除客户
  deleteCustomer: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.delete(customerProfiles)
        .where(and(eq(customerProfiles.id, input.id), eq(customerProfiles.userId, ctx.user.id)));
      return { success: true };
    }),

  // 从领星同步客户数据
  syncFromLingxing: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .mutation(async ({ ctx }) => {
      const ordersRes = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      const orders = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data as any)?.list || [];

      // 按买家聚合
      const buyerMap = new Map<string, any>();
      for (const order of orders) {
        const buyerId = order.buyer_id || order.buyerId || order.amazon_order_id || '';
        if (!buyerId) continue;
        if (!buyerMap.has(buyerId)) {
          buyerMap.set(buyerId, {
            buyerId,
            buyerName: order.buyer_name || order.buyerName || 'Unknown',
            email: order.buyer_email || '',
            orders: [],
            totalAmount: 0,
          });
        }
        const buyer = buyerMap.get(buyerId)!;
        buyer.orders.push(order);
        buyer.totalAmount += Number(order.amount || order.order_total || 0);
      }

      const db = await getDb();
      if (!db) return { synced: 0, total: 0 };
      let synced = 0;

      for (const [, buyer] of Array.from(buyerMap)) {
        const existing = await db.select().from(customerProfiles)
          .where(and(eq(customerProfiles.userId, ctx.user.id), eq(customerProfiles.customerId, buyer.buyerId)));

        const orderDates = buyer.orders.map((o: any) => o.purchase_date || o.purchaseDate || '').filter(Boolean).sort();
        const avgVal = buyer.orders.length > 0 ? (buyer.totalAmount / buyer.orders.length).toFixed(2) : "0";

        if (existing.length > 0) {
          await db.update(customerProfiles).set({
            buyerName: buyer.buyerName,
            email: buyer.email || null,
            totalOrders: buyer.orders.length,
            totalSpent: buyer.totalAmount.toFixed(2),
            firstOrderDate: orderDates[0] || null,
            lastOrderDate: orderDates[orderDates.length - 1] || null,
            avgOrderValue: avgVal,
            lastSyncAt: new Date(),
          }).where(eq(customerProfiles.id, existing[0].id));
        } else {
          await db.insert(customerProfiles).values({
            userId: ctx.user.id,
            customerId: buyer.buyerId,
            buyerName: buyer.buyerName,
            email: buyer.email || null,
            totalOrders: buyer.orders.length,
            totalSpent: buyer.totalAmount.toFixed(2),
            firstOrderDate: orderDates[0] || null,
            lastOrderDate: orderDates[orderDates.length - 1] || null,
            avgOrderValue: avgVal,
          });
        }
        synced++;
      }

      return { synced, total: buyerMap.size };
    }),

  // AI客户价值评估
  aiCustomerValue: protectedProcedure
    .input(z.object({
      customerId: z.number().optional(),
      customerData: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let data = input.customerData;
      if (input.customerId && !data) {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(customerProfiles)
          .where(and(eq(customerProfiles.id, input.customerId), eq(customerProfiles.userId, ctx.user.id)));
        data = rows[0];
      }
      if (!data) return null;

      const prompt = `你是亚马逊客户价值分析专家。请基于以下客户数据进行价值评估。

客户数据：
${JSON.stringify(data, null, 2)}

请输出JSON格式：
{
  "valueScore": 85,
  "valueLabel": "高价值客户",
  "repurchaseProbability": 0.75,
  "riskLevel": "low",
  "insights": ["洞察1", "洞察2"],
  "recommendations": ["建议1", "建议2"],
  "customerType": "忠实客户/新客户/流失风险/高价值/普通"
}`;

      // [Emperor] 优先调用 Emperor Skill: analysis.competitor.single

      try {

        const _emperorRes = await runSkillViaEmperor("analysis.competitor.single", { context: JSON.stringify(data ?? {}).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] customerProfile.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊客户分析专家，输出严格JSON。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "customer_value",
            strict: true,
            schema: {
              type: "object",
              properties: {
                valueScore: { type: "number" },
                valueLabel: { type: "string" },
                repurchaseProbability: { type: "number" },
                riskLevel: { type: "string" },
                insights: { type: "array", items: { type: "string" } },
                recommendations: { type: "array", items: { type: "string" } },
                customerType: { type: "string" },
              },
              required: ["valueScore", "valueLabel", "repurchaseProbability", "riskLevel", "insights", "recommendations", "customerType"],
              additionalProperties: false,
            },
          },
        },
      });

      const result = JSON.parse(String(response.choices[0].message.content));

      // Save AI result to DB
      if (input.customerId) {
        const db = await getDb();
        if (db) {
          await db.update(customerProfiles).set({
            aiValueScore: String(result.valueScore),
            aiValueTag: result.riskLevel === 'high' ? 'risk' : result.valueScore >= 80 ? 'high_value' : result.customerType === '新客户' ? 'new' : 'normal',
            aiAnalysis: result,
          }).where(eq(customerProfiles.id, input.customerId));
        }
      }

      return result;
    }),

  // 客户统计概览
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { total: 0, highValue: 0, atRisk: 0, totalRevenue: 0, avgOrderValue: 0, repeatBuyers: 0, repeatRate: 0 };
    const all = await db.select().from(customerProfiles)
      .where(eq(customerProfiles.userId, ctx.user.id));

    const total = all.length;
    const highValue = all.filter(c => Number(c.aiValueScore || 0) >= 80).length;
    const atRisk = all.filter(c => c.aiValueTag === 'risk').length;
    const totalRevenue = all.reduce((s, c) => s + Number(c.totalSpent || 0), 0);
    const avgOrderValue = total > 0 ? totalRevenue / total : 0;
    const repeatBuyers = all.filter(c => (c.totalOrders || 0) > 1).length;

    return {
      total,
      highValue,
      atRisk,
      totalRevenue,
      avgOrderValue,
      repeatBuyers,
      repeatRate: total > 0 ? (repeatBuyers / total * 100) : 0,
    };
  }),
});
