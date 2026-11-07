import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  runEmperorSkill,
  safeParseSkillJSON,
  getEmperorSkillRuntimeSnapshot,
} from "../ai_os/services/skillRunner";
import { requireDb } from "../../repositories/dbClient";
import { resolveStoredObjectUrl } from "../../storage";
import {
  brandBackgroundHashes,
  richTextSources,
  ImageTranslationSchema,
  ImageTextRegionSchema,
  RichContentPresentationSchema,
  SellingPointCategoriesSchema,
  type RichContentPresentation,
  type RichTextFinding,
} from "../../../shared/richContentPresentation";

export const MEDIA_TRANSLATION_SKILL = "knowledge.media.translation.v1";
const VERSION = 1;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const points = {
  sellingPoints: z.array(z.string().min(1).max(200)).max(12),
  sellingPointCategories: SellingPointCategoriesSchema,
};
const imageResponse = z
  .object({
    status: z.enum(["complete", "no_text", "partial", "unreadable"]),
    regions: z.array(ImageTextRegionSchema).max(160),
    notes: z.string().max(2000).default(""),
    ...points,
  })
  .superRefine((v, c) => {
    if (v.sellingPoints.length !== v.sellingPointCategories.length)
      c.addIssue({ code: "custom", message: "卖点分类数量不一致" });
    ImageTranslationSchema.parse({
      version: 1,
      sourceHash: "0".repeat(64),
      ...v,
    });
  });
const textsResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        translation: z.string().min(1).max(30000),
        ...points,
      })
    )
    .max(24),
});
type ImageFinding = {
  hash: string;
  translation: string;
  sellingPoints: string[];
  sellingPointCategories: string[];
};
type SourceAsset = {
  role: string;
  storageKey?: string | null;
  imageUrl?: string;
  sourceUrlHash?: string | null;
  contentHash?: string | null;
  excluded?: boolean;
};
type Request = {
  userId: number;
  workspaceId: number;
  layout?: unknown;
  assets: SourceAsset[];
  signal?: AbortSignal;
  previous?: unknown;
  onProgress?: (done: number, total: number) => Promise<unknown>;
};
type Run = <T>(
  context: unknown,
  schema: z.ZodType<T>,
  attachments?: Array<{ type: "image_url"; image_url: { url: string } }>
) => Promise<T>;
type Cache = {
  read: (kind: "image" | "text", key: string) => Promise<unknown>;
  write: (kind: "image" | "text", key: string, value: unknown) => Promise<void>;
};

