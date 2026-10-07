import { z } from "zod";
import { containsTemplateFactInFreeText, excludeRawExamplesFromFactTree, formatSingleBulletIdentity, isTemplateOrEmptyFact, rawAttributeExampleValues, sanitizeListingFactTree, sanitizeListingProjectFacts, sanitizeSelectedSellingPoint, selectedPointContainsRawExamples } from "../../../../shared/listingFactSafety";

import {
  MAX_RETRIES,
  buildProductContext,
  loadEnrichedData,
  safeParseJSON,
  validateBullets,
  validateTitles,
} from "../routerContext";
import * as db from "../repository";
import { runEmperorSkill } from "../service";
import {
  cancelAiJob,
  createAiJobRun,
  listAiJobRunsForUser,
  registerAiJobHandler,
  scheduleAiJobRun,
  updateAiJobProgress,
  type AiJobHandlerContext,
  type AiJobSnapshot,
} from "../../ai_os/services/jobRunner";
import { listAgentArtifacts } from "../../ai_os/services/agentRunner/artifactStore";
import { getCheckpoint } from "../../ai_os/services/agentRunner/checkpointStore";
import {
  LISTING_GENERATION_NODE_MAP,
  syncListingNodeJobFailed,
  syncListingNodeJobQueued,
  syncListingNodeJobRunning,
  syncListingNodeJobWaitingHuman,
  syncListingPreparationNodeConfirmed,
  type ListingAgentNodeId,
  type ListingGenerationNodeKey,
} from "../listingAgentBridge";
import { resolveWorkflowGuidance } from "../../knowledge/claimLedgerService";
import { readCompleteAttributeText } from "./listingRawAttributeSource";

export const LISTING_JOB_MODULE = "listing";

export const listingGenerationOperationSchema = z.enum([
  "sellingPoints",
  "singleBullet",
  "bullets",
  "title",
  "description",
  "searchTerms",
  "qa",
  "batch",
]);

export type ListingGenerationOperation = z.infer<typeof listingGenerationOperationSchema>;

const sellingPointSchema = z.object({
  index: z.number(),
  theme: z.string(),
  themeZh: z.string().optional(),
  description: z.string(),
  descriptionZh: z.string().optional(),
  fabeDirection: z.object({
    feature: z.string(),
    advantage: z.string(),
    benefit: z.string(),
    evidence: z.string(),
  }).optional(),
  targetKeywords: z.array(z.string()).optional(),
  addressesGap: z.string().optional(),
});

export const listingGenerationJobInput = z.object({
  projectId: z.number().int().positive(),
  operation: listingGenerationOperationSchema,
  nodeId: z.enum(["G1", "G2", "G3", "G4", "G5"]),
  scopeKey: z.string().trim().min(1).max(80).default("main"),
  agentRunId: z.string().max(80).optional(),
  agentNodeId: z.enum(["G1", "G2", "G3", "G4", "G5"]).optional(),
  emphasis: z.string().max(4_000).optional(),
  existingTitle: z.string().max(2_000).optional(),
  sellingPoint: sellingPointSchema.optional(),
  previousBullets: z.array(z.object({
    subtitle: z.string(),
    fullText: z.string(),
  })).max(9).optional(),
  distillationBinding: z.object({
    ledgerKey: z.string().min(1).max(80).nullable().optional(),
    skillSlugs: z.array(z.string().min(1).max(128)).max(12).optional(),
  }).optional(),
});

export type ListingGenerationJobInput = z.infer<typeof listingGenerationJobInput>;

const OPERATION_CONFIG: Record<Exclude<ListingGenerationOperation, "batch">, {
  nodeKey: ListingGenerationNodeKey;
  skillSlug: string;
  label: string;
}> = {
  sellingPoints: { nodeKey: "sellingPoints", skillSlug: "listing.sellingpoints.generate", label: "卖点核心" },
  // 单条精雕必须走独立Skill，避免复用整套五点提示词并将所有清单维度强加给一条文案。
  singleBullet: { nodeKey: "singleBullet", skillSlug: "listing.bullet.step.generate", label: "单条五点描述" },
  bullets: { nodeKey: "bullets", skillSlug: "listing.bullets.generate", label: "五点描述" },
  title: { nodeKey: "title", skillSlug: "listing.title.generate", label: "标题" },
  description: { nodeKey: "description", skillSlug: "listing.description.generate", label: "产品描述" },
  searchTerms: { nodeKey: "searchTerms", skillSlug: "listing.searchterms.generate", label: "后台搜索词" },
  qa: { nodeKey: "qa", skillSlug: "listing.qa.generate", label: "QA问答" },
};

const NODE_ORDER: ListingAgentNodeId[] = ["G1", "G2", "G3", "G4", "G5"];

