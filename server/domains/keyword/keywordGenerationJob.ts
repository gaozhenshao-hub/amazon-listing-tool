import { z } from "zod";
import * as db from "../../repositories";
import {
  cancelAiJob,
  generateAiJobRunId,
  getAiJobRun,
  listAiJobRunsForUser,
  recoverAiJob,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../ai_os/services/jobRunner";
import { getAgentRun } from "../ai_os/services/agentRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { buildProductContext, chunkArray } from "../../routers/keywordHelpers";
import {
  confirmKeywordNode,
  ensureKeywordAgentRun,
  syncKeywordNodeFailure,
  syncKeywordNodeProgress,
  syncKeywordNodeQueued,
  syncKeywordNodeWaitingHuman,
  KEYWORD_OPERATION_NODE_MAP,
  type KeywordOperation,
} from "./keywordAgentBridge";

export const KEYWORD_JOB_KIND = "keyword.generation";
export const KEYWORD_JOB_MODULE = "keywordWorkflow";

const singleOperationSchema = z.enum(["trafficComp", "filter", "tag", "classify", "matrix", "layout"]);
export const keywordJobOperationSchema = z.union([singleOperationSchema, z.literal("full")]);
export type KeywordJobOperation = z.infer<typeof keywordJobOperationSchema>;

const keywordJobInputSchema = z.object({
  projectId: z.number().int().positive(),
  operation: keywordJobOperationSchema,
  keywordIds: z.array(z.number().int().positive()).optional(),
  agentRunId: z.string().min(1),
  agentNodeId: z.string().min(1).optional(),
});

const skillByOperation: Record<KeywordOperation, string> = {
  trafficComp: "keyword.traffic.classify",
  filter: "keyword.semantic.filter",
  tag: "keyword.scene.tag",
  classify: "keyword.root.classify",
  matrix: "keyword.strategy.matrix",
  layout: "keyword.listing.layout",
};

const operationsForJob = (operation: KeywordJobOperation): KeywordOperation[] => operation === "full"
  ? ["trafficComp", "filter", "tag", "classify", "matrix", "layout"]
  : [operation];

function normalizeLevel(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  if (["high", "高", "头部"].includes(text)) return "high";
  if (["medium", "middle", "中", "腰部"].includes(text)) return "medium";
  if (["low", "低", "尾部"].includes(text)) return "low";
  return null;
}

function resultRows(value: any) {
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.classified)) return value.classified;
  if (Array.isArray(value?.keywords)) return value.keywords;
  return [];
}

function keywordMatch<T extends { keyword?: unknown }>(keywords: T[], value: unknown) {
  const target = String(value || "").trim().toLowerCase();
  return keywords.find((keyword) => String(keyword.keyword || "").trim().toLowerCase() === target);
}

async function runSkill(input: {
  operation: KeywordOperation;
  job: AiJobSnapshot;
  signal: AbortSignal;
  productContext: string;
  payload: unknown;
  expectedSchema: string;
}) {
  const result = await runEmperorSkill<Record<string, any>>({
    skillSlug: skillByOperation[input.operation],
    userId: input.job.userId,
    workspaceId: input.job.workspaceId,
    context: JSON.stringify({
      task: input.operation,
      productContext: input.productContext,
      input: input.payload,
      outputContract: input.expectedSchema,
      rules: [
        "Return valid JSON only.",
        "Keep every keyword exactly as supplied; never translate keyword text.",
        "Only return keywords present in the input.",
      ],
    }),
    variables: { operation: input.operation, expectedSchema: input.expectedSchema },
    migrationSource: "server/domains/keyword/keywordGenerationJob.ts",
    maxModelAttempts: 1,
    signal: input.signal,
    validate: (content) => {
      const parsed = safeParseSkillJSON<Record<string, any>>(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
        throw new Error(`皇帝 Skill ${skillByOperation[input.operation]} 未返回有效 JSON`);
      }
      return parsed;
    },
  });
  return result.parsed;
}

