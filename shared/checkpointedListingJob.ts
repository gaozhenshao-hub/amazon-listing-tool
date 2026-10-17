import { PROFILE_IMPORT_JOB_KIND } from "./profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "./competitorResearchJob";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "./competitorDeepExecutionJob";

/** Domain-owned checkpoints/receipts must not pass through generic job APIs. */
export function isCheckpointedListingJob(kind: unknown): boolean {
  return kind === PROFILE_IMPORT_JOB_KIND || kind === COMPETITOR_RESEARCH_JOB_KIND
    || kind === COMPETITOR_DEEP_EXECUTION_JOB_KIND;
}

export function checkpointedListingJobError(kind: unknown, suffix: string): string {
  const prefix = kind === COMPETITOR_DEEP_EXECUTION_JOB_KIND ? "COMPETITOR_DEEP_RESEARCH"
    : kind === COMPETITOR_RESEARCH_JOB_KIND ? "COMPETITOR_RESEARCH" : "PROFILE_IMPORT";
  return `${prefix}_${suffix}`;
}
