import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { scrapeAmazonProduct } from "../scraper";
import { invokeLLM } from "../_core/llm";

export const kbProductsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return kbDb.listProductInnovations(ctx.user.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return kbDb.getProductInnovation(input.id, ctx.user.id);
    }),

  // Import by ASIN - single
  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      const id = await kbDb.createProductInnovation({
        userId: ctx.user.id,
        asin,
        status: "crawling",
      });
      // Async crawl + analyze
      (async () => {
        try {
          const data = await scrapeAmazonProduct(asin);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
            productTitle: data.title,
            brand: data.brand,
            price: data.price,
            rating: data.rating,
            reviewCount: data.reviewCount,
            category: data.category,
            bulletPoints: JSON.stringify(data.bulletPoints),
            imageUrls: JSON.stringify(data.imageUrls),
            crawledData: JSON.stringify(data),
            productUrl: `https://www.amazon.com/dp/${asin}`,
            status: "analyzing",
          });
          // AI analysis
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是一位资深的亚马逊产品创意分析专家。请分析以下产品，从以下维度评价其创意的优秀之处：
1. 市场定位创新点
2. 功能设计亮点
3. 外观/包装差异化
4. 用户痛点解决方案
5. 定价策略分析
6. 竞争优势总结
7. 可借鉴的创意要素

请用JSON格式返回分析结果，包含以下字段：
{
  "marketPositioning": "市场定位创新点分析",
  "functionalHighlights": "功能设计亮点",
  "designDifferentiation": "外观/包装差异化",
  "painPointSolutions": "用户痛点解决方案",
  "pricingStrategy": "定价策略分析",
  "competitiveAdvantages": "竞争优势总结",
  "inspiringElements": "可借鉴的创意要素",
  "overallScore": 8,
  "summary": "一句话总结"
}`
              },
              {
                role: "user",
                content: `产品标题: ${data.title}\n品牌: ${data.brand}\n价格: ${data.price}\n评分: ${data.rating} (${data.reviewCount}条评论)\n类目: ${data.category}\n五点描述:\n${data.bulletPoints.join("\n")}\n产品描述: ${data.description}`
              }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
            aiAnalysis: analysis,
            overallScore: parsed.overallScore ?? 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Products] Import failed:", err.message);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id), asin };
    }),

  // Batch import by ASINs
  batchImportAsins: protectedProcedure
    .input(z.object({ asins: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const results: { asin: string; id: number }[] = [];
      for (const raw of input.asins) {
        const asin = raw.trim().toUpperCase();
        if (!asin) continue;
        const id = await kbDb.createProductInnovation({
          userId: ctx.user.id,
          asin,
          status: "crawling",
        });
        results.push({ asin, id: Number(id) });
        // Fire-and-forget crawl + analyze for each
        (async () => {
          try {
            const data = await scrapeAmazonProduct(asin);
            await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
              productTitle: data.title, brand: data.brand, price: data.price,
              rating: data.rating, reviewCount: data.reviewCount, category: data.category,
              bulletPoints: JSON.stringify(data.bulletPoints), imageUrls: JSON.stringify(data.imageUrls),
              crawledData: JSON.stringify(data), productUrl: `https://www.amazon.com/dp/${asin}`,
              status: "analyzing",
            });
            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是亚马逊产品创意分析专家。分析产品创意的优秀之处，返回JSON格式包含: marketPositioning, functionalHighlights, designDifferentiation, painPointSolutions, pricingStrategy, competitiveAdvantages, inspiringElements, overallScore(1-10), summary` },
                { role: "user", content: `标题: ${data.title}\n品牌: ${data.brand}\n价格: ${data.price}\n评分: ${data.rating}\n五点: ${data.bulletPoints.join("; ")}` }
              ],
              response_format: { type: "json_object" as const },
            });
            const analysis = String(response.choices?.[0]?.message?.content || "{}");
            const parsed = JSON.parse(analysis);
            await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
              aiAnalysis: analysis, overallScore: parsed.overallScore ?? 7, status: "pending_review",
            });
          } catch (err: any) {
            console.error(`[KB Products] Batch import failed for ${asin}:`, err.message);
            await kbDb.updateProductInnovation(Number(id), ctx.user.id, { status: "archived" });
          }
        })();
      }
      return { imported: results.length, items: results };
    }),

  // Import by URL/link
  importByLink: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      // Extract ASIN from URL
      const asinMatch = input.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch?.[1]?.toUpperCase() || "";
      if (!asin) throw new Error("无法从链接中提取ASIN，请检查链接格式");
      const id = await kbDb.createProductInnovation({
        userId: ctx.user.id, asin, productUrl: input.url, status: "crawling",
      });
      // Same async flow as importByAsin
      (async () => {
        try {
          const data = await scrapeAmazonProduct(asin);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
            productTitle: data.title, brand: data.brand, price: data.price,
            rating: data.rating, reviewCount: data.reviewCount, category: data.category,
            bulletPoints: JSON.stringify(data.bulletPoints), imageUrls: JSON.stringify(data.imageUrls),
            crawledData: JSON.stringify(data), status: "analyzing",
          });
          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊产品创意分析专家。分析产品创意的优秀之处，返回JSON: { marketPositioning, functionalHighlights, designDifferentiation, painPointSolutions, pricingStrategy, competitiveAdvantages, inspiringElements, overallScore(1-10), summary }` },
              { role: "user", content: `标题: ${data.title}\n品牌: ${data.brand}\n价格: ${data.price}\n评分: ${data.rating}\n五点: ${data.bulletPoints.join("; ")}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const analysis = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(analysis);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, {
            aiAnalysis: analysis, overallScore: parsed.overallScore ?? 7, status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Products] Link import failed:", err.message);
          await kbDb.updateProductInnovation(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id), asin };
    }),

  // Confirm / edit analysis
  confirmAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedAnalysis = input.editedAnalysis;
      await kbDb.updateProductInnovation(input.id, ctx.user.id, update);
      return { success: true };
    }),

  // Update tags
  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateProductInnovation(input.id, ctx.user.id, { tags: input.tags });
      return { success: true };
    }),

  updateScore: protectedProcedure
    .input(z.object({ id: z.number(), score: z.number().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateProductInnovation(input.id, ctx.user.id, { overallScore: input.score });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteProductInnovation(input.id, ctx.user.id);
      return { success: true };
    }),
});
