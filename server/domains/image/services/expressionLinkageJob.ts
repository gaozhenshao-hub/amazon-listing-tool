import { createHash } from "node:crypto";
import { z } from "zod";
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
import { requireDb } from "../../../repositories/dbClient";
import { ensureImageWorkflowAgentRun, imageWorkflowSkillNodeId } from "../imageWorkflowAgentBridge";
import { callImageWorkflowSkill } from "../routerContext";
import {
  ExpressionGroupAnalysisSchema,
  Step0SynthesisSchema,
  chunkExpressionAssets,
} from "../expressionLinkageContracts";
import {
  getExpressionGroupForProject,
  getExpressionSelectionById,
  getLatestConfirmedStep0Artifact,
  getLatestExpressionAnalysis,
  getLatestStep0Synthesis,
  listConfirmedExpressionAnalyses,
  listSelectedExpressionFacts,
} from "../expressionLinkageRepository";
import {
  createExpressionAnalysisDraft,
  createSynthesisDraft,
  synthesisInputHash,
} from "../expressionLinkageService";

const MODULE = "imageWorkflow";
const EXPRESSION_JOB_KIND = "image.step0.expression.linked-analysis";
const SYNTHESIS_JOB_KIND = "image.step0.composite.synthesis";

export const expressionAnalysisJobInput = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  groupId: z.number().int().positive(),
  selectionVersionId: z.number().int().positive(),
  agentRunId: z.string().min(1).max(80),
  agentNodeId: z.string().min(1).max(80),
});

export const synthesisJobInput = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  agentRunId: z.string().min(1).max(80),
  agentNodeId: z.string().min(1).max(80),
});

function flattenEvidenceIds(value: unknown): number[] {
  const ids: number[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "number" && Number.isInteger(node) && node > 0) ids.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.entries(node).forEach(([key, child]) => {
      if (key.toLowerCase().includes("asset")) walk(child);
    });
  };
  walk(value);
  return [...new Set(ids)].sort((a, b) => a - b);
}

function expressionInputHash(input: { selectionHash: string; facts: Array<{ assetId: number; facts: unknown }> }) {
  return createHash("sha256").update(JSON.stringify({
    selectionHash: input.selectionHash,
    facts: input.facts.map((item) => ({ assetId: item.assetId, facts: item.facts })),
  })).digest("hex");
}