/** Processing-time only. The viewer never calls this service when toggling Chinese. */
export async function prepareRichContent(
  input: Request,
  deps: { run: Run; cache?: Cache; resolve?: (key: string) => Promise<string> }
) {
  const cached = RichContentPresentationSchema.safeParse(input.previous),
    backgrounds = brandBackgroundHashes(input.layout);
  const assets = [
    ...new Map(
      input.assets
        .filter(
          a =>
            !a.excluded &&
            ["main", "secondary", "aplus", "brand_story"].includes(a.role) &&
            a.sourceUrlHash &&
            !backgrounds.has(a.sourceUrlHash) &&
            (a.storageKey || a.imageUrl)
        )
        .map(a => [a.sourceUrlHash!, a])
    ).values(),
  ];
  const texts = richTextSources(input.layout),
    presentation: RichContentPresentation = {
      version: 1,
      generatedAt: new Date().toISOString(),
      texts: [],
      images: [],
    },
    findings: ImageFinding[] = [];
  let done = 0;
  const total = assets.length + texts.length;
  const progress = async () => {
    input.signal?.throwIfAborted();
    await input.onProgress?.(++done, total);
  };
  const pointSchema = z
    .object(points)
    .refine(
      v => v.sellingPoints.length === v.sellingPointCategories.length,
      "卖点分类数量不一致"
    );
  for (const asset of assets) {
    input.signal?.throwIfAborted();
    const hash = asset.sourceUrlHash!,
      key = asset.contentHash || hash;
    let translated = cached.success
      ? cached.data.images.find(
          i =>
            i.sourceHash === hash &&
            (!asset.contentHash || i.contentHash === asset.contentHash) &&
            i.audited &&
            ["complete", "no_text"].includes(i.status)
        )
      : undefined;
    let imagePoints: z.infer<typeof pointSchema> | undefined;
    const previous = await deps.cache?.read("image", key);
    if (previous && typeof previous === "object") {
      const record = previous as { image?: unknown; points?: unknown },
        image = ImageTranslationSchema.safeParse(record.image),
        parsedPoints = pointSchema.safeParse(record.points);
      if (
        image.success &&
        image.data.audited &&
        ["complete", "no_text"].includes(image.data.status) &&
        parsedPoints.success
      ) {
        if (!translated) translated = { ...image.data, sourceHash: hash };
        imagePoints = parsedPoints.data;
      }
    }
    // A prior presentation may contain the OCR, but selling points still need their own validated cache.
    if (!translated || !imagePoints) {
      const url = await (deps.resolve || resolveStoredObjectUrl)(
          asset.storageKey || asset.imageUrl!
        ),
        attachments = [{ type: "image_url" as const, image_url: { url } }];
      if (translated) {
        imagePoints = await deps.run(
          {
            mode: "image_points",
            imageId: "I1",
            role: asset.role,
            preparedText: translated.regions.map(r => r.source),
          },
          pointSchema,
          attachments
        );
      } else {
        const initial = await deps.run(
          {
            mode: "image",
            imageId: "I1",
            coordinateSystem: "normalized_0_1",
            role: asset.role,
          },
          imageResponse,
          attachments
        );
        input.signal?.throwIfAborted();
        const audited = await deps.run(
          {
            mode: "image_audit",
            imageId: "I1",
            coordinateSystem: "normalized_0_1",
            role: asset.role,
            previous: initial,
          },
          imageResponse,
          attachments
        );
        translated = ImageTranslationSchema.parse({
          version: 1,
          sourceHash: hash,
          ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
          audited: true,
          ...audited,
        });
        imagePoints = {
          sellingPoints: audited.sellingPoints,
          sellingPointCategories: audited.sellingPointCategories,
        };
      }
      // Human corrections belong to the current result, never the reusable AI source cache.
      if (!translated.manualEdited)
        await deps.cache?.write("image", key, {
          image: translated,
          points: imagePoints,
        });
    }
    presentation.images.push(translated);
    findings.push({
      hash,
      translation: translated.regions.map(r => r.translation).join("\n\n"),
      ...imagePoints,
    });
    await progress();
  }
  const pending: Array<{ id: string; text: string }> = [];
  for (const source of texts) {
    const old = cached.success
      ? cached.data.texts.find(
          t => t.id === source.id && t.source === source.text
        )
      : undefined;
    const value = old || (await deps.cache?.read("text", digest(source.text))),
      parsed = value
        ? z
            .object({ translation: z.string().min(1).max(30000), ...points })
            .safeParse(value)
        : null;
    if (parsed?.success) {
      presentation.texts.push({
        ...old,
        id: source.id,
        source: source.text,
        ...parsed.data,
      });
      await progress();
    } else pending.push(source);
  }
  for (let offset = 0; offset < pending.length; ) {
    const batch: typeof pending = [];
    let chars = 0;
    while (
      offset < pending.length &&
      batch.length < 20 &&
      (chars < 14000 || !batch.length)
    ) {
      const s = pending[offset++];
      batch.push(s);
      chars += s.text.length;
    }
    const expected = new Set(batch.map((_, i) => `T${i + 1}`));
    const batchSchema = textsResponse.refine(
      response =>
        response.items.length === batch.length &&
        new Set(response.items.map(t => t.id)).size === expected.size &&
        response.items.every(
          t =>
            expected.has(t.id) &&
            t.sellingPoints.length === t.sellingPointCategories.length
        ),
      "模块文字翻译不完整，请重试"
    );
    const response = await deps.run(
      {
        mode: "texts",
        entries: batch.map((s, i) => ({ id: `T${i + 1}`, source: s.text })),
      },
      batchSchema
    );
    if (
      response.items.length !== batch.length ||
      new Set(response.items.map(t => t.id)).size !== expected.size ||
      response.items.some(
        t =>
          !expected.has(t.id) ||
          t.sellingPoints.length !== t.sellingPointCategories.length
      )
    )
      throw new Error("模块文字翻译不完整，请重试");
    for (const t of response.items) {
      const source = batch[Number(t.id.slice(1)) - 1],
        finding: RichTextFinding = { ...t, id: source.id, source: source.text };
      presentation.texts.push(finding);
      await deps.cache?.write("text", digest(source.text), finding);
      await progress();
    }
  }
  return {
    presentation: RichContentPresentationSchema.parse(presentation),
    findings,
  };
}

