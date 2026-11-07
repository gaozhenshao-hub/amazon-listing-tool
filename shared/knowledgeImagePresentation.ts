import {
  AmazonImageLayoutSchema,
  type AmazonImageLayout,
} from "./amazonImageLayout";
import {
  RichContentPresentationSchema,
  richTextSources,
  type RichContentPresentation,
} from "./richContentPresentation";

/** An explicit ASIN image-set import contains images and copy; videos are imported independently. */
export function imageLibraryLayout(value: unknown): AmazonImageLayout | null {
  const p = AmazonImageLayoutSchema.safeParse(value);
  if (!p.success) return null;
  const modules = p.data.modules.flatMap(m => {
    const cards = m.cards.map(c => ({ ...c, videoHashes: [] }));
    if (
      m.kind === "video" &&
      !cards.some(c => c.images.length || c.blocks?.length || c.text) &&
      !m.blocks?.length
    )
      return [];
    return [
      {
        ...m,
        cards,
        videoHashes: [],
        ...(m.kind === "video"
          ? {
              kind: cards.some(c => c.images.length)
                ? ("image" as const)
                : ("text" as const),
            }
          : {}),
      },
    ];
  });
  return { ...p.data, version: 2, modules };
}
export function presentationForImages(
  value: unknown,
  layout: unknown,
  hashes: ReadonlySet<string>
): RichContentPresentation | null {
  const p = RichContentPresentationSchema.safeParse(value);
  if (!p.success) return null;
  const texts = new Map(richTextSources(layout).map(b => [b.id, b.text]));
  return {
    ...p.data,
    texts: p.data.texts.filter(t => texts.get(t.id) === t.source),
    images: p.data.images.filter(i => hashes.has(i.sourceHash)),
  };
}