async function runExpressionAnalysis(job: AiJobSnapshot, context: AiJobHandlerContext) {
  const input = expressionAnalysisJobInput.parse(job.input);
  const workspaceId = Number(job.workspaceId);
  const db = await requireDb("expression linkage analysis job");
  const group = await getExpressionGroupForProject(db, input.projectId, input.groupId);
  if (!group) throw new Error("表达方向不存在或无权访问");
  const selection = await getExpressionSelectionById(db, workspaceId, input.projectId, input.selectionVersionId);
  if (!selection || selection.groupId !== input.groupId || selection.sessionId !== input.sessionId) throw new Error("表达图片选择版本不存在");
  if (selection.status !== "confirmed") throw new Error("只有已确认的图片选择版本可以进入AI分析");
  const selectedAssetIds = Array.isArray(selection.selectedAssetIds) ? selection.selectedAssetIds.map(Number) : [];
  const rows = await listSelectedExpressionFacts(db, workspaceId, selection.id);
  if (!selectedAssetIds.length || rows.length !== selectedAssetIds.length) throw new Error("已选图片的确认事实不完整，请回到竞品全图分析复核");
  const assets = rows.map((row: any) => ({
    assetId: row.link.acquisitionAssetId,
    subjectId: row.subject.id,
    asin: row.subject.asin,
    subjectRole: row.subject.role,
    assetRole: row.fact.assetRole,
    positionIndex: row.fact.positionIndex,
    facts: row.fact.userEdit || row.fact.aiFacts,
  }));
  const inputHash = expressionInputHash({ selectionHash: selection.selectionHash, facts: assets });
  const existing = await getLatestExpressionAnalysis(db, workspaceId, input.projectId, input.groupId);
  if (existing?.selectionVersionId === selection.id && existing.inputHash === inputHash && ["review_required", "confirmed"].includes(existing.status)) {
    return { groupId: input.groupId, analysisId: existing.id, reused: true };
  }

  const batches = chunkExpressionAssets(assets);
  const batchAnalyses: Array<z.infer<typeof ExpressionGroupAnalysisSchema>> = [];
  for (let index = 0; index < batches.length; index += 1) {
    if (context.signal.aborted) throw new Error("同表达竞品图片分析已取消");
    const batch = batches[index];
    const analysis = await callImageWorkflowSkill({
      skillSlug: "image.step0.expression.linked-analysis",
      userId: job.userId,
      workspaceId: job.workspaceId,
      systemPrompt: "只基于已确认竞品图片事实分析同一卖点表达方向，输出严格JSON。每项策略必须引用输入中的assetId；不得把竞品图片作为我方生成素材。",
      context: JSON.stringify({
        expressionGroup: { id: group.id, name: group.expressionName, description: group.description },
        batch: { index: index + 1, total: batches.length, imageCount: batch.length },
        assets: batch,
        constraints: ["不得遗漏本批资产", "只陈述输入证据", "竞品图片仅用于研究"],
      }),
      maxModelAttempts: 3,
      signal: context.signal,
      validate: (value) => ExpressionGroupAnalysisSchema.parse(value),
    });
    batchAnalyses.push(analysis);
    await updateAiJobProgress(job.runId, 10 + Math.floor(((index + 1) / batches.length) * 60), { expectedAttempt: job.attempt });
  }

  let analysis = batchAnalyses[0];
  if (batchAnalyses.length > 1) {
    analysis = await callImageWorkflowSkill({
      skillSlug: "image.step0.expression.linked-analysis",
      userId: job.userId,
      workspaceId: job.workspaceId,
      systemPrompt: "合并全部批次的同表达竞品图片分析并输出严格JSON。必须覆盖全部批次，imageCount等于总图片数，证据只能引用提供的assetId。",
      context: JSON.stringify({
        expressionGroup: { id: group.id, name: group.expressionName, description: group.description },
        totalImageCount: assets.length,
        batchAnalyses,
        allowedAssetIds: selectedAssetIds,
        constraints: ["不得只总结第一批", "不得把竞品图片作为我方生成素材"],
      }),
      maxModelAttempts: 3,
      signal: context.signal,
      validate: (value) => ExpressionGroupAnalysisSchema.parse(value),
    });
  }
  if (analysis.imageCount !== assets.length) analysis = { ...analysis, imageCount: assets.length };
  const created = await createExpressionAnalysisDraft({
    workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    groupId: input.groupId,
    selectionVersionId: selection.id,
    analysis,
    evidenceAssetIds: selectedAssetIds,
    inputHash,
    jobRunId: job.runId,
    userId: job.userId,
  });
  await updateAiJobProgress(job.runId, 95, { expectedAttempt: job.attempt });
  return { groupId: input.groupId, analysisId: created.id, version: created.version, reused: false };
}

async function runStep0Synthesis(job: AiJobSnapshot, context: AiJobHandlerContext) {
  const input = synthesisJobInput.parse(job.input);
  const workspaceId = Number(job.workspaceId);
  const db = await requireDb("step0 synthesis job");
  const [galleryArtifact, expressionArtifact, expressionRows] = await Promise.all([
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "competitor_gallery"),
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "expression_summary"),
    listConfirmedExpressionAnalyses(db, workspaceId, input.projectId),
  ]);
  if (!galleryArtifact) throw new Error("请先确认主要竞品整套图片分析");
  if (!expressionArtifact || !expressionRows.length) throw new Error("请先确认至少一个图库联动表达方式分析");
  const inputHash = synthesisInputHash({
    galleryArtifactId: galleryArtifact.id,
    expressionArtifactId: expressionArtifact.id,
    expressionAnalysisIds: expressionRows.map((row: any) => row.analysis.id),
  });
  const existing = await getLatestStep0Synthesis(db, workspaceId, input.projectId, input.sessionId);
  if (existing?.inputHash === inputHash && ["review_required", "confirmed"].includes(existing.status)) {
    return { synthesisId: existing.id, reused: true };
  }
  const allowedAssetIds = [...new Set([
    ...flattenEvidenceIds(galleryArtifact.evidenceRefs),
    ...flattenEvidenceIds(expressionArtifact.evidenceRefs),
  ])].sort((a, b) => a - b);
  if (!allowedAssetIds.length) throw new Error("综合结论缺少已确认图片证据");
  if (context.signal.aborted) throw new Error("Step 0综合分析已取消");
  const analysis = await callImageWorkflowSkill({
    skillSlug: "image.step0.composite.synthesis",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: "仅组合已确认的竞品整套图片分析和卖点表达分析，输出严格JSON。所有决策必须引用允许的assetId，用户将逐项选择是否进入后续步骤。",
    context: JSON.stringify({
      competitorGallery: galleryArtifact.content,
      expressionSummaries: expressionArtifact.content,
      allowedAssetIds,
      constraints: ["不得引入未确认事实", "竞品图片只能作为研究证据，不能作为我方生成素材"],
    }),
    maxModelAttempts: 3,
    signal: context.signal,
    validate: (value) => Step0SynthesisSchema.parse(value),
  });
  const created = await createSynthesisDraft({
    workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    analysis,
    evidenceAssetIds: allowedAssetIds,
    inputHash,
    jobRunId: job.runId,
    userId: job.userId,
  });
  await updateAiJobProgress(job.runId, 95, { expectedAttempt: job.attempt });
  return { synthesisId: created.id, version: created.version, reused: false };
}

