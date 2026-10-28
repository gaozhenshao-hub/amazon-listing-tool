import { actorFromContext, assertResourceAction } from "../services/securityGovernance";
import { layoutWithoutDeletedImages } from "../../shared/knowledgeAssetLayout";
import { queryRows } from "../domains/knowledge/assetTargets";
import { deleteAsset } from "../domains/knowledge/assetLifecycle";
import { randomUUID } from "node:crypto";
import { uploadStandaloneImage, saveStandaloneTags, enqueueStandaloneTags, requireStandaloneImage } from "../domains/knowledge/standaloneImages";
import { StandaloneImageUploadSchema } from "../../shared/standaloneImage";
import { resolveKnowledgeVideos } from "../domains/knowledge/videoDelivery";
import { startKnowledgeCollectionBatch } from "../domains/acquisition/knowledgeCollectionBatch";
import { inheritSetImageTags } from "../../shared/imageSetTags";
import { sharedImageTags, imageTaggingUnits } from "../../shared/imageTaggingUnits";
import { taggingUnitPreview } from "../domains/knowledge/taggingUnitPreview";
import { buildSingleImageAnalysisPrompt } from "../domains/knowledge/imageAnalysisPrompt";
import { imageBelongForPosition, validImageBelongSubtype } from "../../shared/imageBelong";
import { parseKnowledgeImageAnalysis, parseKnowledgeAnalysisJson } from "../domains/knowledge/legacyImageAnalysis";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import * as kbDb from "../kbDb";
import { invokeBusinessSkill } from "../domains/ai_os/services/businessSkillGateway";
import { resolveStoredObjectUrl, storagePut } from "../storage";
import { resourceConflictError } from "@shared/_core/errors";
import { requireDb } from "../repositories/dbClient";
import { acquisitionAssetCandidates, acquisitionConfirmedSnapshots } from "../../drizzle/schema/acquisition";
import { startAmazonAcquisitionJob } from "../domains/acquisition/acquisitionJobs";
import { readManualKbImageCoverage, type ManualKbImageCoverage } from "../domains/acquisition/kbManualImageCoverage";
import { createManualKbImageDeliveryGate } from "../domains/acquisition/kbManualImageDelivery";
import {
  KB_IMAGE_IMPORT_CAPABILITIES,
  KbImageImportAsinSchema,
  kbImagesConsumerRef,
  parseAmazonUsAsins,
  type KbImageAcquisitionCapability,
} from "../domains/acquisition/kbImagesAcquisition";
import {
  STYLE_NAME_OPTIONS, IMAGE_BELONG_OPTIONS, IMAGE_BELONG_HIERARCHY, IMAGE_TYPE_HIERARCHY,
  IMAGE_TYPE_MAIN_OPTIONS, SELLING_POINT_HIERARCHY, SELLING_POINT_MAIN_OPTIONS,
  COLOR_SCHEME_OPTIONS, COMPOSITION_OPTIONS, CATEGORY_OPTIONS, COLOR_TAG_OPTIONS, getStyleParams
} from "../constants/imageTagConstants";

async function resolveImageForDelivery<T extends { imageUrl: string }>(image: T): Promise<T & { imageAccessError?: string }> {
  try {
    return {
      ...image,
      imageUrl: await resolveStoredObjectUrl(image.imageUrl),
    };
  } catch {
    console.warn("[KB Images] Failed to refresh a stored image URL for delivery");
    return {
      ...image,
      imageUrl: "",
      imageAccessError: "图片对象暂时不可访问，可刷新后重试。",
    };
  }
}

async function resolveImagesForDelivery<T extends { imageUrl: string }>(images: T[]): Promise<Array<T & { imageAccessError?: string }>> {
  return Promise.all(images.map(resolveImageForDelivery));
}


async function startKbImagesAcquisition(input: {
  workspaceId: number;
  userId: number;
  asin: string;
  capabilities?: readonly KbImageAcquisitionCapability[];
  cachePolicy?: "prefer_cache" | "refresh";
}) {
  return startAmazonAcquisitionJob({
    workspaceId: input.workspaceId,
    requestedBy: input.userId,
    consumerType: "kb_images",
    consumerRef: kbImagesConsumerRef(input.asin),
    marketplace: "US",
    asin: input.asin,
    capabilities: [...(input.capabilities ?? KB_IMAGE_IMPORT_CAPABILITIES)],
    cachePolicy: input.cachePolicy ?? "prefer_cache",
  });
}

/**
 * Run AI analysis only (no scraping) on all images in a set.
 * Existing confirmed tags remain protected.
 */
