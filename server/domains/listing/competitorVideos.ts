import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { z } from "zod";
import * as repository from "../../repositories";
import { requireDb } from "../../repositories/dbClient";
import { readJson } from "../../../shared/competitorPresentation";
import {
  competitorVideoAnalysisSchema,
  videoMomentSchema,
  videoSourceFingerprint,
  type CompetitorVideoAnalysis,
} from "../../../shared/competitorVideoAnalysis";
import {
  parseStorageUri,
  storagePut,
  resolveStoredObjectUrl,
} from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import { prepareVideoEvidence } from "../knowledge/videoMedia";
import { paraformerConfig, submitSpeech, pollSpeech } from "../ops/paraformer";
import { runCompetitorSkill } from "./runCompetitorSkill";
import {
  safeParseSkillJSON,
  getEmperorSkillRuntimeSnapshot,
} from "../ai_os/services/skillRunner";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  getAiJobRun,
  updateAiJobProgress,
} from "../../services/aiJobRunner";
import { VIDEO_SKILL } from "./listingSkillPrompts";
import {
  moduleVideoEvidenceHash,
  richModuleTargets,
} from "../../../shared/richModuleSellingPoints";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { unifyModuleSellingPoints } from "./moduleSellingPoints";

type Scope = {
  projectId: number;
  workspaceId: number;
  userId: number;
  analysisId: number;
};
type Processing = {
  sourceHash: string;
  speechState?: "submitting" | "polling" | "complete";
  speechTaskId?: string;
  providerId?: number;
  transcript?: string;
  sentences?: Array<{ start: number; end: number; text: string }>;
};
const rows = (v: unknown) => v as any[];
export function competitorVideoSource(raw: any, hash: string) {
  const video = (raw.videos || []).find((v: any) => v.hash === hash);
  const asset = (raw.imageAssets || []).find(
    (a: any) =>
      a.role === "video" &&
      a.sourceUrlHash === hash &&
      a.moduleClass === video?.moduleId
  );
  if (!video || !asset?.storageKey)
    throw new Error("视频原件尚未保存，请重新采集");
  return {
    video,
    asset,
    sourceHash: videoSourceFingerprint(
      hash,
      asset.storageKey,
      asset.contentHash
    ),
  };
}
async function requireSource(scope: Scope) {
  const project = await repository.getProjectById(
    scope.projectId,
    scope.userId,
    scope.workspaceId
  );
  if (!project || project.workspaceId !== scope.workspaceId)
    throw new Error("项目不可访问");
  const record = await repository.getPersistedCompetitorAnalysisById(
    scope.analysisId
  );
  if (!record || record.projectId !== scope.projectId)
    throw new Error("竞品不存在");
  const raw = readJson(record.rawData) || {};
  if (raw.analysisStale || !raw.comparisonAnalysis)
    throw new Error("请先完成竞品分析");
  return { record, raw };
}
async function updateRaw<T>(scope: Scope, edit: (raw: any) => T | Promise<T>) {
  const db = await requireDb("competitor video checkpoint");
  return db.transaction(async tx => {
    const [parents] = await tx.execute(
      sql`SELECT id FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
    );
    if (!rows(parents).length) throw new Error("项目不可访问");
    const [records] = await tx.execute(
      sql`SELECT rawData FROM competitorAnalyses WHERE id=${scope.analysisId} AND projectId=${scope.projectId} FOR UPDATE`
    );
    if (!rows(records).length) throw new Error("竞品不存在");
    const raw = readJson(rows(records)[0].rawData) || {},
      result = await edit(raw);
    await tx.execute(
      sql`UPDATE competitorAnalyses SET rawData=${JSON.stringify(raw)} WHERE id=${scope.analysisId} AND projectId=${scope.projectId}`
    );
    return result;
  });
}
const resultSchema = z.object({
  speechTranslations: z
    .array(
      z.object({
        id: z.string(),
        translation: z.string().trim().min(1).max(8000),
      })
    )
    .max(5000),
  screenTexts: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
        source: z.string().trim().min(1).max(6000),
        translation: z.string().trim().min(1).max(8000),
      })
    )
    .max(2000),
  sellingPoints: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        moments: z.array(videoMomentSchema).min(1).max(30),
      })
    )
    .max(12),
  notes: z.string().max(4000),
});
export function validateVideoFinding(
  content: string,
  duration: number,
  speech: Array<{ id: string; start: number; end: number; text: string }>
) {
  const result = resultSchema.parse(safeParseSkillJSON(content)),
    ids = new Set(speech.map(s => s.id));
  if (
    result.speechTranslations.length !== ids.size ||
    new Set(result.speechTranslations.map(s => s.id)).size !== ids.size ||
    result.speechTranslations.some(s => !ids.has(s.id))
  )
    throw new Error("语音字幕翻译不完整或引用错误");
  if (
    [
      ...result.screenTexts,
      ...result.sellingPoints.flatMap(p => p.moments),
    ].some(s => s.end <= s.start || s.end > duration + 0.1)
  )
    throw new Error("字幕或卖点时间超出视频范围");
  return result;
}
export async function analyzeCompetitorVideo(
  scope: Scope,
  hash: string,
  signal: AbortSignal,
  snapshot?: { version: string; manifestHash: string }
) {
  const { raw } = await requireSource(scope),
    source = competitorVideoSource(raw, hash);
  const previous = (raw.comparisonAnalysis.videoAnalyses || []).find(
    (a: any) => a.hash === hash && a.sourceHash === source.sourceHash
  );
  const ready = competitorVideoAnalysisSchema.safeParse(previous);
  if (ready.success) return ready.data;
  const stored = parseStorageUri(source.asset.storageKey);
  if (
    stored?.provider !== "local" ||
    !stored.key.startsWith("acquisition/" + scope.workspaceId + "/")
  )
    throw new Error("视频原件存储暂不支持分析");
  const evidence = await prepareVideoEvidence(
    await verifiedLocalObjectPath(stored.key),
    signal
  );
  const old = raw.videoProcessing?.[hash],
    state: Processing =
      old?.sourceHash === source.sourceHash
        ? old
        : { sourceHash: source.sourceHash };
  const persist = async () => {
    signal.throwIfAborted();
    await updateRaw(scope, current => {
      if (competitorVideoSource(current, hash).sourceHash !== source.sourceHash)
        throw new Error("视频已更新，本次处理停止");
      current.videoProcessing = { ...current.videoProcessing, [hash]: state };
    });
  };
  if (evidence.audio && state.speechState !== "complete") {
    const config = await paraformerConfig(scope.workspaceId, state.providerId);
    if (state.speechState === "submitting" && !state.speechTaskId)
      throw new Error("语音提交结果待核对，请勿重复提交");
    if (!state.speechTaskId) {
      const audio = await storagePut(
        "acquisition/" +
          scope.workspaceId +
          "/video-audio/" +
          source.sourceHash +
          ".flac",
        evidence.audio,
        "audio/flac"
      );
      state.speechState = "submitting";
      state.providerId = config.id;
      await persist();
      state.speechTaskId = await submitSpeech(
        config,
        await resolveStoredObjectUrl(audio.storageUri)
      );
      state.speechState = "polling";
      await persist();
    }
    for (let i = 0; i < 100; i++) {
      signal.throwIfAborted();
      const result = await pollSpeech(config, state.speechTaskId, {
        allowEmpty: true,
      });
      if (result) {
        state.transcript = result.text;
        state.sentences = result.sentences;
        state.speechState = "complete";
        await persist();
        break;
      }
      await delay(3000, undefined, { signal });
    }
    if (state.speechState !== "complete")
      throw new Error("语音仍在处理，请稍后继续读取原任务");
  }
  const speech = (state.sentences || [])
    .filter(
      s => s.text.trim() && s.end > s.start && s.start < evidence.duration
    )
    .map((s, i) => ({
      ...s,
      end: Math.min(evidence.duration, s.end),
      id: "S" + i,
    }));
  if (state.transcript?.trim() && !speech.length)
    throw new Error("语音已转写但没有有效时间轴，请核对语音服务");
  const context = JSON.stringify({
    mode: "video",
    duration: evidence.duration,
    samplingInterval: evidence.interval,
    title: source.video.title,
    transcript: state.transcript || "",
    speech,
    audio: evidence.audio ? "语音已识别；为空时表示未检测到讲解" : "没有音轨",
  });
  const result = (
    await runCompetitorSkill({
      skillSlug: VIDEO_SKILL,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: scope.projectId,
      signal,
      context,
      variables: { context },
      ...(snapshot
        ? {
            expectedSkillVersion: snapshot.version,
            expectedSkillManifestHash: snapshot.manifestHash,
            expectedSkillStatus: "Released" as const,
            skillVersionPolicy: "snapshot" as const,
          }
        : {}),
      attachments: evidence.sheets.map(bytes => ({
        type: "image_url" as const,
        image_url: {
          url: "data:image/jpeg;base64," + bytes.toString("base64"),
        },
      })),
      validate: content =>
        validateVideoFinding(content, evidence.duration, speech),
    })
  ).parsed;
  const translations = new Map(
    result.speechTranslations.map(t => [t.id, t.translation])
  );
  const analysis: CompetitorVideoAnalysis = competitorVideoAnalysisSchema.parse(
    {
      version: 1,
      hash,
      sourceHash: source.sourceHash,
      generatedAt: new Date().toISOString(),
      status: "complete",
      duration: evidence.duration,
      notes: result.notes,
      sellingPoints: result.sellingPoints,
      cues: [
        ...speech.map(s => ({
          id: s.id,
          kind: "speech",
          start: s.start,
          end: s.end,
          source: s.text,
          translation: translations.get(s.id)!,
        })),
        ...result.screenTexts.map((s, i) => ({
          ...s,
          id: "T" + i,
          kind: "screen",
        })),
      ],
    }
  );
  signal.throwIfAborted();
  await updateRaw(scope, current => {
    if (
      competitorVideoSource(current, hash).sourceHash !== source.sourceHash ||
      current.analysisStale
    )
      throw new Error("视频资料已变化，未覆盖当前结果");
    current.comparisonAnalysis = {
      ...current.comparisonAnalysis,
      videoAnalyses: [
        ...(current.comparisonAnalysis.videoAnalyses || []).filter(
          (a: any) => a.hash !== hash
        ),
        analysis,
      ],
    };
  });
  return analysis;
}
const jobInput = z.object({
  projectId: z.number().int().positive(),
  analysisId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  userId: z.number().int().positive(),
  version: z.string(),
  manifestHash: z.string(),
});
export async function unifyVideoModules(scope: Scope, signal: AbortSignal) {
  const { raw } = await requireSource(scope),
    study = raw.comparisonAnalysis;
  if (!study.richContent) return;
  const baseline = acquisitionReviewHash({
    layout: raw.sourceLayout,
    images: study.images,
    rich: study.richContent,
    videos: study.videoAnalyses,
  });
  const modulePoints = await unifyModuleSellingPoints({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    layout: raw.sourceLayout,
    presentation: study.richContent,
    findings: study.images || [],
    videos: study.videoAnalyses || [],
    signal,
  });
  await updateRaw(scope, current => {
    const value = current.comparisonAnalysis;
    if (
      baseline !==
      acquisitionReviewHash({
        layout: current.sourceLayout,
        images: value.images,
        rich: value.richContent,
        videos: value.videoAnalyses,
      })
    )
      throw new Error("模块资料已更新，请重新整理视频卖点");
    current.comparisonAnalysis = {
      ...value,
      richContent: { ...value.richContent, modulePoints },
    };
  });
}
export async function startCompetitorVideos(scope: Scope, retry = false) {
  await requireSource(scope);
  return updateRaw(scope, async raw => {
    const videos = (raw.videos || []).filter((v: any) => {
      try {
        const source = competitorVideoSource(raw, v.hash);
        return !(raw.comparisonAnalysis.videoAnalyses || []).some(
          (a: any) =>
            a.hash === v.hash &&
            a.sourceHash === source.sourceHash &&
            competitorVideoAnalysisSchema.safeParse(a).success
        );
      } catch {
        return false;
      }
    });
    const study = raw.comparisonAnalysis;
    const missingModule =
      study.richContent &&
      richModuleTargets(raw.sourceLayout, study.richContent.images).some(t => {
        const hash = moduleVideoEvidenceHash(t, study.videoAnalyses);
        return (
          hash &&
          !study.richContent.modulePoints?.some(
            (m: any) =>
              m.id === t.id &&
              m.sourceHash === t.sourceHash &&
              m.videoEvidenceHash === hash
          )
        );
      });
    if (!videos.length && !missingModule)
      return { status: "succeeded", runId: null };
    if (raw.videoAnalysisJobRunId) {
      const old = await getAiJobRun(raw.videoAnalysisJobRunId);
      if (
        old &&
        (["queued", "running"].includes(old.status) ||
          (!retry && ["failed", "canceled"].includes(old.status)))
      )
        return { status: old.status, runId: old.runId };
    }
    const snapshot = await getEmperorSkillRuntimeSnapshot(
      VIDEO_SKILL,
      scope.workspaceId
    );
    const job = await startRegisteredAiJob({
      kind: "listing.competitor.video",
      module: "listing",
      procedure: "analysis.prepareVideos",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: scope.projectId,
      skillSlug: VIDEO_SKILL,
      queueName: "analysis",
      maxAttempts: 1,
      timeoutSeconds: 1200,
      input: {
        agentRunId: null,
        agentNodeId: null,
        ...scope,
        version: snapshot.version,
        manifestHash: snapshot.manifestHash,
      },
    });
    raw.videoAnalysisJobRunId = job.runId;
    raw.videoAnalysisError = null;
    return { status: job.status, runId: job.runId };
  });
}
registerAiJobHandler({
  id: "listing-competitor-video",
  match: job => job.kind === "listing.competitor.video",
  handler: async (job, { signal }) => {
    const input = jobInput.parse(job.input),
      { raw } = await requireSource(input),
      videos = (raw.videos || []).filter((v: any) => {
        try {
          competitorVideoSource(raw, v.hash);
          return true;
        } catch {
          return false;
        }
      });
    try {
      for (const [i, v] of videos.entries()) {
        await analyzeCompetitorVideo(input, v.hash, signal, {
          version: input.version,
          manifestHash: input.manifestHash,
        });
        await updateAiJobProgress(
          job.runId,
          Math.round(((i + 1) / videos.length) * 90)
        );
      }
      await unifyVideoModules(input, signal);
      await updateRaw(input, current => {
        current.videoAnalysisError = null;
      });
      return { analysisId: input.analysisId, videos: videos.length };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "视频处理暂未完成";
      await updateRaw(input, current => {
        current.videoAnalysisError = /^(请|视频|语音|字幕|百炼)/.test(message)
          ? message.slice(0, 280)
          : "视频处理暂未完成，请稍后重试";
      });
      throw error;
    }
  },
});
