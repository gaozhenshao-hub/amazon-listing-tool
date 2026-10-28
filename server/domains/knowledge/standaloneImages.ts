import { taggingImprovements } from "./tagImprovements";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { KbImage } from "../../../drizzle/schema/image";
import {
  IMAGE_UPLOAD_LIMIT,
  StandaloneImageTagsSchema,
} from "../../../shared/standaloneImage";
import { IMAGE_TAGGING_TAG_FIELDS } from "../../../shared/imageTagging";
import { IMAGE_TAGGING_GUIDANCE } from "../../../shared/imageTaggingGuidance";
import { requireDb } from "../../repositories/dbClient";
import { storagePut } from "../../storage";
import {
  getAiJobRun,
  startRegisteredAiJob,
  registerAiJobHandler,
} from "../../services/aiJobRunner";
import { runEmperorSkill } from "../../services/emperorSkillRunner";
import { imageTaggerConfiguration } from "./automaticTagging";
import { parseTaggingBatch } from "./taggingBatch";
import { taggingUnitPreview } from "./taggingUnitPreview";

export type ImageScope = { userId: number; workspaceId: number; role?: string };
export const STANDALONE_TAGGING_KIND = "knowledge.images.standalone";
async function rows<T>(query: ReturnType<typeof sql>) {
  return (
    await (await requireDb("standalone images")).execute(query)
  )[0] as unknown as T[];
}
export function standaloneImageAccess(
  scope: ImageScope,
  mode: "mine" | "shared" | "all" = "all",
  edit = false
) {
  const owner = sql`userId=${scope.userId}`,
    shared = sql`visibility='team'`;
  const visible =
    (edit && !["admin", "super_admin"].includes(scope.role || "")) ||
    mode === "mine"
      ? owner
      : mode === "shared"
        ? shared
        : sql`(${owner} OR ${shared})`;
  return sql`recycleId IS NULL AND imageSetId IS NULL AND workspaceId=${scope.workspaceId} AND uploadHash IS NOT NULL AND ${visible}`;
}
export async function requireStandaloneImage(
  scope: ImageScope,
  id: number,
  edit = false
) {
  const [row] = await rows<KbImage>(
    sql`SELECT * FROM kb_images WHERE id=${id} AND ${standaloneImageAccess(scope, "all", edit)} LIMIT 1`
  );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在或无权访问" });
  return row;
}
export async function prepareStandaloneImage(base64: string) {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new Error("请选择完整的图片文件");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > IMAGE_UPLOAD_LIMIT)
    throw new Error("单张图片不能超过 20MB");
  try {
    const source = sharp(bytes, {
        limitInputPixels: 40_000_000,
        failOn: "error",
      }),
      meta = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1 ||
      !meta.width ||
      !meta.height
    )
      throw new Error();
    // Decode the whole file before storing it; strip metadata and normalize orientation.
    const original = await source.rotate().webp({ quality: 95 }).toBuffer();
    const thumbnail = await sharp(original)
      .resize({
        width: 600,
        height: 600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      original,
      thumbnail,
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    throw new Error("请选择有效的 JPG、PNG 或 WebP 图片，像素不超过 4000 万");
  }
}
export async function uploadStandaloneImage(
  scope: ImageScope,
  input: { filename: string; base64: string }
) {
  let prepared: Awaited<ReturnType<typeof prepareStandaloneImage>>;
  try {
    prepared = await prepareStandaloneImage(input.base64);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
  }
  const [existing] = await rows<{ id: number; labelStatus: string; recycleId:string|null }>(
    sql`SELECT id,labelStatus,recycleId FROM kb_images WHERE imageSetId IS NULL AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND uploadHash=${prepared.hash}`
  );
  if(existing?.recycleId)throw new TRPCError({code:"CONFLICT",message:"这张图片在回收站中，请管理员恢复，或永久删除后重新上传"});
  let id = existing?.id;
  if (!id) {
    const key = `knowledge/${scope.workspaceId}/images/${scope.userId}/${prepared.hash}`;
    const original = await storagePut(
        key + ".webp",
        prepared.original,
        "image/webp"
      ),
      thumbnail = await storagePut(
        key + ".thumb.webp",
        prepared.thumbnail,
        "image/webp"
      );
    await (
      await requireDb("upload independent image")
    )
      .execute(sql`INSERT INTO kb_images (imageSetId,userId,workspaceId,uploadTitle,uploadHash,imageUrl,thumbnailUrl,imagePosition,visibility)
      VALUES (NULL,${scope.userId},${scope.workspaceId},${input.filename
        .replace(/^.*[\\/]/, "")
        .replace(/\.[^.]+$/, "")
        .slice(
          0,
          512
        )},${prepared.hash},${original.storageUri},${thumbnail.storageUri},'secondary','team') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`);
    const [saved] = await rows<{ id: number }>(
      sql`SELECT id FROM kb_images WHERE imageSetId IS NULL AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND uploadHash=${prepared.hash}`
    );
    id = saved.id;
  }
  let tagging = true;
  if (!existing || ["pending", "failed"].includes(existing.labelStatus)) {
    try {
      await enqueueStandaloneTags(scope, id);
    } catch {
      tagging = false;
      await (
        await requireDb("mark image tagging failure")
      ).execute(
        sql`UPDATE kb_images SET labelStatus='failed',labelError='图片已保存，打标暂未启动，请重试' WHERE id=${id} AND ${standaloneImageAccess(scope, "mine")} AND labelStatus NOT IN ('queued','running','complete')`
      );
    }
  }
  return { id, duplicate: Boolean(existing), tagging };
}
export async function saveStandaloneTags(
  scope: ImageScope,
  id: number,
  revision: number,
  patch: Record<string, string>
) {
  const row = await requireStandaloneImage(scope, id, true);
  const merged = { ...row, ...patch };
  const parsed = StandaloneImageTagsSchema.safeParse({
    tags: Object.fromEntries(
      IMAGE_TAGGING_TAG_FIELDS.map(k => [k, merged[k] || ""])
    ),
    tagAccentColor: merged.tagAccentColor || "",
    tagImageBelong: merged.tagImageBelong || "",
    tagImageBelongSub: merged.tagImageBelongSub || "",
  });
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择有效的标签及对应子标签",
    });
  const values = {
    ...parsed.data.tags,
    tagAccentColor: parsed.data.tagAccentColor,
    tagImageBelong: parsed.data.tagImageBelong,
    tagImageBelongSub: parsed.data.tagImageBelongSub,
  };
  const [receipt] = await (
    await requireDb("save standalone tags")
  ).execute(
    sql`UPDATE kb_images SET ${sql.join(
      Object.entries(values).map(
        ([key, value]) => sql`${sql.identifier(key)}=${value}`
      ),
      sql`, `
    )},tagsConfirmed=1,labelRevision=labelRevision+1,labelStatus='complete',labelError=NULL WHERE id=${id} AND labelRevision=${revision} AND ${standaloneImageAccess(scope, "all", true)}`
  );
  if ((receipt as unknown as { affectedRows: number }).affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "标签已更新，请刷新后编辑",
    });
}
const JobInput = z.object({
  id: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  configurationRevision: z.number().int().positive(),
  actorRole: z.string(),
  feedback: z.string().max(4000),
});
export async function enqueueStandaloneTags(
  scope: ImageScope,
  id: number,
  expectedRevision?: number,
  feedback = ""
) {
  const row = await requireStandaloneImage(scope, id, true);
  if (expectedRevision !== undefined && row.labelRevision !== expectedRevision)
    throw new TRPCError({
      code: "CONFLICT",
      message: "标签已更新，请刷新后再试",
    });
  if (row.labelRunId) {
    const job = await getAiJobRun(row.labelRunId);
    if (job && ["queued", "running"].includes(job.status))
      return { runId: job.runId };
  }
  const { revision } = await imageTaggerConfiguration(scope.workspaceId),
    runId = "kb-image-" + randomUUID(),
    db = await requireDb("queue image tags");
  const [claim] = await db.execute(
    sql`UPDATE kb_images SET labelStatus='queued',labelError=NULL,labelRunId=${runId} WHERE id=${id} AND labelRevision=${row.labelRevision} AND labelRunId <=> ${row.labelRunId} AND ${standaloneImageAccess(scope, "all", true)}`
  );
  if ((claim as unknown as { affectedRows: number }).affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "图片正在处理，请刷新后再试",
    });
  try {
    await startRegisteredAiJob({
      runId,
      kind: STANDALONE_TAGGING_KIND,
      module: "knowledge",
      procedure: "kbImages.uploadStandalone",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      skillSlug: "knowledge.images.tag",
      queueName: "knowledge_tags",
      timeoutSeconds: 300,
      maxAttempts: 1,
      input: {
        id,
        revision: row.labelRevision,
        configurationRevision: revision,
        actorRole: scope.role || "",
        feedback,
      },
    });
  } catch {
    await db.execute(
      sql`UPDATE kb_images SET labelStatus='failed',labelError='打标任务未能启动，请重试' WHERE id=${id} AND labelRunId=${runId}`
    );
    throw new Error("打标任务未能启动，请重试");
  }
  return { runId };
}
registerAiJobHandler({
  id: STANDALONE_TAGGING_KIND,
  match: job => job.kind === STANDALONE_TAGGING_KIND,
  handler: async (job, ctx) => {
    const input = JobInput.parse(job.input),
      scope = {
        userId: job.userId!,
        workspaceId: job.workspaceId!,
        role: input.actorRole,
      },
      db = await requireDb("tag standalone image");
    const guard = sql`id=${input.id} AND labelRevision=${input.revision} AND labelRunId=${job.runId} AND ${standaloneImageAccess(scope, "all", true)}`;
    try {
      const row = await requireStandaloneImage(scope, input.id, true);
      if (row.labelRevision !== input.revision || row.labelRunId !== job.runId)
        return { skipped: true };
      await db.execute(
        sql`UPDATE kb_images SET labelStatus='running' WHERE ${guard}`
      );
      const { config, snapshot, revision } = await imageTaggerConfiguration(
        scope.workspaceId
      );
      if (revision !== input.configurationRevision)
        throw new Error("configuration changed");
      const prepared = await taggingUnitPreview({
        primary: row,
        images: [row],
        complete: true,
      });
      ctx.signal.throwIfAborted();
      const result = await runEmperorSkill({
        skillSlug: "knowledge.images.tag",
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        modelOverride: config.modelSlug,
        maxModelAttempts: 1,
        fallbackModels: [],
        expectedSkillVersion: snapshot.version,
        expectedSkillManifestHash: snapshot.manifestHash,
        expectedSkillStatus: "Released",
        skillVersionPolicy: "snapshot",
        signal: ctx.signal,
        variables: { taggingRules: config.rules.join("\n") },
        context: `这是独立上传的一张图片，不属于 ASIN 集。必须根据这张图自身判断类目、风格、主色和提亮色，并判断图片类型、卖点与构图。返回完整兼容字段和 evidence，items 只有 imageId=${row.id} 一项。无明显提亮色返回空字符串。图片归属无法由画面确定，本轮不猜测。文件名仅为资料：${JSON.stringify(row.uploadTitle)}。${config.instructions}\n${IMAGE_TAGGING_GUIDANCE}\n用户对当前图片的调整意见：${input.feedback || "无"}` + await taggingImprovements(scope,"image"),
        attachments: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${prepared.toString("base64")}`,
            },
          },
        ],
        migrationSource: "knowledge.standalone_image_tags",
      });
      ctx.signal.throwIfAborted();
      const candidate = parseTaggingBatch(result.content, [row.id]).get(row.id);
      if (
        !candidate ||
        !candidate.tagCategory ||
        !candidate.tagDesignStyleV2 ||
        !candidate.tagColorSchemeV2
      )
        throw new Error("incomplete tags");
      const { accentColor, evidence, ...tags } = candidate;
      await db.execute(
        sql`UPDATE kb_images SET ${sql.join(
          Object.entries({ ...tags, tagAccentColor: accentColor }).map(
            ([key, value]) => sql`${sql.identifier(key)}=${value}`
          ),
          sql`, `
        )},aiDimensionAnalysis=${JSON.stringify(candidate)},labelStatus='complete',labelError=NULL,labelRevision=labelRevision+1 WHERE ${guard}`
      );
      return { id: row.id };
    } catch (error) {
      await db.execute(
        sql`UPDATE kb_images SET labelStatus='failed',labelError='图片已保存，自动打标暂未完成，请重试' WHERE ${guard}`
      );
      throw error;
    }
  },
});
