import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";

// ─── 3.7 DSP广告分析 ──────────────────────────────────────────────

// ─── 3.9 AI广告问答Bot ────────────────────────────────────────────

const AD_KNOWLEDGE_BASE = `
## 亚马逊广告类型基础知识

### SP (Sponsored Products) 商品推广
- 最常用的广告类型，按CPC付费
- 展示在搜索结果页和商品详情页
- 支持自动投放和手动投放（关键词/商品定位）
- 匹配类型：广泛匹配、词组匹配、精准匹配
- 适合所有卖家，是广告投放的基础

### SB (Sponsored Brands) 品牌推广
- 仅限品牌注册卖家使用
- 展示在搜索结果页顶部（头条位置）
- 支持品牌旗舰店、商品集合、视频广告
- 适合品牌曝光和新品推广
- 通常CPC高于SP，但品牌曝光效果好

### SD (Sponsored Display) 展示型推广
- 支持站内外展示广告
- 按CPC或vCPM付费
- 支持商品定位和受众定位（浏览/购买再营销）
- 适合防守竞品和再营销
- 展示在商品详情页、搜索结果页、站外网站

### DSP (Demand-Side Platform) 程序化展示广告
- 面向站外流量和品牌展示
- 按CPM付费，预算门槛较高
- 支持精准受众定位（人群画像、购买行为）
- 适合品牌建设和全漏斗营销
- 核心指标：DPV（详情页浏览）、可见曝光、加购次数

## 广告优化最佳实践

### ACoS控制
- 新品期ACoS可接受30-50%，以获取流量和排名
- 成长期目标ACoS 20-30%
- 成熟期目标ACoS 15-25%
- 利润率低的产品需要更严格的ACoS控制

### 否定词策略
- 定期检查搜索词报告，否定不相关词
- 高花费低转化的词优先否定
- 品牌词被竞品触发时需要精准否定
- 否定词分三个层级：活动级、广告组级、账户级

### 竞价策略
- 新品建议使用建议竞价的1.2-1.5倍
- 核心词可使用Top of Search加价50-100%
- 长尾词使用较低竞价，控制花费
- 分时竞价：根据出单高峰时段调整竞价

### 广告结构
- 建议按匹配类型分组：自动/广泛/词组/精准
- 每个广告组控制5-20个关键词
- 高表现词单独建精准匹配广告组
- 定期从自动广告中收割高表现搜索词到手动广告
`;

// ─── 3.12 跨渠道广告分析 ──────────────────────────────────────────

