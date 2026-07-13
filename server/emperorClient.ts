/**
 * Emperor 皇帝 AI 能力中台 — AMZ 全链路工具调用客户端
 * v5.0：添加超时控制、错误降级、类型安全输出
 *
 * Emperor 平台地址：http://104.196.50.157:4800
 * 所有 AI 调用通过此客户端路由，实现统一鉴权、限流、审计和 Prompt 管理
 */

const EMPEROR_BASE_URL = process.env.EMPEROR_BASE_URL ?? "http://104.196.50.157:4800";
const EMPEROR_API_KEY = process.env.EMPEROR_API_KEY ?? "dev-service-token";
const EMPEROR_PROJECT_ID = process.env.EMPEROR_PROJECT_ID ?? "proj_amz_fullchain";
const EMPEROR_TIMEOUT_MS = 150_000; // 150 秒（Emperor 内部 120s + 30s 缓冲）

export interface SkillRunResult<T = unknown> {
  success: boolean;
  runId?: string;
  output?: T;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs?: number;
  error?: string;
}

/**
 * 核心调用函数：运行指定 Skill
 */
export async function runSkill<T = unknown>(
  slug: string,
  input: Record<string, unknown>,
  options?: { timeoutMs?: number }
): Promise<SkillRunResult<T>> {
  const timeoutMs = options?.timeoutMs ?? EMPEROR_TIMEOUT_MS;
  const url = `${EMPEROR_BASE_URL}/v1/skills/${slug}/run`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${EMPEROR_API_KEY}`,
      },
      body: JSON.stringify({
        projectId: EMPEROR_PROJECT_ID,
        input,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as {
      success: boolean;
      runId?: string;
      output?: T;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      durationMs?: number;
      error?: string;
    };

    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { success: false, error: `Emperor Skill 调用超时（>${timeoutMs}ms）：${slug}` };
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Listing 模块便捷函数
// ============================================================

export interface TitleOutput {
  titles: Array<{
    title: string;
    itemHighlights: string;
    titleCharCount?: number;
    itemHighlightsCharCount?: number;
    combinedCharCount?: number;
    coreKeywords?: string[];
    strategy?: string;
    score?: number;
    reasoning?: string;
  }>;
  recommendedTitle?: string;
  recommendedItemHighlights?: string;
  reasoning?: string;
}

export async function generateTitleViaEmperor(
  context: string,
  emphasis?: string
): Promise<SkillRunResult<TitleOutput>> {
  return runSkill<TitleOutput>("listing.title.generate", { context, emphasis });
}

export interface BulletsOutput {
  bulletPoints?: Array<{
    subtitle?: string;
    fullText?: string;
    sellingPoint?: string;
    charCount?: number;
  }>;
  bullets?: string[];
  keywordsUsed?: string[];
}

export async function generateBulletsViaEmperor(
  context: string,
  confirmedTitle?: string,
  emphasis?: string
): Promise<SkillRunResult<BulletsOutput>> {
  const contextWithTitle = confirmedTitle
    ? `${context}\n\n## 已确认标题\n${confirmedTitle}`
    : context;
  return runSkill<BulletsOutput>("listing.bullets.generate", { context: contextWithTitle, emphasis });
}

export interface DescriptionOutput {
  description?: string;
  htmlDescription?: string;
  wordCount?: number;
}

export async function generateDescriptionViaEmperor(
  context: string,
  confirmedTitle?: string,
  confirmedBullets?: string[],
  emphasis?: string
): Promise<SkillRunResult<DescriptionOutput>> {
  const parts = [context];
  if (confirmedTitle) parts.push(`\n## 已确认标题\n${confirmedTitle}`);
  if (confirmedBullets?.length) {
    parts.push(`\n## 已确认五点\n${confirmedBullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`);
  }
  return runSkill<DescriptionOutput>("listing.description.generate", { context: parts.join(""), emphasis });
}

export interface SearchTermsOutput {
  searchTerms?: string;
  keywords?: string[];
  charCount?: number;
}

export async function generateSearchTermsViaEmperor(
  context: string,
  emphasis?: string
): Promise<SkillRunResult<SearchTermsOutput>> {
  return runSkill<SearchTermsOutput>("listing.searchterms.generate", { context, emphasis });
}

