import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  kbImages,
  kbImageSets,
  type KbImage,
  type KbImageSet,
} from "../../../drizzle/schema/image";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  getAiJobRun,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
} from "../../services/aiJobRunner";
import {
  brandBackgroundHashes,
  richTextSources,
  RichContentPresentationSchema,
  savedImageTranslation,
} from "../../../shared/richContentPresentation";
import {
  translateRichContent,
  MEDIA_TRANSLATION_SKILL,
} from "./richContentTranslation";

export const PRETRANSLATION_JOB_KIND = "knowledge.media.pretranslate";
const targetSchema = z.object({
  kind: z.enum(["set", "image"]),
  id: z.number().int().positive(),
});
type Scope = z.infer<typeof targetSchema> & {
  workspaceId: number;
  userId: number;
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function mergeSavedImages(previous: unknown, images: KbImage[]) {
  const p = RichContentPresentationSchema.safeParse(previous),
    base = p.success
      ? p.data
      : {
          version: 1 as const,
          generatedAt: new Date().toISOString(),
          texts: [],
          images: [],
        };
  const saved = images.flatMap(i => {
    const t = savedImageTranslation(
      i.imageTranslation,
      i.sourceUrlHash || i.uploadHash || digest(i.imageUrl)
    );
    return t && !["pending", "failed"].includes(t.status) ? [t] : [];
  });
  return {
    ...base,
    images: [
      ...base.images.filter(
        t => !saved.some(s => s.sourceHash === t.sourceHash)
      ),
      ...saved,
    ],
  };
}
async function target(
  scope: Scope,
  executor?: DbExecutor
): Promise<{
  set: KbImageSet | null;
  images: KbImage[];
  layout: unknown;
  previous: unknown;
}> {
  const db = executor || (await requireDb("load media pretranslation target"));
  if (scope.kind === "set") {
    const query = db
      .select()
      .from(kbImageSets)
      .where(
        and(
          eq(kbImageSets.id, scope.id),
          eq(kbImageSets.workspaceId, scope.workspaceId),
          eq(kbImageSets.userId, scope.userId),
          isNull(kbImageSets.recycleId)
        )
      )
      .limit(1);
    const [set]: KbImageSet[] = executor
      ? await query.for("update")
      : await query;
    if (!set) throw new Error("图片集已变化或不可编辑");
    const imageQuery = db
      .select()
      .from(kbImages)
      .where(and(eq(kbImages.imageSetId, set.id), isNull(kbImages.recycleId)));
    const images: KbImage[] = executor
      ? await imageQuery.for("update")
      : await imageQuery;
    return {
      set,
      images,
      layout: set.sourceLayout,
      previous: mergeSavedImages(set.contentPresentation, images),
    };
  }
  const query = db
    .select()
    .from(kbImages)
    .where(
      and(
        eq(kbImages.id, scope.id),
        isNull(kbImages.imageSetId),
        eq(kbImages.workspaceId, scope.workspaceId),
        eq(kbImages.userId, scope.userId),
        isNull(kbImages.recycleId)
      )
    )
    .limit(1);
  const [image]: KbImage[] = executor ? await query.for("update") : await query;
  if (!image) throw new Error("图片已变化或不可编辑");
  return {
    set: null,
    images: [image],
    layout: null,
    previous: mergeSavedImages(null, [image]),
  };
}
function sourceFingerprint(value: Awaited<ReturnType<typeof target>>) {
  return digest(
    JSON.stringify({
      layout: value.layout,
      images: [...value.images]
        .sort((a, b) => a.id - b.id)
        .map(i => [i.id, i.imageUrl, i.sourceUrlHash, i.uploadHash]),
    })
  );
}
function sourceAssets(value: Awaited<ReturnType<typeof target>>) {
  return value.images.map(i => ({
    role: i.imagePosition,
    storageKey: i.imageUrl,
    sourceUrlHash: i.sourceUrlHash || i.uploadHash || digest(i.imageUrl),
    contentHash:
      i.uploadHash || i.imageTranslation?.contentHash || digest(i.imageUrl),
    excluded: i.imageTranslation?.status === "excluded_background",
  }));
}
function complete(value: Awaited<ReturnType<typeof target>>) {
  const backgrounds = brandBackgroundHashes(value.layout),
    previous = RichContentPresentationSchema.safeParse(value.previous);
  if (
    sourceAssets(value).some(
      (a, i) =>
        !a.excluded &&
        !backgrounds.has(a.sourceUrlHash) &&
        !["complete", "no_text"].includes(
          savedImageTranslation(
            value.images[i].imageTranslation,
            a.sourceUrlHash
          )?.status || ""
        )
    )
  )
    return false;
  return !richTextSources(value.layout).some(
    s =>
      !previous.success ||
      !previous.data.texts.some(t => t.id === s.id && t.source === s.text)
  );
}
export async function pretranslationStatus(scope: Scope) {
  const [rows] = await (
    await requireDb("read pretranslation progress")
  ).execute(
    sql`SELECT runId,status,progress FROM ai_jobs WHERE workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND kind=${PRETRANSLATION_JOB_KIND} AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind'))=${scope.kind} AND JSON_EXTRACT(input,'$.id')=${scope.id} ORDER BY id DESC LIMIT 1`
  );
  return (
    (
      rows as unknown as Array<{
        runId: string;
        status: string;
        progress: number;
      }>
    )[0] || null
  );
}
export async function enqueuePretranslation(scope: Scope) {
  targetSchema.parse(scope);
  const current = await target(scope);
  if (complete(current)) return null;
  const fingerprint = sourceFingerprint(current),
    base = `media-translate-${scope.workspaceId}-${scope.userId}-${scope.kind}-${scope.id}-${fingerprint.slice(0, 24)}`,
    old = await getAiJobRun(base);
  if (old && ["queued", "running"].includes(old.status)) return old;
  const latest = await pretranslationStatus(scope);
  if (latest && ["queued", "running"].includes(latest.status))
    return getAiJobRun(latest.runId);
  const runId = old ? `${base}-${randomUUID().slice(0, 8)}` : base;
  const job = await startRegisteredAiJob({
    runId,
    kind: PRETRANSLATION_JOB_KIND,
    module: "knowledge",
    procedure: "knowledge.prepareTranslations",
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    skillSlug: MEDIA_TRANSLATION_SKILL,
    queueName: "knowledge_tags",
    timeoutSeconds: 7200,
    maxAttempts: 1,
    input: {
      agentRunId: null,
      agentNodeId: null,
      kind: scope.kind,
      id: scope.id,
      fingerprint,
    },
  });
  const db = await requireDb("mark queued translation");
  for (const image of current.images) {
    const hash =
      image.sourceUrlHash || image.uploadHash || digest(image.imageUrl);
    if (
      brandBackgroundHashes(current.layout).has(hash) ||
      image.imageTranslation?.status === "excluded_background"
    )
      continue;
    if (
      !["complete", "no_text"].includes(
        savedImageTranslation(image.imageTranslation, hash)?.status || ""
      )
    )
      await db
        .update(kbImages)
        .set({
          imageTranslation: {
            version: 1,
            sourceHash: hash,
            status: "pending",
            regions: [],
            notes: "中文翻译正在后台准备",
          },
        })
        .where(
          and(
            eq(kbImages.id, image.id),
            eq(kbImages.imageUrl, image.imageUrl),
            isNull(kbImages.recycleId),
            sql`${kbImages.imageTranslation} <=> CAST(${image.imageTranslation ? JSON.stringify(image.imageTranslation) : null} AS JSON)`
          )
        );
  }
  return job;
}
registerAiJobHandler({
  id: PRETRANSLATION_JOB_KIND,
  match: job => job.kind === PRETRANSLATION_JOB_KIND,
  handler: async (job, context) => {
    const input = targetSchema
        .extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(job.input),
      scope = { ...input, workspaceId: job.workspaceId!, userId: job.userId };
    const before = await target(scope);
    if (sourceFingerprint(before) !== input.fingerprint)
      throw new Error("素材已更新，请重新准备翻译");
    try {
      const result = await translateRichContent({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        layout: before.layout,
        assets: sourceAssets(before),
        previous: before.previous,
        signal: context.signal,
        onProgress: (done, total) =>
          updateAiJobProgress(
            job.runId,
            Math.round((done / Math.max(1, total)) * 90)
          ),
      });
      context.signal.throwIfAborted();
      const db = await requireDb("publish prepared media translations");
      await db.transaction(async tx => {
        const fresh = await target(scope, tx);
        if (sourceFingerprint(fresh) !== input.fingerprint)
          throw new Error("素材已更新，旧翻译未应用");
        if (
          before.set &&
          JSON.stringify(fresh.set?.contentPresentation) !==
            JSON.stringify(before.set.contentPresentation)
        )
          throw new Error("翻译已被修改，原修改已保留");
        for (const image of fresh.images) {
          const old = before.images.find(i => i.id === image.id);
          if (
            old &&
            JSON.stringify(image.imageTranslation) !==
              JSON.stringify(old.imageTranslation)
          ) {
            const current = savedImageTranslation(
              image.imageTranslation,
              image.sourceUrlHash || image.uploadHash || digest(image.imageUrl)
            );
            if (current && !["pending", "failed"].includes(current.status))
              result.presentation.images = result.presentation.images.map(t =>
                t.sourceHash === current.sourceHash ? current : t
              );
          }
        }
        if (before.set)
          await tx
            .update(kbImageSets)
            .set({ contentPresentation: result.presentation })
            .where(eq(kbImageSets.id, before.set.id));
        for (const image of before.images) {
          const hash =
              image.sourceUrlHash || image.uploadHash || digest(image.imageUrl),
            translated = result.presentation.images.find(
              t => t.sourceHash === hash
            ),
            current = fresh.images.find(i => i.id === image.id);
          if (
            translated &&
            current &&
            (JSON.stringify(current.imageTranslation) ===
              JSON.stringify(image.imageTranslation) ||
              !current.imageTranslation ||
              ["pending", "failed"].includes(current.imageTranslation.status))
          )
            await tx
              .update(kbImages)
              .set({ imageTranslation: translated })
              .where(
                and(
                  eq(kbImages.id, image.id),
                  eq(kbImages.imageUrl, image.imageUrl),
                  isNull(kbImages.recycleId)
                )
              );
        }
      });
      return {
        kind: input.kind,
        id: input.id,
        images: result.presentation.images.length,
        texts: result.presentation.texts.length,
      };
    } catch (error) {
      const db = await requireDb("record unfinished translation");
      for (const image of before.images)
        await db.execute(
          sql`UPDATE kb_images SET imageTranslation=JSON_SET(imageTranslation,'$.status','failed','$.notes','中文预翻译尚未完成，已保存的其他结果保留') WHERE id=${image.id} AND imageUrl=${image.imageUrl} AND recycleId IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(imageTranslation,'$.status'))='pending'`
        );
      throw error;
    }
  },
});
