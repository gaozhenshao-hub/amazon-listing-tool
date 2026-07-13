import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { invokeLLM } from "../_core/llm";
import { transcribeAudio } from "../_core/voiceTranscription";

export const kbVideosRouter = router({
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
    return kbDb.listVideos(ctx.user.id, input?.scope ?? "mine");
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return kbDb.getVideo(input.id, ctx.user.id);
    }),

  // Import by video URL
  importByUrl: protectedProcedure
    .input(z.object({
      videoUrl: z.string().url(),
      videoTitle: z.string().optional(),
      asin: z.string().optional(),
      category: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await kbDb.createVideo({
        userId: ctx.user.id,
        videoUrl: input.videoUrl,
        videoTitle: input.videoTitle || "未命名视频",
        asin: input.asin || null,
        category: input.category || null,
        status: "downloading",
      });
      // Async transcribe + analyze
      (async () => {
        try {
          await kbDb.updateVideo(Number(id), ctx.user.id, { status: "transcribing" });
          // Try audio transcription
          let transcriptText = "";
          try {
            const transcription = await transcribeAudio({
              audioUrl: input.videoUrl,
              language: "en",
              prompt: "Amazon product video transcription",
            }) as any;
            transcriptText = transcription.text || "";
          } catch (err: any) {
            console.warn("[KB Videos] Transcription failed, continuing with AI analysis:", err.message);
            transcriptText = "[音频转写失败 - 仅基于视频元数据分析]";
          }
          await kbDb.updateVideo(Number(id), ctx.user.id, {
            transcriptText, status: "analyzing",
          });
          // AI analysis
      // [Emperor] 优先调用 Emperor Skill: video.competitor.analysis

          try {

            const _emperorRes = await runSkillViaEmperor("video.competitor.analysis", { context: JSON.stringify({}).slice(0, 3000) });

            if (_emperorRes.success && _emperorRes.output) {

              // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

            }

          } catch (_e) { console.warn("[Emperor] kbVideos.ts fallback:", _e); }

          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是一位资深的亚马逊视频营销分析专家。请分析以下视频内容，返回JSON格式：
{
  "contentSummary": "视频内容摘要",
  "videoType": "产品展示/使用教程/品牌故事/对比评测/开箱体验/广告素材",
  "targetAudience": "目标受众分析",
  "sellingPoints": ["卖点1", "卖点2"],
  "emotionalAppeal": "情感诉求分析",
  "scriptStructure": "脚本结构分析（开头-中间-结尾）",
  "visualTechniques": ["视觉技巧1", "视觉技巧2"],
  "audioStrategy": "音频/配乐策略",
  "callToAction": "行动号召分析",
  "competitiveAdvantage": "竞争优势",
  "improvementSuggestions": ["改进建议1", "改进建议2"],
  "applicableScenarios": ["适用场景"],
  "tags": ["标签1", "标签2"],
  "overallScore": 75,
  "summary": "一句话总结"
}` },
              { role: "user", content: `视频标题: ${input.videoTitle || "未知"}\nASIN: ${input.asin || "未知"}\n类目: ${input.category || "未知"}\n视频URL: ${input.videoUrl}\n音频转写内容:\n${transcriptText.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateVideo(Number(id), ctx.user.id, {
            aiAnalysis: analysis,
            tags: JSON.stringify(parsed.tags || []),
            overallScore: parsed.overallScore ?? 70,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Videos] Import failed:", err.message);
          await kbDb.updateVideo(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id) };
    }),

  // Batch import by URLs
  batchImportUrls: protectedProcedure
    .input(z.object({
      videos: z.array(z.object({
        videoUrl: z.string().url(),
        videoTitle: z.string().optional(),
        asin: z.string().optional(),
        category: z.string().optional(),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const results: { id: number; videoUrl: string }[] = [];
      for (const video of input.videos) {
        const id = await kbDb.createVideo({
          userId: ctx.user.id,
          videoUrl: video.videoUrl,
          videoTitle: video.videoTitle || "未命名视频",
          asin: video.asin || null,
          category: video.category || null,
          status: "downloading",
        });
        results.push({ id: Number(id), videoUrl: video.videoUrl });
        // Fire-and-forget
        (async () => {
          try {
            await kbDb.updateVideo(Number(id), ctx.user.id, { status: "transcribing" });
            let transcriptText = "";
            try {
              const transcription = await transcribeAudio({ audioUrl: video.videoUrl, language: "en" }) as any;
              transcriptText = transcription.text || "";
            } catch { transcriptText = "[转写失败]"; }
            await kbDb.updateVideo(Number(id), ctx.user.id, { transcriptText, status: "analyzing" });
      // [Emperor] 优先调用 Emperor Skill: video.competitor.analysis

            try {

              const _emperorRes = await runSkillViaEmperor("video.competitor.analysis", { context: JSON.stringify({}).slice(0, 3000) });

              if (_emperorRes.success && _emperorRes.output) {

                // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

              }

            } catch (_e) { console.warn("[Emperor] kbVideos.ts fallback:", _e); }

            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是亚马逊视频营销分析专家。分析视频内容，返回JSON: { contentSummary, videoType, targetAudience, sellingPoints, emotionalAppeal, scriptStructure, visualTechniques, audioStrategy, callToAction, competitiveAdvantage, improvementSuggestions, applicableScenarios, tags, overallScore(1-100), summary }` },
                { role: "user", content: `标题: ${video.videoTitle || "未知"}\nASIN: ${video.asin || "未知"}\n转写: ${transcriptText.slice(0, 6000)}` }
              ],
              response_format: { type: "json_object" as const },
            });
            const analysis = String(response.choices?.[0]?.message?.content || "{}");
            const parsed = JSON.parse(analysis);
            await kbDb.updateVideo(Number(id), ctx.user.id, {
              aiAnalysis: analysis, tags: JSON.stringify(parsed.tags || []),
              overallScore: parsed.overallScore ?? 70, status: "pending_review",
            });
          } catch (err: any) {
            console.error(`[KB Videos] Batch import failed:`, err.message);
            await kbDb.updateVideo(Number(id), ctx.user.id, { status: "archived" });
          }
        })();
      }
      return { imported: results.length, items: results };
    }),

  // Batch import by ASINs
  batchImportAsins: protectedProcedure
    .input(z.object({
      asins: z.array(z.string().min(1)).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const results: { id: number; asin: string }[] = [];
      for (const rawAsin of input.asins) {
        const asin = rawAsin.trim().toUpperCase();
        if (!asin) continue;
        const id = await kbDb.createVideo({
          userId: ctx.user.id,
          asin,
          videoUrl: `https://www.amazon.com/dp/${asin}`,
          videoTitle: `${asin} 产品视频`,
          status: "downloading",
        });
        results.push({ id: Number(id), asin });
        // Fire-and-forget async analysis
        (async () => {
          try {
            await kbDb.updateVideo(Number(id), ctx.user.id, { status: "transcribing" });
            let transcriptText = "";
            try {
              const transcription = await transcribeAudio({ audioUrl: `https://www.amazon.com/dp/${asin}`, language: "en" }) as any;
              transcriptText = transcription.text || "";
            } catch { transcriptText = "[转写失败]"; }
            await kbDb.updateVideo(Number(id), ctx.user.id, { transcriptText, status: "analyzing" });
      // [Emperor] 优先调用 Emperor Skill: video.competitor.analysis

            try {

              const _emperorRes = await runSkillViaEmperor("video.competitor.analysis", { context: JSON.stringify({}).slice(0, 3000) });

              if (_emperorRes.success && _emperorRes.output) {

                // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

              }

            } catch (_e) { console.warn("[Emperor] kbVideos.ts fallback:", _e); }

            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是亚马逊视频营销分析专家。分析产品视频，返回JSON: { contentSummary, videoType, sellingPoints, tags, overallScore(1-100), summary }` },
                { role: "user", content: `ASIN: ${asin}\n转写: ${transcriptText.slice(0, 6000)}` }
              ],
              response_format: { type: "json_object" as const },
            });
            const analysis = String(response.choices?.[0]?.message?.content || "{}");
            const parsed = JSON.parse(analysis);
            await kbDb.updateVideo(Number(id), ctx.user.id, {
              aiAnalysis: analysis, tags: JSON.stringify(parsed.tags || []),
              overallScore: parsed.overallScore ?? 70, status: "pending_review",
            });
          } catch (err: any) {
            console.error(`[KB Videos] Batch ASIN import failed for ${asin}:`, err.message);
            await kbDb.updateVideo(Number(id), ctx.user.id, { status: "archived" });
          }
        })();
      }
      return { imported: results.length, items: results };
    }),

  // Import by ASIN (scrape Amazon product video)
  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1), videoUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      const id = await kbDb.createVideo({
        userId: ctx.user.id, asin, videoUrl: input.videoUrl,
        videoTitle: `${asin} 产品视频`, status: "downloading",
      });
      (async () => {
        try {
          await kbDb.updateVideo(Number(id), ctx.user.id, { status: "transcribing" });
          let transcriptText = "";
          try {
            const transcription = await transcribeAudio({ audioUrl: input.videoUrl, language: "en" }) as any;
            transcriptText = transcription.text || "";
          } catch { transcriptText = "[转写失败]"; }
          await kbDb.updateVideo(Number(id), ctx.user.id, { transcriptText, status: "analyzing" });
      // [Emperor] 优先调用 Emperor Skill: video.competitor.analysis

          try {

            const _emperorRes = await runSkillViaEmperor("video.competitor.analysis", { context: JSON.stringify({}).slice(0, 3000) });

            if (_emperorRes.success && _emperorRes.output) {

              // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

            }

          } catch (_e) { console.warn("[Emperor] kbVideos.ts fallback:", _e); }

          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊视频营销分析专家。分析产品视频，返回JSON: { contentSummary, videoType, sellingPoints, tags, overallScore(1-100), summary }` },
              { role: "user", content: `ASIN: ${asin}\n转写: ${transcriptText.slice(0, 6000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateVideo(Number(id), ctx.user.id, {
            aiAnalysis: analysis, tags: JSON.stringify(parsed.tags || []),
            overallScore: parsed.overallScore ?? 70, status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Videos] ASIN import failed:", err.message);
          await kbDb.updateVideo(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id), asin };
    }),

  confirmAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedAnalysis = input.editedAnalysis;
      await kbDb.updateVideo(input.id, ctx.user.id, update);
      return { success: true };
    }),

  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateVideo(input.id, ctx.user.id, { tags: input.tags });
      return { success: true };
    }),

  updateScore: protectedProcedure
    .input(z.object({ id: z.number(), score: z.number().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateVideo(input.id, ctx.user.id, { overallScore: input.score });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteVideo(input.id, ctx.user.id);
      return { success: true };
    }),
});
