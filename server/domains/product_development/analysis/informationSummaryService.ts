import * as devDb from "../../../devDb";
import { INFORMATION_SUMMARY_PROMPT } from "../../../devAnalysisPrompts";
import { z } from "zod";
import {
  recordBusinessArtifactUse,
  resolveCurrentDevAnalysisArtifact,
} from "../../ai_os/services/businessArtifactRegistry";
import {
  cancelAiJob,
  generateAiJobRunId,
  registerAiJobHandler,
  startRegisteredAiJob,
} from "../../ai_os/services/jobRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../../ai_os/services/skillRunner";
import {
  buildInformationSummaryAiContext,
  buildInformationSummarySeed,
  mergeInformationSummaryAi,
  validateInformationSummaryForConfirmation,
  type InformationSummaryAi,
} from "./informationSummary";
import {
  completeDevAnalysisStageRunConsistently,
  StaleDevAnalysisRunError,
} from "./stageConsistency";
import {
  syncProductAnalysisNodeCompleted,
  syncProductAnalysisNodeFailure,
  syncProductAnalysisNodeProgress,
  syncProductAnalysisNodeRunning,
} from "./productAnalysisAgent";

const informationSummaryJobInput = z.object({
  projectId: z.number().int().positive(),
  ownerName: z.string().nullable().optional(),
  agentRunId: z.string().max(80).optional(),
});

const INFORMATION_SUMMARY_STALE_MS = 12 * 60_000;

function serializeRunError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "信息汇总生成失败")).slice(0, 1_000);
}

