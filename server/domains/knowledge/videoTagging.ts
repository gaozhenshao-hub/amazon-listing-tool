import { taggingImprovements } from "./tagImprovements";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  parseStorageUri,
  resolveStoredObjectUrl,
  storagePut,
} from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import { requireDb } from "../../repositories/dbClient";
import { assistantConfigurationService } from "../ai_os/services/assistantConfigurations";
import {
  runEmperorSkill,
  getEmperorSkillRuntimeSnapshot,
} from "../../services/emperorSkillRunner";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  getAiJobRun,
} from "../../services/aiJobRunner";
import { paraformerConfig, submitSpeech, pollSpeech } from "../ops/paraformer";
import { parseVideoTaggingResult } from "./videoTaggingResult";
import { prepareVideoEvidence } from "./videoMedia";
import {
  requireVideo,
  videoObjectAllowed,
  type VideoScope,
  type VideoRow,
} from "./videoLibrary";
import {
  KNOWLEDGE_VIDEO_SKILL,
} from "../../../shared/videoLabels";

const KIND = "knowledge.videos.tag";
const VideoJobInput = z.object({
  videoId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  feedback: z.string().max(4000),
  model: z.string().min(1),
  skillVersion: z.string().min(1),
  skillHash: z.string().min(1),
  actorRole: z.string(),
});
type Processing = {
  speechState?: "submitting" | "polling" | "complete";
  speechTaskId?: string;
  providerId?: number;
  transcript?: string;
  sentences?: Array<{ start: number; end: number; text: string }>;
};
function processing(row: VideoRow): Processing {
  try {
    return typeof row.processing === "string"
      ? JSON.parse(row.processing)
      : (row.processing as Processing) || {};
  } catch {
    return {};
  }
}
export async function enqueueVideoTags(
  scope: VideoScope,
  id: number,
  revision?: number,
  feedback?: string
) {
  const row = await requireVideo(scope, id, true);
  if (revision !== undefined && row.labelRevision !== revision)
    throw new Error("标签已更新，请刷新后再试");
  if (["queued", "running"].includes(row.labelStatus) && row.labelRunId) {
    const job = await getAiJobRun(row.labelRunId);
    if (job && ["queued", "running"].includes(job.status))
      return { runId: job.runId };
  }
  const saved = await assistantConfigurationService.get(
    scope.workspaceId,
    "tagger"
  );
  if (saved.status !== "configured" || !saved.record.config.enabled)
    throw new Error("请先配置并启用打标签的小酷");
  const snapshot = await getEmperorSkillRuntimeSnapshot(
    KNOWLEDGE_VIDEO_SKILL,
    scope.workspaceId
  );
  const binding = saved.record.config.skills.find(
    s => s.slug === KNOWLEDGE_VIDEO_SKILL && s.enabled
  );
  // Assistant bindings canonicalize JSON keys; runner snapshots preserve the
  // stored manifest order. Validate each against its own registry fingerprint.
  const descriptor = (
    await assistantConfigurationService.options(scope.workspaceId)
  ).skills.find(s => s.slug === KNOWLEDGE_VIDEO_SKILL);
  if (
    !binding ||
    !descriptor ||
    String(binding.version) !== snapshot.version ||
    binding.manifestSha256 !== descriptor.manifestSha256
  )
    throw new Error("请先为小酷配置已发布的视频打标技能");
  const runId = "kb-video-" + randomUUID(),
    db = await requireDb("video tags");
  const [receipt] = await db.execute(
    sql`UPDATE kb_videos SET labelStatus='queued',labelRunId=${runId},labelError=NULL WHERE id=${id} AND workspaceId=${scope.workspaceId} AND labelRevision=${row.labelRevision} AND (labelRunId <=> ${row.labelRunId})`
  );
  if ((receipt as unknown as { affectedRows: number }).affectedRows !== 1)
    throw new Error("视频已在处理，请刷新查看");
  try {
    await startRegisteredAiJob({
      runId,
      kind: KIND,
      module: "knowledge",
      procedure: "kbVideos.runTags",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      queueName: "knowledge_video_tags",
      timeoutSeconds: 900,
      maxAttempts: 1,
      skillSlug: KNOWLEDGE_VIDEO_SKILL,
      input: {
        agentRunId: null,
        agentNodeId: null,
        videoId: id,
        revision: row.labelRevision,
        feedback: feedback || "",
        model: saved.record.config.modelSlug,
        skillVersion: snapshot.version,
        skillHash: snapshot.manifestHash,
        actorRole: scope.role || "",
      },
    });
  } catch {
    await db.execute(
      sql`UPDATE kb_videos SET labelStatus='failed',labelError='打标任务未能启动，请重试' WHERE id=${id} AND workspaceId=${scope.workspaceId} AND labelRunId=${runId}`
    );
    throw new Error("打标任务未能启动，请重试");
  }
  return { runId };
}
async function runVideoTags(
  scope: VideoScope,
  runId: string,
  input: z.infer<typeof VideoJobInput>,
  signal: AbortSignal
) {
  const db = await requireDb("video tagging"),
    row = await requireVideo(scope, input.videoId, true);
  if (row.labelRunId !== runId || row.labelRevision !== input.revision)
    throw new Error("标签已变化，本次任务停止");
  await db.execute(
    sql`UPDATE kb_videos SET labelStatus='running' WHERE id=${row.id} AND workspaceId=${scope.workspaceId} AND labelRunId=${runId}`
  );
  try {
    if (!videoObjectAllowed(row.videoUrl, scope))
      throw new Error("视频原件不可读取");
    const stored = parseStorageUri(row.videoUrl);
    if (stored?.provider !== "local")
      throw new Error("当前视频存储暂不支持分析");
    const evidence = await prepareVideoEvidence(
        await verifiedLocalObjectPath(stored.key),
        signal
      ),
      state = processing(row);
    const persist = async () => {
      await db.execute(
        sql`UPDATE kb_videos SET processing=${JSON.stringify(state)} WHERE id=${row.id} AND workspaceId=${scope.workspaceId} AND labelRunId=${runId}`
      );
    };
    if (evidence.audio && state.speechState !== "complete") {
      const config = await paraformerConfig(
        scope.workspaceId,
        state.providerId
      );
      if (state.speechState === "submitting" && !state.speechTaskId)
        throw new Error("语音提交结果待核对，请联系管理员，避免重复计费");
      if (!state.speechTaskId) {
        const audio = await storagePut(
          `knowledge/${scope.workspaceId}/videos/${row.userId}/${row.sourceHash}.flac`,
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
      for (let attempt = 0; attempt < 75; attempt++) {
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
        await delay(4000, undefined, { signal });
      }
      if (state.speechState !== "complete")
        throw new Error("语音仍在处理，可稍后重试继续读取原任务");
    }
    const fresh = await requireVideo(scope, row.id, true);
    if (fresh.labelRunId !== runId || fresh.labelRevision !== input.revision)
      throw new Error("标签已变化，本次任务停止");
    const context = {
      task: "普通视频打标：只返回视频标签 JSON，不返回 reply/result/improvement 对话外层，不修改共享技能。",
      duration: evidence.duration,
      samplingInterval: evidence.interval,
      title: row.videoTitle,
      asinLabels: row.imageSetId
        ? {
            category: row.setCategory || "",
            style: row.setStyle || "",
            primaryColor: row.setPrimaryColor || "",
            accentColor: row.setAccentColor || "",
          }
        : null,
      audio: evidence.audio
        ? state.transcript
          ? { sentences: state.sentences, text: state.transcript }
          : "语音识别未检测到讲解，结合画面判断，不要虚构旁白"
        : "原视频没有音轨",
      previousResult: row.userEditedAnalysis || row.aiAnalysis,
      feedback: input.feedback,
    };
    const result = await runEmperorSkill({
      skillSlug: KNOWLEDGE_VIDEO_SKILL,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      modelOverride: input.model,
      maxModelAttempts: 1,
      fallbackModels: [],
      expectedSkillVersion: input.skillVersion,
      expectedSkillManifestHash: input.skillHash,
      expectedSkillStatus: "Released",
      skillVersionPolicy: "snapshot",
      signal,
      context: JSON.stringify(context) + await taggingImprovements(scope,"video"),
      variables: {},
      attachments: evidence.sheets.map(bytes => ({
        type: "image_url" as const,
        image_url: {
          url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        },
      })),
      migrationSource: "knowledge.video_labels",
    });
    signal.throwIfAborted();
    const labels = parseVideoTaggingResult(result.content, evidence.duration);
    if (row.imageSetId) Object.assign(labels, context.asinLabels);
    await requireVideo(scope, row.id, true);
    const [receipt] = await db.execute(
      sql`UPDATE kb_videos SET aiAnalysis=${JSON.stringify(labels)},aiOriginalAnalysis=COALESCE(aiOriginalAnalysis,${JSON.stringify(labels)}),userEditedAnalysis=NULL,labelStatus='complete',labelRevision=labelRevision+1,labelError=NULL,transcriptText=${state.transcript || ""},duration=${Math.ceil(evidence.duration)} WHERE id=${row.id} AND recycleId IS NULL AND workspaceId=${scope.workspaceId} AND labelRunId=${runId} AND labelRevision=${input.revision}`
    );
    if ((receipt as unknown as { affectedRows: number }).affectedRows !== 1)
      throw new Error("标签已变化，未覆盖新结果");
    return {
      videoId: row.id,
      segments: labels.segments.length,
      type: labels.type,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const friendly = /^(请|视频|语音|标签|当前)/.test(message)
      ? message.slice(0, 280)
      : "视频打标暂未完成，已保留视频及原标签，请稍后重试";
    await db.execute(
      sql`UPDATE kb_videos SET labelStatus='failed',labelError=${friendly} WHERE id=${row.id} AND workspaceId=${scope.workspaceId} AND labelRunId=${runId}`
    );
    throw new Error(friendly);
  }
}
registerAiJobHandler({
  id: KIND,
  match: job => job.kind === KIND,
  handler: (job, context) => {
    const input = VideoJobInput.parse(job.input);
    return runVideoTags(
      {
        workspaceId: job.workspaceId!,
        userId: job.userId!,
        role: input.actorRole,
      },
      job.runId,
      input,
      context.signal
    );
  },
});
