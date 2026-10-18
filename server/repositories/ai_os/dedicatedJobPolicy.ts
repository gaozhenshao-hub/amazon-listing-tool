/** This lane owns its private checkpoints and immutable candidates. Generic
 * infrastructure must never turn it into a retryable/manager-readable job. */
export const PRIVATE_IMAGE_TAGGING_JOB_KIND = "knowledge.image_tagging.v1";
export const PRIVATE_IMAGE_PLANNING_JOB_KIND = "image.workflow.outline.v1";
export const PRIVATE_DEVELOPMENT_MARKET_JOB_KIND = "product.development.market_overview.v1";
export const PRIVATE_KNOWLEDGE_QA_JOB_KIND = "knowledge.qa.v1";
export const PRIVATE_VIDEO_WORKFLOW_JOB_KIND = "video.workflow.configured.v1";
export const PRIVATE_SAIHU_REPORT_JOB_KIND = "ops.saihu_report_capture.v1";
export const PRIVATE_LISTING_CONFIGURED_JOB_KIND = "listing.generation.configured.v1";
export const PRIVATE_LISTING_AUXILIARY_JOB_KIND = "listing.auxiliary.configured.v1";
export const PRIVATE_BUSINESS_JOB_KINDS = [PRIVATE_IMAGE_TAGGING_JOB_KIND, PRIVATE_IMAGE_PLANNING_JOB_KIND, PRIVATE_DEVELOPMENT_MARKET_JOB_KIND,
  PRIVATE_KNOWLEDGE_QA_JOB_KIND, PRIVATE_VIDEO_WORKFLOW_JOB_KIND, PRIVATE_SAIHU_REPORT_JOB_KIND, PRIVATE_LISTING_CONFIGURED_JOB_KIND, PRIVATE_LISTING_AUXILIARY_JOB_KIND] as const;
export const PRIVATE_IMAGE_TAGGING_ARTIFACT_KEYS = [
  "knowledge.image_tagging.source.v1", "knowledge.image_tagging.candidate.v1",
] as const;
export const PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS = ["image.workflow.outline.source.v1", "image.workflow.outline.candidate.v1", "image.workflow.outline.apply.v1",
  "product.development.market_overview.source.v1", "product.development.market_overview.candidate.v1", "product.development.market_overview.apply.v1",
  "knowledge.qa.source.v1", "knowledge.qa.answer.v1", "knowledge.qa.thread.v1",
  "video.workflow.source.v1", "video.workflow.candidate.v1", "video.workflow.revision.v1",
  "ops.saihu_report.source.v1", "ops.saihu_report.preview.v1", "ops.saihu_report.apply.v1",
  "ops.saihu_report.schedule_occurrence.v1",
  "listing.generation.source.v1", "listing.generation.candidate.v1", "listing.generation.apply.v1",
  "listing.auxiliary.source.v1", "listing.auxiliary.candidate.v1", "listing.auxiliary.apply.v1"] as const;
/** Fixed server SQL only. The existing tagger exclusion remains independently
 * bound; these extra lanes cannot change its queue/lease parameter contract. */
export function additionalPrivateBusinessJobExclusion(): string {
  return "kind NOT IN ('image.workflow.outline.v1','product.development.market_overview.v1') AND kind NOT IN ('knowledge.qa.v1','video.workflow.configured.v1') AND kind <> 'ops.saihu_report_capture.v1' AND kind <> 'listing.generation.configured.v1' AND kind <> 'listing.auxiliary.configured.v1'";
}

export function isDedicatedOnlyAiJob(kind: unknown): boolean {
  return PRIVATE_BUSINESS_JOB_KINDS.some(value => value === kind);
}

export function assertGenericAiJobKind(kind: unknown): void {
  if (isDedicatedOnlyAiJob(kind)) throw new Error("IMAGE_TAGGING_USE_DEDICATED_ENDPOINT");
}

export function isDedicatedOnlyArtifact(row: { artifactKey?: unknown; sourceTable?: unknown; sourceAiJobRunId?: unknown }): boolean {
  return [...PRIVATE_IMAGE_TAGGING_ARTIFACT_KEYS, ...PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS].some(key => key === row.artifactKey)
    || (["kb_images", "kb_image_sets"].includes(String(row.sourceTable)) && row.sourceAiJobRunId != null);
}

/** Trusted identifiers only. The linked-job check also rejects a private job's
 * artifact if its key/table is mislabeled; a missing job cannot unprotect the
 * reserved keys or KB job-backed source records. No payload is hydrated. */
export function genericArtifactPredicate(alias: "a" | "ai_artifacts" = "a"): string {
  return `(${alias}.artifactKey NOT IN ('knowledge.image_tagging.source.v1','knowledge.image_tagging.candidate.v1')
    AND ${alias}.artifactKey NOT IN ('image.workflow.outline.source.v1','image.workflow.outline.candidate.v1','image.workflow.outline.apply.v1','product.development.market_overview.source.v1','product.development.market_overview.candidate.v1','product.development.market_overview.apply.v1')
    AND ${alias}.artifactKey NOT IN ('knowledge.qa.source.v1','knowledge.qa.answer.v1','knowledge.qa.thread.v1','video.workflow.source.v1','video.workflow.candidate.v1','video.workflow.revision.v1')
    AND ${alias}.artifactKey NOT IN ('ops.saihu_report.source.v1','ops.saihu_report.preview.v1','ops.saihu_report.apply.v1','ops.saihu_report.schedule_occurrence.v1')
    AND ${alias}.artifactKey NOT IN ('listing.generation.source.v1','listing.generation.candidate.v1','listing.generation.apply.v1')
    AND ${alias}.artifactKey NOT IN ('listing.auxiliary.source.v1','listing.auxiliary.candidate.v1','listing.auxiliary.apply.v1')
    AND NOT (COALESCE(${alias}.sourceTable,'') IN ('kb_images','kb_image_sets') AND ${alias}.sourceAiJobRunId IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM ai_jobs private_job WHERE private_job.runId=${alias}.sourceAiJobRunId AND (private_job.kind='knowledge.image_tagging.v1' OR private_job.kind IN ('image.workflow.outline.v1','product.development.market_overview.v1') OR private_job.kind IN ('knowledge.qa.v1','video.workflow.configured.v1') OR private_job.kind='ops.saihu_report_capture.v1' OR private_job.kind='listing.generation.configured.v1' OR private_job.kind='listing.auxiliary.configured.v1')))`;
}
