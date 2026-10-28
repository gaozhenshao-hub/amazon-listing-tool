import { z } from "zod";

export const KNOWLEDGE_COLLECTION_LIMIT = 10;
type CollectionVideoGaps = { acceptedMissing?: number; missingMainVideos?: number; missingAplusVideos?: number };
export function collectionVideoGapText(job: CollectionVideoGaps) {
  return [job.missingMainVideos ? `主图视频 ${job.missingMainVideos} 条` : "",
    job.missingAplusVideos ? `A+ 视频 ${job.missingAplusVideos} 条` : ""].filter(Boolean).join("、");
}
export function collectionNeedsAttention(job: CollectionVideoGaps & { status: string }) {
  return ["failed", "review_required"].includes(job.status)
    || job.status === "confirmed" && !job.acceptedMissing && Boolean(job.missingMainVideos || job.missingAplusVideos);
}
/** Stored version names are aliases; never send their prefix to Amazon. */
export function knowledgeSourceAsin(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase().match(/^(?:新[0-9]*)?([A-Z0-9]{10})$/u)?.[1] ?? null;
}

export function knowledgeStoredVersion(asin: string, version?: number | null) {
  const prefix = asin.trim().match(/^新([0-9]*)[A-Z0-9]{10}$/i);
  const displayed = prefix ? Number(prefix[1] || 1) + 1 : 1;
  return Math.max(Number.isSafeInteger(version) && version! > 0 ? version! : 1,
    Number.isSafeInteger(displayed) ? displayed : 1);
}

export function parseKnowledgeAsins(raw: string) {
  const asins: string[] = [], invalid: string[] = [], repeated: string[] = [];
  for (const token of raw.split(/[\s,;，；]+/u).filter(Boolean)) {
    let asin = knowledgeSourceAsin(token) ?? "";
    if (!asin) {
      try {
        const url = new URL(token);
        if (["https:", "http:"].includes(url.protocol) && /^(?:[a-z0-9-]+\.)*amazon\.com$/i.test(url.hostname)) {
          asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() ?? "";
        }
      } catch { /* Report invalid input without silently dropping it. */ }
    }
    if (!asin) invalid.push(token);
    else if (asins.includes(asin)) repeated.push(asin);
    else asins.push(asin);
  }
  return { asins, invalid, repeated: [...new Set(repeated)] };
}

export const KnowledgeCollectionInputSchema = z.object({
  requestId: z.string().uuid(),
  asins: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/)).min(1).max(KNOWLEDGE_COLLECTION_LIMIT),
  mode: z.enum(["normal", "new_version"]).default("normal"),
});
export type KnowledgeCollectionInput = z.infer<typeof KnowledgeCollectionInputSchema>;
export type KnowledgeCollectionReceipt = {
  items: Array<{ asin: string; displayAsin: string; version: number; jobId: number; status: "queued"; cacheHitSnapshotId: null }>;
  skippedItems: Array<{ asin: string; reason: "exists" | "active" | "not_collected" }>;
};
export function collectionDisplayAsin(asin: string, version = 1) {
  return version <= 1 ? asin : `${version === 2 ? "新" : `新${version - 1}`}${asin}`;
}
export function knowledgeCollectionRef(asin: string, version = 1) {
  return `kb-images:US:${asin}${version > 1 ? `:version:${version}` : ""}`;
}
export function knowledgeCollectionVersion(ref: string | null | undefined) {
  const match = ref?.match(/^kb-images:US:[A-Z0-9]{10}:version:([1-9]\d*)$/);
  const version = Number(match?.[1] ?? 1);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}