export interface SellingPointsOutput {
  sellingPoints?: Array<{
    point?: string;
    category?: string;
    priority?: number;
    evidence?: string;
  }>;
  coreDirection?: string;
}

export async function generateSellingPointsViaEmperor(
  context: string,
  emphasis?: string
): Promise<SkillRunResult<SellingPointsOutput>> {
  return runSkill<SellingPointsOutput>("listing.sellingpoints.generate", { context, emphasis });
}

export interface SingleBulletOutput {
  subtitle?: string;
  fullText?: string;
  charCount?: number;
  checklistScores?: Array<{ dimension: string; score: number; feedback: string }>;
}

export async function refineSingleBulletViaEmperor(
  context: string,
  bulletIndex: number,
  currentBullet: string,
  emphasis?: string
): Promise<SkillRunResult<SingleBulletOutput>> {
  return runSkill<SingleBulletOutput>("listing.bullet.single", {
    context,
    bulletIndex,
    currentBullet,
    emphasis,
  });
}

export interface QAOutput {
  qaItems?: Array<{
    question?: string;
    answer?: string;
    questionZh?: string;
    answerZh?: string;
    category?: string;
  }>;
}

export async function generateQAViaEmperor(
  context: string,
  emphasis?: string
): Promise<SkillRunResult<QAOutput>> {
  return runSkill<QAOutput>("listing.qa.generate", { context, emphasis });
}

export interface ImageAdviceOutput {
  designGuidelines?: {
    fontRecommendation?: string;
    colorScheme?: string;
    brandTone?: string;
    mobileOptimization?: string;
  };
  mainImages?: Array<{
    concept?: string;
    colorScheme?: string;
    composition?: string;
    shootingTips?: string;
    sellingPoint?: string;
    textContent?: string;
  }>;
  subImages?: Array<{
    title?: string;
    expressionMethod?: string;
    colorScheme?: string;
    composition?: string;
    dataVisualization?: string;
    icons?: string[];
    keyElements?: string[];
    fabeAnalysis?: string;
  }>;
  aplusContent?: Array<{
    title?: string;
    expressionMethod?: string;
    colorScheme?: string;
    composition?: string;
    storyNarrative?: string;
    consistency?: string;
    modularDesign?: string;
  }>;
}

export async function generateImageAdviceViaEmperor(
  context: string
): Promise<SkillRunResult<ImageAdviceOutput>> {
  return runSkill<ImageAdviceOutput>("listing.image.advice", { context });
}

export interface TranslationOutput {
  titleCn?: string;
  itemHighlightsCn?: string;
  bulletPointsCn?: Array<{ subtitle?: string; fullText?: string }>;
  descriptionCn?: string;
  searchTermsCn?: string;
  qaContentCn?: string;
}

export async function translateListingViaEmperor(
  context: string
): Promise<SkillRunResult<TranslationOutput>> {
  return runSkill<TranslationOutput>("listing.translate.chinese", { context });
}

export interface ChecklistOutput {
  dimensions?: Array<{
    name?: string;
    score?: number;
    maxScore?: number;
    passed?: boolean;
    issues?: string[];
    suggestions?: string[];
  }>;
  totalScore?: number;
  grade?: string;
  summary?: string;
}

export async function checkTitleViaEmperor(
  context: string
): Promise<SkillRunResult<ChecklistOutput>> {
  return runSkill<ChecklistOutput>("listing.checklist.title", { context });
}

export async function checkBulletsViaEmperor(
  context: string
): Promise<SkillRunResult<ChecklistOutput>> {
  return runSkill<ChecklistOutput>("listing.checklist.bullets", { context });
}

export async function checkDescriptionViaEmperor(
  context: string
): Promise<SkillRunResult<ChecklistOutput>> {
  return runSkill<ChecklistOutput>("listing.checklist.description", { context });
}

export async function checkSearchTermsViaEmperor(
  context: string
): Promise<SkillRunResult<ChecklistOutput>> {
  return runSkill<ChecklistOutput>("listing.checklist.searchterms", { context });
}

export async function checkQAViaEmperor(
  context: string
): Promise<SkillRunResult<ChecklistOutput>> {
  return runSkill<ChecklistOutput>("listing.checklist.qa", { context });
}