function compactText(value: unknown, maxChars: number) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 700)}\n\n[上下文已压缩，省略${text.length - maxChars}字符]\n\n${text.slice(-700)}`;
}

function normalizeBulletText(value: unknown) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function meaningfulBulletTokens(value: unknown): string[] {
  const common = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "this", "to", "with", "you", "your"]);
  return (String(value || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length > 2 && !common.has(token));
}

function tokenSimilarity(left: string[], right: string[]): number {
  const first = new Set(left);
  const second = new Set(right);
  if (first.size === 0 || second.size === 0) return 0;
  const intersection = [...first].filter((word) => second.has(word)).length;
  return intersection / (first.size + second.size - intersection);
}

const SINGLE_BULLET_AUDIT_KEYS = [
  "factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit",
  "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect",
  "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant",
] as const;

function countOccurrences(text: string, phrase: string) {
  if (!phrase) return 0;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"))].length;
}

export function validateSingleBulletQuality(bullet: any, input: ListingGenerationJobInput, _unconfirmedProductAttributes: unknown = null) {
  const issues: string[] = [];
  const rawSubtitle = String(bullet?.subtitle || "");
  const rawFullText = String(bullet?.fullText || "");
  const subtitle = rawSubtitle.trim();
  const fullText = rawFullText.trim();
  const combined = `${subtitle} ${fullText}`.trim();
  if (!subtitle || !fullText) issues.push("必须同时提供subtitle和fullText");
  if (/\r|\n/.test(rawSubtitle) || /\r|\n/.test(rawFullText)) issues.push("逐条精雕只能输出一条英文Bullet段落，不得分段");
  if (combined.length < 200 || combined.length > 280) issues.push(`总长度${combined.length}，必须在200–280字符之间`);
  const titleWords = subtitle.replace(/:$/, "").trim().split(/\s+/).filter(Boolean);
  const naturalSmallWords = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  if (!/^[A-Z][A-Za-z0-9'& -]*:$/.test(subtitle) || titleWords.length < 2 || titleWords.length > 8
      || titleWords.some((word, index) => /^[a-z]/.test(word)
        && (index === 0 || index === titleWords.length - 1 || !naturalSmallWords.has(word.toLowerCase())))
      || /:[\s]*:/.test(subtitle)) {
    issues.push("小标题必须为2–8词的Title Case且以单个英文冒号结尾");
  }
  if (!/^(?:[A-Z]|\d)/.test(fullText) || /[.!?;:]$/.test(fullText) || /^(?:[•*-]|\d+[.)])\s/.test(fullText)
      || /<\/?[a-z][^>]*>/i.test(combined) || /[\u3400-\u9fff]/.test(combined)) {
    issues.push("正文需大写或经证实数字开头，不含列表/HTML/中文或末尾标点");
  }
  const plainTitle = subtitle.replace(/:$/, "").toLowerCase();
  if (plainTitle && fullText.toLowerCase().startsWith(plainTitle)) issues.push("正文开头不得复述小标题");
  if (/\b(?:best|perfect|guaranteed|revolutionary|industry-leading|must-have|game-changing|#1)\b/i.test(combined)
      || /\$\s*\d/.test(combined)) issues.push("不得包含绝对化宣传或价格信息");

  const normalized = normalizeBulletText(combined);
  if (typeof bullet?.distinctFromPrevious !== "string" || !bullet.distinctFromPrevious.trim()) {
    issues.push("须说明与既有卖点不同的买家角度distinctFromPrevious");
  }
  const previous = (input.previousBullets || []).map((item) => normalizeBulletText(`${item.subtitle} ${item.fullText}`));
  if (normalized && previous.includes(normalized)) issues.push("与已确认卖点重复");
  if ((input.previousBullets || []).some((item) => normalizeBulletText(item.subtitle) === normalizeBulletText(subtitle))) {
    issues.push("小标题与已确认卖点重复");
  }
  const currentOpening = meaningfulBulletTokens(fullText.split(/[.!?;,]/, 1)[0]).slice(0, 11);
  const currentTheme = meaningfulBulletTokens(`${subtitle} ${fullText}`);
  if ((input.previousBullets || []).some((item) => {
    const priorOpening = meaningfulBulletTokens(item.fullText.split(/[.!?;,]/, 1)[0]).slice(0, 11);
    const priorTheme = meaningfulBulletTokens(`${item.subtitle} ${item.fullText}`);
    return (currentOpening.length >= 5 && priorOpening.length >= 5 && tokenSimilarity(currentOpening, priorOpening) >= 0.78)
      || (currentTheme.length >= 12 && priorTheme.length >= 12 && tokenSimilarity(currentTheme, priorTheme) >= 0.8);
  })) issues.push("与已确认卖点的开头句式或核心表达高度重复，请改用不同的买家角度");

  const targetKeywords = input.sellingPoint?.targetKeywords || [];
  const usedKeywords = bullet?.keywordsUsed;
  if (!Array.isArray(usedKeywords) || usedKeywords.some((word: unknown) => typeof word !== "string")) {
    issues.push("keywordsUsed必须是关键词数组");
  } else {
    for (const keyword of usedKeywords) {
      if (!targetKeywords.some((source) => normalizeBulletText(source) === normalizeBulletText(keyword))
          || countOccurrences(combined, keyword) !== 1) issues.push("关键词只能来自当前卖点且每个词最多使用一次");
    }
    if (targetKeywords.some((keyword) => countOccurrences(combined, keyword) > 1)) {
      issues.push("不得重复堆砌目标关键词");
    }
    if (targetKeywords.some((keyword) => countOccurrences(combined, keyword) === 1
        && !usedKeywords.some((used: string) => normalizeBulletText(used) === normalizeBulletText(keyword)))) {
      issues.push("keywordsUsed应列出文案实际采用的目标关键词");
    }
  }
  const selected = input.sellingPoint ? sanitizeSelectedSellingPoint(input.sellingPoint) : null;
  if (!selected?.canGenerate) issues.push("卖点核心缺少已确认且非模板的产品事实");
  const sourceFacts = [selected?.point.theme, selected?.point.description,
    ...Object.values(selected?.point.fabeDirection || {})].filter(Boolean).join(" ").toLowerCase();
  const originalFacts = [input.sellingPoint?.theme, input.sellingPoint?.description,
    ...Object.values(input.sellingPoint?.fabeDirection || {})].filter((value): value is string => typeof value === "string");
  const excludedNumbers = originalFacts.filter(isTemplateOrEmptyFact)
    .flatMap((value) => [...value.matchAll(/(?<![\w])\d[\d,.]*/gu)].map(([number]) => number.replace(/,/g, "")));
  if (isTemplateOrEmptyFact(combined) || (Array.isArray(bullet?.evidenceUsed)
      && bullet.evidenceUsed.some((fact: unknown) => isTemplateOrEmptyFact(fact)))
      || /\b(?:unspecified|placeholder|sample value|example value|not (?:provided|listed|stated)|blank (?:field|specification|spec))\b/iu.test(combined)
      || excludedNumbers.some((number) => new RegExp(`(?<![\\w])${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "u").test(combined))) {
    issues.push("示例或空白字段不能作为卖点事实依据");
  }
  if (!Array.isArray(bullet?.evidenceUsed) || ((input.sellingPoint?.theme || input.sellingPoint?.description) && bullet.evidenceUsed.length === 0)) {
    issues.push("未输出可追溯的事实依据evidenceUsed");
  } else if (bullet.evidenceUsed.some((fact: unknown) => typeof fact !== "string" || !fact.trim()
      || !sourceFacts.includes(fact.trim().toLowerCase()))) {
    issues.push("evidenceUsed必须引用当前已确认卖点核心中的具体短事实");
  }
  // A self-declared audit cannot establish numeric proof: compare numeric tokens to the
  // selected, human-confirmed point. The broader project context may include competitors.
  const statedNumbers = [...combined.matchAll(/(?<![\w])\d[\d,.]*(?:\s*(?:%|rpm|w|v|in|ft|lb|oz|hours?|minutes?))?/gi)]
    .map(([token]) => token.replace(/,/g, "").toLowerCase().replace(/\s+/g, ""));
  const supportedNumbers = new Set([...sourceFacts.matchAll(/(?<![\w])\d[\d,.]*(?:\s*(?:%|rpm|w|v|in|ft|lb|oz|hours?|minutes?))?/gi)]
    .map(([token]) => token.replace(/,/g, "").toLowerCase().replace(/\s+/g, "")));
  const citedFacts = Array.isArray(bullet?.evidenceUsed)
    ? bullet.evidenceUsed.filter((fact: unknown): fact is string => typeof fact === "string").join(" ").toLowerCase() : "";
  const citedNumbers = new Set([...citedFacts.matchAll(/(?<![\w])\d[\d,.]*(?:\s*(?:%|rpm|w|v|in|ft|lb|oz|hours?|minutes?))?/gi)]
    .map(([token]) => token.replace(/,/g, "").toLowerCase().replace(/\s+/g, "")));
  if (statedNumbers.some((token) => !supportedNumbers.has(token) || !citedNumbers.has(token))) {
    issues.push("数字/规格必须能从当前已确认卖点核心和evidenceUsed逐字追溯");
  }
  const sensitiveClaims = /\b(?:titanium|stainless steel|aluminum|aluminium|ceramic|silicone|leather|cotton|bpa.free|fda.approved|ul.certified|usda.certified|ce.certified|warrant(?:y|ies)|guaranteed)\b/giu;
  if ([...combined.matchAll(sensitiveClaims)].some(([claim]) => !sourceFacts.includes(claim.toLowerCase()) || !citedFacts.includes(claim.toLowerCase()))) {
    issues.push("材料、认证或保修声明必须能从当前已确认产品事实和evidenceUsed逐字追溯");
  }
  const comparativeOrCompatibility = /\b(?:more|less|faster|slower|better|lighter|stronger|longer)\b[^,.;:!?]{0,45}\bthan\b[^,.;:!?]{0,55}|\b(?:compatible with|works with|fits the|fits a|fits an)\b[^,.;:!?]{0,60}/giu;
  if ([...combined.matchAll(comparativeOrCompatibility)].some(([phrase]) => {
    const claim = normalizeBulletText(phrase);
    return !normalizeBulletText(sourceFacts).includes(claim) || !normalizeBulletText(citedFacts).includes(claim);
  })) issues.push("竞品比较或兼容性声明必须完整引用当前已确认事实和evidenceUsed");
  const audit = bullet?.qualityAudit;
  for (const key of SINGLE_BULLET_AUDIT_KEYS) {
    if (audit?.[key] !== true) issues.push(`qualityAudit.${key}必须为true`);
  }
  return { valid: issues.length === 0, issues, characterCount: combined.length };
}

