/** This lane owns its private checkpoints and immutable candidates. Generic
 * infrastructure must never turn it into a retryable/manager-readable job. */
export const PRIVATE_IMAGE_TAGGING_JOB_KIND = "knowledge.image_tagging.v1";
export const PRIVATE_IMAGE_TAGGING_ARTIFACT_KEYS = [
  "knowledge.image_tagging.source.v1", "knowledge.image_tagging.candidate.v1",
] as const;

export function isDedicatedOnlyAiJob(kind: unknown): boolean {
  return kind === PRIVATE_IMAGE_TAGGING_JOB_KIND;
}

export function assertGenericAiJobKind(kind: unknown): void {
  if (isDedicatedOnlyAiJob(kind)) throw new Error("IMAGE_TAGGING_USE_DEDICATED_ENDPOINT");
}

export function isDedicatedOnlyArtifact(row: { artifactKey?: unknown; sourceTable?: unknown; sourceAiJobRunId?: unknown }): boolean {
  return PRIVATE_IMAGE_TAGGING_ARTIFACT_KEYS.some(key => key === row.artifactKey)
    || (["kb_images", "kb_image_sets"].includes(String(row.sourceTable)) && row.sourceAiJobRunId != null);
}

/** Trusted identifiers only. The linked-job check also rejects a private job's
 * artifact if its key/table is mislabeled; a missing job cannot unprotect the
 * reserved keys or KB job-backed source records. No payload is hydrated. */
export function genericArtifactPredicate(alias: "a" | "ai_artifacts" = "a"): string {
  return `(${alias}.artifactKey NOT IN ('knowledge.image_tagging.source.v1','knowledge.image_tagging.candidate.v1')
    AND NOT (COALESCE(${alias}.sourceTable,'') IN ('kb_images','kb_image_sets') AND ${alias}.sourceAiJobRunId IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM ai_jobs private_job WHERE private_job.runId=${alias}.sourceAiJobRunId AND private_job.kind='knowledge.image_tagging.v1'))`;
}