async function ensureCurrentJob(job: AiJobSnapshot, operation: KeywordOperation) {
  const jobs = await listAiJobRunsForUser(job.userId, { module: KEYWORD_JOB_MODULE, projectId: job.projectId || undefined, limit: 50 });
  const currentCreatedAt = job.createdAt.getTime();
  const superseding = jobs.find((candidate) => {
    if (candidate.runId === job.runId || candidate.createdAt.getTime() <= currentCreatedAt) return false;
    const parsed = keywordJobInputSchema.safeParse(candidate.input);
    return parsed.success && operationsForJob(parsed.data.operation).includes(operation);
  });
  if (superseding) throw new Error(`关键词 ${operation} 任务已被更新的任务 ${superseding.runId} 替代`);
}

async function executeTraffic(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  const selected = input.keywordIds
    ? allKeywords.filter((keyword) => input.keywordIds!.includes(keyword.id) && keyword.isNegative === 0)
    : allKeywords.filter((keyword) => keyword.isNegative === 0);
  const eligible = selected.filter((keyword) => Number(keyword.monthlySearchVolume || 0) > 0 || Number(keyword.spr || 0) > 0);
  if (!eligible.length) return { classified: 0, thresholds: null, reason: "No search volume or SPR data available" };
  let classified = 0;
  let thresholds: unknown = null;
  const chunks = chunkArray(eligible, 50);
  for (let index = 0; index < chunks.length; index += 1) {
    await ensureCurrentJob(input.job, "trafficComp");
    const chunk = chunks[index];
    const parsed = await runSkill({
      ...input,
      operation: "trafficComp",
      payload: chunk.map((keyword) => ({ keyword: keyword.keyword, monthlySearchVolume: keyword.monthlySearchVolume, spr: keyword.spr })),
      expectedSchema: "{results:[{keyword,trafficLevel:high|medium|low,competition:high|medium|low}],analysis:{trafficThresholds,competitionThresholds}}",
    });
    thresholds = parsed.analysis || parsed.thresholds || thresholds;
    for (const row of resultRows(parsed)) {
      const keyword = keywordMatch(chunk, row.keyword);
      if (!keyword) continue;
      const trafficLevel = normalizeLevel(row.trafficLevel);
      const competition = normalizeLevel(row.competition ?? row.competitionLevel);
      if (!trafficLevel && !competition) continue;
      await db.updateKeyword(keyword.id, {
        ...(trafficLevel ? { trafficLevel } : {}),
        ...(competition ? { competition } : {}),
      });
      classified += 1;
    }
    await input.progress(index + 1, chunks.length);
  }
  return { classified, thresholds };
}

async function executeFilter(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  const candidates = input.keywordIds
    ? allKeywords.filter((keyword) => input.keywordIds!.includes(keyword.id))
    : allKeywords.filter((keyword) => keyword.status === "raw" || keyword.status === "cleaned");
  const skipped = candidates.filter((keyword) => keyword.skipSemanticFilter === 1);
  for (const keyword of skipped) await db.updateKeyword(keyword.id, { status: "cleaned" });
  const eligible = candidates.filter((keyword) => keyword.skipSemanticFilter !== 1);
  let kept = skipped.length;
  let removed = 0;
  const chunks = chunkArray(eligible, 30);
  for (let index = 0; index < chunks.length; index += 1) {
    await ensureCurrentJob(input.job, "filter");
    const chunk = chunks[index];
    const parsed = await runSkill({
      ...input,
      operation: "filter",
      payload: chunk.map((keyword) => keyword.keyword),
      expectedSchema: "{results:[{keyword,action:keep|remove,relevance,reason}]} (filtered/removed arrays are also accepted)",
    });
    const rows = resultRows(parsed).length
      ? resultRows(parsed)
      : [
          ...(Array.isArray(parsed.filtered) ? parsed.filtered.map((row: any) => ({ ...row, action: "keep" })) : []),
          ...(Array.isArray(parsed.removed) ? parsed.removed.map((row: any) => ({ ...row, action: "remove" })) : []),
        ];
    for (const row of rows) {
      const keyword = keywordMatch(chunk, row.keyword);
      if (!keyword) continue;
      if (String(row.action || "keep").toLowerCase() === "remove") {
        await db.updateKeyword(keyword.id, { status: "negative", isNegative: 1, relevance: "none" });
        await db.createNegativeKeyword({
          projectId: input.projectId,
          userId: input.job.userId,
          keyword: keyword.keyword,
          reason: row.reason || "AI semantic filter",
          reasonCn: row.reason ? `AI语义过滤: ${row.reason}` : "AI语义过滤移除",
          source: "ai_suggest",
          matchType: "exact",
        }).catch(() => null);
        removed += 1;
      } else {
        await db.updateKeyword(keyword.id, { status: "cleaned", relevance: row.relevance || keyword.relevance });
        kept += 1;
      }
    }
    await input.progress(index + 1, Math.max(chunks.length, 1));
  }
  return { filtered: eligible.length, kept, removed };
}

