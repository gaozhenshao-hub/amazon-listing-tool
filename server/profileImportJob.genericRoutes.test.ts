import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { PROFILE_IMPORT_JOB_KIND } from "../shared/profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../shared/competitorResearchJob";
import { checkpointedListingJobError } from "../shared/checkpointedListingJob";

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), deadLetters: vi.fn(), cancel: vi.fn(), recover: vi.fn(),
  confirm: vi.fn(), audit: vi.fn(), start: vi.fn(), metric: vi.fn() }));
vi.mock("./repositories/ai_os", () => ({ listAiJobsForUser: mocks.list }));
vi.mock("./services/aiJobRunner", () => ({
  getAiJobRun: mocks.get, listAiJobDeadLetterRuns: mocks.deadLetters, cancelAiJob: mocks.cancel,
  recoverAiJob: mocks.recover, buildAiJobSnapshot: (row: unknown) => row,
  registerAiJobHandler: vi.fn(), startRegisteredAiJob: mocks.start, updateAiJobProgress: vi.fn(),
  getAiJobRuntimeStatus: vi.fn(), getAiJobWorkerHealth: vi.fn(),
}));
vi.mock("./services/emperorSkillRunner", () => ({ runEmperorSkill: vi.fn(), safeParseSkillJSON: vi.fn() }));
vi.mock("./domains/ai_os/services/operationalScheduler", () => ({ listAiOsOperationalAlerts: vi.fn() }));
vi.mock("./services/securityGovernance", () => ({ recordSecurityAuditLog: mocks.audit }));
vi.mock("./domains/listing/routerContext", () => ({ ensureWriteAccess: vi.fn(), resolveProjectAccess: vi.fn() }));
vi.mock("./domains/listing/routers/jobControl", () => ({ startListingJobForContext: vi.fn() }));
vi.mock("./domains/ai_os/services/scopedBusinessAgent", () => ({
  confirmScopedBusinessAgentOutput: mocks.confirm, ensureScopedBusinessAgentRun: vi.fn(),
  SCOPED_BUSINESS_AGENT_CONFIG: {}, syncScopedBusinessAgentFailure: vi.fn(),
  syncScopedBusinessAgentProgress: vi.fn(), syncScopedBusinessAgentQueued: vi.fn(),
  syncScopedBusinessAgentWaitingHuman: vi.fn(),
}));
vi.mock("./domains/keyword/keywordGenerationJob", () => ({ cancelKeywordJob: vi.fn(), confirmKeywordJob: mocks.confirm, retryKeywordJob: vi.fn() }));
vi.mock("./domains/video/videoGenerationJob", () => ({ cancelVideoGenerationJob: vi.fn(), retryVideoGenerationJob: vi.fn() }));
vi.mock("./domains/ai_os/services/businessJobCheckpointBinder", () => ({ auditBusinessJobCheckpointBindings: vi.fn() }));

import { aiJobsRouter } from "./routers/aiJobs";

const privateJob = { runId: "profile-anchor", kind: PROFILE_IMPORT_JOB_KIND as string, module: "listing", status: "succeeded",
  userId: 7, input: { checkpoint: { modelResult: "PRIVATE-CHECKPOINT" } }, output: { private: "PRIVATE-RESULT" } };
const legacyJob = { runId: "legacy", kind: "legacy", module: "other", status: "running", userId: 7,
  input: { old: "public-compatibility" }, output: null };
function caller(role = "user", id = 7) {
  return aiJobsRouter.createCaller({ user: { id, role, defaultWorkspaceId: 9 }, workspaceId: 9,
    requestId: "synthetic-private-job", req: {}, res: {} } as TrpcContext);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.get.mockResolvedValue(privateJob);
  mocks.list.mockResolvedValue([privateJob, legacyJob]); mocks.deadLetters.mockResolvedValue([privateJob, legacyJob]);
  mocks.cancel.mockResolvedValue(legacyJob);
});

describe.each([PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND])("generic AI job API does not expose %s checkpoints", kind => {
  beforeEach(() => { privateJob.kind = kind; });
  it.each(["user", "admin", "super_admin"])("%s cannot get/cancel/retry/confirm the private job", async role => {
    const api = caller(role);
    const denied = { code: "PRECONDITION_FAILED", message: checkpointedListingJobError(kind, "USE_DEDICATED_ENDPOINT") };
    await expect(api.get({ runId: privateJob.runId })).rejects.toMatchObject(denied);
    await expect(api.cancel({ runId: privateJob.runId })).rejects.toMatchObject(denied);
    await expect(api.retry({ runId: privateJob.runId })).rejects.toMatchObject(denied);
    await expect(api.confirmBusinessOutput({ runId: privateJob.runId, output: { spoof: true } })).rejects.toMatchObject(denied);
    for (const fn of [mocks.cancel, mocks.recover, mocks.confirm, mocks.audit, mocks.start]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([undefined, { module: "listing" }, { projectId: 19 }])("list input %# never includes private checkpoint/result", async input => {
    const result = await caller().list(input);
    expect(result).toEqual([legacyJob]); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("even the admin dead-letter view excludes historical private copies", async () => {
    const result = await caller("admin").deadLetters();
    expect(result).toEqual([legacyJob]); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("keeps legacy owner get/cancel behavior", async () => {
    mocks.get.mockResolvedValue(legacyJob);
    await expect(caller().get({ runId: "legacy" })).resolves.toEqual(legacyJob);
    await expect(caller().cancel({ runId: "legacy" })).resolves.toEqual(legacyJob);
    expect(mocks.cancel).toHaveBeenCalledWith("legacy", "User canceled AI job");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy foreign ownership denial and administrator read", async () => {
    mocks.get.mockResolvedValue(legacyJob);
    await expect(caller("user", 8).get({ runId: "legacy" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin", 8).get({ runId: "legacy" })).resolves.toEqual(legacyJob);
  });

  it("unauthenticated callers do not perform job reads", async () => {
    const api = aiJobsRouter.createCaller({ user: null, req: {}, res: {} } as TrpcContext);
    await expect(api.get({ runId: privateJob.runId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