export async function getLatestExpressionAnalysisJob(userId: number, projectId: number, groupId: number) {
  const jobs = await listAiJobRunsForUser(userId, { module: MODULE, projectId, limit: 100 });
  return jobs.find((job) => job.kind === EXPRESSION_JOB_KIND && Number((job.input as any)?.groupId) === groupId) || null;
}

export async function getLatestStep0SynthesisJob(userId: number, projectId: number) {
  const jobs = await listAiJobRunsForUser(userId, { module: MODULE, projectId, limit: 100 });
  return jobs.find((job) => job.kind === SYNTHESIS_JOB_KIND) || null;
}

export async function startExpressionAnalysisJob(input: {
  projectId: number; sessionId: number; groupId: number; selectionVersionId: number; userId: number; workspaceId: number;
}) {
  const active = await getLatestExpressionAnalysisJob(input.userId, input.projectId, input.groupId);
  if (active?.status === "queued" || active?.status === "running") return active;
  const agentRunId = await ensureImageWorkflowAgentRun(input);
  if (!agentRunId) throw new Error("图片工作流无法创建Agent Run，任务未入队");
  const job = await createAiJobRun({
    kind: EXPRESSION_JOB_KIND,
    module: MODULE,
    procedure: "imageWorkflow.startExpressionAssetAnalysis",
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug: "image.step0.expression.linked-analysis",
    input: { ...input, agentRunId, agentNodeId: imageWorkflowSkillNodeId(0) },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: 30 * 60,
  });
  try {
    await scheduleAiJobRun(job.runId);
  } catch (error) {
    await cancelAiJob(job.runId, "同表达竞品图片分析任务调度失败").catch(() => null);
    throw error;
  }
  return job;
}

export async function startStep0SynthesisJob(input: { projectId: number; sessionId: number; userId: number; workspaceId: number }) {
  const active = await getLatestStep0SynthesisJob(input.userId, input.projectId);
  if (active?.status === "queued" || active?.status === "running") return active;
  const agentRunId = await ensureImageWorkflowAgentRun(input);
  if (!agentRunId) throw new Error("图片工作流无法创建Agent Run，任务未入队");
  const job = await createAiJobRun({
    kind: SYNTHESIS_JOB_KIND,
    module: MODULE,
    procedure: "imageWorkflow.startStep0Synthesis",
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug: "image.step0.composite.synthesis",
    input: { ...input, agentRunId, agentNodeId: imageWorkflowSkillNodeId(0) },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: 20 * 60,
  });
  try {
    await scheduleAiJobRun(job.runId);
  } catch (error) {
    await cancelAiJob(job.runId, "Step 0综合分析任务调度失败").catch(() => null);
    throw error;
  }
  return job;
}

registerAiJobHandler({ id: "imageWorkflow.expressionLinkedAnalysis", match: (job) => job.kind === EXPRESSION_JOB_KIND, handler: runExpressionAnalysis });
registerAiJobHandler({ id: "imageWorkflow.step0CompositeSynthesis", match: (job) => job.kind === SYNTHESIS_JOB_KIND, handler: runStep0Synthesis });
