/** Knowledge-library cache policy. This module only plans; it never deletes records or files. */
export const KNOWLEDGE_CACHE_RETENTION_DAYS = 7;
export type CacheRetentionInput = {
  consumerType: string;
  status: string;
  completedAt: Date | null;
  now: Date;
  permanentlyDeletedSet: boolean;
  hasManualRevision: boolean;
  hasOtherConsumer: boolean;
  hasActiveCollection: boolean;
};
export function knowledgeCacheRetention(input: CacheRetentionInput) {
  if (input.consumerType !== "kb_images") return "other_business";
  if (input.status !== "confirmed" || !input.completedAt) return "unfinished";
  if (input.hasActiveCollection) return "active_collection";
  if (input.hasManualRevision || input.hasOtherConsumer)
    return "shared_evidence";
  const age = input.now.getTime() - input.completedAt.getTime();
  if (!Number.isFinite(age) || age < 0) return "invalid_time";
  if (
    !input.permanentlyDeletedSet &&
    age < KNOWLEDGE_CACHE_RETENTION_DAYS * 86_400_000
  )
    return "retained";
  return "eligible";
}