export async function syncListingPreparationNodes(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  agentRunId?: string | null;
}) {
  if (!input.agentRunId) return;
  const project = await db.getProjectByIdAdmin(input.projectId, input.workspaceId ?? null);
  if (!project) return;
  const [analyses, comparison, enrichedData, keywords, reviewAggregation, buyerQuestions] = await Promise.all([
    db.getCompetitorAnalysesByProject(input.projectId),
    db.getLatestConfirmedCompetitorComparisonReport(input.projectId),
    loadEnrichedData(input.projectId),
    db.getKeywordsByProject(input.projectId),
    db.getReviewAggregationByProject(input.projectId),
    db.getActiveBuyerQuestionsByProject(input.projectId),
  ]);
  const shared = {
    agentRunId: input.agentRunId,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N0",
    output: {
      id: project.id,
      productName: project.productName,
      brand: project.brand,
      category: project.category,
      targetMarket: project.targetMarket,
    },
  });
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N1",
    output: analyses.slice(0, 20).map((analysis: any) => ({
      id: analysis.id,
      asin: analysis.asin,
      summary: analysis.summary || compactText(analysis.analysisResult, 1_000),
      summaryStatus: analysis.summaryStatus,
    })),
  });
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N2",
    output: comparison || { available: false, reason: "暂无已确认竞品对比" },
  });
  const productAttributes = enrichedData?.productAttributes;
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N3",
    output: { productAttributes: productAttributes || null, buyerQuestions },
  });
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N4",
    output: keywords.slice(0, 500),
  });
  await syncListingPreparationNodeConfirmed({
    ...shared,
    nodeId: "N5",
    output: reviewAggregation || { available: false, reason: "暂无评论聚合分析" },
  });
}

