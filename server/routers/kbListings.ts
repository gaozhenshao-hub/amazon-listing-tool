import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { scrapeAmazonProduct } from "../scraper";
import { getScraperConfig } from "./systemSettings";
import { invokeLLM } from "../_core/llm";

export const kbListingsRouter = router({
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
    return kbDb.listListingCopywriting(ctx.user.id, input?.scope ?? "mine");
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return kbDb.getListingCopywriting(input.id, ctx.user.id);
    }),

  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      const id = await kbDb.createListingCopywriting({ userId: ctx.user.id, asin, status: "crawling" });
      (async () => {
        try {
          const scraperCfg = await getScraperConfig();
          const data = await scrapeAmazonProduct(asin, scraperCfg);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
            productTitle: data.title, brand: data.brand, category: data.category,
            titleText: data.title,
            bulletPoints: JSON.stringify(data.bulletPoints),
            longDescription: data.description,
            crawledData: JSON.stringify(data),
            status: "analyzing",
          });
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是一位资深的亚马逊Listing文案分析专家。请从以下维度分析这个Listing文案的优劣：
1. 标题结构分析（关键词布局、品牌词位置、字符数）
2. 五点描述分析（卖点提炼、关键词密度、结构化程度）
3. 长描述/A+分析（故事性、视觉引导、SEO优化）
4. 关键词覆盖评估
5. 转化率优化建议
6. 竞品对比亮点
7. 可借鉴的文案技巧

返回JSON格式：
{
  "titleAnalysis": { "structure": "", "keywords": "", "score": 8 },
  "bulletPointsAnalysis": { "highlights": "", "keywordDensity": "", "structure": "", "score": 8 },
  "descriptionAnalysis": { "storytelling": "", "seoOptimization": "", "score": 7 },
  "keywordCoverage": { "primaryKeywords": [], "missingKeywords": [], "score": 7 },
  "conversionTips": [],
  "competitiveHighlights": [],
  "copywritingTechniques": [],
  "overallScore": 75,
  "summary": "一句话总结"
}` },
              { role: "user", content: `ASIN: ${asin}\n标题: ${data.title}\n品牌: ${data.brand}\n类目: ${data.category}\n五点描述:\n${data.bulletPoints.map((b, i) => `${i+1}. ${b}`).join("\n")}\n长描述: ${data.description}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
            aiAnalysis: analysis, overallScore: parsed.overallScore ?? 70, status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Listings] Import failed:", err.message);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id), asin };
    }),

  batchImportAsins: protectedProcedure
    .input(z.object({ asins: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const results: { asin: string; id: number }[] = [];
      for (const raw of input.asins) {
        const asin = raw.trim().toUpperCase();
        if (!asin) continue;
        const id = await kbDb.createListingCopywriting({ userId: ctx.user.id, asin, status: "crawling" });
        results.push({ asin, id: Number(id) });
        (async () => {
          try {
            const scraperCfg = await getScraperConfig();
          const data = await scrapeAmazonProduct(asin, scraperCfg);
            await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
              productTitle: data.title, brand: data.brand, category: data.category,
              titleText: data.title, bulletPoints: JSON.stringify(data.bulletPoints),
              longDescription: data.description, crawledData: JSON.stringify(data), status: "analyzing",
            });
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是亚马逊Listing文案分析专家。分析文案优劣，返回JSON: { titleAnalysis: {structure,keywords,score}, bulletPointsAnalysis: {highlights,keywordDensity,structure,score}, descriptionAnalysis: {storytelling,seoOptimization,score}, keywordCoverage: {primaryKeywords,missingKeywords,score}, conversionTips, competitiveHighlights, copywritingTechniques, overallScore(1-100), summary }` },
                { role: "user", content: `ASIN: ${asin}\n标题: ${data.title}\n五点: ${data.bulletPoints.join("; ")}\n描述: ${data.description?.slice(0, 500)}` }
              ],
              response_format: { type: "json_object" as const },
            });
            const analysis = String(response.choices?.[0]?.message?.content || "{}");
            const parsed = JSON.parse(analysis);
            await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
              aiAnalysis: analysis, overallScore: parsed.overallScore ?? 70, status: "pending_review",
            });
          } catch (err: any) {
            console.error(`[KB Listings] Batch import failed for ${asin}:`, err.message);
            await kbDb.updateListingCopywriting(Number(id), ctx.user.id, { status: "archived" });
          }
        })();
      }
      return { imported: results.length, items: results };
    }),

  importByLink: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const asinMatch = input.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch?.[1]?.toUpperCase() || "";
      if (!asin) throw new Error("无法从链接中提取ASIN");
      const id = await kbDb.createListingCopywriting({ userId: ctx.user.id, asin, status: "crawling" });
      (async () => {
        try {
          const scraperCfg = await getScraperConfig();
          const data = await scrapeAmazonProduct(asin, scraperCfg);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
            productTitle: data.title, brand: data.brand, category: data.category,
            titleText: data.title, bulletPoints: JSON.stringify(data.bulletPoints),
            longDescription: data.description, crawledData: JSON.stringify(data), status: "analyzing",
          });
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊Listing文案分析专家。分析文案优劣，返回JSON: { titleAnalysis, bulletPointsAnalysis, descriptionAnalysis, keywordCoverage, conversionTips, competitiveHighlights, copywritingTechniques, overallScore(1-100), summary }` },
              { role: "user", content: `ASIN: ${asin}\n标题: ${data.title}\n五点: ${data.bulletPoints.join("; ")}\n描述: ${data.description?.slice(0, 500)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, {
            aiAnalysis: analysis, overallScore: parsed.overallScore ?? 70, status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Listings] Link import failed:", err.message);
          await kbDb.updateListingCopywriting(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id), asin };
    }),

  confirmAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedAnalysis = input.editedAnalysis;
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, update);
      return { success: true };
    }),

  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, { tags: input.tags });
      return { success: true };
    }),

  updateScore: protectedProcedure
    .input(z.object({ id: z.number(), score: z.number().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, { overallScore: input.score });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteListingCopywriting(input.id, ctx.user.id);
      return { success: true };
    }),
});
