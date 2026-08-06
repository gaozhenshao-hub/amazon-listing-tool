import type { z } from "zod";
import { invokeBusinessSkill } from "../ai_os/services/businessSkillGateway";
import { adsRepository as repository } from "./repository";
import type {
  adChatInput,
  adDateRangeInput,
  channelStrategyInput,
  dspStrategyInput,
} from "./schema";
import type { AdChannelName, AdRecord } from "./types";

type DateRangeInput = z.infer<typeof adDateRangeInput>;
type DspStrategyInput = z.infer<typeof dspStrategyInput>;
type AdChatInput = z.infer<typeof adChatInput>;
type ChannelStrategyInput = z.infer<typeof channelStrategyInput>;

const AD_KNOWLEDGE_BASE = `
SP商品推广按CPC付费，适合承接搜索流量；SB品牌推广用于品牌曝光；
SD支持站内外展示与再营销；DSP适合程序化受众投放和全漏斗营销。
优化时应联合检查ACoS、ROAS、CTR、CVR、否定词、竞价、广告结构和分时表现。
`;

function parseSkillJson(response: Awaited<ReturnType<typeof invokeBusinessSkill>>) {
  const content = response.choices?.[0]?.message?.content;
  return JSON.parse(String(content || "{}"));
}

function aggregateChannel(data: AdRecord[], channel: AdChannelName) {
  let cost = 0;
  let sales = 0;
  let clicks = 0;
  let impressions = 0;
  let orders = 0;
  for (const row of data) {
    cost += row.cost || row.spends || row.spend || 0;
    sales += row.sales || 0;
    clicks += row.clicks || 0;
    impressions += row.impressions || 0;
    orders += row.orders || 0;
  }
  return {
    channel,
    cost: +cost.toFixed(2),
    sales: +sales.toFixed(2),
    clicks,
    impressions,
    orders,
    acos: sales > 0 ? +((cost / sales) * 100).toFixed(2) : 0,
    roas: cost > 0 ? +(sales / cost).toFixed(2) : 0,
    ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(4) : 0,
    cvr: clicks > 0 ? +((orders / clicks) * 100).toFixed(2) : 0,
    cpc: clicks > 0 ? +(cost / clicks).toFixed(2) : 0,
    campaignCount: data.length,
  };
}

function dailyBreakdown(data: AdRecord[]) {
  const daily: Record<string, { cost: number; sales: number; orders: number; clicks: number; impressions: number }> = {};
  for (const row of data) {
    const date = String(row.date || row.report_date || row.queryDate || "").slice(0, 10);
    if (!date) continue;
    daily[date] ||= { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    daily[date].cost += row.cost || row.spends || row.spend || 0;
    daily[date].sales += row.sales || 0;
    daily[date].orders += row.orders || 0;
    daily[date].clicks += row.clicks || 0;
    daily[date].impressions += row.impressions || 0;
  }
  return daily;
}

const dspStrategyFormat = {
  type: "json_schema" as const,
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
};

const adChatFormat = {
  type: "json_schema" as const,
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
                  properties: { label: { type: "string" }, value: { type: "string" } },
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
            properties: { action: { type: "string" }, can_auto_execute: { type: "boolean" } },
            required: ["action", "can_auto_execute"],
            additionalProperties: false,
          },
        },
        related_questions: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "data_cards", "actionable_suggestions", "related_questions"],
      additionalProperties: false,
    },
  },
};

const channelStrategyFormat = {
  type: "json_schema" as const,
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
};