function parseSkillJson(content: string) {
  const parsed = safeParseJSON<any>(content);
  if (parsed && typeof parsed === "object" && "raw" in parsed) {
    throw new Error("皇帝 Skill 返回格式异常，请重试");
  }
  return parsed;
}

function jobTargetsNode(job: AiJobSnapshot, nodeId: ListingAgentNodeId) {
  const parsed = listingGenerationJobInput.safeParse(job.input);
  if (!parsed.success) return false;
  return parsed.data.operation === "batch"
    ? NODE_ORDER.includes(nodeId)
    : parsed.data.nodeId === nodeId;
}

export async function listListingGenerationJobs(userId: number, projectId: number) {
  return listAiJobRunsForUser(userId, { module: LISTING_JOB_MODULE, projectId, limit: 100 });
}

export async function getLatestListingNodeJob(
  userId: number,
  projectId: number,
  nodeId: ListingAgentNodeId,
  scopeKey?: string,
) {
  const jobs = await listListingGenerationJobs(userId, projectId);
  return jobs.find((job) => {
    if (!jobTargetsNode(job, nodeId)) return false;
    if (!scopeKey) return true;
    const parsed = listingGenerationJobInput.safeParse(job.input);
    return parsed.success && parsed.data.scopeKey === scopeKey;
  }) || null;
}