export interface ScoringOutput {
  totalScore?: number;
  dimensions?: Array<{
    name?: string;
    score?: number;
    maxScore?: number;
    issues?: string[];
    suggestions?: string[];
  }>;
  grade?: "S" | "A" | "B" | "C" | "D";
  topPriorities?: string[];
}

export async function scoreListingViaEmperor(
  context: string
): Promise<SkillRunResult<ScoringOutput>> {
  return runSkill<ScoringOutput>("listing.scoring.overall", { context });
}

export interface ABTestOutput {
  variants?: Array<{
    label?: string;
    title?: string;
    itemHighlights?: string;
    hypothesis?: string;
    targetAudience?: string;
  }>;
  testPlan?: string;
  metrics?: string[];
}

export async function generateABTestViaEmperor(
  context: string
): Promise<SkillRunResult<ABTestOutput>> {
  return runSkill<ABTestOutput>("listing.abtest.generate", { context });
}

export interface FABEExpandOutput {
  fabeItems?: Array<{
    keyword?: string;
    feature?: string;
    advantage?: string;
    benefit?: string;
    evidence?: string;
  }>;
}

export async function expandKeywordFABEViaEmperor(
  context: string,
  keywords: string[]
): Promise<SkillRunResult<FABEExpandOutput>> {
  return runSkill<FABEExpandOutput>("listing.keyword.fabe.expand", { context, keywords });
}

// ============================================================
// 关键词模块便捷函数
// ============================================================

export interface KeywordMatrixOutput {
  coreKeywords?: Array<{ keyword: string; intent: string; priority: "高" | "中" | "低" }>;
  longTailKeywords?: string[];
  negativeKeywords?: string[];
  strategy?: string;
}

export async function generateKeywordMatrixViaEmperor(
  context: string,
  emphasis?: string
): Promise<SkillRunResult<KeywordMatrixOutput>> {
  return runSkill<KeywordMatrixOutput>("keyword.strategy.matrix", { context, emphasis });
}

export interface KeywordFilterOutput {
  filtered?: Array<{ keyword: string; relevance: string; reason: string }>;
  removed?: Array<{ keyword: string; reason: string }>;
}

export async function filterKeywordsViaEmperor(
  context: string
): Promise<SkillRunResult<KeywordFilterOutput>> {
  return runSkill<KeywordFilterOutput>("keyword.semantic.filter", { context });
}

export interface KeywordSceneTagOutput {
  keywords?: Array<{
    keyword: string;
    scenes?: string[];
    cosmoTags?: string[];
    intent?: string;
  }>;
}

export async function tagKeywordScenesViaEmperor(
  context: string
): Promise<SkillRunResult<KeywordSceneTagOutput>> {
  return runSkill<KeywordSceneTagOutput>("keyword.scene.tag", { context });
}

export interface KeywordRootOutput {
  roots?: Array<{
    root: string;
    keywords: string[];
    type?: string;
    priority?: string;
  }>;
}

export async function classifyKeywordRootsViaEmperor(
  context: string
): Promise<SkillRunResult<KeywordRootOutput>> {
  return runSkill<KeywordRootOutput>("keyword.root.classify", { context });
}

export interface KeywordTrafficOutput {
  classified?: Array<{
    keyword: string;
    trafficLevel?: "高" | "中" | "低";
    competitionLevel?: "高" | "中" | "低";
    strategy?: string;
  }>;
}

export async function classifyKeywordTrafficViaEmperor(
  context: string
): Promise<SkillRunResult<KeywordTrafficOutput>> {
  return runSkill<KeywordTrafficOutput>("keyword.traffic.classify", { context });
}

export interface KeywordListingLayoutOutput {
  titleKeywords?: string[];
  bulletKeywords?: string[][];
  searchTermKeywords?: string[];
  reasoning?: string;
}

export async function suggestKeywordListingLayoutViaEmperor(
  context: string
): Promise<SkillRunResult<KeywordListingLayoutOutput>> {
  return runSkill<KeywordListingLayoutOutput>("keyword.listing.layout", { context });
}

// ============================================================
// 广告模块便捷函数
// ============================================================

export interface AdSearchTermAdviceOutput {
  recommendations?: Array<{
    keyword?: string;
    action?: "加词" | "否定" | "调价" | "保持";
    reason?: string;
    suggestedBid?: number;
    priority?: string;
  }>;
  summary?: string;
}