export const adAnalysisP2Router = router({

  // ═══════════════════════════════════════════════════════════════
  // 3.7 DSP广告分析
  // ═══════════════════════════════════════════════════════════════

  getDspReport: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/basicopen/dapReport/order/list",
        method: "POST",
        body: {
          start_date: input.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          end_date: input.endDate || new Date().toISOString().slice(0, 10),
        },
      });

      const orders = Array.isArray(res.data) ? res.data : [];

      // Aggregate KPIs
      let totalSpends = 0, totalSales = 0, totalOrders = 0;
      let totalImpressions = 0, totalViewable = 0, totalClicks = 0;
      let totalDpv = 0, totalAddToCart = 0, totalBudget = 0;

      for (const o of orders) {
        totalBudget += o.order_budget || 0;
        totalSpends += o.spends || 0;
        totalSales += o.sales || 0;
        totalOrders += o.orders || 0;
        totalImpressions += o.impressions || 0;
        totalViewable += o.viewable_impressions || 0;
        totalClicks += o.clicks || 0;
        totalDpv += o.dpv || 0;
        totalAddToCart += o.total_add_to_cart || 0;
      }

      const roas = totalSpends > 0 ? +(totalSales / totalSpends).toFixed(2) : 0;
      const acos = totalSales > 0 ? +((totalSpends / totalSales) * 100).toFixed(2) : 0;
      const ctr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(4) : 0;
      const viewabilityRate = totalImpressions > 0 ? +((totalViewable / totalImpressions) * 100).toFixed(2) : 0;

      return {
        orders,
        kpi: {
          totalBudget: +totalBudget.toFixed(2),
          totalSpends: +totalSpends.toFixed(2),
          totalSales: +totalSales.toFixed(2),
          totalOrders,
          totalImpressions,
          totalViewable,
          totalClicks,
          totalDpv,
          totalAddToCart,
          roas, acos, ctr, viewabilityRate,
        },
        _meta: res._meta,
      };
    }),

  aiDspStrategy: protectedProcedure
    .input(z.object({
      kpi: z.object({
        totalSpends: z.number(),
        totalSales: z.number(),
        totalOrders: z.number(),
        totalImpressions: z.number(),
        totalDpv: z.number(),
        totalAddToCart: z.number(),
        roas: z.number(),
        acos: z.number(),
        viewabilityRate: z.number(),
      }),
      topOrders: z.array(z.object({
        order_name: z.string(),
        spends: z.number(),
        sales: z.number(),
        roas: z.number().optional(),
        dpv: z.number(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位亚马逊DSP广告专家。请基于以下DSP广告数据给出投放优化建议。

## 角色定位
- 精通DSP程序化广告的受众定位、创意优化和预算分配
- 基于数据给出具体可操作的建议
- 回答简洁专业，使用4阶段建议格式

## 输出格式（JSON）
{
  "problemAnalysis": "问题分析（分析DSP投放现状和主要问题）",
  "adPurpose": "优化目标（明确DSP优化方向）",
  "adStrategy": "优化策略（具体可执行的DSP优化措施，用❶❷❸编号）",
  "expectedResult": "预期效果（量化预期改善）",
  "orderRecommendations": [
    {"orderName": "DSP订单名", "action": "建议操作", "reason": "原因"}
  ]
}`
          },
          {
            role: "user",
            content: `DSP广告数据概览：
- 总花费: $${input.kpi.totalSpends}
- 总销售额: $${input.kpi.totalSales}
- ROAS: ${input.kpi.roas}x
- ACoS: ${input.kpi.acos}%
- 总订单: ${input.kpi.totalOrders}
- 总曝光: ${input.kpi.totalImpressions.toLocaleString()}
- DPV: ${input.kpi.totalDpv}
- 加购: ${input.kpi.totalAddToCart}
- 可见曝光率: ${input.kpi.viewabilityRate}%

${input.topOrders ? `TOP DSP订单:\n${input.topOrders.map(o => `- ${o.order_name}: 花费$${o.spends}, 销售$${o.sales}, DPV ${o.dpv}`).join('\n')}` : ''}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dsp_strategy",
            strict: true,
            schema: {
              type: "object",
              properties: {
                problemAnalysis: { type: "string" },
                adPurpose: { type: "string" },
                adStrategy: { type: "string" },
                expectedResult: { type: "string" },
                orderRecommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      orderName: { type: "string" },
                      action: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["orderName", "action", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["problemAnalysis", "adPurpose", "adStrategy", "expectedResult", "orderRecommendations"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ═══════════════════════════════════════════════════════════════
  // 3.9 AI广告问答Bot
  // ═══════════════════════════════════════════════════════════════

  adChatBot: protectedProcedure
    .input(z.object({
      question: z.string().min(1).max(2000),
      asin: z.string().optional(),
      marketplace: z.string().optional(),
      conversationHistory: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      // Build context data if ASIN is provided
      let contextData = "";
      if (input.asin) {
        try {
          const adapter = getLingxingAdapter();
          // Fetch recent ad data for context
          const adRes = await adapter.requestWithMockFallback({
            path: "/ph/openaps/newad/spAdvertiseHourData",
            method: "POST",
            body: {
              asin: input.asin,
              start_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
              end_date: new Date().toISOString().slice(0, 10),
            },
          });
          const adData = Array.isArray(adRes.data) ? adRes.data : [];
          if (adData.length > 0) {
            let totalCost = 0, totalSales = 0, totalClicks = 0, totalImpressions = 0, totalOrders = 0;
            adData.forEach((d: any) => {
              totalCost += d.cost || d.spend || 0;
              totalSales += d.sales || 0;
              totalClicks += d.clicks || 0;
              totalImpressions += d.impressions || 0;
              totalOrders += d.orders || 0;
            });
            const acos = totalSales > 0 ? ((totalCost / totalSales) * 100).toFixed(2) : "N/A";
            const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "N/A";
            const cvr = totalClicks > 0 ? ((totalOrders / totalClicks) * 100).toFixed(2) : "N/A";
            // Anonymize ASIN
            contextData = `\n当前分析产品: Product_001\n近7天广告数据:\n- 花费: $${totalCost.toFixed(2)}\n- 销售额: $${totalSales.toFixed(2)}\n- ACoS: ${acos}%\n- 点击: ${totalClicks}\n- 曝光: ${totalImpressions}\n- CTR: ${ctr}%\n- CVR: ${cvr}%\n- 订单: ${totalOrders}`;
          }
        } catch (e) {
          // Context data is optional, continue without it
        }
      }

      // Build conversation messages
      const messages: any[] = [
        {
          role: "system",
          content: `你是一位亚马逊广告运营AI助手，精通SP/SB/SD/DSP四种广告类型。
你可以访问用户的广告数据来回答问题。

## 角色定位
- 基于数据回答，不编造数据
- 给出具体可操作的建议，而非泛泛而谈
- 回答简洁专业，控制在300字以内
- 涉及具体ASIN时，使用脱敏后的产品标识

## 可用数据上下文
${contextData || "（未选择具体ASIN，无法获取实时数据）"}

## 亚马逊广告知识库摘要
${AD_KNOWLEDGE_BASE}

## 输出格式（JSON）
{
  "answer": "回答内容（支持Markdown格式）",
  "data_cards": [
    {"title": "卡片标题", "metrics": [{"label": "指标名", "value": "值"}]}
  ],
  "actionable_suggestions": [
    {"action": "可执行操作", "can_auto_execute": false}
  ],
  "related_questions": ["相关问题1", "相关问题2"]
}`
        },
      ];

      // Add conversation history
      if (input.conversationHistory) {
        for (const msg of input.conversationHistory.slice(-6)) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      messages.push({ role: "user", content: input.question });

      const response = await invokeLLM({
        messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_chat_response",
            strict: true,
            schema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                data_cards: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      metrics: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            label: { type: "string" },
                            value: { type: "string" },
                          },
                          required: ["label", "value"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["title", "metrics"],
                    additionalProperties: false,
                  },
                },
                actionable_suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      can_auto_execute: { type: "boolean" },
                    },
                    required: ["action", "can_auto_execute"],
                    additionalProperties: false,
                  },
                },
                related_questions: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["answer", "data_cards", "actionable_suggestions", "related_questions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

  // ═══════════════════════════════════════════════════════════════
  // 3.12 跨渠道广告分析
  // ═══════════════════════════════════════════════════════════════

  getCrossChannelData: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const startDate = input.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const endDate = input.endDate || new Date().toISOString().slice(0, 10);
      const baseParams = { start_date: startDate, end_date: endDate };

      // Fetch all 4 channels in parallel
      const [spRes, sbRes, sdRes, dspRes] = await Promise.all([
        adapter.requestWithMockFallback({ path: "/pb/openaps/newad/spCampaignHourData", body: baseParams }),
        adapter.requestWithMockFallback({ path: "/pb/openaps/newad/sbCampaignHourData", body: baseParams }),
        adapter.requestWithMockFallback({ path: "/pb/openaps/newad/sdCampaignHourData", body: baseParams }),
        adapter.requestWithMockFallback({ path: "/basicopen/dapReport/order/list", body: baseParams }),
      ]);

      function aggregateChannel(data: any[], channelName: string) {
        const items = Array.isArray(data) ? data : [];
        let cost = 0, sales = 0, clicks = 0, impressions = 0, orders = 0;
        items.forEach((d: any) => {
          cost += d.cost || d.spends || d.spend || 0;
          sales += d.sales || 0;
          clicks += d.clicks || 0;
          impressions += d.impressions || 0;
          orders += d.orders || 0;
        });
        const acos = sales > 0 ? +((cost / sales) * 100).toFixed(2) : 0;
        const roas = cost > 0 ? +(sales / cost).toFixed(2) : 0;
        const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(4) : 0;
        const cvr = clicks > 0 ? +((orders / clicks) * 100).toFixed(2) : 0;
        const cpc = clicks > 0 ? +(cost / clicks).toFixed(2) : 0;
        return {
          channel: channelName,
          cost: +cost.toFixed(2),
          sales: +sales.toFixed(2),
          clicks, impressions, orders,
          acos, roas, ctr, cvr, cpc,
          campaignCount: items.length,
        };
      }

      const channels = [
        aggregateChannel(spRes.data, "SP"),
        aggregateChannel(sbRes.data, "SB"),
        aggregateChannel(sdRes.data, "SD"),
        aggregateChannel(dspRes.data, "DSP"),
      ];

      const totalCost = channels.reduce((s, c) => s + c.cost, 0);
      const totalSales = channels.reduce((s, c) => s + c.sales, 0);

      // Add percentage shares
      const channelsWithShare = channels.map(c => ({
        ...c,
        costShare: totalCost > 0 ? +((c.cost / totalCost) * 100).toFixed(1) : 0,
        salesShare: totalSales > 0 ? +((c.sales / totalSales) * 100).toFixed(1) : 0,
      }));

      return {
        channels: channelsWithShare,
        total: {
          cost: +totalCost.toFixed(2),
          sales: +totalSales.toFixed(2),
          acos: totalSales > 0 ? +((totalCost / totalSales) * 100).toFixed(2) : 0,
          roas: totalCost > 0 ? +(totalSales / totalCost).toFixed(2) : 0,
        },
      };
    }),

  aiChannelStrategy: protectedProcedure
    .input(z.object({
      channels: z.array(z.object({
        channel: z.string(),
        cost: z.number(),
        sales: z.number(),
        acos: z.number(),
        roas: z.number(),
        orders: z.number(),
        costShare: z.number(),
      })),
      totalCost: z.number(),
      totalSales: z.number(),
    }))
    .mutation(async ({ input }) => {
      const channelSummary = input.channels.map(c =>
        `${c.channel}: 花费$${c.cost}(${c.costShare}%), 销售$${c.sales}, ACoS ${c.acos}%, ROAS ${c.roas}x, 订单${c.orders}`
      ).join('\n');

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位亚马逊全渠道广告策略专家。请基于SP/SB/SD/DSP四渠道数据给出预算分配优化建议。

## 输出格式（JSON）
{
  "problemAnalysis": "当前渠道分配问题分析",
  "adPurpose": "优化目标",
  "adStrategy": "预算重新分配策略（用❶❷❸编号）",
  "expectedResult": "预期效果",
  "budgetAllocation": [
    {"channel": "SP", "currentPct": 当前占比, "suggestedPct": 建议占比, "reason": "原因"}
  ]
}`
          },
          {
            role: "user",
            content: `四渠道广告数据：\n${channelSummary}\n\n总花费: $${input.totalCost}\n总销售: $${input.totalSales}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "channel_strategy",
            strict: true,
            schema: {
              type: "object",
              properties: {
                problemAnalysis: { type: "string" },
                adPurpose: { type: "string" },
                adStrategy: { type: "string" },
                expectedResult: { type: "string" },
                budgetAllocation: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      channel: { type: "string" },
                      currentPct: { type: "number" },
                      suggestedPct: { type: "number" },
                      reason: { type: "string" },
                    },
                    required: ["channel", "currentPct", "suggestedPct", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["problemAnalysis", "adPurpose", "adStrategy", "expectedResult", "budgetAllocation"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),
});
