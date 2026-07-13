/**
 * Image AI Analyzer - 截图AI识别模块
 * 
 * 利用LLM的多模态能力（vision）分析亚马逊产品图片质量
 * 对首图、辅图、A+图片进行结构化评分
 * 
 * 评分维度：
 * - 首图：白底纯净度、产品占比、清晰度、角度、专业感
 * - 辅图：卖点表达、文案可读性、构图美感、信息密度、场景真实性
 * - A+图片：模块一致性、品牌调性、信息层次、视觉吸引力
 */

import { invokeLLM } from "../_core/llm";
import { analyzeImageViaEmperor } from "../emperorClient";
import type { ProductImage } from "../scraper";

// ─── Types ───

export interface ImageAnalysisResult {
  imageUrl: string;
  imageType: "main" | "secondary" | "aplus" | "brand_story";
  positionIndex: number;
  overallScore: number; // 1-5
  dimensions: ImageDimensionScore[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface ImageDimensionScore {
  dimension: string;
  score: number; // 1-5
  reason: string;
}

export interface ImageAnalysisBatchResult {
  success: boolean;
  results: ImageAnalysisResult[];
  errors: string[];
  analyzedCount: number;
  totalCount: number;
}

// ─── Main Image Analysis Prompt ───

const MAIN_IMAGE_PROMPT = `你是一位拥有10年经验的亚马逊产品摄影和视觉营销专家。请分析这张亚马逊产品首图（Main Image），按照以下维度进行评分。

亚马逊首图要求：
- 必须是纯白背景（RGB 255,255,255）
- 产品必须占据图片面积的85%以上
- 不能有文字、Logo水印、边框
- 产品必须完整展示，不能被裁切
- 图片必须清晰、高分辨率
- 光线均匀，无明显阴影

评分维度（每项1-5分）：
1. 白底纯净度：背景是否为纯白，有无杂色、阴影、渐变
2. 产品占比：产品是否占据画面85%以上，构图是否饱满
3. 清晰度：图片是否高清，细节是否清晰可辨
4. 拍摄角度：角度是否最能展示产品特征和卖点
5. 专业感：整体是否有专业产品摄影的质感

请严格按照以下JSON格式返回：`;

const SECONDARY_IMAGE_PROMPT = `你是一位拥有10年经验的亚马逊视觉营销和电商设计专家。请分析这张亚马逊产品辅图（Secondary Image），按照以下维度进行评分。

优秀辅图的标准：
- 清晰表达一个核心卖点
- 文案简洁有力，字体大小适合手机端阅读
- 构图美观，视觉层次分明
- 信息密度适中，不过于拥挤也不过于空洞
- 场景真实自然，能引起消费者共鸣
- 配色协调，与品牌调性一致

评分维度（每项1-5分）：
1. 卖点表达：是否清晰传达了一个核心卖点，买家能否一眼看懂
2. 文案可读性：文案是否简洁有力，字体大小是否适合手机端
3. 构图美感：布局是否美观，视觉层次是否分明
4. 信息密度：信息量是否适中，不过于拥挤也不过于空洞
5. 场景/表达方式：是否使用了有效的表达方式（场景、对比、图表等）

请严格按照以下JSON格式返回：`;

const APLUS_IMAGE_PROMPT = `你是一位拥有10年经验的亚马逊A+内容设计专家。请分析这张亚马逊A+（Enhanced Brand Content）图片，按照以下维度进行评分。

优秀A+内容的标准：
- 模块设计一致，品牌调性统一
- 信息层次清晰，重点突出
- 视觉吸引力强，能留住买家
- 图文配合得当，不是纯图片堆砌
- 整体讲述品牌/产品故事

评分维度（每项1-5分）：
1. 品牌调性：是否与品牌整体风格一致，配色/字体是否统一
2. 信息层次：信息是否有主次之分，重点是否突出
3. 视觉吸引力：设计是否精美，能否吸引买家继续浏览
4. 图文配合：图片与文字是否互补，信息传达是否完整
5. 模块设计：模块类型选择是否合适，布局是否合理

请严格按照以下JSON格式返回：`;

const RESPONSE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "image_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        overallScore: { type: "integer", description: "总体评分 1-5" },
        dimensions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string", description: "评分维度名称" },
              score: { type: "integer", description: "该维度评分 1-5" },
              reason: { type: "string", description: "评分理由（简短）" },
            },
            required: ["dimension", "score", "reason"],
            additionalProperties: false,
          },
        },
        summary: { type: "string", description: "总体评价（一句话）" },
        strengths: {
          type: "array",
          items: { type: "string" },
          description: "优点列表（2-3条）",
        },
        weaknesses: {
          type: "array",
          items: { type: "string" },
          description: "不足列表（2-3条）",
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "改进建议（2-3条）",
        },
      },
      required: ["overallScore", "dimensions", "summary", "strengths", "weaknesses", "suggestions"],
      additionalProperties: false,
    },
  },
};

// ─── Core Analysis Function ───