export async function adviseAdSearchTermsViaEmperor(
  context: string
): Promise<SkillRunResult<AdSearchTermAdviceOutput>> {
  return runSkill<AdSearchTermAdviceOutput>("ad.searchterm.advice", { context });
}

export interface AdDiagnosisOutput {
  healthScore?: number;
  issues?: Array<{ type: string; severity: string; description: string; suggestion: string }>;
  opportunities?: Array<{ type: string; description: string; expectedImpact: string }>;
  summary?: string;
}

export async function diagnoseAdViaEmperor(
  context: string
): Promise<SkillRunResult<AdDiagnosisOutput>> {
  return runSkill<AdDiagnosisOutput>("ad.diagnosis", { context });
}

export interface AdBudgetAllocationOutput {
  allocations?: Array<{
    campaignName?: string;
    currentBudget?: number;
    suggestedBudget?: number;
    reason?: string;
    priority?: string;
  }>;
  totalBudget?: number;
  strategy?: string;
}

export async function allocateAdBudgetViaEmperor(
  context: string
): Promise<SkillRunResult<AdBudgetAllocationOutput>> {
  return runSkill<AdBudgetAllocationOutput>("ad.budget.allocation", { context });
}

export interface AdStructureOutput {
  campaigns?: Array<{
    name?: string;
    type?: string;
    budget?: number;
    adGroups?: Array<{
      name?: string;
      keywords?: Array<{ keyword: string; matchType: string; bid: number }>;
    }>;
  }>;
  strategy?: string;
}

export async function generateAdStructureViaEmperor(
  context: string
): Promise<SkillRunResult<AdStructureOutput>> {
  return runSkill<AdStructureOutput>("ad.structure.generate", { context });
}

export interface AdNegativeOutput {
  negativeKeywords?: Array<{ keyword: string; matchType: string; reason: string; campaignScope: string }>;
  addKeywords?: Array<{ keyword: string; matchType: string; suggestedBid: number; reason: string }>;
}

export async function generateAdNegativeViaEmperor(
  context: string
): Promise<SkillRunResult<AdNegativeOutput>> {
  return runSkill<AdNegativeOutput>("ad.negative.generate", { context });
}

export interface AdDaypartingOutput {
  strategy?: Array<{
    timeSlot?: string;
    dayOfWeek?: string;
    bidMultiplier?: number;
    reason?: string;
  }>;
  summary?: string;
}

export async function suggestAdDaypartingViaEmperor(
  context: string
): Promise<SkillRunResult<AdDaypartingOutput>> {
  return runSkill<AdDaypartingOutput>("ad.dayparting.strategy", { context });
}

// ============================================================
// 运营模块便捷函数
// ============================================================

export interface InventoryAnalysisOutput {
  status?: string;
  daysOfStock?: number;
  reorderRecommendation?: string;
  riskLevel?: "高" | "中" | "低";
  actions?: Array<{ action: string; priority: string; deadline?: string }>;
}

export async function analyzeInventoryViaEmperor(
  context: string
): Promise<SkillRunResult<InventoryAnalysisOutput>> {
  return runSkill<InventoryAnalysisOutput>("ops.inventory.analysis", { context });
}

export interface ProfitAnalysisOutput {
  profitMargin?: number;
  roi?: number;
  breakEvenPoint?: number;
  optimizationSuggestions?: Array<{ item: string; currentCost: number; suggestedAction: string; potentialSaving: number }>;
  summary?: string;
}

export async function analyzeProfitViaEmperor(
  context: string
): Promise<SkillRunResult<ProfitAnalysisOutput>> {
  return runSkill<ProfitAnalysisOutput>("ops.profit.analysis", { context });
}

export interface OpsSearchTermAdviceOutput {
  recommendations?: Array<{
    keyword?: string;
    currentRank?: number;
    targetRank?: number;
    action?: string;
    reason?: string;
  }>;
  summary?: string;
}

export async function adviseOpsSearchTermsViaEmperor(
  context: string
): Promise<SkillRunResult<OpsSearchTermAdviceOutput>> {
  return runSkill<OpsSearchTermAdviceOutput>("ops.searchterm.advice", { context });
}

