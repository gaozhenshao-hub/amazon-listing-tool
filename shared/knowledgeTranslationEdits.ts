import { z } from "zod";
import {
  ImageTranslationSchema,
  RichContentPresentationSchema,
  type ImageTranslation,
  type RichContentPresentation,
} from "./richContentPresentation";
export type EditableImageTranslation = {
  imageId: number;
  translation: ImageTranslation;
};
export type EditableContentTranslation = {
  id: string;
  source: string;
  translation: string;
};
export function imageTranslationsForEditing(
  images: ReadonlyArray<{ id: number; imageTranslation?: unknown }>
): EditableImageTranslation[] {
  return images.flatMap(i => {
    const p = ImageTranslationSchema.safeParse(i.imageTranslation);
    return p.success &&
      ["complete", "no_text", "partial", "unreadable"].includes(p.data.status)
      ? [{ imageId: i.id, translation: p.data }]
      : [];
  });
}
export function contentTranslationsForEditing(
  value: unknown
): EditableContentTranslation[] {
  const p = RichContentPresentationSchema.safeParse(value);
  return p.success
    ? p.data.texts.map(t => ({
        id: t.id,
        source: t.source,
        translation: t.translation,
      }))
    : [];
}
export function validateImageTranslationEdits(
  value: unknown,
  original: EditableImageTranslation[]
): EditableImageTranslation[] {
  if (value === undefined) return original;
  const items = z
    .array(
      z.object({
        imageId: z.number().int().positive(),
        translation: ImageTranslationSchema,
      })
    )
    .max(80)
    .parse(value);
  if (
    items.length !== original.length ||
    new Set(items.map(i => i.imageId)).size !== original.length
  )
    throw new Error("图片翻译必须与当前素材逐一对应");
  return items.map(item => {
    const source = original.find(i => i.imageId === item.imageId)?.translation;
    if (
      !source ||
      item.translation.sourceHash !== source.sourceHash ||
      item.translation.contentHash !== source.contentHash
    )
      throw new Error("不能把译文应用到其他图片");
    if (
      !["complete", "no_text", "partial", "unreadable"].includes(
        item.translation.status
      )
    )
      throw new Error("不能修改翻译的处理状态");
    const changed =
      JSON.stringify(item.translation.regions) !==
      JSON.stringify(source.regions);
    return {
      imageId: item.imageId,
      translation: {
        ...item.translation,
        version: source.version,
        sourceHash: source.sourceHash,
        contentHash: source.contentHash,
        audited: source.audited,
        originalRegions:
          source.originalRegions || (changed ? source.regions : undefined),
        manualEdited: source.manualEdited || changed,
      },
    };
  });
}
export function validateContentTranslationEdits(
  value: unknown,
  original: EditableContentTranslation[]
): EditableContentTranslation[] {
  if (value === undefined) return original;
  const items = z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        translation: z.string().min(1).max(30000),
      })
    )
    .max(6000)
    .parse(value);
  if (
    items.length !== original.length ||
    new Set(items.map(i => i.id)).size !== original.length ||
    items.some(t => !original.some(s => s.id === t.id && s.source === t.source))
  )
    throw new Error("模块译文必须与当前原文逐段对应");
  return items;
}
export function applyContentTranslationEdits(
  value: unknown,
  items: EditableContentTranslation[]
): RichContentPresentation | null {
  const p = RichContentPresentationSchema.safeParse(value);
  if (!p.success) return null;
  const edits = validateContentTranslationEdits(
    items,
    contentTranslationsForEditing(value)
  );
  return {
    ...p.data,
    texts: p.data.texts.map(t => {
      const translation = edits.find(e => e.id === t.id)!.translation;
      return {
        ...t,
        translation,
        ...(translation !== t.translation
          ? { originalTranslation: t.originalTranslation || t.translation }
          : {}),
      };
    }),
  };
}