async function confirmedArtifactContext(agentRunId: string | undefined, currentNodeId: ListingAgentNodeId) {
  if (!agentRunId) return "";
  const artifacts = await listAgentArtifacts({
    runId: agentRunId,
    currentOnly: true,
    skipOwnerCheck: true,
  }).catch(() => []);
  const currentIndex = NODE_ORDER.indexOf(currentNodeId);
  const eligible = artifacts.filter((artifact: any) => {
    if (!artifact.isCurrent || artifact.status !== "final") return false;
    const nodeIndex = NODE_ORDER.indexOf(artifact.nodeId as ListingAgentNodeId);
    return nodeIndex >= 0 && nodeIndex < currentIndex;
  });
  const selected = (await Promise.all(eligible.map(async (artifact: any) => ({
    artifact,
    checkpoint: await getCheckpoint(agentRunId, artifact.nodeId).catch(() => null),
  })))).filter(({ checkpoint }) => checkpoint?.status === "confirmed").map(({ artifact }) => artifact);
  if (selected.length === 0) return "";
  return selected.map((artifact: any) => (
    `--- 已确认 Artifact ${artifact.nodeId} v${artifact.version} ---\n${compactText(artifact.content, 4_000)}`
  )).join("\n\n");
}

async function buildJobContext(job: AiJobSnapshot, input: ListingGenerationJobInput, operation: ListingGenerationOperation) {
  const project = await db.getProjectByIdAdmin(input.projectId, job.workspaceId ?? null);
  if (!project) throw new Error("项目不存在");
  const [analyses, enrichedData, artifactContext, distillationGuidance] = await Promise.all([
    db.getCompetitorAnalysesByProject(input.projectId),
    loadEnrichedData(input.projectId),
    confirmedArtifactContext(input.agentRunId, input.nodeId),
    input.distillationBinding
      ? resolveWorkflowGuidance({ workspaceId: job.workspaceId || Number(project.workspaceId || 0), ...input.distillationBinding })
      : Promise.resolve(null),
  ]);
  const guardFacts = operation === "sellingPoints" || operation === "singleBullet" || operation === "bullets";
  let safeProject = guardFacts ? sanitizeListingProjectFacts(project).project : project;
  // Product attribute extraction is AI-generated and not a confirmation of
  // facts. Pair the latest completed analysis with its own original upload:
  // an extractor may have stripped the "example" tag while keeping its value.
  let safeEnriched = enrichedData;
  let rawExamples: string[] = [];
  if (guardFacts) {
    const files = await db.getProjectFilesByProject(input.projectId);
    const latest = files.find((file) => file.fileType === "product_attributes"
      && file.status === "completed" && file.analysisResult);
    let attributes: unknown = null;
    if (latest) {
      const rawText = await readCompleteAttributeText(latest, job.workspaceId ?? null);
      rawExamples = rawAttributeExampleValues(rawText);
      try {
        const parsed = JSON.parse(latest.analysisResult!);
        const cleaned = sanitizeListingFactTree(parsed, "productAttributes").value;
        attributes = excludeRawExamplesFromFactTree(cleaned, rawExamples, "productAttributes").value;
      } catch { /* malformed analysis is not evidence */ }
    }
    safeProject = (excludeRawExamplesFromFactTree(safeProject, rawExamples, "project").value || safeProject) as typeof project;
    safeEnriched = { ...enrichedData, productAttributes: attributes };
  }
  const safeGuidance = !guardFacts || !distillationGuidance || !containsTemplateFactInFreeText(JSON.stringify(distillationGuidance))
    ? distillationGuidance : null;
  let context = buildProductContext(safeProject, analyses, safeEnriched);
  if (artifactContext && (!guardFacts || !containsTemplateFactInFreeText(artifactContext))) context += `\n\n${artifactContext}`;
  if (safeGuidance) context += `\n\n--- 用户显式选择的知识蒸馏指导（只读） ---\n${compactText(safeGuidance, 6_000)}`;
  if (input.emphasis?.trim()) {
    context += `\n\n--- 用户重点强调 ---\n${input.emphasis.trim()}`;
  }
  return {
    project: safeProject,
    analyses,
    enrichedData: safeEnriched,
    rawExamples,
    context: compactText(context, 28_000),
    variables: { project: safeProject, analyses, enrichedData: safeEnriched, distillationGuidance: safeGuidance },
  };
}

async function callListingSkill(
  job: AiJobSnapshot,
  context: AiJobHandlerContext,
  input: ListingGenerationJobInput,
  skillSlug: string,
  promptContext: string,
  variables: Record<string, unknown>,
) {
  const result = await runEmperorSkill<any>({
    skillSlug,
    userId: job.userId,
    workspaceId: job.workspaceId,
    context: promptContext,
    emphasis: input.emphasis,
    variables: {
      context: promptContext,
      emphasis: input.emphasis || "",
      ...variables,
    },
    signal: context.signal,
    maxModelAttempts: 3,
    validate: parseSkillJson,
  });
  return result.parsed;
}

