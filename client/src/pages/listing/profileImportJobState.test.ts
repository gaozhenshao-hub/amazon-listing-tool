import { describe, expect, it } from "vitest";
import type { ProfileImportJobView } from "@shared/profileImportJob";
import { exactProfileImportMatch, isOwnedProfileImportJob, isProfileImportActive, isProfileImportCommitted,
  isProfileImportResumable, isSourceHash, profileImportMatches } from "./profileImportJobState";

const owner = { userId: 1, workspaceId: 9, listingProjectId: 7 };
const binding = { devProjectId: 10, sourceHash: "a".repeat(64) };
function job(patch: Partial<ProfileImportJobView> = {}): ProfileImportJobView {
  return { runId: "profile-job-1", ...owner, ...binding, status: "queued", stage: "reserved", progress: 0,
    fileId: null, canResume: false, message: "等待执行", createdAt: new Date("2026-10-16T00:00:00Z"), ...patch };
}

describe("profile import durable receipt guards", () => {
  it("accepts exactly owned DTOs including the explicit legacy null workspace", () => {
    expect(isOwnedProfileImportJob(job(), owner)).toBe(true);
    expect(isOwnedProfileImportJob(job({ workspaceId: null }), { ...owner, workspaceId: null })).toBe(true);
    expect(isOwnedProfileImportJob(job({ workspaceId: null }), owner)).toBe(false);
  });

  it.each([
    { userId: 2 }, { workspaceId: 11 }, { workspaceId: undefined }, { listingProjectId: 8 }, { devProjectId: 0 },
    { devProjectId: Number.MAX_SAFE_INTEGER + 1 }, { runId: "" }, { sourceHash: "A".repeat(64) }, { status: "unknown" },
    { stage: "saved" }, { progress: -1 }, { progress: 101 }, { progress: Number.NaN }, { fileId: 0 },
    { canResume: 1 }, { message: null }, { createdAt: "2026-10-16T00:00:00Z" }, { createdAt: new Date("invalid") },
  ])("refuses malformed or cross-owner receipt %j", patch => {
    expect(isOwnedProfileImportJob({ ...job(), ...patch }, owner)).toBe(false);
  });

  it("requires explicit committed success with a positive file id, not a status/message alone", () => {
    expect(isProfileImportCommitted(job({ status: "succeeded", stage: "file_committed", fileId: 300 }))).toBe(true);
    for (const partial of [{ status: "running", stage: "file_committed", fileId: 300 },
      { status: "succeeded", stage: "analysis_ready", fileId: 300 }, { status: "succeeded", stage: "file_committed", fileId: null }])
      expect(isProfileImportCommitted(job(partial as Partial<ProfileImportJobView>))).toBe(false);
  });

  it("allows only server-authorized pre-dispatch or persisted-analysis failed/canceled resumes", () => {
    for (const stage of ["reserved", "analysis_ready"] as const) {
      for (const status of ["failed", "canceled"] as const) {
        expect(isProfileImportResumable(job({ status, stage, canResume: true }))).toBe(true);
        expect(isProfileImportResumable(job({ status, stage, canResume: false }))).toBe(false);
      }
      expect(isProfileImportResumable(job({ status: "running", stage, canResume: true }))).toBe(false);
    }
    for (const stage of ["model_dispatched", "model_result_unknown", "file_committed"] as const)
      for (const status of ["failed", "canceled"] as const)
        expect(isProfileImportResumable(job({ status, stage, canResume: true }))).toBe(false);
  });

  it("polls queued/running only and never treats unknown or failed as pending model permission", () => {
    expect(isProfileImportActive(job())).toBe(true);
    expect(isProfileImportActive(job({ status: "running" }))).toBe(true);
    for (const status of ["failed", "canceled", "succeeded"] as const) expect(isProfileImportActive(job({ status }))).toBe(false);
  });

  it("recovers by one exact source tuple, never by newest row or ambiguous duplicates", () => {
    const unrelated = job({ runId: "unrelated", devProjectId: 20, createdAt: new Date("2026-10-17T00:00:00Z") });
    const exact = job();
    expect(exactProfileImportMatch([unrelated, exact], binding)).toBe(exact);
    expect(exactProfileImportMatch([unrelated], binding)).toBeNull();
    expect(exactProfileImportMatch([exact, job({ runId: "duplicate" })], binding)).toBeNull();
    expect(profileImportMatches(exact, { ...binding, sourceHash: "b".repeat(64) })).toBe(false);
    expect(isSourceHash(binding.sourceHash)).toBe(true); expect(isSourceHash(null)).toBe(false);
  });
});