export interface CompetitorAnalysisOutput {
  competitors?: Array<{
    asin?: string;
    strengths?: string[];
    weaknesses?: string[];
    opportunities?: string[];
    threats?: string[];
  }>;
  marketPosition?: string;
  recommendations?: string[];
}

export async function analyzeCompetitorViaEmperor(
  context: string
): Promise<SkillRunResult<CompetitorAnalysisOutput>> {
  return runSkill<CompetitorAnalysisOutput>("ops.competitor.analysis", { context });
}

// ============================================================
// 图片模块便捷函数
// ============================================================

export interface ImageSellingPointsOutput {
  sellingPoints?: Array<{ point: string; visualExpression: string; priority: number }>;
  mainTheme?: string;
}

export async function extractImageSellingPointsViaEmperor(
  context: string
): Promise<SkillRunResult<ImageSellingPointsOutput>> {
  return runSkill<ImageSellingPointsOutput>("image.step1.sellingpoints", { context });
}

export interface ImageOutlineOutput {
  images?: Array<{
    index?: number;
    type?: string;
    sellingPoint?: string;
    content?: string;
    layout?: string;
  }>;
}

export async function planImageOutlineViaEmperor(
  context: string
): Promise<SkillRunResult<ImageOutlineOutput>> {
  return runSkill<ImageOutlineOutput>("image.step2.outline", { context });
}

export interface ImageStyleOutput {
  style?: string;
  colorPalette?: string[];
  fontStyle?: string;
  backgroundStyle?: string;
  moodBoard?: string;
}

export async function defineImageStyleViaEmperor(
  context: string
): Promise<SkillRunResult<ImageStyleOutput>> {
  return runSkill<ImageStyleOutput>("image.step3.style", { context });
}

export interface AplusOptimizeOutput {
  modules?: Array<{
    type?: string;
    title?: string;
    content?: string;
    imageDescription?: string;
    layout?: string;
  }>;
  overallStrategy?: string;
}

export async function optimizeAplusViaEmperor(
  context: string
): Promise<SkillRunResult<AplusOptimizeOutput>> {
  return runSkill<AplusOptimizeOutput>("image.step5.aplus.optimize", { context });
}

export interface ImagePromptOutput {
  prompts?: Array<{
    imageIndex?: number;
    prompt?: string;
    negativePrompt?: string;
    style?: string;
    aspectRatio?: string;
  }>;
}

export async function generateImagePromptsViaEmperor(
  context: string
): Promise<SkillRunResult<ImagePromptOutput>> {
  return runSkill<ImagePromptOutput>("image.step6.prompt", { context });
}

// ============================================================
// 售后模块便捷函数
// ============================================================

export interface ReviewAnalysisOutput {
  mustBe?: Array<{ feature: string; evidence: string; currentStatus: string }>;
  oneDimensional?: Array<{ feature: string; sentiment: string; frequency: string }>;
  attractive?: Array<{ feature: string; opportunity: string }>;
  indifferent?: string[];
  priorityRecommendations?: string[];
  overallSentiment?: string;
  topIssues?: string[];
}

export async function analyzeReviewsViaEmperor(
  context: string
): Promise<SkillRunResult<ReviewAnalysisOutput>> {
  return runSkill<ReviewAnalysisOutput>("aftersales.review.analysis", { context });
}

export interface ReturnDiagnosisOutput {
  topReasons?: Array<{ reason: string; percentage: number; solution: string }>;
  productIssues?: string[];
  listingIssues?: string[];
  recommendations?: string[];
}

export async function diagnoseReturnsViaEmperor(
  context: string
): Promise<SkillRunResult<ReturnDiagnosisOutput>> {
  return runSkill<ReturnDiagnosisOutput>("aftersales.return.diagnosis", { context });
}

export interface EmailReplyOutput {
  subject?: string;
  body?: string;
  tone?: string;
  keyPoints?: string[];
}

export async function generateEmailReplyViaEmperor(
  context: string,
  emailContent: string
): Promise<SkillRunResult<EmailReplyOutput>> {
  return runSkill<EmailReplyOutput>("aftersales.email.reply", { context, emailContent });
}

// ============================================================
// 视频模块便捷函数
// ============================================================

