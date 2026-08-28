import { z } from "zod";

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

export function validateSingleBulletQuality(bullet: any, input: ListingGenerationJobInput) {
  const issues: string[] = [];
  const subtitle = String(bullet?.subtitle || "").trim();
  const fullText = String(bullet?.fullText || "").trim();
  const combined = `${subtitle} ${fullText}`.trim();
  if (!subtitle || !fullText) issues.push("必须同时提供subtitle和fullText");
  if (/\r|\n/.test(subtitle) || /\r|\n/.test(fullText)) issues.push("逐条精雕只能输出一条英文Bullet段落，不得分段");
  if (combined.length < 200 || combined.length > 280) issues.push(`总长度${combined.length}，必须在200–280字符之间`);

  const normalized = normalizeBulletText(combined);
  const previous = (input.previousBullets || []).map((item) => normalizeBulletText(`${item.subtitle} ${item.fullText}`));
  if (normalized && previous.includes(normalized)) issues.push("与已确认卖点重复");

  const targetKeywords = input.sellingPoint?.targetKeywords || [];
  if (targetKeywords.length > 0 && !targetKeywords.some((keyword) => normalizeBulletText(combined).includes(normalizeBulletText(keyword)))) {
    issues.push("未自然使用当前卖点核心指定的目标关键词");
  }
  if (input.sellingPoint?.fabeDirection?.evidence && (!Array.isArray(bullet?.evidenceUsed) || bullet.evidenceUsed.length === 0)) {
    issues.push("未输出可追溯的事实依据evidenceUsed");
  }
  const audit = bullet?.qualityAudit;
  for (const key of ["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit"]) {
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
  const project = await db.getProjectByIdAdmin(input.projectId);
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

async function buildJobContext(job: AiJobSnapshot, input: ListingGenerationJobInput) {
  const project = await db.getProjectByIdAdmin(input.projectId);
  if (!project) throw new Error("项目不存在");
  const [analyses, enrichedData, artifactContext, distillationGuidance] = await Promise.all([
    db.getCompetitorAnalysesByProject(input.projectId),
    loadEnrichedData(input.projectId),
    confirmedArtifactContext(input.agentRunId, input.nodeId),
    input.distillationBinding
      ? resolveWorkflowGuidance({ workspaceId: input.workspaceId || Number(project.workspaceId || 0), ...input.distillationBinding })
      : Promise.resolve(null),
  ]);
  let context = buildProductContext(project, analyses, enrichedData);
  if (artifactContext) context += `\n\n${artifactContext}`;
  if (distillationGuidance) context += `\n\n--- 用户显式选择的知识蒸馏指导（只读） ---\n${compactText(distillationGuidance, 6_000)}`;
  if (input.emphasis?.trim()) {
    context += `\n\n--- 用户重点强调 ---\n${input.emphasis.trim()}`;
  }
  return {
    project,
    analyses,
    enrichedData,
    context: compactText(context, 28_000),
    variables: { project, analyses, enrichedData, distillationGuidance },
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
  const built = await buildJobContext(job, input);
  const config = OPERATION_CONFIG[operation];
  let promptContext = built.context;
  const variables: Record<string, unknown> = { ...built.variables, ...transientOutputs };

  if (operation === "singleBullet") {
    if (!input.sellingPoint) throw new Error("缺少待生成的卖点核心");
    promptContext += `\n\n--- 单条五点描述任务 ---\n只生成一条五点描述。卖点核心：${JSON.stringify(input.sellingPoint)}\n已确认五点：${JSON.stringify(input.previousBullets || [])}\n输出可使用 {bulletPoints:[...]} 或单条 {subtitle,fullText} JSON。`;
    variables.mode = "single_bullet";
    variables.sellingPoint = input.sellingPoint;
    variables.previousBullets = input.previousBullets || [];
  } else if (operation === "searchTerms" && input.existingTitle) {
    promptContext += `\n\n当前已确认标题（搜索词不得重复）：${input.existingTitle}`;
    variables.existingTitle = input.existingTitle;
  }

  let parsed = await callListingSkill(job, handlerContext, input, config.skillSlug, promptContext, variables);
  if (operation === "sellingPoints") return normalizeSellingPoints(parsed);
  if (operation === "singleBullet") {
    let bullet = parsed?.bulletPoints?.[0] || parsed?.bullets?.[0] || parsed;
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
      bullet = parsed?.bulletPoints?.[0] || parsed?.bullets?.[0] || parsed;
      quality = validateSingleBulletQuality(bullet, input);
    }
    if (!quality.valid) throw new Error(`单条五点描述质量验证未通过：${quality.issues.join("；")}`);
    return { ...bullet, characterCount: quality.characterCount, actualCharacterCount: quality.characterCount, inRange: true };
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
