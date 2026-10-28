import { AmazonImageLayoutSchema } from "./amazonImageLayout";

/** Remove intentionally deleted assets only; genuine acquisition gaps stay visible. */
export function layoutWithoutDeletedImages(
  layout: unknown,
  hashes: readonly string[]
) {
  const parsed = AmazonImageLayoutSchema.safeParse(layout);
  if (!parsed.success || !hashes.length)
    return parsed.success ? parsed.data : null;
  const removed = new Set(hashes);
  return {
    ...parsed.data,
    modules: parsed.data.modules.flatMap(module => {
      // Keep textual cards; drop cards whose complete image content was deleted.
      const retained = module.cards.flatMap(card => {
        const images = card.images.filter(image => !removed.has(image.hash));
        return card.images.length && !images.length
          ? []
          : [{ ...card, images }];
      });
      const background =
        module.background && removed.has(module.background.hash)
          ? undefined
          : module.background;
      if (
        module.cards.some(c => c.images.length) &&
        !retained.some(c => c.images.length) &&
        !background
      )
        return [];
      return [{ ...module, cards: retained, background }];
    }),
  };
}