export interface VideoSectionPlanOutput {
  sections?: Array<{
    index?: number;
    title?: string;
    duration?: number;
    content?: string;
    visualDescription?: string;
  }>;
  totalDuration?: number;
  style?: string;
}

export async function planVideoSectionsViaEmperor(
  context: string
): Promise<SkillRunResult<VideoSectionPlanOutput>> {
  return runSkill<VideoSectionPlanOutput>("video.section.plan", { context });
}

export interface VideoShotOutput {
  shots?: Array<{
    index?: number;
    duration?: number;
    shotType?: string;
    description?: string;
    dialogue?: string;
    visualEffect?: string;
  }>;
}

export async function generateVideoShotsViaEmperor(
  context: string,
  sectionIndex: number
): Promise<SkillRunResult<VideoShotOutput>> {
  return runSkill<VideoShotOutput>("video.shot.detail", { context, sectionIndex });
}

export interface VideoScriptOutput {
  script?: string;
  timeline?: Array<{ time: string; action: string; dialogue?: string }>;
  editingNotes?: string[];
}

export async function generateVideoScriptViaEmperor(
  context: string
): Promise<SkillRunResult<VideoScriptOutput>> {
  return runSkill<VideoScriptOutput>("video.edit.script", { context });
}

// ============================================================
// 站外模块便捷函数
// ============================================================

export interface OffsiteSummaryOutput {
  platforms?: Array<{ platform: string; opportunity: string; strategy: string; priority: string }>;
  overallStrategy?: string;
  topChannels?: string[];
}

export async function generateOffsiteSummaryViaEmperor(
  context: string
): Promise<SkillRunResult<OffsiteSummaryOutput>> {
  return runSkill<OffsiteSummaryOutput>("offsite.summary", { context });
}

export interface SocialContentOutput {
  posts?: Array<{
    platform?: string;
    content?: string;
    hashtags?: string[];
    imageDescription?: string;
    postingTime?: string;
  }>;
}

export async function generateSocialContentViaEmperor(
  context: string
): Promise<SkillRunResult<SocialContentOutput>> {
  return runSkill<SocialContentOutput>("off.social.content", { context });
}

// ============================================================
// 分析模块便捷函数
// ============================================================

export interface CustomerProfileOutput {
  coreProfile?: { demographics: string; lifestyle: string; purchaseMotivation: string };
  usageScenes?: Array<{ scene: string; frequency: string }>;
  painPoints?: string[];
  expectations?: string[];
  listingImplications?: string[];
}

export async function analyzeCustomerProfileViaEmperor(
  context: string
): Promise<SkillRunResult<CustomerProfileOutput>> {
  return runSkill<CustomerProfileOutput>("analysis.review.kano", { context });
}

export interface ComparisonSummaryOutput {
  comparison?: Array<{
    dimension?: string;
    ourProduct?: string;
    competitors?: Record<string, string>;
    advantage?: string;
  }>;
  overallPosition?: string;
  keyDifferentiators?: string[];
}

export async function summarizeComparisonViaEmperor(
  context: string
): Promise<SkillRunResult<ComparisonSummaryOutput>> {
  return runSkill<ComparisonSummaryOutput>("analysis.comparison.summary", { context });
}

// ─── 图片识别分析 ──────────────────────────────────────────────────────────────
export async function analyzeImageViaEmperor(context: string): Promise<SkillRunResult> {
  return runSkill("analysis.image.recognition", context);
}

// ─── 通用 Skill 调用（供 kbSkills.ts 等使用）──────────────────────────────────
/**
 * 通用 Emperor Skill 调用，供需要动态指定 slug 的模块使用
 */
export async function runSkillViaEmperor<T = unknown>(
  slug: string,
  input: Record<string, unknown>
): Promise<SkillRunResult<T>> {
  return runSkill<T>(slug, input);
}

// ─── 产品开发分析（devAnalysis.ts）──────────────────────────────────────────
export interface ProductDevAnalysisOutput {
  summary?: string;
  insights?: string[];
  recommendations?: string[];
  riskFactors?: string[];
  marketOpportunity?: string;
  competitiveAdvantage?: string;
}

export async function analyzeProductDevViaEmperor(
  context: string
): Promise<SkillRunResult<ProductDevAnalysisOutput>> {
  return runSkill<ProductDevAnalysisOutput>("dev.analysis.product", { context });
}
