import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as offDb from "../offsiteDb";
import { CONTENT_CALENDAR_PROMPT, SOCIAL_CONTENT_GENERATION_PROMPT, MATRIX_CONTENT_VARIATION_PROMPT } from "./offsitePrompts";

export const offSocialRouter = router({
  // Social Accounts
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    return offDb.listSocialAccounts(ctx.user.id);
  }),

  createAccount: protectedProcedure.input(z.object({
    platform: z.string(), accountName: z.string(), accountId: z.string().optional(),
    matrixGroupId: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createSocialAccount({ ...input, userId: ctx.user.id });
    return { id };
  }),

  updateAccount: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateSocialAccount(input.id, input.data);
    return { success: true };
  }),

  // Content Calendar
  listCalendar: protectedProcedure.input(z.object({
    startDate: z.string().optional(), endDate: z.string().optional(), platform: z.string().optional(),
  }).optional()).query(async ({ ctx, input }) => {
    return offDb.listCalendarItems(ctx.user.id, input || {});
  }),

  createCalendarItem: protectedProcedure.input(z.object({
    platform: z.string(), title: z.string(), content: z.string().optional(),
    scheduledDate: z.string(), scheduledTime: z.string().optional(),
    socialAccountId: z.number().optional(), tags: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createCalendarItem({ ...input, userId: ctx.user.id });
    return { id };
  }),

  updateCalendarItem: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateCalendarItem(input.id, input.data);
    return { success: true };
  }),

  aiGenerateCalendar: protectedProcedure.input(z.object({
    productName: z.string(), platforms: z.array(z.string()),
    startDate: z.string(), endDate: z.string(), frequency: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const startTime = Date.now();
      // [Emperor] 优先调用 Emperor Skill: off.social.content

    try {

      const _emperorRes = await runSkillViaEmperor("off.social.content", { context: JSON.stringify(input).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

      }

    } catch (_e) { console.warn("[Emperor] offSocial.ts fallback:", _e); }

    const resp = await invokeLLM({
      messages: [
        { role: "system", content: CONTENT_CALENDAR_PROMPT },
        { role: "user", content: `产品: ${input.productName}\n平台: ${input.platforms.join(", ")}\n时间: ${input.startDate} ~ ${input.endDate}\n频率: ${input.frequency || "每周3次"}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { calendarItems: [], raw: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "content_calendar", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),

  aiGenerateContent: protectedProcedure.input(z.object({
    platform: z.string(), productName: z.string(), contentType: z.string().optional(),
    tone: z.string().optional(), targetAudience: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const startTime = Date.now();
      // [Emperor] 优先调用 Emperor Skill: off.social.content

    try {

      const _emperorRes = await runSkillViaEmperor("off.social.content", { context: JSON.stringify(input).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

      }

    } catch (_e) { console.warn("[Emperor] offSocial.ts fallback:", _e); }

    const resp = await invokeLLM({
      messages: [
        { role: "system", content: SOCIAL_CONTENT_GENERATION_PROMPT },
        { role: "user", content: `平台: ${input.platform}\n产品: ${input.productName}\n类型: ${input.contentType || "post"}\n风格: ${input.tone || "专业"}\n受众: ${input.targetAudience || "亚马逊买家"}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { content, hashtags: [] }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "social_content", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),

  // Matrix Groups
  listMatrixGroups: protectedProcedure.query(async ({ ctx }) => {
    return offDb.listMatrixGroups(ctx.user.id);
  }),

  createMatrixGroup: protectedProcedure.input(z.object({
    name: z.string(), description: z.string().optional(),
    targetAsin: z.string().optional(), strategy: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await offDb.createMatrixGroup({ ...input, userId: ctx.user.id });
    return { id };
  }),

  updateMatrixGroup: protectedProcedure.input(z.object({
    id: z.number(), data: z.record(z.string(), z.any()),
  })).mutation(async ({ input }) => {
    await offDb.updateMatrixGroup(input.id, input.data);
    return { success: true };
  }),

  aiMatrixVariation: protectedProcedure.input(z.object({
    originalScript: z.string(), accountProfiles: z.array(z.string()),
    productName: z.string().optional(), targetAsin: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const startTime = Date.now();
      // [Emperor] 优先调用 Emperor Skill: off.social.content

    try {

      const _emperorRes = await runSkillViaEmperor("off.social.content", { context: JSON.stringify(input).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

      }

    } catch (_e) { console.warn("[Emperor] offSocial.ts fallback:", _e); }

    const resp = await invokeLLM({
      messages: [
        { role: "system", content: MATRIX_CONTENT_VARIATION_PROMPT },
        { role: "user", content: `原始脚本: ${input.originalScript}\n账号人设: ${input.accountProfiles.join(", ")}\n产品: ${input.productName || ""}\nASIN: ${input.targetAsin || ""}` },
      ],
    });
    const content = resp.choices[0]?.message?.content as string;
    let result: any;
    try { result = JSON.parse(content); } catch { result = { variations: [], raw: content }; }
    await offDb.logAiAnalysis({ userId: ctx.user.id, analysisType: "matrix_variation", inputData: JSON.stringify(input), outputData: content, durationMs: Date.now() - startTime });
    return result;
  }),
});
