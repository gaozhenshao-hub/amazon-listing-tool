/** Public, intentionally content-free view of one durable profile conversion. */
export const PROFILE_IMPORT_JOB_KIND = "listing_profile_import_v1";

export type ProfileImportJobView = {
  runId: string;
  listingProjectId: number;
  workspaceId: number | null;
  userId: number;
  devProjectId: number;
  sourceHash: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  stage: "reserved" | "model_dispatched" | "analysis_ready" | "file_committed" | "model_result_unknown";
  fileId: number | null;
  canResume: boolean;
  message: string;
  createdAt: Date;
};
