import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { CONTENT_REVIEW_PROMPT } from "./offsitePrompts";

export const offContentRouter = router({
  list: protectedProcedure.input(z.object({
    collaborationId: z.number().optional(), humanStatus: z.string().optional(),
  }).optional()).query(async ({ ctx, input }) => {
    return offDb.listContentSubmissions(ctx.user.id, input || {});
  }),

  create: protectedProcedure.input(z.object({
    collaborationId: z.number(), contentType: z.string().optional(),
    contentUrl: z.string().optional(), caption: z.string().optional(),
    mediaUrls: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createContentSubmission({ ...input, userId: ctx.user.id });
    return { id };
  }),

  aiReview: protectedProcedure.input(z.object({
    submissionId: z.number(), brandGuidelines: z.string().optional(),
    productInfo: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await import("../offsiteDb");
    // We don't have getContentSubmission, use listContentSubmissions and filter
    const submissions = await offDb.listContentSubmissions(ctx.user.id, {});
    const submission = submissions.find((s: any) => s.id === input.submissionId);
    if (!submission) throw new Error("Submission not found");
    const startTime = Date.now();
      // [Emperor] 优先调用 Emperor Skill: off.content.calendar

    try {

      const _emperorRes = await runSkillViaEmperor("off.content.calendar", { context: JSON.stringify(input).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

      }

    } catch (_e) { console.warn("[Emperor] offContent.ts fallback:", _e); }

    const resp = await invokeLLM({
      messages: [
        { role: "system", content: CONTENT_REVIEW_PROMPT },
        { role: "user", content: `内容: ${JSON.stringify(submission)}\n品牌指南: ${input.brandGuidelines || "无"}\n产品信息: ${input.productInfo || "无"}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { overallScore: 0, passed: false, raw: content }; }
    await offDb.updateContentSubmission(input.submissionId, { aiReviewResult: content, aiReviewedAt: new Date() });
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "content_review", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),

  updateStatus: protectedProcedure.input(z.object({
    id: z.number(), humanStatus: z.string(), humanNotes: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    await offDb.updateContentSubmission(input.id, {
      humanStatus: input.humanStatus, humanNotes: input.humanNotes,
      reviewedBy: ctx.user.id, reviewedAt: new Date(),
    });
    return { success: true };
  }),
});