async function executeTag(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  const eligible = input.keywordIds
    ? allKeywords.filter((keyword) => input.keywordIds!.includes(keyword.id))
    : allKeywords.filter((keyword) => keyword.status === "cleaned" || keyword.status === "scored");
  let tagged = 0;
  const chunks = chunkArray(eligible, 30);
  for (let index = 0; index < chunks.length; index += 1) {
    await ensureCurrentJob(input.job, "tag");
    const chunk = chunks[index];
    const parsed = await runSkill({
      ...input,
      operation: "tag",
      payload: chunk.map((keyword) => keyword.keyword),
      expectedSchema: "{results:[{keyword,sceneTags:string[],intentTag:string}]} (keywords with scenes/cosmoTags/intent are also accepted)",
    });
    for (const row of resultRows(parsed)) {
      const keyword = keywordMatch(chunk, row.keyword);
      if (!keyword) continue;
      const sceneTags = row.sceneTags || row.scenes || row.cosmoTags || [];
      await db.updateKeyword(keyword.id, {
        sceneTags: JSON.stringify(Array.isArray(sceneTags) ? sceneTags : []),
        intentTag: row.intentTag || row.intent || null,
        status: "tagged",
      });
      tagged += 1;
    }
    await input.progress(index + 1, Math.max(chunks.length, 1));
  }
  return { tagged };
}

async function executeClassify(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  const eligible = input.keywordIds
    ? allKeywords.filter((keyword) => input.keywordIds!.includes(keyword.id) && keyword.isNegative === 0)
    : allKeywords.filter((keyword) => keyword.isNegative === 0);
  let classified = 0;
  const chunks = chunkArray(eligible, 30);
  for (let index = 0; index < chunks.length; index += 1) {
    await ensureCurrentJob(input.job, "classify");
    const chunk = chunks[index];
    const parsed = await runSkill({
      ...input,
      operation: "classify",
      payload: chunk.map((keyword) => keyword.keyword),
      expectedSchema: "{results:[{keyword,rootWord,rootCategory,rootImpact}]} (grouped roots are also accepted)",
    });
    const rows = resultRows(parsed).length
      ? resultRows(parsed)
      : (Array.isArray(parsed.roots) ? parsed.roots.flatMap((root: any) => (
          (root.keywords || []).map((keyword: string) => ({
            keyword,
            rootWord: root.root,
            rootCategory: root.type,
            rootImpact: root.priority,
          }))
        )) : []);
    for (const row of rows) {
      const keyword = keywordMatch(chunk, row.keyword);
      if (!keyword) continue;
      await db.updateKeyword(keyword.id, {
        rootWord: row.rootWord || row.root || null,
        rootCategory: row.rootCategory || row.type || null,
        rootImpact: row.rootImpact || row.priority || null,
      });
      classified += 1;
    }
    await input.progress(index + 1, Math.max(chunks.length, 1));
  }
  return { classified };
}

