import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { scrapeAmazonProduct, type ProductImage } from "../scraper";
import { getScraperConfig } from "./systemSettings";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import axios from "axios";

async function downloadAndStoreImage(imageUrl: string, asin: string, index: number, prefix = "kb-images"): Promise<string> {
  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(response.data);
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || "jpg";
    const key = `${prefix}/${asin}/${Date.now()}-${index}.${ext}`;
    const { url } = await storagePut(key, buffer, `image/${ext}`);
    return url;
  } catch {
    return imageUrl; // Fallback to original URL
  }
}

/**
 * Shared import logic: scrape, download, classify, and analyze images.
 * Used by importByAsin, batchImportAsins, and importByLink.
 */
async function processImport(setId: number, asin: string, userId: number, runAnalysis: boolean) {
  try {
    const scraperConfig = await getScraperConfig();
    const data = await scrapeAmazonProduct(asin, scraperConfig);
    await kbDb.updateImageSet(setId, userId, {
      productTitle: data.title, brand: data.brand, category: data.category,
    });

    // Use the new structured images array (includes product + A+ + brand story)
    const allImages = data.images || [];
    console.log(`[KB Images] Processing ${allImages.length} images for ASIN ${asin}`);

    // Download and store all images
    for (let i = 0; i < allImages.length; i++) {
      const img = allImages[i];
      const prefix = img.position === "aplus" ? "kb-aplus" : img.position === "brand_story" ? "kb-brand-story" : "kb-images";
      const storedUrl = await downloadAndStoreImage(img.url, asin, i, prefix);
      await kbDb.createImage({
        imageSetId: setId,
        imageUrl: storedUrl,
        imagePosition: img.position as any,
        positionIndex: img.positionIndex,
        aplusModuleType: img.aplusModuleType || null,
        aplusModuleClass: img.aplusModuleClass || null,
      });
    }

    // If no structured images, fall back to legacy imageUrls
    if (allImages.length === 0 && data.imageUrls?.length > 0) {
      console.log(`[KB Images] Falling back to legacy imageUrls for ASIN ${asin}`);
      for (let i = 0; i < data.imageUrls.length; i++) {
        const storedUrl = await downloadAndStoreImage(data.imageUrls[i], asin, i);
        await kbDb.createImage({
          imageSetId: setId,
          imageUrl: storedUrl,
          imagePosition: i === 0 ? "main" as const : "secondary" as const,
          positionIndex: i,
        });
      }
    }

    await kbDb.updateImageSet(setId, userId, { status: "analyzing" });

    if (runAnalysis) {
      // AI analysis for each image
      const images = await kbDb.listImagesBySet(setId);
      for (const img of images) {
        try {
          const posIdx = img.positionIndex ?? 0;
          const posLabel = img.imagePosition === "main" ? "主图"
            : img.imagePosition === "aplus" ? `A+内容图#${posIdx + 1}`
            : img.imagePosition === "brand_story" ? `品牌故事图#${posIdx + 1}`
            : `副图#${posIdx}`;

          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是一位资深的亚马逊产品图片分析专家。请从以下12个维度分析这张产品图片：
1. 构图与布局 2. 色彩搭配 3. 产品展示角度 4. 场景化程度 5. 文字/信息图层
6. 品牌一致性 7. 目标受众匹配度 8. 情感传达 9. 技术质量 10. 差异化程度
11. 转化驱动力 12. 合规性

同时请为图片打上四维标签：
- tagCategory: 产品类目标签（如 "厨房用品", "电子产品"）
- tagColorScheme: 色彩方案（如 "暖色系", "冷色系", "黑白"）
- tagImageType: 图片类型（如 "主图白底", "场景图", "对比图", "信息图", "生活方式图", "A+全幅图", "A+轮播图", "品牌故事图"）
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
              { role: "user", content: [{ type: "image_url" as const, image_url: { url: img.imageUrl } }, { type: "text" as const, text: `这是ASIN ${asin}的${posLabel}` }] }
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

      // Overall analysis including A+ and brand story
      const allDbImages = await kbDb.listImagesBySet(setId);
      const productImgs = allDbImages.filter(i => i.imagePosition === "main" || i.imagePosition === "secondary");
      const aplusImgs = allDbImages.filter(i => i.imagePosition === "aplus");
      const brandImgs = allDbImages.filter(i => i.imagePosition === "brand_story");

      const overallResponse = await invokeLLM({
        messages: [
          { role: "system", content: `你是亚马逊产品图片策略分析专家。请对这组产品图片进行整体评估，返回JSON：
{
  "overallStrategy": "整体图片策略评价",
  "mainImageAssessment": "主图评估",
  "secondaryImageFlow": "副图叙事流评估",
  "aplusAssessment": "A+内容图片评估（如有）",
  "brandStoryAssessment": "品牌故事图片评估（如有）",
  "missingImageTypes": ["缺少的图片类型"],
  "improvementSuggestions": ["改进建议"],
  "overallScore": 75,
  "summary": ""
}` },
          { role: "user", content: `ASIN: ${asin}
产品图: ${productImgs.length}张 (${productImgs.map(i => `${i.imagePosition}#${i.positionIndex}: ${i.singleImageScore}/10`).join(", ")})
A+图: ${aplusImgs.length}张
品牌故事图: ${brandImgs.length}张` }
        ],
        response_format: { type: "json_object" as const },
      });
      const overallAnalysis = String(overallResponse.choices?.[0]?.message?.content || "{}");
      const overallParsed = JSON.parse(overallAnalysis);
      await kbDb.updateImageSet(setId, userId, {
        overallAnalysis, overallScore: overallParsed.overallScore ?? 70, status: "pending_review",
      });
    } else {
      await kbDb.updateImageSet(setId, userId, { status: "pending_review" });
    }
  } catch (err: any) {
    console.error(`[KB Images] Import failed for ${asin}:`, err.message);
    await kbDb.updateImageSet(setId, userId, { status: "archived" });
  }
}

/**
 * Re-crawl only specific image positions for an existing set.
 * Deletes old images for those positions first, then scrapes and stores new ones.
 */
async function processPartialReCrawl(
  setId: number, asin: string, userId: number,
  positions: ("main" | "secondary" | "aplus" | "brand_story")[]
) {
  try {
    const scraperConfig = await getScraperConfig();
    const data = await scrapeAmazonProduct(asin, scraperConfig);
    // Update product info
    await kbDb.updateImageSet(setId, userId, {
      productTitle: data.title, brand: data.brand, category: data.category,
    });

    const allImages = data.images || [];
    // Filter to only the requested positions
    const targetImages = allImages.filter(img => positions.includes(img.position as any));
    console.log(`[KB Images] Re-crawl ${positions.join(",")} for ASIN ${asin}: found ${targetImages.length} images`);

    for (let i = 0; i < targetImages.length; i++) {
      const img = targetImages[i];
      const prefix = img.position === "aplus" ? "kb-aplus" : img.position === "brand_story" ? "kb-brand-story" : "kb-images";
      const storedUrl = await downloadAndStoreImage(img.url, asin, i, prefix);
      await kbDb.createImage({
        imageSetId: setId,
        imageUrl: storedUrl,
        imagePosition: img.position as any,
        positionIndex: img.positionIndex,
        aplusModuleType: img.aplusModuleType || null,
        aplusModuleClass: img.aplusModuleClass || null,
      });
    }

    // If no structured images found for requested positions, try legacy fallback for main/secondary
    if (targetImages.length === 0 && data.imageUrls?.length > 0) {
      const needsMain = positions.includes("main");
      const needsSecondary = positions.includes("secondary");
      if (needsMain || needsSecondary) {
        console.log(`[KB Images] Falling back to legacy imageUrls for re-crawl`);
        for (let i = 0; i < data.imageUrls.length; i++) {
          const isMain = i === 0;
          if (isMain && !needsMain) continue;
          if (!isMain && !needsSecondary) continue;
          const storedUrl = await downloadAndStoreImage(data.imageUrls[i], asin, i);
          await kbDb.createImage({
            imageSetId: setId,
            imageUrl: storedUrl,
            imagePosition: isMain ? "main" as const : "secondary" as const,
            positionIndex: i,
          });
        }
      }
    }

    // Set status to pending_review (user can then trigger re-analysis)
    await kbDb.updateImageSet(setId, userId, { status: "pending_review" });
  } catch (err: any) {
    console.error(`[KB Images] Re-crawl failed for ${asin}:`, err.message);
    await kbDb.updateImageSet(setId, userId, { status: "pending_review" });
  }
}

/**
 * Run AI analysis only (no scraping) on all images in a set.
 * Reuses the same analysis logic from processImport.
 */
async function runAnalysisOnly(setId: number, asin: string, userId: number) {
  try {
    const images = await kbDb.listImagesBySet(setId);
    // Per-image analysis
    for (const img of images) {
      try {
        const posIdx = img.positionIndex ?? 0;
        const posLabel = img.imagePosition === "main" ? "主图"
          : img.imagePosition === "aplus" ? `A+内容图#${posIdx + 1}`
          : img.imagePosition === "brand_story" ? `品牌故事图#${posIdx + 1}`
          : `副图#${posIdx}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: `你是一位资深的亚马逊产品图片分析专家。请从以下12个维度分析这张产品图片：
1. 构图与布局 2. 色彩搭配 3. 产品展示角度 4. 场景化程度 5. 文字/信息图层
6. 品牌一致性 7. 目标受众匹配度 8. 情感传达 9. 技术质量 10. 差异化程度
11. 转化驱动力 12. 合规性

同时请为图片打上四维标签：
- tagCategory: 产品类目标签
- tagColorScheme: 色彩方案
- tagImageType: 图片类型
- tagDesignStyle: 设计风格

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
            { role: "user", content: [{ type: "image_url" as const, image_url: { url: img.imageUrl } }, { type: "text" as const, text: `这是ASIN ${asin}的${posLabel}` }] }
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
        console.error(`[KB Images] Re-analysis failed for image ${img.id}:`, err.message);
      }
    }

    // Overall analysis
    const allDbImages = await kbDb.listImagesBySet(setId);
    const productImgs = allDbImages.filter(i => i.imagePosition === "main" || i.imagePosition === "secondary");
    const aplusImgs = allDbImages.filter(i => i.imagePosition === "aplus");
    const brandImgs = allDbImages.filter(i => i.imagePosition === "brand_story");

    const overallResponse = await invokeLLM({
      messages: [
        { role: "system", content: `你是亚马逊产品图片策略分析专家。请对这组产品图片进行整体评估，返回JSON：
{
  "overallStrategy": "整体图片策略评价",
  "mainImageAssessment": "主图评估",
  "secondaryImageFlow": "副图叙事流评估",
  "aplusAssessment": "A+内容图片评估（如有）",
  "brandStoryAssessment": "品牌故事图片评估（如有）",
  "missingImageTypes": ["缺少的图片类型"],
  "improvementSuggestions": ["改进建议"],
  "overallScore": 75,
  "summary": ""
}` },
        { role: "user", content: `ASIN: ${asin}
产品图: ${productImgs.length}张 (${productImgs.map(i => `${i.imagePosition}#${i.positionIndex}: ${i.singleImageScore}/10`).join(", ")})
A+图: ${aplusImgs.length}张
品牌故事图: ${brandImgs.length}张` }
      ],
      response_format: { type: "json_object" as const },
    });
    const overallAnalysis = String(overallResponse.choices?.[0]?.message?.content || "{}");
    const overallParsed = JSON.parse(overallAnalysis);
    await kbDb.updateImageSet(setId, userId, {
      overallAnalysis, overallScore: overallParsed.overallScore ?? 70, status: "pending_review",
    });
  } catch (err: any) {
    console.error(`[KB Images] Re-analysis failed for set ${setId}:`, err.message);
    await kbDb.updateImageSet(setId, userId, { status: "pending_review" });
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
      // Fire-and-forget with full analysis
      processImport(Number(setId), asin, Number(ctx.user.id), true);
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
        // Fire-and-forget without per-image analysis for batch (faster)
        processImport(Number(setId), asin, Number(ctx.user.id), false);
      }
      return { imported: results.length, items: results };
    }),

  importByLink: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const asinMatch = input.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch?.[1]?.toUpperCase() || "";
      if (!asin) throw new Error("无法从链接中提取ASIN");
      const setId = await kbDb.createImageSet({ userId: ctx.user.id, asin, status: "crawling" });
      // Fire-and-forget with full analysis
      processImport(Number(setId), asin, Number(ctx.user.id), true);
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

  // Re-crawl specific image positions for an existing set
  reCrawlByPosition: protectedProcedure
    .input(z.object({
      setId: z.number(),
      positions: z.array(z.enum(["main", "secondary", "aplus", "brand_story"])).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.setId, ctx.user.id);
      if (!set) throw new Error("图片集不存在");
      // Delete existing images for selected positions
      await kbDb.deleteImagesByPosition(set.id, input.positions);
      // Update status to crawling
      await kbDb.updateImageSet(set.id, ctx.user.id, { status: "crawling" });
      // Fire-and-forget: re-crawl only selected positions
      processPartialReCrawl(set.id, set.asin, Number(ctx.user.id), input.positions);
      return { success: true };
    }),

  // Upload images manually to a specific position
  uploadImages: protectedProcedure
    .input(z.object({
      setId: z.number(),
      images: z.array(z.object({
        base64: z.string(),
        filename: z.string(),
        position: z.enum(["main", "secondary", "aplus", "brand_story"]),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.setId, ctx.user.id);
      if (!set) throw new Error("图片集不存在");
      const existingImages = await kbDb.listImagesBySet(set.id);
      const results: { imageUrl: string; position: string }[] = [];
      for (let i = 0; i < input.images.length; i++) {
        const img = input.images[i];
        const buffer = Buffer.from(img.base64, "base64");
        const ext = img.filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)?.[1] || "jpg";
        const prefix = img.position === "aplus" ? "kb-aplus" : img.position === "brand_story" ? "kb-brand-story" : "kb-images";
        const key = `${prefix}/${set.asin}/${Date.now()}-upload-${i}.${ext}`;
        const { url } = await storagePut(key, buffer, `image/${ext}`);
        // Calculate positionIndex: max existing index for this position + 1
        const samePositionImages = existingImages.filter(e => e.imagePosition === img.position);
        const maxIdx = samePositionImages.length > 0 ? Math.max(...samePositionImages.map(e => e.positionIndex ?? 0)) : -1;
        await kbDb.createImage({
          imageSetId: set.id,
          imageUrl: url,
          imagePosition: img.position,
          positionIndex: maxIdx + 1 + i,
        });
        results.push({ imageUrl: url, position: img.position });
      }
      // Reset status to pending_review so user can re-analyze
      await kbDb.updateImageSet(set.id, ctx.user.id, { status: "pending_review" });
      return { success: true, uploaded: results.length };
    }),

  // Delete a single image from a set
  deleteImage: protectedProcedure
    .input(z.object({ imageId: z.number(), setId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.setId, ctx.user.id);
      if (!set) throw new Error("图片集不存在");
      await kbDb.deleteImage(input.imageId);
      return { success: true };
    }),

  // Reorder images within a group
  reorderImages: protectedProcedure
    .input(z.object({
      setId: z.number(),
      imageOrders: z.array(z.object({ id: z.number(), positionIndex: z.number() })),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.setId, ctx.user.id);
      if (!set) throw new Error("图片集不存在");
      await kbDb.reorderImages(input.imageOrders);
      return { success: true };
    }),

  // Re-run AI analysis on all images in a set
  reAnalyze: protectedProcedure
    .input(z.object({ setId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getImageSet(input.setId, ctx.user.id);
      if (!set) throw new Error("图片集不存在");
      const images = await kbDb.listImagesBySet(set.id);
      if (images.length === 0) throw new Error("没有图片可供分析");
      await kbDb.updateImageSet(set.id, ctx.user.id, { status: "analyzing" });
      // Fire-and-forget: run full AI analysis
      runAnalysisOnly(set.id, set.asin, Number(ctx.user.id));
      return { success: true };
    }),

  deleteSet: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteImageSet(input.id, ctx.user.id);
      return { success: true };
    }),
});
