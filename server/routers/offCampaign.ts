import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { CAMPAIGN_ANALYSIS_PROMPT } from "./offsitePrompts";

export const offCampaignRouter = router({
  list: protectedProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    return offDb.listCampaigns(ctx.user.id, input || {});
  }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const campaign = await offDb.getCampaign(input.id);
    if (!campaign) throw new Error("Campaign not found");
    const collabs = await offDb.listCollaborations(input.id);
    const analytics = await offDb.getCampaignAnalytics(input.id);
    return { ...campaign, collaborations: collabs, analytics };
  }),

  create: protectedProcedure.input(z.object({
    name: z.string(), description: z.string().optional(), type: z.string().optional(),
    budget: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(),
    targetAsin: z.string().optional(), targetMarketplace: z.string().optional(),
    goals: z.string().optional(), tags: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createCampaign({ ...input, userId: ctx.user.id });
    return { id };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateCampaign(input.id, input.data);
    return { success: true };
  }),

  listCollaborations: protectedProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
    return offDb.listCollaborations(input.campaignId);
  }),

  createCollaboration: protectedProcedure.input(z.object({
    campaignId: z.number(), influencerId: z.number(),
    stage: z.string().optional(), fee: z.string().optional(),
    deliverables: z.string().optional(), deadline: z.string().optional(), notes: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createCollaboration({ ...input, userId: ctx.user.id });
    return { id };
  }),

  updateCollaboration: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateCollaboration(input.id, input.data);
    return { success: true };
  }),

  aiAnalysis: protectedProcedure.input(z.object({ campaignId: z.number() })).mutation(async ({ ctx, input }) => {
    const campaign = await offDb.getCampaign(input.campaignId);
    const collabs = await offDb.listCollaborations(input.campaignId);
    const analytics = await offDb.getCampaignAnalytics(input.campaignId);
    const startTime = Date.now();
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

    const resp = await invokeLLM({
      messages: [
        { role: "system", content: CAMPAIGN_ANALYSIS_PROMPT },
        { role: "user", content: `活动: ${JSON.stringify(campaign)}\n合作: ${JSON.stringify(collabs)}\n数据: ${JSON.stringify(analytics)}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { raw: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "campaign_analysis", inputData: JSON.stringify({ campaignId: input.campaignId }), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),
});
