import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { scrapeAmazonProduct } from "../scraper";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import axios from "axios";

async function downloadAndStoreImage(imageUrl: string, asin: string, index: number): Promise<string> {
  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(response.data);
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || "jpg";
    const key = `kb-images/${asin}/${Date.now()}-${index}.${ext}`;
    const { url } = await storagePut(key, buffer, `image/${ext}`);
    return url;
  } catch {
    return imageUrl; // Fallback to original URL
  }
}

export const kbImagesRouter = router({
  // List all image sets
  listSets: protectedProcedure.query(async ({ ctx }) => {
    return kbDb.listImageSets(ctx.user.id);
  }),

  // Get image set with all images
  getSet: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.id, ctx.user.id);
      if (!set) return null;
      const images = await kbDb.listImagesBySet(set.id);
      return { ...set, images };
    }),

  // List all images with 4-dimension filters (waterfall view)
  listAllImages: protectedProcedure
    .input(z.object({
      tagCategory: z.string().optional(),
      tagColorScheme: z.string().optional(),
      tagImageType: z.string().optional(),
      tagDesignStyle: z.string().optional(),
      imagePosition: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      return kbDb.listAllImages(ctx.user.id, input);
    }),

  // Import by ASIN - crawl images and analyze
  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      const setId = await kbDb.createImageSet({ userId: ctx.user.id, asin, status: "crawling" });
      (async () => {
        try {
          const data = await scrapeAmazonProduct(asin);
          await kbDb.updateImageSet(Number(setId), ctx.user.id, {
            productTitle: data.title, brand: data.brand, category: data.category,
          });
          // Download and store images
          const imageUrls = data.imageUrls || [];
          for (let i = 0; i < imageUrls.length; i++) {
            const storedUrl = await downloadAndStoreImage(imageUrls[i], asin, i);
            const position = i === 0 ? "main" as const : "secondary" as const;
            await kbDb.createImage({
              imageSetId: Number(setId), imageUrl: storedUrl,
              imagePosition: position, positionIndex: i,
            });
          }
          await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "analyzing" });
          // AI analysis for each image
          const images = await kbDb.listImagesBySet(Number(setId));
          for (const img of images) {
            try {
              const response = await invokeLLM({
                messages: [
                  { role: "system", content: `你是一位资深的亚马逊产品图片分析专家。请从以下12个维度分析这张产品图片：
1. 构图与布局 2. 色彩搭配 3. 产品展示角度 4. 场景化程度 5. 文字/信息图层
6. 品牌一致性 7. 目标受众匹配度 8. 情感传达 9. 技术质量 10. 差异化程度
11. 转化驱动力 12. 合规性

同时请为图片打上四维标签：
- tagCategory: 产品类目标签（如 "厨房用品", "电子产品"）
- tagColorScheme: 色彩方案（如 "暖色系", "冷色系", "黑白"）
- tagImageType: 图片类型（如 "主图白底", "场景图", "对比图", "信息图", "生活方式图"）
- tagDesignStyle: 设计风格（如 "极简", "科技感", "自然", "奢华"）

返回JSON：
{
  "dimensions": { "composition": {"score":8,"comment":""}, "colorScheme": {"score":8,"comment":""}, "productAngle": {"score":8,"comment":""}, "sceneSetting": {"score":7,"comment":""}, "textOverlay": {"score":7,"comment":""}, "brandConsistency": {"score":8,"comment":""}, "audienceMatch": {"score":8,"comment":""}, "emotionalImpact": {"score":7,"comment":""}, "technicalQuality": {"score":8,"comment":""}, "differentiation": {"score":7,"comment":""}, "conversionPower": {"score":8,"comment":""}, "compliance": {"score":9,"comment":""} },
  "tagCategory": "",
  "tagColorScheme": "",
  "tagImageType": "",
  "tagDesignStyle": "",
  "highlights": ["亮点1", "亮点2"],
  "singleImageScore": 8,
  "summary": ""
}` },
                  { role: "user", content: [{ type: "image_url" as const, image_url: { url: img.imageUrl } }, { type: "text" as const, text: `这是ASIN ${asin}的${img.imagePosition === "main" ? "主图" : `副图#${img.positionIndex}`}` }] }
                ],
                response_format: { type: "json_object" as const },
              });
              const analysis = String(response.choices?.[0]?.message?.content || "{}");
              const parsed = JSON.parse(analysis);
              await kbDb.updateImage(img.id, {
                aiDimensionAnalysis: analysis,
                tagCategory: parsed.tagCategory || null,
                tagColorScheme: parsed.tagColorScheme || null,
                tagImageType: parsed.tagImageType || null,
                tagDesignStyle: parsed.tagDesignStyle || null,
                singleImageScore: parsed.singleImageScore || null,
                highlights: JSON.stringify(parsed.highlights || []),
              });
            } catch (err: any) {
              console.error(`[KB Images] Image analysis failed for image ${img.id}:`, err.message);
            }
          }
          // Overall analysis
          const allImages = await kbDb.listImagesBySet(Number(setId));
          const overallResponse = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊产品图片策略分析专家。请对这组产品图片进行整体评估，返回JSON：
{
  "overallStrategy": "整体图片策略评价",
  "mainImageAssessment": "主图评估",
  "secondaryImageFlow": "副图叙事流评估",
  "missingImageTypes": ["缺少的图片类型"],
  "improvementSuggestions": ["改进建议"],
  "overallScore": 75,
  "summary": ""
}` },
              { role: "user", content: `ASIN: ${asin}, 共${allImages.length}张图片。各图评分: ${allImages.map(i => `${i.imagePosition}#${i.positionIndex}: ${i.singleImageScore}/10`).join(", ")}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const overallAnalysis = String(overallResponse.choices?.[0]?.message?.content || "{}");
          const overallParsed = JSON.parse(overallAnalysis);
          await kbDb.updateImageSet(Number(setId), ctx.user.id, {
            overallAnalysis, overallScore: overallParsed.overallScore ?? 70, status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Images] Import failed:", err.message);
          await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(setId), asin };
    }),

  batchImportAsins: protectedProcedure
    .input(z.object({ asins: z.array(z.string()).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const results: { asin: string; id: number }[] = [];
      for (const raw of input.asins) {
        const asin = raw.trim().toUpperCase();
        if (!asin) continue;
        const setId = await kbDb.createImageSet({ userId: ctx.user.id, asin, status: "crawling" });
        results.push({ asin, id: Number(setId) });
        // Fire-and-forget (same flow as importByAsin but simplified)
        (async () => {
          try {
            const data = await scrapeAmazonProduct(asin);
            await kbDb.updateImageSet(Number(setId), ctx.user.id, {
              productTitle: data.title, brand: data.brand, category: data.category,
            });
            for (let i = 0; i < (data.imageUrls?.length || 0); i++) {
              const storedUrl = await downloadAndStoreImage(data.imageUrls[i], asin, i);
              await kbDb.createImage({
                imageSetId: Number(setId), imageUrl: storedUrl,
                imagePosition: i === 0 ? "main" as const : "secondary" as const, positionIndex: i,
              });
            }
            await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "analyzing" });
            // Simplified: just set to pending_review, user can trigger individual analysis
            await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "pending_review" });
          } catch (err: any) {
            console.error(`[KB Images] Batch import failed for ${asin}:`, err.message);
            await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "archived" });
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
      // Reuse importByAsin logic
      const setId = await kbDb.createImageSet({ userId: ctx.user.id, asin, status: "crawling" });
      (async () => {
        try {
          const data = await scrapeAmazonProduct(asin);
          await kbDb.updateImageSet(Number(setId), ctx.user.id, { productTitle: data.title, brand: data.brand, category: data.category });
          for (let i = 0; i < (data.imageUrls?.length || 0); i++) {
            const storedUrl = await downloadAndStoreImage(data.imageUrls[i], asin, i);
            await kbDb.createImage({
              imageSetId: Number(setId), imageUrl: storedUrl,
              imagePosition: i === 0 ? "main" as const : "secondary" as const, positionIndex: i,
            });
          }
          await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "pending_review" });
        } catch (err: any) {
          console.error("[KB Images] Link import failed:", err.message);
          await kbDb.updateImageSet(Number(setId), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(setId), asin };
    }),

  // Confirm image tags
  confirmImageTags: protectedProcedure
    .input(z.object({
      imageId: z.number(),
      tagCategory: z.string().optional(),
      tagColorScheme: z.string().optional(),
      tagImageType: z.string().optional(),
      tagDesignStyle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { imageId, ...tags } = input;
      await kbDb.updateImage(imageId, { ...tags, tagsConfirmed: 1 });
      return { success: true };
    }),

  // Confirm set overall analysis
  confirmSetAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedOverallAnalysis = input.editedAnalysis;
      await kbDb.updateImageSet(input.id, ctx.user.id, update);
      return { success: true };
    }),

  // Update single image score
  updateImageScore: protectedProcedure
    .input(z.object({ imageId: z.number(), score: z.number().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateImage(input.imageId, { singleImageScore: input.score });
      return { success: true };
    }),

  deleteSet: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteImageSet(input.id, ctx.user.id);
      return { success: true };
    }),
});
