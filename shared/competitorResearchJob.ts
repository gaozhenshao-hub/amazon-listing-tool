/** Per-competitor durable analysis of explicitly selected, saved Listing sources. */
export const COMPETITOR_RESEARCH_JOB_KIND = "listing_competitor_research_v1";

export interface CompetitorResearchJobView {
  runId: string;
  userId: number;
  workspaceId: number | null;
  projectId: number;
  analysisId: number;
  asin: string;
  sourceHash: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  stage: "reserved" | "model_dispatched" | "analysis_ready" | "analysis_committed" | "model_result_unknown";
  progress: number;
  canResume: boolean;
  canCancel: boolean;
  sourceChanged: boolean;
  message: string;
  createdAt: Date;
}