async function executeMatrix(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  const eligible = input.keywordIds
    ? allKeywords.filter((keyword) => input.keywordIds!.includes(keyword.id) && keyword.isNegative === 0)
    : allKeywords.filter((keyword) => keyword.isNegative === 0);
  let categorized = 0;
  const chunks = chunkArray(eligible, 25);
  for (let index = 0; index < chunks.length; index += 1) {
    await ensureCurrentJob(input.job, "matrix");
    const chunk = chunks[index];
    const parsed = await runSkill({
      ...input,
      operation: "matrix",
      payload: chunk.map((keyword) => ({
        keyword: keyword.keyword,
        traffic: keyword.trafficLevel,
        relevance: keyword.relevance,
        competition: keyword.competition,
        spr: keyword.spr,
        monthlySearchVolume: keyword.monthlySearchVolume,
      })),
      expectedSchema: "{results:[{keyword,strategyCategory,listingPlacement}]} where strategyCategory may be negative",
    });
    for (const row of resultRows(parsed)) {
      const keyword = keywordMatch(chunk, row.keyword);
      if (!keyword) continue;
      const negative = row.strategyCategory === "negative";
      await db.updateKeyword(keyword.id, {
        strategyCategory: row.strategyCategory || null,
        listingPlacement: row.listingPlacement || null,
        status: negative ? "negative" : "finalized",
        ...(negative ? { isNegative: 1 } : {}),
      });
      if (negative) {
        await db.createNegativeKeyword({
          projectId: input.projectId,
          userId: input.job.userId,
          keyword: keyword.keyword,
          reason: "3D matrix analysis marked as negative",
          reasonCn: "3D矩阵分析标记为否定词",
          source: "ai_suggest",
          matchType: "exact",
        }).catch(() => null);
      }
      categorized += 1;
    }
    await input.progress(index + 1, Math.max(chunks.length, 1));
  }
  return { categorized };
}

async function executeLayout(input: ExecutionInput) {
  const allKeywords = await db.getKeywordsByProject(input.projectId);
  if (!allKeywords.length) throw new Error("没有关键词数据，请先导入关键词");
  await ensureCurrentJob(input.job, "layout");
  const rootGroups: Record<string, string[]> = {};
  const strategyGroups: Record<string, string[]> = {};
  for (const keyword of allKeywords) {
    if (keyword.rootCategory) (rootGroups[keyword.rootCategory] ||= []).push(keyword.keyword);
    if (keyword.strategyCategory) (strategyGroups[keyword.strategyCategory] ||= []).push(keyword.keyword);
  }
  const parsed = await runSkill({
    ...input,
    operation: "layout",
    payload: {
      roots: Object.fromEntries(Object.entries(rootGroups).map(([key, values]) => [key, values.slice(0, 30)])),
      strategyMatrix: Object.fromEntries(Object.entries(strategyGroups).map(([key, values]) => [key, values.slice(0, 30)])),
    },
    expectedSchema: "{titleFormula,bulletFormulas,aplusKeywords,searchTermKeywords,doNotUse,overallStrategy}",
  });
  await input.progress(1, 1);
  return parsed;
}

type ExecutionInput = {
  projectId: number;
  keywordIds?: number[];
  job: AiJobSnapshot;
  signal: AbortSignal;
  productContext: string;
  progress: (completed: number, total: number) => Promise<void>;
};

const executorByOperation: Record<KeywordOperation, (input: ExecutionInput) => Promise<any>> = {
  trafficComp: executeTraffic,
  filter: executeFilter,
  tag: executeTag,
  classify: executeClassify,
  matrix: executeMatrix,
  layout: executeLayout,
};

