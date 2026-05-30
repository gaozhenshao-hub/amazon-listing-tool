import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import {
  reviewRecords, reviewReplies, emailTemplates, emailReplies,
  returnAnalysisCache, serviceTasks
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// ============================================================
// 3.1 售后仪表盘 + Review智能管理
// ============================================================

export const afterSalesRouter = router({
  // --- 售后仪表盘 KPI ---
  getDashboardStats: protectedProcedure
    .input(z.object({ sid: z.number().optional(), dateRange: z.string().optional() }))
    .query(async ({ input }) => {
      // Use requestWithMockFallback for all after-sales APIs since many Lingxing
      // after-sales endpoints return "服务不存在" (service not found) for some accounts
      const [reviewRes, feedbackRes, returnRes, rmaRes, emailRes, perfRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);
      return {
        reviews: {
          averageRating: reviewRes.data?.average_rating ?? 0,
          totalReviews: reviewRes.data?.total_reviews ?? 0,
          negativeCount: (reviewRes.data?.daily || []).reduce((s: number, d: any) => s + (d.star_1 || 0) + (d.star_2 || 0), 0),
        },
        feedback: {
          totalFeedback: feedbackRes.data?.total_feedback ?? 0,
          positiveRate: feedbackRes.data?.positive_rate ?? 0,
          negativeCount: feedbackRes.data?.negative ?? 0,
        },
        returns: {
          returnRate: returnRes.data?.overall_return_rate ?? 0,
          totalReturns: returnRes.data?.total_returns ?? 0,
          totalOrders: returnRes.data?.total_orders ?? 0,
        },
        rma: { total: rmaRes.data?.total ?? 0 },
        emails: {
          total: emailRes.data?.total ?? 0,
          unread: emailRes.data?.unread ?? 0,
        },
        performance: perfRes.data || {},
        reviewTrend: reviewRes.data?.daily || [],
        returnTrend: returnRes.data?.trend || [],
        _dataSources: {
          reviews: reviewRes._meta?.source || 'unknown',
          feedback: feedbackRes._meta?.source || 'unknown',
          returns: returnRes._meta?.source || 'unknown',
          rma: rmaRes._meta?.source || 'unknown',
          emails: emailRes._meta?.source || 'unknown',
          performance: perfRes._meta?.source || 'unknown',
        },
      };
    }),

  // --- AI 售后简报 ---
  aiServiceBriefing: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .mutation(async ({ input }) => {
      const [reviewRes, returnRes, emailRes, perfRes] = await Promise.all([
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
        ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ]);
      const prompt = `你是一位资深亚马逊售后运营专家。请根据以下售后数据生成今日售后简报。

## 数据概览
- Review: 平均评分${reviewRes.data?.average_rating || 'N/A'}，总评论${reviewRes.data?.total_reviews || 0}
- 退货: 退货率${returnRes.data?.overall_return_rate || 0}%，总退货${returnRes.data?.total_returns || 0}
- 邮件: 总邮件${emailRes.data?.total || 0}，未读${emailRes.data?.unread || 0}
- 店铺绩效: ODR ${perfRes.data?.order_defect_rate || 0}%, 迟发率${perfRes.data?.late_shipment_rate || 0}%

## 要求
请输出JSON格式，包含以下字段：
1. summary: 一句话总结今日售后状态
2. alerts: 需要紧急处理的事项数组 [{level: "critical"|"warning"|"info", title, description}]
3. recommendations: 改进建议数组 [{priority: 1-5, action, expectedImpact}]
4. healthScore: 售后健康评分(0-100)`;

      const resp = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊售后运营AI助手，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "service_briefing",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                alerts: { type: "array", items: { type: "object", properties: { level: { type: "string" }, title: { type: "string" }, description: { type: "string" } }, required: ["level", "title", "description"], additionalProperties: false } },
                recommendations: { type: "array", items: { type: "object", properties: { priority: { type: "number" }, action: { type: "string" }, expectedImpact: { type: "string" } }, required: ["priority", "action", "expectedImpact"], additionalProperties: false } },
                healthScore: { type: "number" },
              },
              required: ["summary", "alerts", "recommendations", "healthScore"],
              additionalProperties: false,
            },
          },
        },
      });
      try {
        return JSON.parse(String(resp.choices[0].message.content) || "{}");
      } catch { return { summary: String(resp.choices[0].message.content), alerts: [], recommendations: [], healthScore: 0 }; }
    }),

  // --- Review列表 ---
  getReviews: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      asin: z.string().optional(),
      starFilter: z.number().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      let list = res.data?.list || res.data || [];
      if (Array.isArray(list) && input.starFilter) list = list.filter((r: any) => r.star_rating === input.starFilter);
      return { total: res.data?.total || (Array.isArray(list) ? list.length : 0), list, _dataSource: res._meta?.source || 'unknown' };
    }),

  // --- Review统计 ---
  getReviewStats: protectedProcedure
    .input(z.object({ sid: z.number().optional(), asin: z.string().optional() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  // --- AI差评分析+回复生成 ---
  aiReviewAnalysis: protectedProcedure
    .input(z.object({
      reviewId: z.string(),
      starRating: z.number(),
      reviewTitle: z.string(),
      reviewContent: z.string(),
      asin: z.string(),
      productName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const prompt = `你是一位资深亚马逊售后客服专家。请分析以下差评并生成回复草稿。

## Review信息
- ASIN: ${input.asin}
- 产品: ${input.productName || '未知'}
- 星级: ${input.starRating}星
- 标题: ${input.reviewTitle}
- 内容: ${input.reviewContent}

## 分析要求
1. 识别核心问题分类（产品质量/物流/描述不符/使用问题/期望落差）
2. 评估严重程度（high/medium/low）
3. 提取关键问题点
4. 生成英文公开回复草稿（专业、诚恳、提供解决方案、不超过150字）
5. 生成内部改进建议（中文）
6. 判断是否需要后续跟进

输出JSON格式。`;

      const resp = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊售后AI助手，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                problemCategory: { type: "string" },
                severity: { type: "string" },
                keyIssues: { type: "array", items: { type: "string" } },
                sentiment: { type: "string" },
                suggestedReply: { type: "string" },
                internalAction: { type: "string" },
                followUpNeeded: { type: "boolean" },
              },
              required: ["problemCategory", "severity", "keyIssues", "sentiment", "suggestedReply", "internalAction", "followUpNeeded"],
              additionalProperties: false,
            },
          },
        },
      });

      try {
        const analysis = JSON.parse(String(resp.choices[0].message.content) || "{}");
        // Save to DB
        const db = await getDb();
        if (db) {
          await db.insert(reviewRecords).values({
            userId: ctx.user.id,
            asin: input.asin,
            reviewId: input.reviewId,
            starRating: input.starRating,
            reviewTitle: input.reviewTitle,
            reviewContent: input.reviewContent,
            aiProblemCategory: analysis.problemCategory,
            aiSeverity: analysis.severity as any,
            aiKeyIssues: analysis.keyIssues,
            aiSentiment: analysis.sentiment as any,
            aiSuggestedReply: analysis.suggestedReply,
            aiInternalAction: analysis.internalAction,
            aiFollowUpNeeded: analysis.followUpNeeded ? 1 : 0,
            processStatus: "pending",
          });
        }
        return analysis;
      } catch { return { error: "AI分析失败" }; }
    }),

  // --- Review回复CRUD ---
  saveReviewReply: protectedProcedure
    .input(z.object({
      reviewRecordId: z.number(),
      aiDraftReply: z.string().optional(),
      editedReply: z.string().optional(),
      status: z.enum(["draft", "edited", "confirmed", "sent"]).default("draft"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const [existing] = await db.select().from(reviewReplies).where(eq(reviewReplies.reviewRecordId, input.reviewRecordId)).limit(1);
      if (existing) {
        await db.update(reviewReplies).set({
          editedReply: input.editedReply || existing.editedReply,
          finalReply: input.status === "confirmed" ? (input.editedReply || existing.editedReply || existing.aiDraftReply) : existing.finalReply,
          status: input.status,
          confirmedAt: input.status === "confirmed" ? new Date() : existing.confirmedAt,
        }).where(eq(reviewReplies.id, existing.id));
        return { success: true, id: existing.id };
      } else {
        const [result] = await db.insert(reviewReplies).values({
          reviewRecordId: input.reviewRecordId,
          userId: ctx.user.id,
          aiDraftReply: input.aiDraftReply,
          editedReply: input.editedReply,
          status: input.status,
        });
        return { success: true, id: result.insertId };
      }
    }),

  // --- 已处理的Review记录列表 ---
  getProcessedReviews: protectedProcedure
    .input(z.object({ page: z.number().default(1), pageSize: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { total: 0, list: [] };
      const list = await db.select().from(reviewRecords)
        .where(eq(reviewRecords.userId, ctx.user.id))
        .orderBy(desc(reviewRecords.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [countRes] = await db.select({ count: sql<number>`count(*)` }).from(reviewRecords).where(eq(reviewRecords.userId, ctx.user.id));
      return { total: countRes?.count || 0, list };
    }),

  // ============================================================
  // 3.2 退货分析 + AI根因诊断
  // ============================================================

  getReturnAnalysis: protectedProcedure
    .input(z.object({ sid: z.number().optional(), asin: z.string().optional() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      const raw = res.data || {};
      // Normalize mock/real data to match frontend expected structure
      const totalReturns = raw.total_returns || 0;
      const totalOrders = raw.total_orders || 0;
      const returnRate = raw.overall_return_rate || (totalOrders > 0 ? +((totalReturns / totalOrders) * 100).toFixed(2) : 0);
      const byAsin = raw.by_asin || [];
      const highReturnAsins = byAsin.filter((a: any) => a.return_rate > 8);
      const totalRefund = byAsin.reduce((s: number, a: any) => s + (a.total_returns || 0) * 25, 0); // Estimate $25 avg refund
      // Generate recent returns from by_asin data
      const recentReturns = byAsin.flatMap((a: any) =>
        (a.return_reasons || []).slice(0, 2).map((r: any, i: number) => ({
          order_id: `111-${Math.floor(Math.random() * 9000000 + 1000000)}-${Math.floor(Math.random() * 9000000 + 1000000)}`,
          asin: a.asin,
          return_reason: r.reason,
          status: ['refunded', 'pending', 'refunded'][i % 3],
          refund_amount: +(15 + Math.random() * 50).toFixed(2),
          return_date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().slice(0, 10),
        }))
      ).slice(0, 15);
      return {
        summary: { totalReturns, returnRate, refundAmount: totalRefund, highReturnAsinCount: highReturnAsins.length, totalOrders },
        trend: raw.trend || [],
        reasonDistribution: (raw.reasons || []).map((r: any) => ({ reason: r.reason, count: r.count, pct: r.pct })),
        asinReturns: byAsin,
        recentReturns,
        _dataSource: res._meta?.source || 'unknown',
      };
    }),

  getRmaList: protectedProcedure
    .input(z.object({ sid: z.number().optional(), page: z.number().default(1), pageSize: z.number().default(20) }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  getVoiceOfBuyer: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  // --- AI退货根因诊断 ---
  aiReturnDiagnosis: protectedProcedure
    .input(z.object({
      asin: z.string(),
      returnData: z.any(),
      reviewData: z.any().optional(),
      voiceOfBuyerData: z.any().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const prompt = `你是一位资深亚马逊运营专家，专注于退货分析和产品改进。请综合分析以下数据，诊断退货根因。

## ASIN: ${input.asin}

## 退货数据
${JSON.stringify(input.returnData, null, 2)}

## 相关差评数据
${input.reviewData ? JSON.stringify(input.reviewData, null, 2) : '暂无'}

## 买家之声数据
${input.voiceOfBuyerData ? JSON.stringify(input.voiceOfBuyerData, null, 2) : '暂无'}

## 分析要求
1. 识别退货的主要根因（交叉分析退货原因+差评+买家之声）
2. 每个根因给出证据链和影响占比
3. 按修复难度和影响力排序
4. 给出具体改进方案（产品改进/Listing优化/包装改进/客服流程）
5. 预估改进后退货率降低幅度

输出JSON格式。`;

      const resp = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊退货分析AI专家，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "return_diagnosis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                rootCauseAnalysis: { type: "string" },
                primaryCauses: { type: "array", items: { type: "object", properties: { cause: { type: "string" }, evidence: { type: "string" }, impactPct: { type: "number" }, fixDifficulty: { type: "string" } }, required: ["cause", "evidence", "impactPct", "fixDifficulty"], additionalProperties: false } },
                improvementPlan: { type: "array", items: { type: "object", properties: { priority: { type: "number" }, action: { type: "string" }, category: { type: "string" }, expectedReduction: { type: "string" } }, required: ["priority", "action", "category", "expectedReduction"], additionalProperties: false } },
                listingOptimization: { type: "string" },
                estimatedReturnRateReduction: { type: "number" },
              },
              required: ["rootCauseAnalysis", "primaryCauses", "improvementPlan", "listingOptimization", "estimatedReturnRateReduction"],
              additionalProperties: false,
            },
          },
        },
      });

      try {
        const diagnosis = JSON.parse(String(resp.choices[0].message.content) || "{}");
        // Cache to DB
        const db = await getDb();
        if (db) {
          await db.insert(returnAnalysisCache).values({
            userId: ctx.user.id,
            asin: input.asin,
            returnRate: input.returnData?.return_rate ? Number(input.returnData.return_rate) : null,
            totalReturns: input.returnData?.total_returns,
            totalOrders: input.returnData?.total_orders,
            returnReasons: input.returnData?.return_reasons,
            aiRootCauseAnalysis: diagnosis.rootCauseAnalysis,
            aiPrimaryCauses: diagnosis.primaryCauses,
            aiImprovementPlan: diagnosis.improvementPlan,
            aiListingOptimization: diagnosis.listingOptimization,
          } as any);
        }
        return diagnosis;
      } catch { return { error: "AI诊断失败" }; }
    }),

  // ============================================================
  // 3.3 AI客服回复 + 邮件模板
  // ============================================================

  getEmails: protectedProcedure
    .input(z.object({ sid: z.number().optional(), page: z.number().default(1), pageSize: z.number().default(20) }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  getEmailDetail: protectedProcedure
    .input(z.object({ mailId: z.string() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  // --- AI邮件分类+回复生成 ---
  aiEmailReply: protectedProcedure
    .input(z.object({
      emailId: z.string(),
      subject: z.string(),
      content: z.string(),
      orderId: z.string().optional(),
      asin: z.string().optional(),
      buyerEmail: z.string().optional(),
      history: z.array(z.object({ direction: z.string(), content: z.string(), date: z.string() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const prompt = `你是一位资深亚马逊客服专家。请分析以下买家邮件并生成回复。

## 邮件信息
- 主题: ${input.subject}
- 订单号: ${input.orderId || '未知'}
- ASIN: ${input.asin || '未知'}
- 内容: ${input.content}
${input.history ? `\n## 历史对话\n${input.history.map(h => `[${h.direction}] ${h.date}: ${h.content}`).join('\n')}` : ''}

## 要求
1. 分类邮件类型
2. 评估紧急程度
3. 生成英文回复草稿（专业、友好、提供解决方案）
4. 如果是退货/退款请求，提供处理建议

输出JSON格式。`;

      const resp = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊客服AI助手，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "email_reply",
            strict: true,
            schema: {
              type: "object",
              properties: {
                classification: { type: "string" },
                urgencyLevel: { type: "string" },
                draftReply: { type: "string" },
                handlingAdvice: { type: "string" },
                suggestedActions: { type: "array", items: { type: "string" } },
              },
              required: ["classification", "urgencyLevel", "draftReply", "handlingAdvice", "suggestedActions"],
              additionalProperties: false,
            },
          },
        },
      });

      try {
        const result = JSON.parse(String(resp.choices[0].message.content) || "{}");
        // Save to DB
        const db = await getDb();
        if (db) {
          await db.insert(emailReplies).values({
            userId: ctx.user.id,
            emailId: input.emailId,
            buyerEmail: input.buyerEmail,
            orderId: input.orderId,
            asin: input.asin,
            emailCategory: result.classification?.includes("return") ? "return_request" : result.classification?.includes("complaint") ? "complaint" : result.classification?.includes("inquiry") ? "product_inquiry" : "other",
            urgencyLevel: (result.urgencyLevel === "critical" || result.urgencyLevel === "high" || result.urgencyLevel === "medium" || result.urgencyLevel === "low") ? result.urgencyLevel : "medium",
            aiClassification: result.classification,
            aiDraftReply: result.draftReply,
            status: "draft",
          } as any);
        }
        return result;
      } catch { return { error: "AI回复生成失败" }; }
    }),

  // --- 邮件回复保存 ---
  saveEmailReply: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      emailId: z.string(),
      editedReply: z.string(),
      status: z.enum(["draft", "replied"]).default("draft"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      if (input.id) {
        await db.update(emailReplies).set({
          editedReply: input.editedReply,
          finalReply: input.status === "replied" ? input.editedReply : undefined,
          status: input.status,
          repliedAt: input.status === "replied" ? new Date() : undefined,
        }).where(eq(emailReplies.id, input.id));
        return { success: true, id: input.id };
      }
      const [result] = await db.insert(emailReplies).values({
        userId: ctx.user.id,
        emailId: input.emailId,
        editedReply: input.editedReply,
        status: input.status,
      } as any);
      return { success: true, id: result.insertId };
    }),

  // --- 邮件模板CRUD ---
  listTemplates: protectedProcedure
    .input(z.object({ category: z.string().optional(), language: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      let query = db.select().from(emailTemplates).where(eq(emailTemplates.userId, ctx.user.id));
      return await query.orderBy(desc(emailTemplates.usageCount));
    }),

  createTemplate: protectedProcedure
    .input(z.object({
      category: z.enum(["return_handling", "product_inquiry", "negative_review_reply", "positive_review_thanks", "logistics_inquiry", "after_sales_followup", "other"]),
      templateName: z.string(),
      subject: z.string().optional(),
      bodyContent: z.string(),
      language: z.string().default("en"),
      variables: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const [result] = await db.insert(emailTemplates).values({
        userId: ctx.user.id,
        category: input.category,
        templateName: input.templateName,
        subject: input.subject,
        bodyContent: input.bodyContent,
        language: input.language,
        variables: input.variables,
      });
      return { success: true, id: result.insertId };
    }),

  updateTemplate: protectedProcedure
    .input(z.object({
      id: z.number(),
      templateName: z.string().optional(),
      subject: z.string().optional(),
      bodyContent: z.string().optional(),
      category: z.enum(["return_handling", "product_inquiry", "negative_review_reply", "positive_review_thanks", "logistics_inquiry", "after_sales_followup", "other"]).optional(),
      language: z.string().optional(),
      variables: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const { id, ...updates } = input;
      const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(filtered).length > 0) {
        await db.update(emailTemplates).set(filtered).where(and(eq(emailTemplates.id, id), eq(emailTemplates.userId, ctx.user.id)));
      }
      return { success: true };
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.delete(emailTemplates).where(and(eq(emailTemplates.id, input.id), eq(emailTemplates.userId, ctx.user.id)));
      return { success: true };
    }),

  // --- AI模板生成 ---
  aiGenerateTemplate: protectedProcedure
    .input(z.object({
      category: z.string(),
      scenario: z.string(),
      language: z.string().default("en"),
      tone: z.string().default("professional"),
    }))
    .mutation(async ({ input }) => {
      const prompt = `你是一位亚马逊客服模板专家。请根据以下要求生成邮件模板。

## 要求
- 分类: ${input.category}
- 场景: ${input.scenario}
- 语言: ${input.language}
- 语气: ${input.tone}

## 输出要求
1. 模板名称
2. 邮件主题
3. 邮件正文（使用{buyer_name}, {order_id}, {product_name}, {tracking_number}等变量占位符）
4. 使用的变量列表

输出JSON格式。`;

      const resp = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊客服模板AI专家，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "email_template",
            strict: true,
            schema: {
              type: "object",
              properties: {
                templateName: { type: "string" },
                subject: { type: "string" },
                bodyContent: { type: "string" },
                variables: { type: "array", items: { type: "string" } },
              },
              required: ["templateName", "subject", "bodyContent", "variables"],
              additionalProperties: false,
            },
          },
        },
      });
      try { return JSON.parse(String(resp.choices[0].message.content) || "{}"); }
      catch { return { error: "AI模板生成失败" }; }
    }),

  // --- 售后任务管理 ---
  listServiceTasks: protectedProcedure
    .input(z.object({
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
      taskType: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { total: 0, list: [] };
      const conditions = [eq(serviceTasks.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(serviceTasks.status, input.status));
      const list = await db.select().from(serviceTasks)
        .where(and(...conditions))
        .orderBy(desc(serviceTasks.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [countRes] = await db.select({ count: sql<number>`count(*)` }).from(serviceTasks).where(and(...conditions));
      return { total: countRes?.count || 0, list };
    }),

  createServiceTask: protectedProcedure
    .input(z.object({
      taskType: z.enum(["negative_review", "return_handling", "email_reply", "rma_processing", "performance_notice", "feedback_response"]),
      relatedId: z.string().optional(),
      asin: z.string().optional(),
      sid: z.number().optional(),
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
      dueDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const [result] = await db.insert(serviceTasks).values({
        userId: ctx.user.id,
        ...input,
      });
      return { success: true, id: result.insertId };
    }),

  updateServiceTask: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
      priority: z.enum(["critical", "high", "medium", "low"]).optional(),
      assignedTo: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const { id, ...updates } = input;
      const filtered: any = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (updates.status === "resolved") filtered.resolvedAt = new Date();
      await db.update(serviceTasks).set(filtered).where(and(eq(serviceTasks.id, id), eq(serviceTasks.userId, ctx.user.id)));
      return { success: true };
    }),

  // --- Feedback列表 ---
  getFeedbackList: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),

  // --- 业绩通知 ---
  getPerformanceNotices: protectedProcedure
    .input(z.object({ sid: z.number().optional() }))
    .query(async ({ input }) => {
      const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      return { ...(res.data || {}), _dataSource: res._meta?.source || 'unknown' };
    }),
});