export const adsAnalysisService = {
  async getDspReport(_input: DateRangeInput) {
    const result = repository.getDspOrders();
    const orders = Array.isArray(result.data) ? result.data : [];
    let totalSpends = 0;
    let totalSales = 0;
    let totalOrders = 0;
    let totalImpressions = 0;
    let totalViewable = 0;
    let totalClicks = 0;
    let totalDpv = 0;
    let totalAddToCart = 0;
    let totalBudget = 0;
    for (const order of orders) {
      totalBudget += order.order_budget || 0;
      totalSpends += order.spends || 0;
      totalSales += order.sales || 0;
      totalOrders += order.orders || 0;
      totalImpressions += order.impressions || 0;
      totalViewable += order.viewable_impressions || 0;
      totalClicks += order.clicks || 0;
      totalDpv += order.dpv || 0;
      totalAddToCart += order.total_add_to_cart || 0;
    }
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
        roas: totalSpends > 0 ? +(totalSales / totalSpends).toFixed(2) : 0,
        acos: totalSales > 0 ? +((totalSpends / totalSales) * 100).toFixed(2) : 0,
        ctr: totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(4) : 0,
        viewabilityRate: totalImpressions > 0 ? +((totalViewable / totalImpressions) * 100).toFixed(2) : 0,
      },
      _meta: result._meta,
    };
  },

  async aiDspStrategy(input: DspStrategyInput) {
    const topOrders = input.topOrders?.map((order) => (
      `- ${order.order_name}: 花费$${order.spends}, 销售$${order.sales}, DPV ${order.dpv}`
    )).join("\n") || "";
    const response = await invokeBusinessSkill({
      messages: [
        {
          role: "system",
          content: "你是一位亚马逊DSP广告专家。基于数据返回问题分析、优化目标、优化策略、预期效果和逐订单建议。",
        },
        {
          role: "user",
          content: `总花费: $${input.kpi.totalSpends}\n总销售额: $${input.kpi.totalSales}\nROAS: ${input.kpi.roas}x\nACoS: ${input.kpi.acos}%\n订单: ${input.kpi.totalOrders}\n曝光: ${input.kpi.totalImpressions}\nDPV: ${input.kpi.totalDpv}\n加购: ${input.kpi.totalAddToCart}\n可见曝光率: ${input.kpi.viewabilityRate}%\n${topOrders}`,
        },
      ],
      response_format: dspStrategyFormat,
    });
    return parseSkillJson(response);
  },

  async adChatBot(input: AdChatInput) {
    let contextData = "（未选择具体广告活动，无法获取实时数据）";
    if (input.campaignId) {
      try {
        const rows = repository.getCampaignContext(input.campaignId).data || [];
        const metric = aggregateChannel(rows, "SP");
        contextData = `当前分析产品: Product_001\n近7天广告数据:\n- 花费: $${metric.cost}\n- 销售额: $${metric.sales}\n- ACoS: ${metric.acos}%\n- 点击: ${metric.clicks}\n- 曝光: ${metric.impressions}\n- CVR: ${metric.cvr}%\n- 订单: ${metric.orders}`;
      } catch {
        // Context is optional; the Skill must clearly state when live data is unavailable.
      }
    }
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [{
      role: "system",
      content: `你是一位亚马逊广告运营AI助手。基于数据回答，不编造数据，给出具体建议并控制在300字以内。\n数据上下文:\n${contextData}\n知识库:\n${AD_KNOWLEDGE_BASE}`,
    }];
    messages.push(...(input.conversationHistory || []).slice(-6));
    messages.push({ role: "user", content: input.question });
    return parseSkillJson(await invokeBusinessSkill({ messages, response_format: adChatFormat }));
  },

  async getCrossChannelData(input: DateRangeInput) {
    const startDate = input.startDate || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const endDate = input.endDate || new Date().toISOString().slice(0, 10);
    const names: AdChannelName[] = ["SP", "SB", "SD", "DSP"];
    const rows = Object.fromEntries(names.map((name) => [name, repository.getChannelRows(name, startDate, endDate).data || []])) as Record<AdChannelName, AdRecord[]>;
    const channels = names.map((name) => aggregateChannel(rows[name], name));
    const totalCost = channels.reduce((sum, channel) => sum + channel.cost, 0);
    const totalSales = channels.reduce((sum, channel) => sum + channel.sales, 0);
    const daily = Object.fromEntries(names.map((name) => [name, dailyBreakdown(rows[name])])) as Record<AdChannelName, ReturnType<typeof dailyBreakdown>>;
    const dates = new Set<string>();
    for (const name of names) Object.keys(daily[name]).forEach((date) => dates.add(date));
    for (let date = new Date(startDate); date <= new Date(endDate); date.setDate(date.getDate() + 1)) {
      dates.add(date.toISOString().slice(0, 10));
    }
    const zero = { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    return {
      channels: channels.map((channel) => ({
        ...channel,
        costShare: totalCost > 0 ? +((channel.cost / totalCost) * 100).toFixed(1) : 0,
        salesShare: totalSales > 0 ? +((channel.sales / totalSales) * 100).toFixed(1) : 0,
      })),
      total: {
        cost: +totalCost.toFixed(2),
        sales: +totalSales.toFixed(2),
        acos: totalSales > 0 ? +((totalCost / totalSales) * 100).toFixed(2) : 0,
        roas: totalCost > 0 ? +(totalSales / totalCost).toFixed(2) : 0,
      },
      dailyBreakdown: [...dates].sort().map((date) => {
        const value = Object.fromEntries(names.map((name) => [name, daily[name][date] || { ...zero }])) as Record<AdChannelName, typeof zero>;
        return {
          date,
          ...value,
          total: {
            cost: +names.reduce((sum, name) => sum + value[name].cost, 0).toFixed(2),
            sales: +names.reduce((sum, name) => sum + value[name].sales, 0).toFixed(2),
            orders: names.reduce((sum, name) => sum + value[name].orders, 0),
          },
        };
      }),
      dateRange: { startDate, endDate },
    };
  },

  async aiChannelStrategy(input: ChannelStrategyInput) {
    const summary = input.channels.map((channel) => (
      `${channel.channel}: 花费$${channel.cost}(${channel.costShare}%), 销售$${channel.sales}, ACoS ${channel.acos}%, ROAS ${channel.roas}x, 订单${channel.orders}`
    )).join("\n");
    const response = await invokeBusinessSkill({
      messages: [
        {
          role: "system",
          content: "你是一位亚马逊全渠道广告策略专家。根据SP/SB/SD/DSP数据返回问题、目标、预算策略、预期效果和渠道预算分配。",
        },
        { role: "user", content: `${summary}\n总花费: $${input.totalCost}\n总销售: $${input.totalSales}` },
      ],
      response_format: channelStrategyFormat,
    });
    return parseSkillJson(response);
  },
};