async function runKeywordJob(job: AiJobSnapshot, signal: AbortSignal) {
  const input = keywordJobInputSchema.parse(job.input);
  const project = await db.getProjectById(input.projectId, job.userId);
  if (!project) throw new Error("项目不存在或无权访问");
  const productContext = buildProductContext(project);
  const operations = operationsForJob(input.operation);
  const results: Partial<Record<KeywordOperation, unknown>> = {};

  try {
    for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
      const operation = operations[operationIndex];
      const rangeStart = 10 + Math.floor((operationIndex / operations.length) * 80);
      const rangeSize = Math.max(1, Math.floor(80 / operations.length));
      await syncKeywordNodeProgress({
        operation,
        projectId: input.projectId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        agentRunId: input.agentRunId,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        maxAttempts: job.maxAttempts,
        progress: rangeStart,
      });
      const output = await executorByOperation[operation]({
        projectId: input.projectId,
        keywordIds: input.keywordIds,
        job,
        signal,
        productContext,
        progress: async (completed, total) => {
          const progress = Math.min(90, rangeStart + Math.floor((completed / Math.max(total, 1)) * rangeSize));
          await updateAiJobProgress(job.runId, progress, {
            expectedWorkerId: job.lockedBy || undefined,
            expectedAttempt: job.attempt,
          });
          await syncKeywordNodeProgress({
            operation,
            projectId: input.projectId,
            userId: job.userId,
            workspaceId: job.workspaceId,
            agentRunId: input.agentRunId,
            aiJobRunId: job.runId,
            aiJobAttempt: job.attempt,
            maxAttempts: job.maxAttempts,
            progress,
          });
        },
      });
      results[operation] = output;
      await syncKeywordNodeWaitingHuman({
        operation,
        projectId: input.projectId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        agentRunId: input.agentRunId,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        output,
      });
    }
    return input.operation === "full" ? results : results[operations[0]];
  } catch (error) {
    const operation = operations.find((candidate) => results[candidate] === undefined) || operations[operations.length - 1];
    const abortReason = signal.aborted ? String(signal.reason || "") : "";
    const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
    const finalAttempt = job.attempt >= job.maxAttempts || (signal.aborted && !retryableTimeout);
    await syncKeywordNodeFailure({
      operation,
      projectId: input.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      agentRunId: input.agentRunId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      maxAttempts: job.maxAttempts,
      finalAttempt,
      error,
      failureKind: signal.aborted ? (retryableTimeout ? "timeout" : "cancel") : "error",
    }).catch((syncError) => console.warn("[Keyword Job] Failed to sync failure", syncError));
    throw error;
  }
}

export async function queueKeywordJob(input: {
  projectId: number;
  operation: KeywordJobOperation;
  keywordIds?: number[];
  userId: number;
  workspaceId?: number | null;
}) {
  const parsed = keywordJobInputSchema.omit({ agentRunId: true, agentNodeId: true }).parse(input);
  const existing = await listAiJobRunsForUser(input.userId, {
    module: KEYWORD_JOB_MODULE,
    projectId: input.projectId,
    limit: 50,
  });
  const active = existing.find((job) => {
    const jobInput = keywordJobInputSchema.safeParse(job.input);
    return jobInput.success && jobInput.data.operation === parsed.operation && ["queued", "running"].includes(job.status);
  });
  if (active) {
    const activeInput = keywordJobInputSchema.parse(active.input);
    const firstOperation = operationsForJob(activeInput.operation)[0];
    const sync = active.status === "queued" ? syncKeywordNodeQueued : syncKeywordNodeProgress;
    await sync({
      operation: firstOperation,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      agentRunId: activeInput.agentRunId,
      aiJobRunId: active.runId,
      aiJobAttempt: active.attempt,
      maxAttempts: active.maxAttempts,
      progress: active.progress,
    }).catch(() => null);
    return { ...active, alreadyRunning: true, agentRunId: activeInput.agentRunId };
  }

  const agent = await ensureKeywordAgentRun(input);
  const runId = generateAiJobRunId(`keyword_${parsed.operation}`);
  const job = await startRegisteredAiJob({
    runId,
    kind: KEYWORD_JOB_KIND,
    module: KEYWORD_JOB_MODULE,
    procedure: `keywordAi.${parsed.operation}`,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId,
    skillSlug: parsed.operation === "full" ? "keyword.*" : skillByOperation[parsed.operation],
    input: {
      ...parsed,
      agentRunId: agent.runId,
      agentNodeId: KEYWORD_OPERATION_NODE_MAP[operationsForJob(parsed.operation)[0]],
    },
    progress: 5,
    priority: 15,
    queueName: "analysis",
    maxAttempts: 3,
    timeoutSeconds: parsed.operation === "full" ? 1200 : 420,
  });
  await syncKeywordNodeQueued({
    operation: operationsForJob(parsed.operation)[0],
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentRunId: agent.runId,
    aiJobRunId: runId,
    aiJobAttempt: 0,
    maxAttempts: job.maxAttempts,
    progress: 5,
  }).catch((error) => console.warn("[Keyword Job] Failed to sync queued state", error));
  return { ...job, alreadyRunning: false, agentRunId: agent.runId };
}