function getPromptForImageType(imageType: string): string {
  switch (imageType) {
    case "main":
      return MAIN_IMAGE_PROMPT;
    case "secondary":
      return SECONDARY_IMAGE_PROMPT;
    case "aplus":
    case "brand_story":
      return APLUS_IMAGE_PROMPT;
    default:
      return SECONDARY_IMAGE_PROMPT;
  }
}

/**
 * Analyze a single image using LLM vision
 */
export async function analyzeImage(
  imageUrl: string,
  imageType: "main" | "secondary" | "aplus" | "brand_story",
  positionIndex: number,
): Promise<ImageAnalysisResult> {
  const prompt = getPromptForImageType(imageType);

  // Emperor Skill 优先 - 图片分析
  try {
    const emperorRes = await analyzeImageViaEmperor(JSON.stringify({imageUrl: imageUrl || "", context: ""}).slice(0, 2000));
    if (emperorRes.success && emperorRes.output) return emperorRes.output as unknown as ImageAnalysisResult;
  } catch (e) { console.warn("[Emperor] imageAnalyze fallback:", e); }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
              detail: "high",
            },
          },
          {
            type: "text",
            text: `请分析这张${imageType === 'main' ? '首图' : imageType === 'secondary' ? '辅图' : 'A+图片'}（第${positionIndex + 1}张），给出结构化评分。`,
          },
        ],
      },
    ],
    response_format: RESPONSE_SCHEMA,
  });

  const rawContent = response.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("LLM返回空内容");
  }

  // content may be string or array of content parts
  const content = typeof rawContent === 'string' ? rawContent : 
    (rawContent as any[]).find((c: any) => c.type === 'text')?.text || JSON.stringify(rawContent);
  const parsed = JSON.parse(content);

  return {
    imageUrl,
    imageType,
    positionIndex,
    overallScore: Math.max(1, Math.min(5, parsed.overallScore)),
    dimensions: (parsed.dimensions || []).map((d: any) => ({
      dimension: d.dimension,
      score: Math.max(1, Math.min(5, d.score)),
      reason: d.reason,
    })),
    summary: parsed.summary || "",
    strengths: parsed.strengths || [],
    weaknesses: parsed.weaknesses || [],
    suggestions: parsed.suggestions || [],
  };
}

/**
 * Batch analyze multiple images
 * Processes images sequentially to avoid rate limiting
 */
export async function analyzeImages(
  images: ProductImage[],
  maxImages: number = 10,
): Promise<ImageAnalysisBatchResult> {
  const errors: string[] = [];
  const results: ImageAnalysisResult[] = [];

  // Limit the number of images to analyze
  const toAnalyze = images.slice(0, maxImages);

  for (let i = 0; i < toAnalyze.length; i++) {
    const img = toAnalyze[i];
    try {
      console.log(`[ImageAI] Analyzing image ${i + 1}/${toAnalyze.length}: ${img.position} #${img.positionIndex}`);
      const result = await analyzeImage(img.url, img.position, img.positionIndex);
      results.push(result);

      // Small delay between API calls to avoid rate limiting
      if (i < toAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err: any) {
      const errMsg = `图片分析失败 (${img.position} #${img.positionIndex}): ${err.message}`;
      console.error(`[ImageAI] ${errMsg}`);
      errors.push(errMsg);
    }
  }

  return {
    success: results.length > 0,
    results,
    errors,
    analyzedCount: results.length,
    totalCount: toAnalyze.length,
  };
}

/**
 * Analyze images and return scores mapped to check items
 * This function bridges the image analysis with the conversion scoring system
 */
export async function analyzeImagesForScoring(
  images: ProductImage[],
): Promise<{
  mainImageScore: number | null;
  secondaryImageScores: number[];
  aplusImageScore: number | null;
  details: ImageAnalysisResult[];
  errors: string[];
}> {
  const mainImages = images.filter(img => img.position === "main");
  const secondaryImages = images.filter(img => img.position === "secondary");
  const aplusImages = images.filter(img => img.position === "aplus" || img.position === "brand_story");

  const allToAnalyze: ProductImage[] = [];
  
  // Prioritize: first main image, then up to 6 secondary, then up to 3 A+
  if (mainImages.length > 0) allToAnalyze.push(mainImages[0]);
  allToAnalyze.push(...secondaryImages.slice(0, 6));
  allToAnalyze.push(...aplusImages.slice(0, 3));

  if (allToAnalyze.length === 0) {
    return {
      mainImageScore: null,
      secondaryImageScores: [],
      aplusImageScore: null,
      details: [],
      errors: ["没有可分析的图片URL"],
    };
  }

  const batchResult = await analyzeImages(allToAnalyze);

  const mainResult = batchResult.results.find(r => r.imageType === "main");
  const secondaryResults = batchResult.results.filter(r => r.imageType === "secondary");
  const aplusResults = batchResult.results.filter(r => r.imageType === "aplus" || r.imageType === "brand_story");

  return {
    mainImageScore: mainResult?.overallScore ?? null,
    secondaryImageScores: secondaryResults.map(r => r.overallScore),
    aplusImageScore: aplusResults.length > 0
      ? Math.round(aplusResults.reduce((sum, r) => sum + r.overallScore, 0) / aplusResults.length)
      : null,
    details: batchResult.results,
    errors: batchResult.errors,
  };
}
