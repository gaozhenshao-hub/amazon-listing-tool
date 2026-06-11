import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { INFLUENCER_MATCHING_PROMPT } from "./offsitePrompts";

export const offInfluencerRouter = router({
  search: protectedProcedure.input(z.object({
    platform: z.string().optional(), category: z.string().optional(),
    country: z.string().optional(), keyword: z.string().optional(),
    limit: z.number().optional(), offset: z.number().optional(),
  })).query(async ({ ctx, input }) => {
    return offDb.searchInfluencers(ctx.user.id, input);
  }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const inf = await offDb.getInfluencer(input.id);
    if (!inf) throw new Error("Influencer not found");
    const scores = await offDb.getInfluencerScores(input.id);
    return { ...inf, scores };
  }),

  create: protectedProcedure.input(z.object({
    platform: z.string(), handle: z.string(),
    displayName: z.string().optional(), profileUrl: z.string().optional(), followerCount: z.number().optional(),
    engagementRate: z.string().optional(), category: z.string().optional(),
    country: z.string().optional(), language: z.string().optional(),
    email: z.string().optional(), phone: z.string().optional(),
    notes: z.string().optional(), tags: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createInfluencer({ ...input, userId: ctx.user.id });
    return { id };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateInfluencer(input.id, input.data);
    return { success: true };
  }),

  aiMatch: protectedProcedure.input(z.object({
    productName: z.string(), productCategory: z.string(),
    targetAudience: z.string().optional(), budget: z.string().optional(),
    platforms: z.array(z.string()).optional(),
  })).mutation(async ({ ctx, input }) => {
    const influencers = await offDb.searchInfluencers(ctx.user.id, { limit: 100 });
    const startTime = Date.now();
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: INFLUENCER_MATCHING_PROMPT },
        { role: "user", content: `产品: ${JSON.stringify(input)}\n达人库: ${JSON.stringify(influencers.map(i => ({ id: i.id, name: i.displayName || i.handle, platform: i.platform, followers: i.followerCount, engagement: i.engagementRate, category: i.category })))}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { raw: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "influencer_match", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    for (const m of result.matchedInfluencers || []) {
      if (m.influencerId) {
        await offDb.saveInfluencerScore({ influencerId: m.influencerId, overallScore: String(m.matchScore || 0), relevanceScore: String(Math.round((m.matchScore || 0) * 0.9)), engagementScore: String(Math.round((m.matchScore || 0) * 0.85)), aiAnalysis: (m.matchReasons || []).join("; ") });
      }
    }
    return result;
  }),
});
