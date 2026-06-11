import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { OUTREACH_EMAIL_PROMPT } from "./offsitePrompts";

export const offOutreachRouter = router({
  list: protectedProcedure.input(z.object({
    influencerId: z.number().optional(), campaignId: z.number().optional(),
  }).optional()).query(async ({ ctx, input }) => {
    return offDb.listOutreachMessages(ctx.user.id, input || {});
  }),

  create: protectedProcedure.input(z.object({
    influencerId: z.number(), campaignId: z.number().optional(),
    channel: z.string().optional(), subject: z.string().optional(),
    content: z.string().optional(), direction: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createOutreachMessage({ ...input, userId: ctx.user.id });
    return { id };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateOutreachMessage(input.id, input.data);
    return { success: true };
  }),

  aiGenerate: protectedProcedure.input(z.object({
    influencerId: z.number(), productName: z.string(),
    productDescription: z.string().optional(), collaborationType: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const influencer = await offDb.getInfluencer(input.influencerId);
    const startTime = Date.now();
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: OUTREACH_EMAIL_PROMPT },
        { role: "user", content: `达人: ${JSON.stringify(influencer)}\n产品: ${input.productName}\n描述: ${input.productDescription || ""}\n合作类型: ${input.collaborationType || "product_review"}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { subject: "合作邀约", body: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "outreach_email", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),
});
