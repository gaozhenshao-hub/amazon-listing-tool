import type { ProfileImportJobView } from "@shared/profileImportJob";

export type ProfileImportOwner = { userId: number; workspaceId: number | null; listingProjectId: number };
export type ProfileImportBinding = { devProjectId: number; sourceHash: string };
export const isSourceHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function isOwnedProfileImportJob(value: unknown, owner: ProfileImportOwner): value is ProfileImportJobView {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.runId === "string" && !!item.runId && item.userId === owner.userId && item.workspaceId === owner.workspaceId
    && item.listingProjectId === owner.listingProjectId && positiveId(item.devProjectId) && isSourceHash(item.sourceHash)
    && ["queued", "running", "succeeded", "failed", "canceled"].includes(String(item.status))
    && ["reserved", "model_dispatched", "analysis_ready", "file_committed", "model_result_unknown"].includes(String(item.stage))
    && typeof item.progress === "number" && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100
    && (item.fileId === null || positiveId(item.fileId)) && typeof item.canResume === "boolean" && typeof item.message === "string"
    && item.createdAt instanceof Date && Number.isFinite(item.createdAt.getTime());
}
export const isProfileImportActive = (job: ProfileImportJobView) => job.status === "queued" || job.status === "running";
export const isProfileImportCommitted = (job: ProfileImportJobView) => job.status === "succeeded" && job.stage === "file_committed" && positiveId(job.fileId);
export const isProfileImportResumable = (job: ProfileImportJobView) => (job.status === "failed" || job.status === "canceled") && job.canResume && (job.stage === "reserved" || job.stage === "analysis_ready");
export const profileImportMatches = (job: ProfileImportJobView, binding: ProfileImportBinding) => job.devProjectId === binding.devProjectId && job.sourceHash === binding.sourceHash;
export function exactProfileImportMatch(jobs: ProfileImportJobView[], binding: ProfileImportBinding) {
  const matches = jobs.filter(job => profileImportMatches(job, binding));
  return matches.length === 1 ? matches[0] : null;
}