export async function cancelKeywordJob(input: { runId: string; userId: number }) {
  const job = await getAiJobRun(input.runId);
  if (!job || job.userId !== input.userId || job.module !== KEYWORD_JOB_MODULE) throw new Error("关键词任务不存在或无权访问");
  const parsed = keywordJobInputSchema.parse(job.input);
  const operations = operationsForJob(parsed.operation);
  const detail = await getAgentRun(parsed.agentRunId, input.userId).catch(() => null);
  const activeCheckpoint = detail?.checkpoints.find((checkpoint: any) => (
    checkpoint.aiJobRunId === job.runId
    && ["running", "ready"].includes(checkpoint.status)
  ));
  const activeOperation = operations.find((operation) => (
    KEYWORD_OPERATION_NODE_MAP[operation] === activeCheckpoint?.nodeId
  )) || operations[0];
  await cancelAiJob(job.runId, "用户取消关键词分析");
  await syncKeywordNodeFailure({
    operation: activeOperation,
    projectId: parsed.projectId,
    userId: job.userId,
    workspaceId: job.workspaceId,
    agentRunId: parsed.agentRunId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    maxAttempts: job.maxAttempts,
    finalAttempt: true,
    failureKind: "cancel",
    error: "用户取消关键词分析",
  }).catch(() => null);
  return getAiJobRun(job.runId);
}

export async function retryKeywordJob(input: { runId: string; userId: number }) {
  const existing = await getAiJobRun(input.runId);
  if (!existing || existing.userId !== input.userId || existing.module !== KEYWORD_JOB_MODULE) throw new Error("关键词任务不存在或无权访问");
  const recovered = await recoverAiJob(existing.runId, "用户请求重试关键词分析");
  const parsed = keywordJobInputSchema.parse(recovered.input);
  await syncKeywordNodeQueued({
    operation: operationsForJob(parsed.operation)[0],
    projectId: parsed.projectId,
    userId: recovered.userId,
    workspaceId: recovered.workspaceId,
    agentRunId: parsed.agentRunId,
    aiJobRunId: recovered.runId,
    aiJobAttempt: 0,
    maxAttempts: recovered.maxAttempts,
    progress: recovered.progress,
  });
  return recovered;
}

export async function confirmKeywordJob(input: { runId: string; userId: number; output?: unknown }) {
  const job = await getAiJobRun(input.runId);
  if (!job || job.userId !== input.userId || job.module !== KEYWORD_JOB_MODULE) throw new Error("关键词任务不存在或无权访问");
  if (job.status !== "succeeded") throw new Error("关键词任务尚未成功完成，不能确认");
  const parsed = keywordJobInputSchema.parse(job.input);
  const outputs = parsed.operation === "full" && job.output && typeof job.output === "object"
    ? job.output as Partial<Record<KeywordOperation, unknown>>
    : { [operationsForJob(parsed.operation)[0]]: input.output ?? job.output };
  for (const operation of operationsForJob(parsed.operation)) {
    const output = outputs[operation];
    if (output === undefined) continue;
    await confirmKeywordNode({
      operation,
      projectId: parsed.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      agentRunId: parsed.agentRunId,
      output,
    });
  }
  return { confirmed: true, agentRunId: parsed.agentRunId };
}

registerAiJobHandler({
  id: "keyword.generation",
  match: (job) => job.kind === KEYWORD_JOB_KIND,
  handler: (job, context) => runKeywordJob(job, context.signal),
});