function normalizeSellingPoints(parsed: any) {
  const sellingPoints = parsed?.sellingPoints || parsed?.selling_points || parsed?.points
    || parsed?.bulletCores || parsed?.cores || parsed?.themes;
  if (!Array.isArray(sellingPoints) || sellingPoints.length === 0) {
    throw new Error("卖点核心生成结果缺少 sellingPoints");
  }
  return {
    ...parsed,
    sellingPoints,
    overallStrategy: parsed.overallStrategy || parsed.overall_strategy || parsed.strategy || parsed.summary || "",
  };
}

async function runOperation(
  job: AiJobSnapshot,
  handlerContext: AiJobHandlerContext,
  input: ListingGenerationJobInput,
  operation: Exclude<ListingGenerationOperation, "batch">,
  transientOutputs: Record<string, unknown> = {},
) {
  const selected = operation === "singleBullet" && input.sellingPoint
    ? sanitizeSelectedSellingPoint(input.sellingPoint) : null;
  if (operation === "singleBullet" && !selected?.canGenerate) {
    throw new Error("卖点核心无可用产品事实；请先编辑并确认，空白与示例字段不可用于生成");
  }
  if ((operation === "sellingPoints" || operation === "singleBullet" || operation === "bullets")
      && input.emphasis && containsTemplateFactInFreeText(input.emphasis)) {
    throw new Error("重点强调含空白或示例数值；请确认真实数据后重试");
  }
  const built = await buildJobContext(job, input, operation);
  if (operation === "singleBullet" && selectedPointContainsRawExamples(selected!.point, built.rawExamples)) {
    throw new Error("卖点核心包含原始属性表的示例值；请核实真实参数并修改核心后再生成");
  }
  const config = OPERATION_CONFIG[operation];
  let promptContext = built.context;
  const variables: Record<string, unknown> = { ...built.variables, ...transientOutputs };

  if (operation === "singleBullet") {
    const previous = (input.previousBullets || []).filter((bullet) =>
      !containsTemplateFactInFreeText(`${bullet.subtitle}\n${bullet.fullText}`));
    promptContext = `${formatSingleBulletIdentity(built.project)}\n\n--- 人工选中的卖点核心；非示例事实 ---\n${JSON.stringify(selected!.point)}\n--- 其他已确认卖点；仅供避免重复，不作本品证据 ---\n${JSON.stringify(previous)}\n仅输出一条 {subtitle,fullText,evidenceUsed,keywordsUsed,distinctFromPrevious,qualityAudit} JSON。被过滤的空值/示例不得补全或写入文案；不足事实时请拒绝编造。`;
    variables.mode = "single_bullet";
    variables.sellingPoint = selected!.point;
    variables.previousBullets = previous;
    variables.excludedFactPaths = selected!.excludedFields;
    delete variables.project;
    delete variables.analyses;
    delete variables.enrichedData;
    delete variables.distillationGuidance;
  } else if (operation === "searchTerms" && input.existingTitle) {
    promptContext += `\n\n当前已确认标题（搜索词不得重复）：${input.existingTitle}`;
    variables.existingTitle = input.existingTitle;
  }

  let parsed = await callListingSkill(job, handlerContext, input, config.skillSlug, promptContext, variables);
  if ((operation === "sellingPoints" || operation === "bullets") && built.rawExamples.length
      && excludeRawExamplesFromFactTree(parsed, built.rawExamples, "output").excludedFields.length) {
    throw new Error("生成结果引用了原始产品属性表的示例值；此候选不可确认，请核实真实事实");
  }
  if (operation === "sellingPoints") return normalizeSellingPoints(parsed);
  if (operation === "singleBullet") {
    let bullet = parsed;
    let quality = validateSingleBulletQuality(bullet, input);
    for (let attempt = 0; attempt < MAX_RETRIES && !quality.valid; attempt += 1) {
      parsed = await callListingSkill(
        job,
        handlerContext,
        input,
        config.skillSlug,
        `${promptContext}\n\n上次逐条卖点质量门禁未通过：${quality.issues.join("；")}。请仅依据输入事实完整重写当前选中卖点的一条英文JSON Bullet，且不要解释。`,
        { ...variables, previousOutput: bullet, qualityIssues: quality.issues },
      );
      bullet = parsed;
      quality = validateSingleBulletQuality(bullet, input);
    }
    if (!quality.valid) throw new Error(`单条五点描述质量验证未通过：${quality.issues.join("；")}`);
    return { ...bullet, factSafety: { excludedFields: selected!.excludedFields, requiresHumanReview: true },
      characterCount: quality.characterCount, actualCharacterCount: quality.characterCount, inRange: true };
  }
  if (operation === "title") {
    let validation = validateTitles(parsed);
    for (let attempt = 0; attempt < MAX_RETRIES && !validation.valid; attempt += 1) {
      parsed = await callListingSkill(
        job,
        handlerContext,
        input,
        config.skillSlug,
        `${promptContext}\n\n上次标题校验未通过：${validation.issues.join("；")}。请修正并重新输出完整 JSON。`,
        { ...variables, previousOutput: parsed, validationIssues: validation.issues },
      );
      validation = validateTitles(parsed);
    }
  }
  if (operation === "bullets") {
    let validation = validateBullets(parsed);
    for (let attempt = 0; attempt < MAX_RETRIES && !validation.valid; attempt += 1) {
      parsed = await callListingSkill(
        job,
        handlerContext,
        input,
        config.skillSlug,
        `${promptContext}\n\n上次五点描述校验未通过：${validation.issues.join("；")}。请修正并重新输出完整 JSON。`,
        { ...variables, previousOutput: parsed, validationIssues: validation.issues },
      );
      validation = validateBullets(parsed);
    }
    if (built.rawExamples.length && excludeRawExamplesFromFactTree(parsed, built.rawExamples, "output").excludedFields.length) {
      throw new Error("五点重试结果引用了原始产品属性表的示例值；此候选不可确认");
    }
  }
  return parsed;
}

