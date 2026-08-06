import { z } from "zod";

export const adDateRangeInput = z.object({
  marketplace: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const dspStrategyInput = z.object({
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
});

export const adChatInput = z.object({
  question: z.string().min(1).max(2000),
  campaignId: z.string().optional(),
  campaignIds: z.array(z.string()).optional(),
  marketplace: z.string().optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })).optional(),
});

export const channelStrategyInput = z.object({
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
});
