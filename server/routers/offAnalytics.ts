import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { ATTRIBUTION_ANALYSIS_PROMPT } from "./offsitePrompts";

export const offAnalyticsRouter = router({
  // Attribution Links
  listLinks: protectedProcedure.input(z.object({
    campaignId: z.number().optional(),
  }).optional()).query(async ({ ctx, input }) => {
    return offDb.listAttributionLinks(ctx.user.id, input || {});
  }),

  createLink: protectedProcedure.input(z.object({
    originalUrl: z.string(), campaignId: z.number().optional(),
    influencerId: z.number().optional(), utmSource: z.string().optional(),
    utmMedium: z.string().optional(), utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    // Build tracking URL with UTM params
    const url = new URL(input.originalUrl);
    if (input.utmSource) url.searchParams.set("utm_source", input.utmSource);
    if (input.utmMedium) url.searchParams.set("utm_medium", input.utmMedium);
    if (input.utmCampaign) url.searchParams.set("utm_campaign", input.utmCampaign);
    if (input.utmContent) url.searchParams.set("utm_content", input.utmContent);
    const shortCode = Math.random().toString(36).substring(2, 10);
    const id = await offDb.createAttributionLink({
      ...input, userId: ctx.user.id, trackingUrl: url.toString(), shortCode,
    });
    return { id, trackingUrl: url.toString(), shortCode };
  }),

  updateLink: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateAttributionLink(input.id, input.data);
    return { success: true };
  }),

  // Dashboard Stats
  getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
    return offDb.getOffsiteDashboardStats(ctx.user.id);
  }),

  // Campaign Analytics
  getCampaignAnalytics: protectedProcedure.input(z.object({
    campaignId: z.number(),
  })).query(async ({ input }) => {
    return offDb.getCampaignAnalytics(input.campaignId);
  }),

  // AI Attribution Analysis
  aiAttributionAnalysis: protectedProcedure.input(z.object({
    campaignIds: z.array(z.number()).optional(),
    dateRange: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const campaigns = await offDb.listCampaigns(ctx.user.id, {});
    const links = await offDb.listAttributionLinks(ctx.user.id, {});
    const startTime = Date.now();
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: ATTRIBUTION_ANALYSIS_PROMPT },
        { role: "user", content: `活动列表: ${JSON.stringify(campaigns)}\n归因链接: ${JSON.stringify(links)}\n分析范围: ${input.dateRange || "最近30天"}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { raw: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "attribution_analysis", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),
});
