import { PROFILE_IMPORT_JOB_KIND } from "./profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "./competitorResearchJob";

/** Domain-owned checkpoints/receipts must not pass through generic job APIs. */
export function isCheckpointedListingJob(kind: unknown): boolean {
  return kind === PROFILE_IMPORT_JOB_KIND || kind === COMPETITOR_RESEARCH_JOB_KIND;
}

export function checkpointedListingJobError(kind: unknown, suffix: string): string {
  return `${kind === COMPETITOR_RESEARCH_JOB_KIND ? "COMPETITOR_RESEARCH" : "PROFILE_IMPORT"}_${suffix}`;
}
