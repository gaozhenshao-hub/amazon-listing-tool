/** Explicit, idempotent administrator rollout. Work is durable in the existing worker queues. */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import { createAiJobRun, getAiJobRun } from "../server/services/aiJobRunner";
import { imageTaggerConfiguration } from "../server/domains/knowledge/automaticTagging";
import { KNOWLEDGE_SET_SKILL } from "../server/domains/knowledge/taggingSkillPrompts";
import { enqueueMissingAssetRepair } from "../server/domains/acquisition/missingAssetRepair";
import { enqueueVideoTags } from "../server/domains/knowledge/videoTagging";

const workspaceId = Number(process.env.KNOWLEDGE_MAINTENANCE_WORKSPACE),
  actor = Number(process.env.KNOWLEDGE_MAINTENANCE_ACTOR);
const mode = process.argv[2],
  rollout = process.env.KNOWLEDGE_ROLLOUT_KEY || "20261027-split-v1";
const ids = (process.env.KNOWLEDGE_ROLLOUT_IDS || "")
  .split(",")
  .filter(Boolean)
  .map(Number);
if (
  !Number.isSafeInteger(workspaceId) ||
  workspaceId < 1 ||
  !Number.isSafeInteger(actor) ||
  actor < 1 ||
  !/^[a-z0-9-]{1,32}$/.test(rollout) ||
  ids.some(id => !Number.isSafeInteger(id) || id < 1)
)
  throw Error("Invalid explicit rollout scope");
try {
  const db = await requireDb("knowledge rollout");
  const rows = async <T>(q: ReturnType<typeof sql>) =>
    (await db.execute(q))[0] as unknown as T[];
  const [user] = await rows<{ role: string }>(
    sql`SELECT role FROM users WHERE id=${actor} AND status='active'`
  );
  if (!user || !["admin", "super_admin"].includes(user.role))
    throw Error("Administrator required");
  const selected = (id: number) => !ids.length || ids.includes(id);
  if (mode === "repair") {
    const jobs = await rows<{
      id: number;
      userId: number;
    }>(sql`SELECT DISTINCT j.id,j.requested_by AS userId FROM acquisition_jobs j
      JOIN acquisition_source_snapshots s ON s.job_id=j.id AND s.workspace_id=j.workspace_id
      JOIN acquisition_asset_candidates a ON a.snapshot_id=s.id AND a.workspace_id=j.workspace_id
      WHERE j.workspace_id=${workspaceId} AND j.deleted_at IS NULL AND j.cache_expired_at IS NULL AND j.accepted_missing=0
      AND j.consumer_type='kb_images' AND j.status IN ('confirmed','review_required')
      AND (a.storage_key IS NULL OR a.role='video' AND a.thumbnail_storage_key IS NULL) ORDER BY j.id`);
    for (const job of jobs.filter(j => selected(j.id)))
      console.log(
        JSON.stringify({
          jobId: job.id,
          ...(await enqueueMissingAssetRepair(
            { workspaceId, userId: job.userId, jobId: job.id },
            randomUUID()
          )),
        })
      );
  } else if (mode === "sets") {
    const { revision } = await imageTaggerConfiguration(
      workspaceId,
      KNOWLEDGE_SET_SKILL
    );
    const sets = await rows<{ id: number; userId: number; asin: string }>(
      sql`SELECT id,userId,asin FROM kb_image_sets WHERE workspaceId=${workspaceId} AND recycleId IS NULL AND status='confirmed' ORDER BY id`
    );
    for (const set of sets.filter(s => selected(s.id))) {
      const runId = `kb-set-${rollout}-${set.id}`;
      if (!(await getAiJobRun(runId)))
        await createAiJobRun({
          runId,
          kind: "knowledge.sets.retag",
          module: "knowledge",
          procedure: "maintenance.retagSets",
          workspaceId,
          userId: set.userId,
          skillSlug: KNOWLEDGE_SET_SKILL,
          queueName: "knowledge_tags",
          maxAttempts: 1,
          timeoutSeconds: 1800,
          input: { imageSetId: set.id, configurationRevision: revision },
        });
      console.log(JSON.stringify({ id: set.id, asin: set.asin, runId }));
    }
  } else if (mode === "videos") {
    const videos = await rows<{
      id: number;
      userId: number;
      labelRevision: number;
    }>(
      sql`SELECT id,userId,labelRevision FROM kb_videos WHERE workspaceId=${workspaceId} AND recycleId IS NULL AND status='confirmed' AND userEditedAnalysis IS NULL AND labelStatus NOT IN ('queued','running') ORDER BY id`
    );
    for (const video of videos.filter(v => selected(v.id)))
      console.log(
        JSON.stringify({
          videoId: video.id,
          ...(await enqueueVideoTags(
            { workspaceId, userId: video.userId, role: "admin" },
            video.id,
            video.labelRevision,
            "按更新的技能重新核对整条视频。先看故事叙事与人物情境，再区分口播讲解；保留十种内容标签并定位时间段。"
          )),
        })
      );
  } else if (mode === "status") {
    const jobs = await rows(
      sql`SELECT kind,status,COUNT(*) AS count FROM ai_jobs WHERE workspaceId=${workspaceId} AND createdAt>=DATE_SUB(NOW(),INTERVAL 12 HOUR) AND kind IN ('knowledge.sets.retag','knowledge.collection.repair','knowledge.videos.tag') GROUP BY kind,status`
    );
    const colors = await rows(
      sql`SELECT setPrimaryColor,COUNT(*) AS count FROM kb_image_sets WHERE workspaceId=${workspaceId} AND recycleId IS NULL AND status='confirmed' GROUP BY setPrimaryColor`
    );
    console.log(JSON.stringify({ jobs, colors }));
  } else throw Error("Expected repair, sets, videos or status");
} finally {
  await closeDbConnection();
}
