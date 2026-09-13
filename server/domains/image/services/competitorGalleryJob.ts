import { z } from "zod";
import { storageGet } from "../../../storage";
import type { AcquisitionAssetCandidate } from "../../../../drizzle/schema/acquisition";
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
import { ensureImageWorkflowAgentRun, imageWorkflowSkillNodeId } from "../imageWorkflowAgentBridge";
import { callImageWorkflowSkill } from "../routerContext";
import { requireDb } from "../../../repositories/dbClient";
import {
  COMPETITOR_GALLERY_SKILL_VERSION,
  CompetitorGalleryAnalysisSchema,
  CompetitorImageFactSchema,
  buildCompetitorGalleryInputHash,
} from "../competitorGalleryContracts";
import {
  createCompetitorGalleryAnalysisVersion,
  getCompetitorResearchSubject,
  getLatestCompetitorGalleryAnalysis,
  listCompetitorAssetFacts,
  listConfirmedAssets,
  nextCompetitorGalleryAnalysisVersion,
  updateCompetitorResearchSubject,
  upsertCompetitorAssetFact,
} from "../competitorGalleryRepository";

const JOB_KIND = "image.step0.competitor.gallery.analysis";
const JOB_MODULE = "imageWorkflow";

export const competitorGalleryJobInput = z.object({
  projectId: z.number().int().positive(),
  subjectId: z.number().int().positive(),
  agentRunId: z.string().min(1).max(80),
  agentNodeId: z.string().min(1).max(80),
});