export async function queueInformationSummaryGeneration(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  ownerName?: string | null;
}) {
  const current = await devDb.getDevAnalysisStage(input.projectId, "information_summary");
  const currentAgeMs = current?.updatedAt ? Date.now() - new Date(current.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  if (current?.status === "running" && current.runId && currentAgeMs < INFORMATION_SUMMARY_STALE_MS) {
    const linked = await syncProductAnalysisNodeRunning({
      projectId: input.projectId,
      stageType: "information_summary",
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: current.runId,
    });
    return {
      runId: current.runId,
      agentRunId: linked?.agentRunId || null,
      status: "running" as const,
      progress: current.runProgress || 0,
      alreadyRunning: true,
    };
  }

  if (current?.runId && (current.status === "running" || current.status === "generating")) {
    await cancelAiJob(current.runId, "信息汇总任务已超时，由新的运行接管").catch(() => null);
  }

  const runId = generateAiJobRunId("dev_information_summary");
  const claim = await devDb.claimDevAnalysisStageRun({
    projectId: input.projectId,
    userId: input.userId,
    stageType: "information_summary",
    runId,
    staleAfterSeconds: INFORMATION_SUMMARY_STALE_MS / 1_000,
  });
  if (!claim.claimed) {
    return {
      runId: claim.runId || runId,
      status: "running" as const,
      progress: claim.runProgress || 0,
      alreadyRunning: true,
    };
  }

  let agentRunId = "";
  try {
    const linked = await syncProductAnalysisNodeRunning({
      projectId: input.projectId,
      stageType: "information_summary",
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: runId,
    });
    agentRunId = linked?.agentRunId || "";
    await startRegisteredAiJob({
      runId,
      kind: "dev.analysis.informationSummary",
      module: "productDevelopment",
      procedure: "devAnalysis.runInformationSummary",
      workspaceId: input.workspaceId ?? null,
      userId: input.userId,
      projectId: input.projectId,
      skillSlug: "dev.analysis.information_summary",
      input: { projectId: input.projectId, ownerName: input.ownerName || null, agentRunId: agentRunId || undefined },
      progress: 5,
      priority: 20,
      queueName: "analysis",
      maxAttempts: 2,
      timeoutSeconds: 240,
    });
  } catch (error) {
    await devDb.failDevAnalysisStageRun(input.projectId, "information_summary", runId, error);
    if (agentRunId) {
      await syncProductAnalysisNodeFailure({
        agentRunId,
        stageType: "information_summary",
        aiJobRunId: runId,
        aiJobAttempt: 0,
        finalAttempt: true,
        error,
      }).catch(() => null);
    }
    throw error;
  }

  return { runId, agentRunId: agentRunId || null, status: "queued" as const, progress: 5, alreadyRunning: false };
}

async function runInformationSummaryGeneration(input: {
  runId: string;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  ownerName?: string | null;
  agentRunId?: string | null;
  signal?: AbortSignal;
  attempt: number;
  maxAttempts: number;
}) {
  let agentRunId = input.agentRunId || "";
  const updateIfCurrent = (data: Parameters<typeof devDb.updateDevAnalysisStageForRun>[3]) =>
    devDb.updateDevAnalysisStageForRun(input.projectId, "information_summary", input.runId, data);

  try {
    if (!agentRunId) {
      const linked = await syncProductAnalysisNodeRunning({
        projectId: input.projectId,
        stageType: "information_summary",
        userId: input.userId,
        workspaceId: input.workspaceId,
        aiJobRunId: input.runId,
      });
      agentRunId = linked?.agentRunId || "";
    }
    const claimed = await updateIfCurrent({
      status: "running",
      runProgress: 15,
      runError: null,
      runCompletedAt: null,
    });
    if (!claimed) return { skipped: true, reason: "信息汇总任务已被新的运行替代" };
    if (agentRunId) {
      await syncProductAnalysisNodeProgress({
        agentRunId,
        stageType: "information_summary",
        aiJobRunId: input.runId,
        aiJobAttempt: input.attempt,
        progress: 15,
      });
    }

    const project = await devDb.getDevProjectByWorkspace(
      input.projectId,
      input.workspaceId ?? null,
      input.userId,
    );
    if (!project) throw new Error("产品开发项目不存在");

    const [products, stages] = await Promise.all([
      devDb.getDevProductsByProject(input.projectId),
      devDb.getDevAnalysisStages(input.projectId),
    ]);
    const stageArtifacts = await Promise.all(stages.map(async (stage) => {
      if (stage.status !== "confirmed") return null;
      const artifact = await resolveCurrentDevAnalysisArtifact(stage.id);
      if (!artifact) return null;
      await recordBusinessArtifactUse({
        artifact,
        consumerDomain: "project",
        consumerType: "ai_job",
        consumerId: input.runId,
        projectId: input.projectId,
        runId: input.runId,
        nodeId: "information_summary",
        metadata: { stageType: stage.stageType },
      });
      return { stageId: stage.id, artifact };
    }));
    const artifactByStageId = new Map(stageArtifacts
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => [entry.stageId, entry.artifact]));
    const stagesFromArtifacts = stages.map((stage) => {
      const artifact = artifactByStageId.get(stage.id);
      if (!artifact) return stage;
      return {
        ...stage,
        rawResult: null,
        editedResult: typeof artifact.content === "string"
          ? artifact.content
          : JSON.stringify(artifact.content),
      };
    });
    const seed = buildInformationSummarySeed({
      project,
      products,
      stages: stagesFromArtifacts,
      ownerName: input.ownerName,
    });
    const aiContext = buildInformationSummaryAiContext(seed);
    const emperorContext = JSON.stringify(aiContext);
    if (!await updateIfCurrent({ runProgress: 45 })) {
      return { skipped: true, reason: "信息汇总任务已被新的运行替代" };
    }
    if (agentRunId) {
      await syncProductAnalysisNodeProgress({
        agentRunId,
        stageType: "information_summary",
        aiJobRunId: input.runId,
        aiJobAttempt: input.attempt,
        progress: 45,
      });
    }

    let aiResult: InformationSummaryAi = {};
    let runWarning: string | null = null;
    try {
      const skillResult = await runEmperorSkill<InformationSummaryAi>({
        skillSlug: "dev.analysis.information_summary",
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        context: emperorContext,
        variables: {
          schemaVersion: "1.0",
          totalCompetitors: seed.competitors.length,
          includedCompetitors: aiContext.competitorEvidence.includedCount,
        },
        legacySystemPrompt: INFORMATION_SUMMARY_PROMPT,
        migrationSource: "drizzle/0121_dev_information_summary_emperor_skills.sql",
        maxModelAttempts: 1,
        signal: input.signal,
        validate: (content) => {
          const parsed = safeParseSkillJSON<InformationSummaryAi>(content);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
            throw new Error("皇帝 Skill 未返回有效的信息汇总 JSON");
          }
          return parsed;
        },
      });
      aiResult = skillResult.parsed;
    } catch (error) {
      if (input.signal?.aborted) throw error;
      runWarning = `皇帝 Skill 暂未完成AI归纳，已生成可编辑的基础汇总：${serializeRunError(error)}`;
      aiResult = { missingFields: [runWarning] };
    }

    const result = mergeInformationSummaryAi(seed, aiResult);
    let completedStage;
    try {
      const completed = await completeDevAnalysisStageRunConsistently({
        projectId: input.projectId,
        stageType: "information_summary",
        runId: input.runId,
        rawResult: JSON.stringify(result),
        runError: runWarning,
      });
      completedStage = completed.stage;
      if (agentRunId) {
        await syncProductAnalysisNodeCompleted({
          agentRunId,
          projectId: input.projectId,
          stageType: "information_summary",
          aiJobRunId: input.runId,
          aiJobAttempt: input.attempt,
          output: result,
          invalidated: completed.invalidated,
          warning: runWarning,
        });
      }
    } catch (error) {
      if (error instanceof StaleDevAnalysisRunError) {
        return { skipped: true, reason: "信息汇总任务完成前已被新的运行替代" };
      }
      throw error;
    }
    return {
      stageId: completedStage.id,
      competitorCount: result.competitors.length,
      warning: runWarning,
    };
  } catch (error) {
    const abortReason = input.signal?.aborted ? String(input.signal.reason || "") : "";
    const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
    const finalAttempt = input.attempt >= input.maxAttempts || (Boolean(input.signal?.aborted) && !retryableTimeout);
    if (finalAttempt) {
      await devDb.failDevAnalysisStageRun(
        input.projectId,
        "information_summary",
        input.runId,
        error,
      );
    } else {
      await updateIfCurrent({
        status: "running",
        runProgress: 15,
        runError: `本次调用失败，后台将自动重试（${input.attempt}/${input.maxAttempts}）：${serializeRunError(error)}`,
        runCompletedAt: null,
      });
    }
    if (agentRunId) {
      await syncProductAnalysisNodeFailure({
        agentRunId,
        stageType: "information_summary",
        aiJobRunId: input.runId,
        aiJobAttempt: input.attempt,
        finalAttempt,
        error,
        failureKind: Boolean(input.signal?.aborted) ? (retryableTimeout ? "timeout" : "cancel") : "error",
      }).catch((syncError) => console.warn("[Product Analysis Agent] Failed to sync information-summary failure", syncError));
    }
    throw error;
  }
}

registerAiJobHandler({
  id: "productDevelopment.informationSummary",
  match: (job) => job.kind === "dev.analysis.informationSummary",
  handler: (job, context) => {
    const parsed = informationSummaryJobInput.parse(job.input);
    return runInformationSummaryGeneration({
      runId: job.runId,
      projectId: parsed.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      ownerName: parsed.ownerName,
      agentRunId: parsed.agentRunId,
      signal: context.signal,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
    });
  },
});