async function runAnalysisOnly(setId: number, asin: string, userId: number, workspaceId: number) {
  try {
    const images = await kbDb.listImagesBySet(setId);
    const set = await kbDb.getOwnedImageSet(setId, userId, workspaceId);
    if (!set) throw new Error("图片集不可编辑");
    let failedImages = 0;
    for (const unit of imageTaggingUnits(images, set.sourceLayout)) {
      if (!unit.complete) continue;
      const img = unit.primary;
      if (img.tagsConfirmed || img.analysisConfirmed || img.imagePosition === "brand_story") continue;
      try {
        if (!await kbDb.getOwnedImageSet(setId, userId, workspaceId)) throw new Error("图片集不可编辑");
        const posIdx = img.positionIndex ?? 0;
        const posLabel = img.imagePosition === "main" ? "主图"
          : img.imagePosition === "aplus" ? `A+内容图#${posIdx + 1}`
          : `副图#${posIdx}`;

      // [Emperor] 优先调用 Emperor Skill: analysis.image.recognition





        const resolvedImageUrl = unit.module ? `data:image/jpeg;base64,${(await taggingUnitPreview(unit)).toString("base64")}` : await resolveStoredObjectUrl(img.imageUrl);
        const response = await invokeBusinessSkill({
          emperorSkill: { slug: "analysis.image.recognition", userId, workspaceId, migrationSource: "knowledge.images.analysis" },
          messages: [
            { role: "system", content: buildSingleImageAnalysisPrompt() },
            { role: "user", content: [{ type: "image_url" as const, image_url: { url: resolvedImageUrl } }, { type: "text" as const, text: `这是ASIN ${asin}的${posLabel}，图片位置: ${img.imagePosition}。${unit.module ? "这是完整 A+ 模块，多张图共用一组标签，请按整个模块分析。模块类型：" + (unit.module.subtype || unit.module.kind) : ""}` }] }
          ],
          response_format: { type: "json_object" as const },
        });
        const analysis = String(response.choices?.[0]?.message?.content || "{}");
        const parsed = parseKnowledgeImageAnalysis(analysis);
        await kbDb.updateUnconfirmedOwnedImage(img.id, userId, workspaceId, img.imageUrl, {
          aiDimensionAnalysis: JSON.stringify(parsed),
          tagCategory: parsed.tagCategory || null,
          tagColorScheme: parsed.tagColorScheme || null,
          tagImageType: parsed.tagImageType || null,
          tagDesignStyle: parsed.tagDesignStyle || null,
          // Ownership/module structure comes from the captured page, not visual guesses.
          tagImageBelong: img.tagImageBelong || imageBelongForPosition(img.imagePosition),
          tagImageBelongSub: validImageBelongSubtype(img.tagImageBelong || imageBelongForPosition(img.imagePosition), img.tagImageBelongSub),
          tagImageTypeMain: parsed.tagImageTypeMain || null,
          tagImageTypeSub: parsed.tagImageTypeSub || null,
          tagSellingPointCategory: parsed.tagSellingPointCategory || null,
          tagSellingPointDetail: parsed.tagSellingPointDetail || null,
          tagComposition: parsed.tagComposition || null,
          tagColorSchemeV2: parsed.tagColorSchemeV2 || null,
          tagDesignStyleV2: parsed.tagDesignStyleV2 || null,
          singleImageScore: parsed.singleImageScore || null,
          highlights: JSON.stringify(parsed.highlights || []),
        });
      } catch (err: any) {
        failedImages++;
        console.error(`[KB Images] Re-analysis failed for image ${img.id}:`, err.message);
      }
    }

    if (failedImages) throw new Error(`${failedImages} 张图片分析失败，已有标签保留`);

    // Overall analysis
    const allDbImages = await kbDb.listImagesBySet(setId);
    const productImgs = allDbImages.filter(i => i.imagePosition === "main" || i.imagePosition === "secondary");
    const aplusImgs = allDbImages.filter(i => i.imagePosition === "aplus");
    const brandImgs = allDbImages.filter(i => i.imagePosition === "brand_story");

    // Build tag coverage summary for overall analysis
    const currentSet = await kbDb.getOwnedImageSet(setId, userId, workspaceId);
    const tagCoverage = imageTaggingUnits(allDbImages, currentSet?.sourceLayout).map(({primary:i}) => ({
      pos: `${i.imagePosition}#${i.positionIndex}`,
      score: i.singleImageScore,
      belong: (i as any).tagImageBelong || "unknown",
      typeMain: (i as any).tagImageTypeMain || "unknown",
      typeSub: (i as any).tagImageTypeSub || "",
      sellingPoint: (i as any).tagSellingPointCategory || "",
      composition: (i as any).tagComposition || "",
      category: i.tagCategory || "",
      color: i.tagColorSchemeV2 || i.tagColorScheme || "",
      style: (i as any).tagDesignStyleV2 || (i as any).tagDesignStyle || "",
    }));

    const overallResponse = await invokeBusinessSkill({
          emperorSkill: { slug: "analysis.image.recognition", userId, workspaceId, migrationSource: "knowledge.images.analysis" },
      messages: [
        { role: "system", content: `你是亚马逊产品图片策略分析专家。请对这组产品图片进行整体评估。

评估维度：
1. 图片类型覆盖率：是否涵盖了对比/细节/场景/特效/必要信息等关键类型
2. 卖点覆盖率：图片是否充分展示了产品的各类卖点（质量/功能/设计/操作/安全/附加值）
3. 构图多样性：是否使用了多种构图方式避免单调
4. 风格一致性：套图整体风格是否统一
5. 叙事流逻辑：副图排序是否有清晰的叙事逻辑

返回JSON：
{
  "overallStrategy": "整体图片策略评价",
  "mainImageAssessment": "主图评估",
  "secondaryImageFlow": "副图叙事流评估",
  "aplusAssessment": "A+内容图片评估（如有）",
  "brandStoryAssessment": "品牌故事图片评估（如有）",
  "tagCoverageAnalysis": {
    "imageTypeCoverage": "图片类型覆盖分析",
    "sellingPointCoverage": "卖点覆盖分析",
    "compositionDiversity": "构图多样性分析",
    "styleConsistency": "风格一致性分析"
  },
  "recommendedStyle": "建议的套图风格名称",
  "setCategory": "产品类目（从以下选：${CATEGORY_OPTIONS.join("、")}）",
  "setPrimaryColor": "主颜色（从以下选：${COLOR_TAG_OPTIONS.join("、")}）",
  "setAccentColor": "提亮色（从以下选：${COLOR_TAG_OPTIONS.join("、")}）",
  "missingImageTypes": ["缺少的图片类型"],
  "improvementSuggestions": ["改进建议"],
  "overallScore": 75,
  "summary": ""
}` },
        { role: "user", content: `套图类目、主颜色、提亮色必须从下面各图的实际标签归纳，不能用建议风格的配色替代实际颜色；证据不足时留空。没有采集到的图片只能说明本次资料缺失，不能断言商品页面没有这些内容。
ASIN: ${asin}
产品图: ${productImgs.length}张 (${productImgs.map(i => `${i.imagePosition}#${i.positionIndex}: ${i.singleImageScore}/10`).join(", ")})
A+图: ${aplusImgs.length}张
品牌故事图: ${brandImgs.length}张

各图标签详情:
${JSON.stringify(tagCoverage, null, 1)}` }
      ],
      response_format: { type: "json_object" as const },
    });
    const overallAnalysis = String(overallResponse.choices?.[0]?.message?.content || "{}");
    const overallParsed = parseKnowledgeAnalysisJson(overallAnalysis) as any;
    await kbDb.updateOwnedImageSet(setId, userId, workspaceId, {
      overallAnalysis: JSON.stringify(overallParsed), overallScore: overallParsed.overallScore ?? 70, status: "confirmed",
      setStyle: overallParsed.recommendedStyle || null,
      ...(overallParsed.setCategory && { setCategory: overallParsed.setCategory }),
      ...(overallParsed.setPrimaryColor && { setPrimaryColor: overallParsed.setPrimaryColor }),
      ...(overallParsed.setAccentColor && { setAccentColor: overallParsed.setAccentColor }),
    });
  } catch (err: any) {
    console.error(`[KB Images] Re-analysis failed for set ${setId}:`, err.message);
    await kbDb.updateOwnedImageSet(setId, userId, workspaceId, { status: "pending_review" });
  }
}

/**
 * Run ONLY the overall set-level analysis (no per-image tag re-scoring).
 * Uses existing image tags to build the summary, much faster than full re-analysis.
 */
async function runSummaryOnly(setId: number, asin: string, userId: number, workspaceId: number) {
  try {
    const allDbImages = await kbDb.listImagesBySet(setId);
    const productImgs = allDbImages.filter(i => i.imagePosition === "main" || i.imagePosition === "secondary");
    const aplusImgs = allDbImages.filter(i => i.imagePosition === "aplus");
    const brandImgs = allDbImages.filter(i => i.imagePosition === "brand_story");

    const currentSet = await kbDb.getOwnedImageSet(setId, userId, workspaceId);
    const tagCoverage = imageTaggingUnits(allDbImages, currentSet?.sourceLayout).map(({primary:i}) => ({
      pos: `${i.imagePosition}#${i.positionIndex}`,
      score: i.singleImageScore,
      belong: (i as any).tagImageBelong || "unknown",
      typeMain: (i as any).tagImageTypeMain || "unknown",
      typeSub: (i as any).tagImageTypeSub || "",
      sellingPoint: (i as any).tagSellingPointCategory || "",
      composition: (i as any).tagComposition || "",
      category: i.tagCategory || "",
      color: i.tagColorSchemeV2 || i.tagColorScheme || "",
      style: (i as any).tagDesignStyleV2 || (i as any).tagDesignStyle || "",
    }));

    const overallResponse = await invokeBusinessSkill({
          emperorSkill: { slug: "analysis.image.recognition", userId, workspaceId, migrationSource: "knowledge.images.analysis" },
      messages: [
        { role: "system", content: `你是亚马逊产品图片策略分析专家。请对这组产品图片进行整体评估。\n\n评估维度：\n1. 图片类型覆盖率：是否涵盖了对比/细节/场景/特效/必要信息等关键类型\n2. 卖点覆盖率：图片是否充分展示了产品的各类卖点（质量/功能/设计/操作/安全/附加值）\n3. 构图多样性：是否使用了多种构图方式避免单调\n4. 风格一致性：套图整体风格是否统一\n5. 叙事流逻辑：副图排序是否有清晰的叙事逻辑\n\n返回JSON：\n{\n  "overallStrategy": "整体图片策略评价",\n  "mainImageAssessment": "主图评估",\n  "secondaryImageFlow": "副图叙事流评估",\n  "aplusAssessment": "A+内容图片评估（如有）",\n  "brandStoryAssessment": "品牌故事图片评估（如有）",\n  "tagCoverageAnalysis": {\n    "imageTypeCoverage": "图片类型覆盖分析",\n    "sellingPointCoverage": "卖点覆盖分析",\n    "compositionDiversity": "构图多样性分析",\n    "styleConsistency": "风格一致性分析"\n  },\n  "recommendedStyle": "建议的套图风格名称",\n  "setCategory": "产品类目",\n  "setPrimaryColor": "主颜色",\n  "setAccentColor": "提亮色",\n  "missingImageTypes": ["缺少的图片类型"],\n  "improvementSuggestions": ["改进建议"],\n  "overallScore": 75,\n  "summary": ""\n}` },
        { role: "user", content: `套图类目、主颜色、提亮色必须从下面各图的实际标签归纳，不能用建议风格的配色替代实际颜色；证据不足时留空。没有采集到的图片只能说明本次资料缺失，不能断言商品页面没有这些内容。\nASIN: ${asin}\n产品图: ${productImgs.length}张 (${productImgs.map(i => `${i.imagePosition}#${i.positionIndex}: ${i.singleImageScore}/10`).join(", ")})\nA+图: ${aplusImgs.length}张\n品牌故事图: ${brandImgs.length}张\n\n各图标签详情:\n${JSON.stringify(tagCoverage, null, 1)}` }
      ],
      response_format: { type: "json_object" as const },
    });
    const overallAnalysis = String(overallResponse.choices?.[0]?.message?.content || "{}");
    const overallParsed = parseKnowledgeAnalysisJson(overallAnalysis) as any;
    await kbDb.updateOwnedImageSet(setId, userId, workspaceId, {
      overallAnalysis: JSON.stringify(overallParsed), overallScore: overallParsed.overallScore ?? 70, status: "confirmed",
      setStyle: overallParsed.recommendedStyle || null,
      ...(overallParsed.setCategory && { setCategory: overallParsed.setCategory }),
      ...(overallParsed.setPrimaryColor && { setPrimaryColor: overallParsed.setPrimaryColor }),
      ...(overallParsed.setAccentColor && { setAccentColor: overallParsed.setAccentColor }),
    });
  } catch (err: any) {
    console.error(`[KB Images] Summary-only re-analysis failed for set ${setId}:`, err.message);
    await kbDb.updateOwnedImageSet(setId, userId, workspaceId, { status: "pending_review" });
  }
}

export const kbImagesRouter = router({
  facets: workspaceScopedProcedure("knowledge").input(z.object({scope:z.enum(["mine","shared","all"]),query:z.string().max(200).optional(),filters:z.record(z.string().max(64),z.string().max(100)),groupBy:z.string().max(32)}))
    .query(({ctx,input})=>kbDb.imageBrowseFacets(ctx.user.id,ctx.workspaceId!,input.scope,input)),
  uploadStandalone: workspaceScopedProcedure("knowledge").input(StandaloneImageUploadSchema).mutation(async ({ctx,input})=>{
    await assertResourceAction({actor:actorFromContext(ctx),resource:"knowledge",action:"upload",workspaceId:ctx.workspaceId!},ctx);
    return uploadStandaloneImage({userId:ctx.user.id,workspaceId:ctx.workspaceId!,role:ctx.user.role},input);
  }),
  saveStandaloneTags: workspaceScopedProcedure("knowledge").input(z.object({id:z.number().int().positive(),revision:z.number().int().nonnegative(),tags:z.record(z.string(),z.string().max(200))})).mutation(({ctx,input})=>
    saveStandaloneTags({userId:ctx.user.id,workspaceId:ctx.workspaceId!,role:ctx.user.role},input.id,input.revision,input.tags)),
  runStandaloneTags: workspaceScopedProcedure("knowledge").input(z.object({id:z.number().int().positive(),revision:z.number().int().nonnegative(),feedback:z.string().max(4000).optional()})).mutation(({ctx,input})=>
    enqueueStandaloneTags({userId:ctx.user.id,workspaceId:ctx.workspaceId!,role:ctx.user.role},input.id,input.revision,input.feedback)),

  // List all image sets
  listSets: workspaceScopedProcedure("knowledge")
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional(), includeThumbnails: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const sets = await kbDb.listImageSetsWithThumbnails(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine", { thumbnails: input?.includeThumbnails });
    const delivery = createManualKbImageDeliveryGate({ userId: ctx.user.id, workspaceId: ctx.workspaceId! });
    return Promise.all(sets.map(async set => {
      const checked = await delivery.forSet(set, set.thumbnailImages);
      return { ...set, thumbnailImages: await resolveImagesForDelivery(checked.images), sourceCoverage: checked.sourceCoverage };
    }));
  }),

  setThumbnails: workspaceScopedProcedure("knowledge")
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(50), scope: z.enum(["mine", "shared", "all"]).default("shared") }))
    .query(async ({ ctx, input }) => {
      const sets = await kbDb.listImageSetsWithThumbnails(ctx.user.id, ctx.workspaceId!, input.scope, {setIds: [...new Set(input.ids)]});
      const delivery = createManualKbImageDeliveryGate({userId:ctx.user.id,workspaceId:ctx.workspaceId!});
      return Promise.all(sets.map(async set => {const checked=await delivery.forSet(set,set.thumbnailImages);return {id:set.id,thumbnailImages:await resolveImagesForDelivery(checked.images)};}));
    }),
  contributions: workspaceScopedProcedure("knowledge").query(async ({ctx}) => kbDb.imageContributions(ctx.workspaceId!)),

  // Get image set with all images (lightweight: excludes large analysis fields for fast load)
  getSet: workspaceScopedProcedure("knowledge")
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const set = await kbDb.getReadableImageSet(input.id, ctx.user.id, ctx.workspaceId!);
      if (!set) return null;
      const manual = set.originInstanceId === "manual_acquisition_review_v1";
      if (manual && (set.userId !== ctx.user.id || set.workspaceId !== ctx.workspaceId || set.visibility !== "private")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "MANUAL_KB_IMAGE_SCOPE_UNAVAILABLE" });
      }
      const rawImages = await kbDb.listImagesBySetLight(set.id);
      let sourceCoverage: ManualKbImageCoverage | null = null;
      if (manual) {
        const db = await requireDb("manual image revision coverage");
        sourceCoverage = await readManualKbImageCoverage(db, { userId: ctx.user.id, workspaceId: ctx.workspaceId! }, set, rawImages);
      }
      // A private set alone does not authorize a corrupted storage pointer.
      // Manual versions must bind every delivered image to durable provenance
      // before signing; unavailable proof never degrades to unchecked URLs.
      const images = manual && sourceCoverage?.status !== "verified" ? [] : await resolveImagesForDelivery(sharedImageTags(rawImages, set.sourceLayout).map(image => inheritSetImageTags(image,set)));
      const missingGallery: Array<{id:number;imagePosition:string;positionIndex:number}> = [];
      let acquisitionCoverage: { stored: number; missing: number; total: number; partial: boolean } | null = null;
      if (set.originInstanceId === "unified_amazon_acquisition" && set.remoteId) {
        const db = await requireDb("image acquisition coverage");
        const [confirmed] = await db.select().from(acquisitionConfirmedSnapshots).where(and(
          eq(acquisitionConfirmedSnapshots.workspaceId, ctx.workspaceId!),
          eq(acquisitionConfirmedSnapshots.id, set.remoteId),
        )).limit(1);
        if (confirmed) {
          const candidates = await db.select().from(acquisitionAssetCandidates).where(and(
            eq(acquisitionAssetCandidates.workspaceId, ctx.workspaceId!),
            eq(acquisitionAssetCandidates.snapshotId, confirmed.snapshotId),
          ));
          missingGallery.push(...candidates.filter(c=>!c.storageKey && ["main","secondary"].includes(c.role)).map(c=>({id:-c.id,imagePosition:c.role,positionIndex:c.positionIndex})));
          const stored = candidates.filter(candidate => Boolean(candidate.storageKey) && (candidate.role !== "video" || candidate.thumbnailStorageKey)).length;
          acquisitionCoverage = { stored, missing: candidates.length - stored, total: candidates.length, partial: stored < candidates.length };
        }
      }
      const db=await requireDb();
      const trashedImages=await queryRows<{sourceUrlHash:string|null}>(db,sql`SELECT sourceUrlHash FROM kb_images WHERE imageSetId=${set.id} AND recycleId IS NOT NULL`);
      const trashedVideos=await queryRows<{sourceHash:string;videoRole:string;moduleId:string|null}>(db,sql`SELECT sourceHash,videoRole,moduleId FROM kb_videos WHERE imageSetId=${set.id} AND workspaceId=${ctx.workspaceId!} AND recycleId IS NOT NULL`);
      const visibleVideos=(set.videos||[]).filter(v=>!trashedVideos.some(t=>t.sourceHash===v.hash&&t.videoRole===v.role&&(t.moduleId||"")===(v.moduleId||"")));
      return { ...set, sourceLayout:layoutWithoutDeletedImages(set.sourceLayout,trashedImages.flatMap(i=>i.sourceUrlHash?[i.sourceUrlHash]:[])), videos: manual ? [] : await resolveKnowledgeVideos(visibleVideos, ctx.workspaceId!), images, missingGallery, acquisitionCoverage, sourceCoverage, canEditTags: set.userId === ctx.user.id || (!manual && set.visibility !== "private" && ["admin", "super_admin"].includes(ctx.user.role)) };
    }),

  // Get single image's full analysis data on-demand (lazy load when user expands tag panel)
  getImageAnalysis: workspaceScopedProcedure("knowledge")
    .input(z.object({ imageId: z.number() }))
    .query(async ({ ctx, input }) => {
      return kbDb.getReadableImageWithAnalysis(input.imageId, ctx.user.id, ctx.workspaceId!);
    }),

  // List all images with 7-dimension filters (waterfall view)
  listAllImages: workspaceScopedProcedure("knowledge")
    .input(z.object({
      page: z.number().int().min(1).max(10000).optional(),
      query: z.string().max(200).optional(),
      groupBy: z.enum(["none","type","style","category","primaryColor","accentColor","belong","sellingPoint","composition"]).optional(),
      scope: z.enum(["mine", "shared", "all"]).optional(),
      // Legacy filters
      tagCategory: z.string().optional(),
      tagColorScheme: z.string().optional(),
      tagImageType: z.string().optional(),
      tagDesignStyle: z.string().optional(),
      imagePosition: z.string().optional(),
      // V2 filters
      tagImageBelong: z.string().optional(),
      tagImageBelongSub: z.string().optional(),
      tagImageTypeMain: z.string().optional(),
      tagImageTypeSub: z.string().optional(),
      tagSellingPointCategory: z.string().optional(),
      tagSellingPointDetail: z.string().optional(),
      tagComposition: z.string().optional(),
      tagAccentColor: z.string().max(30).optional(),
      tagColorSchemeV2: z.string().optional(),
      tagDesignStyleV2: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const rawImages = await kbDb.listAllImages(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine", input);
      const delivery = createManualKbImageDeliveryGate({ userId: ctx.user.id, workspaceId: ctx.workspaceId! });
      // Independent assets already passed their own workspace/visibility predicate.
      const collectionImages=rawImages.filter(image=>image.imageSetId!==null);
      await delivery.selection(collectionImages);
      const selected = rawImages;
      return Promise.all(selected.map(async image => ({...await resolveImageForDelivery(image),
        thumbnailUrl:image.thumbnailUrl ? await resolveStoredObjectUrl(image.thumbnailUrl).catch(()=>null) : null,
        moduleImages:await Promise.all((await delivery.selection(image.moduleImages)).map(async member => ({...await resolveImageForDelivery(member),
          thumbnailUrl:member.thumbnailUrl ? await resolveStoredObjectUrl(member.thumbnailUrl).catch(()=>null):null}))),
      })));
    }),

  // Import by ASIN through the governed acquisition job. Projection occurs only after guarded direct ingestion.
  importByAsin: workspaceScopedProcedure("knowledge")
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const asin = KbImageImportAsinSchema.parse(input.asin);
      const dupSet = await kbDb.findImageSetByAsin(asin, ctx.workspaceId!);
      if (dupSet) {
        throw resourceConflictError(`ASIN ${asin} 已存在于图片知识库中`, { existingId: dupSet.id, resource: "kb_image_set", asin });
      }
      const job = await startKbImagesAcquisition({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin });
      return { asin, ...job, directIngestion: true, reviewRequired: false };
    }),

  batchImportAsins: workspaceScopedProcedure("knowledge")
    .input(z.object({ asins: z.array(KbImageImportAsinSchema).min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const receipt = await startKnowledgeCollectionBatch({ workspaceId: ctx.workspaceId!, requestedBy: ctx.user.id,
        requestId: randomUUID(), asins: input.asins, mode: "normal" });
      return { ...receipt, imported: receipt.items.length, skipped: receipt.skippedItems.length };
    }),
  importByLink: workspaceScopedProcedure("knowledge")
    .input(z.object({ url: z.string().trim().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const asins = parseAmazonUsAsins(input.url);
      if (!asins.length || asins.length > 10) throw new TRPCError({ code: "BAD_REQUEST", message: "每次请输入 1 至 10 个美国站 ASIN" });
      const receipt = await startKnowledgeCollectionBatch({ workspaceId: ctx.workspaceId!, requestedBy: ctx.user.id,
        requestId: randomUUID(), asins, mode: "normal" });
      return { ...receipt, imported: receipt.items.length, skipped: receipt.skippedItems.length };
    }),

  // Confirm image tags (v2: supports 7-dimension tags)
  confirmImageTags: workspaceScopedProcedure("knowledge")
    .input(z.object({
      imageId: z.number(),
      // Legacy fields (backward compatible)
      tagCategory: z.string().optional(),
      tagColorScheme: z.string().optional(),
      tagImageType: z.string().optional(),
      tagDesignStyle: z.string().optional(),
      // V2 new fields
      tagImageBelong: z.string().optional(),
      tagImageBelongSub: z.string().optional(),
      tagImageTypeMain: z.string().optional(),
      tagImageTypeSub: z.string().optional(),
      tagSellingPointCategory: z.string().optional(),
      tagSellingPointDetail: z.string().optional(),
      tagComposition: z.string().optional(),
      tagAccentColor: z.string().max(30).optional(),
      tagColorSchemeV2: z.string().optional(),
      tagDesignStyleV2: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { imageId, ...tags } = input;
      const admin = ["admin", "super_admin"].includes(ctx.user.role);
      const image = await kbDb.getImageForTagEditing(imageId, ctx.user.id, ctx.workspaceId!, admin);
      if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在或无权限" });
      // Filter out undefined values
      const cleanTags = Object.fromEntries(
        Object.entries(tags).filter(([_, v]) => v !== undefined)
      );
      if (["tagCategory","tagDesignStyleV2","tagColorSchemeV2","tagAccentColor","tagDesignStyle","tagColorScheme"].some(key=>key in cleanTags))
        throw new TRPCError({code:"BAD_REQUEST",message:"类目、风格、主色和提亮色请在 ASIN 集总标签中修改"});
      await kbDb.updateImageTagsForEditor(imageId, ctx.user.id, ctx.workspaceId!, admin, {...cleanTags, ...(Object.keys(cleanTags).length ? {tagsConfirmed:1} : {})});
      return { success: true };
    }),

  // Confirm set overall analysis
  confirmSetAnalysis: workspaceScopedProcedure("knowledge")
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.id, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedOverallAnalysis = input.editedAnalysis;
      await kbDb.updateOwnedImageSet(input.id, ctx.user.id, ctx.workspaceId!, update);
      return { success: true };
    }),

  // Update single image score
  updateImageScore: workspaceScopedProcedure("knowledge")
    .input(z.object({ imageId: z.number(), score: z.number().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const image = await kbDb.getOwnedImage(input.imageId, ctx.user.id, ctx.workspaceId!);
      if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在或无权限" });
      await kbDb.updateImageTagsForEditor(input.imageId, ctx.user.id, ctx.workspaceId!, false, { singleImageScore: input.score });
      return { success: true };
    }),

  // Refresh selected capabilities through a governed acquisition job. Existing images remain until guarded direct ingestion succeeds.
  reCrawlByPosition: workspaceScopedProcedure("knowledge")
    .input(z.object({
      setId: z.number(),
      positions: z.array(z.enum(["main", "secondary", "aplus", "brand_story"])).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const asin = KbImageImportAsinSchema.parse(set.sourceAsin || set.asin);
      const receipt = await startKnowledgeCollectionBatch({ workspaceId: ctx.workspaceId!, requestedBy: ctx.user.id,
        requestId: randomUUID(), asins: [asin], mode: "new_version" });
      const job = receipt.items[0];
      if (!job) throw new TRPCError({ code: "CONFLICT", message: "该 ASIN 正在采集中或等待补图，请先处理已有任务" });
      return { success: true, ...job, directIngestion: true, reviewRequired: false };
    }),

  // Upload images manually to a specific position
  uploadImages: workspaceScopedProcedure("knowledge")
    .input(z.object({
      setId: z.number(),
      images: z.array(z.object({
        base64: z.string(),
        filename: z.string(),
        position: z.enum(["main", "secondary", "aplus", "brand_story"]),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const existingImages = await kbDb.listImagesBySet(set.id);
      for (let i = 0; i < input.images.length; i++) {
        const img = input.images[i];
        const buffer = Buffer.from(img.base64, "base64");
        const ext = img.filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)?.[1] || "jpg";
        const prefix = img.position === "aplus" ? "kb-aplus" : img.position === "brand_story" ? "kb-brand-story" : "kb-images";
        const key = `${prefix}/${set.asin}/${Date.now()}-upload-${i}.${ext}`;
        const { storageUri } = await storagePut(key, buffer, `image/${ext}`);
        // Calculate positionIndex: max existing index for this position + 1
        const samePositionImages = existingImages.filter(e => e.imagePosition === img.position);
        const maxIdx = samePositionImages.length > 0 ? Math.max(...samePositionImages.map(e => e.positionIndex ?? 0)) : -1;
        await kbDb.createImage({
          imageSetId: set.id,
          imageUrl: storageUri,
          imagePosition: img.position,
          positionIndex: maxIdx + 1 + i,
        });
      }
      // Reset status to pending_review so user can re-analyze
      await kbDb.updateOwnedImageSet(set.id, ctx.user.id, ctx.workspaceId!, { status: "confirmed" });
      const { triggerConsumerPostConfirmation } = await import("../domains/acquisition/postConfirmation");
      const tagging = await triggerConsumerPostConfirmation({consumerType:"kb_images",imageSetId:set.id,workspaceId:ctx.workspaceId!,userId:ctx.user.id});
      return { success: true, uploaded: input.images.length, ...tagging };
    }),

  // Delete a single image from a set
  deleteImage: workspaceScopedProcedure("knowledge")
    .input(z.object({ imageId: z.number(), setId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const image = await kbDb.getReadableImage(input.imageId,ctx.user.id,ctx.workspaceId!);
       if(!image||image.imageSetId!==input.setId)throw new TRPCError({code:"NOT_FOUND",message:"图片不存在或无权限"});
      await deleteAsset({workspaceId:ctx.workspaceId!,userId:ctx.user.id,role:ctx.user.role},"image",input.imageId);
      return { success: true };
    }),

  // Reorder images within a group
  reorderImages: workspaceScopedProcedure("knowledge")
    .input(z.object({
      setId: z.number(),
      imageOrders: z.array(z.object({ id: z.number(), positionIndex: z.number() })),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      for (const item of input.imageOrders) {
        const image = await kbDb.getImageInOwnedSet(item.id, set.id, ctx.user.id, ctx.workspaceId!);
        if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在于该图片集或无权限" });
      }
      await kbDb.reorderImagesInOwnedSet(set.id, ctx.user.id, ctx.workspaceId!, input.imageOrders);
      return { success: true };
    }),

  // Re-run AI analysis on all images in a set
  reAnalyze: workspaceScopedProcedure("knowledge")
    .input(z.object({ setId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const images = await kbDb.listImagesBySet(set.id);
      if (images.length === 0) throw new Error("没有图片可供分析");
      await kbDb.updateOwnedImageSet(set.id, ctx.user.id, ctx.workspaceId!, { status: "analyzing" });
      // Fire-and-forget: run full AI analysis
      void runAnalysisOnly(set.id, set.asin, ctx.user.id, ctx.workspaceId!);
      return { success: true };
    }),

  // Re-run ONLY the overall set-level summary (no per-image tag re-scoring, much faster)
  reAnalyzeSummaryOnly: workspaceScopedProcedure("knowledge")
    .input(z.object({ setId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const set = await kbDb.getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const images = await kbDb.listImagesBySet(set.id);
      if (images.length === 0) throw new Error("没有图片可供分析");
      await kbDb.updateOwnedImageSet(set.id, ctx.user.id, ctx.workspaceId!, { status: "analyzing" });
      // Fire-and-forget: run summary-only analysis
      void runSummaryOnly(set.id, set.asin, ctx.user.id, ctx.workspaceId!);
      return { success: true };
    }),

  deleteSet: workspaceScopedProcedure("knowledge")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteAsset({workspaceId:ctx.workspaceId!,userId:ctx.user.id,role:ctx.user.role},"set",input.id);
      return { success: true };
    }),

  // Update set-level style configuration (Phase 6)
  updateSetStyle: workspaceScopedProcedure("knowledge")
    .input(z.object({
      id: z.number(),
      setStyle: z.string().nullable().optional(),
      setStyleParams: z.string().nullable().optional(), // JSON string of style params
      setPrimaryColor: z.string().nullable().optional(), // 主颜色
      setAccentColor: z.string().nullable().optional(), // 提亮色
      setCategory: z.string().nullable().optional(), // 套图类目
      setTargetAudience: z.string().nullable().optional(),
      setCategoryScene: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const set = await kbDb.getOwnedImageSet(id, ctx.user.id, ctx.workspaceId!);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "图片集不存在或无权限" });
      const update: any = {};
      if (data.setStyle !== undefined) update.setStyle = data.setStyle;
      if (data.setStyleParams !== undefined) update.setStyleParams = data.setStyleParams;
      if (data.setPrimaryColor !== undefined) update.setPrimaryColor = data.setPrimaryColor;
      if (data.setAccentColor !== undefined) update.setAccentColor = data.setAccentColor;
      if (data.setCategory !== undefined) update.setCategory = data.setCategory;
      if (data.setTargetAudience !== undefined) update.setTargetAudience = data.setTargetAudience;
      if (data.setCategoryScene !== undefined) update.setCategoryScene = data.setCategoryScene;
      await kbDb.updateOwnedImageSet(id, ctx.user.id, ctx.workspaceId!, update);
      return { success: true };
    }),
  // ── Manual upload: create a new set from uploaded images (no ASIN crawl) ──
  createSetFromUpload: workspaceScopedProcedure("knowledge")
    .input(z.object({
      asin: z.string().min(1).describe("ASIN or custom identifier for the set"),
      title: z.string().min(1).describe("Title for the image set").optional(),
      images: z.array(z.object({
        base64: z.string(),
        filename: z.string(),
        position: z.enum(["main", "secondary", "aplus", "brand_story"]),
      })).min(1).max(50),
      autoAnalyze: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      // ASIN dedup: prevent duplicate entries
      const dupSet = await kbDb.findImageSetByAsin(asin, ctx.workspaceId!);
      if (dupSet) {
        throw resourceConflictError(`ASIN ${asin} 已存在于图片知识库中`, { existingId: dupSet.id, resource: "kb_image_set", asin });
      }
      const setId = await kbDb.createImageSet({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin, productTitle: input.title || undefined, status: "confirmed", visibility: "team" });
      const numericSetId = Number(setId);
      // Upload images to S3
      for (let i = 0; i < input.images.length; i++) {
        const img = input.images[i];
        const buffer = Buffer.from(img.base64, "base64");
        const ext = img.filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)?.[1] || "jpg";
        const prefix = img.position === "aplus" ? "kb-aplus" : img.position === "brand_story" ? "kb-brand-story" : "kb-images";
        const key = `${prefix}/${asin}/${Date.now()}-manual-${i}.${ext}`;
        const { storageUri } = await storagePut(key, buffer, `image/${ext}`);
        await kbDb.createImage({
          imageSetId: numericSetId,
          imageUrl: storageUri,
          imagePosition: img.position,
          positionIndex: i,
        });
      }
      const { triggerConsumerPostConfirmation } = await import("../domains/acquisition/postConfirmation");
      const tagging = await triggerConsumerPostConfirmation({consumerType:"kb_images",imageSetId:numericSetId,workspaceId:ctx.workspaceId!,userId:ctx.user.id});
      return { id: numericSetId, asin, imageCount: input.images.length, ...tagging };
    }),
});