async function assetAccessUrl(storageKey: string | null) {
  if (!storageKey?.startsWith("storage://")) throw new Error("竞品图片缺少已确认S3证据");
  const key = storageKey.replace(/^storage:\/\/[^/]+\//, "");
  return (await storageGet(key)).url;
}

async function runCompetitorGalleryAnalysis(job: AiJobSnapshot, context: AiJobHandlerContext) {
  const input = competitorGalleryJobInput.parse(job.input);
  const db = await requireDb("competitor gallery analysis");
  const subject = await getCompetitorResearchSubject(db, Number(job.workspaceId), input.projectId, input.subjectId);
  if (!subject) throw new Error("竞品研究对象不存在或无权访问");
  const assets = await listConfirmedAssets(db, Number(job.workspaceId), subject.confirmedSnapshotId);
  if (!assets.length) throw new Error("该竞品没有已确认的图片证据");
  if (assets.some((asset: AcquisitionAssetCandidate) => !asset.storageKey || !asset.contentHash)) throw new Error("竞品图片证据不完整，无法进入AI分析");
  await updateCompetitorResearchSubject(db, Number(job.workspaceId), input.projectId, input.subjectId, { status: "analyzing" });

  const inputHash = buildCompetitorGalleryInputHash({
    subjectId: subject.id,
    confirmedSnapshotId: subject.confirmedSnapshotId,
    assets: assets.map((asset: AcquisitionAssetCandidate) => ({ id: asset.id, contentHash: asset.contentHash, role: asset.role, positionIndex: asset.positionIndex })),
  });
  const existing = await getLatestCompetitorGalleryAnalysis(db, Number(job.workspaceId), subject.id);
  if (existing?.inputHash === inputHash && ["review_required", "confirmed"].includes(existing.status)) {
    return { subjectId: subject.id, analysisId: existing.id, reused: true };
  }

  const imageFacts: Array<{ assetId: number; role: string; positionIndex: number; facts: z.infer<typeof CompetitorImageFactSchema> }> = [];
  for (let index = 0; index < assets.length; index += 1) {
    if (context.signal.aborted) throw new Error("竞品全图分析已取消");
    const asset = assets[index];
    const imageUrl = await assetAccessUrl(asset.storageKey);
    const facts = await callImageWorkflowSkill({
      skillSlug: "image.step0.competitor.gallery.image-facts",
      userId: job.userId,
      workspaceId: job.workspaceId,
      systemPrompt: "只分析提供的单张竞品图片并输出严格JSON；不得推断图片之外的事实，也不得建议直接复用竞品素材。",
      context: `已确认竞品图片证据。assetId=${asset.id}，角色=${asset.role}，序号=${asset.positionIndex}。请提取可观察的图片目的、卖点、表达方式、构图、视觉、文案策略、证明方式、人群、情绪、优势、风险和置信度。`,
      attachments: [{ type: "image_url", image_url: { url: imageUrl, detail: "high" } }],
      maxModelAttempts: 3,
      signal: context.signal,
      validate: (value) => CompetitorImageFactSchema.parse(value),
    });
    await upsertCompetitorAssetFact(db, {
      workspaceId: Number(job.workspaceId),
      projectId: input.projectId,
      subjectId: subject.id,
      acquisitionAssetId: asset.id,
      assetRole: asset.role,
      positionIndex: asset.positionIndex,
      inputContentHash: asset.contentHash!,
      status: "review_required",
      aiFacts: facts,
      confidence: String(facts.confidence),
      analyzedByJobRunId: job.runId,
    });
    imageFacts.push({ assetId: asset.id, role: asset.role, positionIndex: asset.positionIndex, facts });
    await updateAiJobProgress(job.runId, 10 + Math.floor(((index + 1) / assets.length) * 65), { expectedAttempt: job.attempt });
  }

  const analysis = await callImageWorkflowSkill({
    skillSlug: "image.step0.competitor.gallery.summary",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: "基于同一竞品全部已确认图片的逐图事实生成严格JSON总结。所有策略结论必须引用输入中的assetId。",
    context: JSON.stringify({
      competitor: { asin: subject.asin, marketplace: subject.marketplace, displayName: subject.displayName },
      images: imageFacts,
      constraints: ["只总结输入证据", "不得把竞品图片作为我方素材", "未出现的A+或品牌故事不得推断为不存在"],
    }),
    maxModelAttempts: 3,
    signal: context.signal,
    validate: (value) => CompetitorGalleryAnalysisSchema.parse(value),
  });
  const version = await nextCompetitorGalleryAnalysisVersion(db, subject.id);
  const analysisId = await createCompetitorGalleryAnalysisVersion(db, {
    workspaceId: Number(job.workspaceId),
    projectId: input.projectId,
    subjectId: subject.id,
    version,
    inputHash,
    status: "review_required",
    analysis,
    evidenceAssetIds: assets.map((asset: AcquisitionAssetCandidate) => asset.id),
    skillVersion: COMPETITOR_GALLERY_SKILL_VERSION,
    jobRunId: job.runId,
    createdBy: job.userId,
  });
  await updateCompetitorResearchSubject(db, Number(job.workspaceId), input.projectId, subject.id, {
    status: "review_required",
    currentAnalysisVersion: version,
  });
  await updateAiJobProgress(job.runId, 95, { expectedAttempt: job.attempt });
  return { subjectId: subject.id, analysisId, version, reused: false };
}

export async function getLatestCompetitorGalleryJob(userId: number, projectId: number, subjectId: number) {
  const jobs = await listAiJobRunsForUser(userId, { module: JOB_MODULE, projectId, limit: 100 });
  return jobs.find((job) => job.kind === JOB_KIND && Number((job.input as any)?.subjectId) === subjectId) || null;
}

export async function startCompetitorGalleryAnalysisJob(input: {
  projectId: number;
  subjectId: number;
  userId: number;
  workspaceId: number;
}) {
  const active = await getLatestCompetitorGalleryJob(input.userId, input.projectId, input.subjectId);
  if (active?.status === "queued" || active?.status === "running") return active;
  const agentRunId = await ensureImageWorkflowAgentRun(input);
  if (!agentRunId) throw new Error("图片工作流无法创建Agent Run，任务未入队");
  const job = await createAiJobRun({
    kind: JOB_KIND,
    module: JOB_MODULE,
    procedure: "imageWorkflow.startCompetitorGalleryAnalysis",
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug: "image.step0.competitor.gallery.summary",
    input: {
      projectId: input.projectId,
      subjectId: input.subjectId,
      agentRunId,
      agentNodeId: imageWorkflowSkillNodeId(0),
    },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: 30 * 60,
  });
  try {
    await scheduleAiJobRun(job.runId);
  } catch (error) {
    await cancelAiJob(job.runId, "竞品全图分析任务调度失败").catch(() => null);
    throw error;
  }
  return job;
}

registerAiJobHandler({
  id: "imageWorkflow.competitorGalleryAnalysis",
  match: (job) => job.kind === JOB_KIND,
  handler: runCompetitorGalleryAnalysis,
});