async function reportNodeProgress(job: AiJobSnapshot, input: ListingGenerationJobInput, nodeId: ListingAgentNodeId, progress: number) {
  await updateAiJobProgress(job.runId, progress, { expectedAttempt: job.attempt });
  await syncListingNodeJobRunning({
    agentRunId: input.agentRunId,
    nodeId,
    projectId: input.projectId,
    userId: job.userId,
    workspaceId: job.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    progress,
  });
}

async function latestJobStillOwnsNode(job: AiJobSnapshot, nodeId: ListingAgentNodeId) {
  const latest = await getLatestListingNodeJob(job.userId, Number(job.projectId), nodeId);
  return latest?.runId === job.runId;
}

async function runBatchJob(job: AiJobSnapshot, context: AiJobHandlerContext, input: ListingGenerationJobInput) {
  const outputs: Record<string, any> = {};
  const stages: Array<{ nodeId: ListingGenerationJobInput["nodeId"]; operation: Exclude<ListingGenerationOperation, "batch"> }> = [
    { nodeId: "G1", operation: "sellingPoints" },
    { nodeId: "G1", operation: "bullets" },
    { nodeId: "G2", operation: "title" },
    { nodeId: "G3", operation: "description" },
    { nodeId: "G4", operation: "searchTerms" },
    { nodeId: "G5", operation: "qa" },
  ];
  for (let index = 0; index < stages.length; index += 1) {
    if (context.signal.aborted) throw new Error("Listing 批量生成任务已取消");
    const stage = stages[index];
    if (!await latestJobStillOwnsNode(job, stage.nodeId)) {
      return { skipped: true, reason: `${stage.nodeId} 已有更新的任务`, outputs };
    }
    await reportNodeProgress(job, input, stage.nodeId, 10 + Math.floor(index / stages.length * 75));
    const stageInput = { ...input, nodeId: stage.nodeId };
    let result: any;
    try {
      result = await runOperation(job, context, stageInput, stage.operation, outputs);
    } catch (error) {
      const tagged = error instanceof Error ? error : new Error(String(error || "Listing 批量阶段失败"));
      (tagged as Error & { listingNodeId?: ListingAgentNodeId }).listingNodeId = stage.nodeId;
      throw tagged;
    }
    outputs[stage.operation] = result;
    const isLastForNode = stage.nodeId !== "G1" || stage.operation === "bullets";
    if (isLastForNode) {
      const output = stage.nodeId === "G1"
        ? { sellingPoints: outputs.sellingPoints, bullets: outputs.bullets }
        : result;
      await syncListingNodeJobWaitingHuman({
        agentRunId: input.agentRunId,
        nodeId: stage.nodeId,
        projectId: input.projectId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        aiJobMaxAttempts: job.maxAttempts,
        output,
      });
    }
  }
  return outputs;
}

