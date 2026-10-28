import { AmazonImageLayoutSchema, type AmazonImageModule } from "./amazonImageLayout";

type Image = { id: number; imagePosition: string; sourceUrlHash?: string | null; positionIndex?: number | null };
export type ImageTaggingUnit<T extends Image> = { primary: T; images: T[]; module?: AmazonImageModule; complete: boolean };

/** Composite A+ modules share labels; carousel slides remain independent images. */
export function imageTaggingUnits<T extends Image>(images: readonly T[], layout: unknown): ImageTaggingUnit<T>[] {
  const parsed = AmazonImageLayoutSchema.safeParse(layout);
  const byHash = new Map(images.filter(i => i.imagePosition === "aplus" && i.sourceUrlHash).map(i => [i.sourceUrlHash!, i]));
  const used = new Set<number>(), units: ImageTaggingUnit<T>[] = [];
  for (const module of parsed.success ? parsed.data.modules : []) {
    if (module.section !== "aplus") continue;
    const hashes = [...new Set(module.cards.flatMap(c => c.images.map(i => i.hash)))];
    const members = hashes.map(hash => byHash.get(hash)).filter((i): i is T => Boolean(i));
    if (module.kind === "carousel") {
      for (const image of members) {
        if (!used.has(image.id)) units.push({ primary: image, images: [image], complete: true });
        used.add(image.id);
      }
      continue;
    }
    members.forEach(i => used.add(i.id));
    if (!members.length) continue;
    // Never silently promote a later image if the source's first image is missing.
    const primary = byHash.get(hashes[0]) ?? members[0];
    if (!units.some(u => u.primary.id === primary.id)) units.push({ primary, images: members, module, complete: members.length === hashes.length });
  }
  const standalone = [...images].sort((a,b) => (a.positionIndex ?? a.id) - (b.positionIndex ?? b.id));
  for (const image of standalone) {
    if (image.imagePosition !== "brand_story" && !used.has(image.id)) units.push({primary:image,images:[image],complete:true});
  }
  return units;
}

export const REQUIRED_IMAGE_TAGS = ["tagImageTypeMain", "tagComposition"] as const;
export function hasCompleteImageTags(image: { tagsConfirmed?: number; analysisConfirmed?: number } & Partial<Record<typeof REQUIRED_IMAGE_TAGS[number], unknown>>) {
  return Boolean(image.tagsConfirmed || image.analysisConfirmed || REQUIRED_IMAGE_TAGS.every(key => image[key]));
}

export const SHARED_IMAGE_TAG_FIELDS = [
  "tagCategory", "tagColorScheme", "tagImageType", "tagDesignStyle", "tagImageBelong", "tagImageBelongSub",
  "tagImageTypeMain", "tagImageTypeSub", "tagSellingPointCategory", "tagSellingPointDetail", "tagComposition",
  "tagColorSchemeV2", "tagAccentColor", "tagDesignStyleV2", "singleImageScore", "tagsConfirmed", "analysisConfirmed",
  "aiDimensionAnalysis", "userEditedDimensionAnalysis", "highlights",
] as const;

/** Resolve labels, never image identity or storage, from the module's first source image. */
export function sharedImageTags<T extends Image>(images: readonly T[], layout: unknown) {
  const owners = new Map<number, { owner?: T; size: number }>();
  for (const unit of imageTaggingUnits(images, layout)) {
    const owner = unit.module && unit.primary.sourceUrlHash !== unit.module.cards[0]?.images[0]?.hash ? undefined : unit.primary;
    for (const member of unit.images) owners.set(member.id, { owner, size: unit.images.length });
  }
  return images.map(image => {
    const shared = owners.get(image.id);
    if (!shared) return { ...image, tagOwnerId: image.id, moduleImageCount: 1 };
    const tags = Object.fromEntries(SHARED_IMAGE_TAG_FIELDS.map(key => [key, shared.owner ? (shared.owner as Record<string, unknown>)[key] ?? null : null]));
    return { ...image, ...tags, tagOwnerId: shared.owner?.id ?? null, moduleImageCount: shared.size } as T & {tagOwnerId: number | null; moduleImageCount: number};
  });
}