export async function translateRichContent(input: Request) {
  const snapshot = await getEmperorSkillRuntimeSnapshot(
    MEDIA_TRANSLATION_SKILL,
    input.workspaceId
  );
  const cacheKey = (key: string) => digest(snapshot.manifestHash + ":" + key);
  const cache: Cache = {
    read: async (kind, key) => {
      const [rows] = await (
        await requireDb("read prepared media translation")
      ).execute(
        sql`SELECT payload FROM media_pretranslations WHERE workspaceId=${input.workspaceId} AND userId=${input.userId} AND kind=${kind} AND sourceHash=${cacheKey(key)} AND version=${VERSION} LIMIT 1`
      );
      const row = (rows as unknown as Array<{ payload: unknown }>)[0];
      if (!row) return null;
      try {
        return typeof row.payload === "string"
          ? JSON.parse(row.payload)
          : row.payload;
      } catch {
        return null;
      }
    },
    write: async (kind, key, value) => {
      input.signal?.throwIfAborted();
      await (
        await requireDb("save prepared media translation")
      ).execute(
        sql`INSERT INTO media_pretranslations (workspaceId,userId,kind,sourceHash,version,payload) VALUES (${input.workspaceId},${input.userId},${kind},${cacheKey(key)},${VERSION},${JSON.stringify(value)}) ON DUPLICATE KEY UPDATE payload=VALUES(payload),updatedAt=CURRENT_TIMESTAMP`
      );
    },
  };
  const run: Run = async (context, schema, attachments) => {
    let feedback: Array<{ path: string; code: string; message: string }> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      input.signal?.throwIfAborted();
      const value = JSON.stringify(
        feedback.length && context && typeof context === "object"
          ? { ...context, validationFeedback: feedback }
          : context
      );
      try {
        const result = await runEmperorSkill({
          skillSlug: MEDIA_TRANSLATION_SKILL,
          skillVersionPolicy: "pinned",
          expectedSkillVersion: snapshot.version,
          expectedSkillManifestHash: snapshot.manifestHash,
          userId: input.userId,
          workspaceId: input.workspaceId,
          context: value,
          variables: { context: value },
          attachments,
          signal: input.signal,
          maxModelAttempts: 1,
          fallbackModels: [],
          validate: content => {
            try {
              return schema.parse(safeParseSkillJSON(content));
            } catch (error) {
              feedback =
                error instanceof z.ZodError
                  ? error.issues
                      .slice(0, 8)
                      .map(i => ({
                        path: i.path.join("."),
                        code: i.code,
                        message: i.message,
                      }))
                  : [
                      {
                        path: "response",
                        code: "invalid_json",
                        message:
                          "请返回符合约定的单个JSON对象，保留全部必填字段",
                      },
                    ];
              console.warn(
                "[RICH_TRANSLATION_VALIDATION]",
                (context as { mode?: string })?.mode,
                JSON.stringify(feedback)
              );
              throw error;
            }
          },
        });
        return result.parsed;
      } catch (error) {
        const cause =
          error && typeof error === "object" && "cause" in error
            ? error.cause
            : null;
        const detail = [error, cause].find(
          v =>
            v &&
            typeof v === "object" &&
            "retryable" in v &&
            typeof v.retryable === "boolean"
        ) as { retryable: boolean } | undefined;
        if (attempt === 2 || !detail?.retryable) throw error;
      }
    }
    throw new Error("预翻译未完成");
  };
  return prepareRichContent(input, { run, cache });
}