export async function runListingGenerationJob(job: AiJobSnapshot, context: AiJobHandlerContext) {
  const input = listingGenerationJobInput.parse(job.input);
  if (input.operation === "batch") return runBatchJob(job, context, input);
  await reportNodeProgress(job, input, input.nodeId, 15);
  const result = await runOperation(job, context, input, input.operation);
  if (context.signal.aborted) throw new Error(`${OPERATION_CONFIG[input.operation].label}任务已取消`);
  if (!await latestJobStillOwnsNode(job, input.nodeId)) {
    return { skipped: true, reason: `${input.nodeId} 已有更新的任务` };
  }
  await reportNodeProgress(job, input, input.nodeId, 90);
  return result;
}

export async function startListingGenerationJob(input: ListingGenerationJobInput & {
  userId: number;
  workspaceId?: number | null;
}) {
  const active = await getLatestListingNodeJob(input.userId, input.projectId, input.nodeId);
  if (active?.status === "queued" || active?.status === "running") return active;
  const label = input.operation === "batch" ? "Listing 批量五步" : OPERATION_CONFIG[input.operation].label;
  const skillSlug = input.operation === "batch" ? "listing.*" : OPERATION_CONFIG[input.operation].skillSlug;
  const job = await createAiJobRun({
    kind: `listing.generation.${input.operation}`,
    module: LISTING_JOB_MODULE,
    procedure: "listing.startGenerationJob",
    workspaceId: input.workspaceId ?? null,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug,
    input: { ...input, agentRunId: input.agentRunId, agentNodeId: input.nodeId },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: input.operation === "batch" ? 60 * 60 : 20 * 60,
  });
  await syncListingNodeJobQueued({
    agentRunId: input.agentRunId,
    nodeId: input.nodeId,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    progress: job.progress,
  });
  try {
    await scheduleAiJobRun(job.runId);
  } catch (error) {
    await cancelAiJob(job.runId, `${label}任务调度失败`).catch(() => null);
    await syncListingNodeJobFailed({
      agentRunId: input.agentRunId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
      errorMessage: error instanceof Error ? error.message : String(error || "任务调度失败"),
      finalAttempt: true,
    });
    throw error;
  }
  return job;
}

export async function cancelListingGenerationJob(input: {
  userId: number;
  projectId: number;
  nodeId: ListingAgentNodeId;
  scopeKey?: string;
  agentRunId?: string | null;
}) {
  const job = await getLatestListingNodeJob(input.userId, input.projectId, input.nodeId, input.scopeKey);
  if (!job || (job.status !== "queued" && job.status !== "running")) return job;
  const canceled = await cancelAiJob(job.runId, `用户取消 ${input.nodeId} Listing 生成任务`);
  await syncListingNodeJobFailed({
    agentRunId: input.agentRunId,
    nodeId: input.nodeId,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: job.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    errorMessage: canceled?.error || "任务已取消",
    finalAttempt: true,
    failureKind: "cancel",
  });
  return canceled;
}

registerAiJobHandler({
  id: "listing.generation.workflow",
  match: (job) => job.module === LISTING_JOB_MODULE && job.procedure === "listing.startGenerationJob",
  recoverable: true,
  handler: async (job, context) => {
    const input = listingGenerationJobInput.parse(job.input);
    await syncListingNodeJobRunning({
      agentRunId: input.agentRunId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
      progress: 15,
    });
    try {
      const result = await runListingGenerationJob(job, context);
      if (!result?.skipped && input.operation !== "batch") {
        await syncListingNodeJobWaitingHuman({
          agentRunId: input.agentRunId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          userId: job.userId,
          workspaceId: job.workspaceId,
          aiJobRunId: job.runId,
          aiJobAttempt: job.attempt,
          aiJobMaxAttempts: job.maxAttempts,
          output: result,
        });
      }
      return result;
    } catch (error) {
      const abortReason = context.signal.aborted ? String(context.signal.reason || "") : "";
      const timeout = /timed?\s*out|timeout/i.test(abortReason);
      const finalAttempt = job.attempt >= job.maxAttempts || (context.signal.aborted && !timeout);
      const failedNodeId = (error as Error & { listingNodeId?: ListingAgentNodeId })?.listingNodeId || input.nodeId;
      await syncListingNodeJobFailed({
        agentRunId: input.agentRunId,
        nodeId: failedNodeId,
        projectId: input.projectId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        aiJobMaxAttempts: job.maxAttempts,
        errorMessage: error instanceof Error ? error.message : String(error || "Listing 生成任务失败"),
        finalAttempt,
        failureKind: context.signal.aborted ? (timeout ? "timeout" : "cancel") : "error",
      });
      throw error;
    }
  },
});

export function listingOperationNodeId(operation: ListingGenerationOperation): ListingAgentNodeId {
  if (operation === "batch") return "G1";
  return LISTING_GENERATION_NODE_MAP[OPERATION_CONFIG[operation].nodeKey] as ListingAgentNodeId;
}
