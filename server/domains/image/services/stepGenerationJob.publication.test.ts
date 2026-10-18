import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJobHandlerContext, AiJobSnapshot } from "../../ai_os/services/jobRunner";

const io = vi.hoisted(() => ({
  project: vi.fn(), session: vi.fn(), directUpdate: vi.fn(), listJobs: vi.fn(),
  verify: vi.fn(), invalidate: vi.fn(), callSkill: vi.fn(),
}));
vi.mock("../routerContext", () => ({
  APLUS_MODULE_STYLE_GUIDE: "synthetic styles", buildImageWorkflowContext: vi.fn(async () => "synthetic source"),
  callImageWorkflowSkill: io.callSkill, getKBReference: vi.fn(), invokeBusinessSkill: vi.fn(),
  normalizeImageOutline: vi.fn(value => value), parseLLMJson: vi.fn(),
}));
vi.mock("../repository", () => ({
  getProjectByIdAdmin: io.project, getImageWorkflowSessionById: io.session,
  updateImageWorkflowSession: io.directUpdate, devDb: {}, kbDb: {},
}));
vi.mock("../../ai_os/services/jobRunner", () => ({
  cancelAiJob: vi.fn(), createAiJobRun: vi.fn(), listAiJobRunsForUser: io.listJobs,
  registerAiJobHandler: vi.fn(), scheduleAiJobRun: vi.fn(), updateAiJobProgress: vi.fn(),
}));
vi.mock("../../ai_os/services/businessArtifactRegistry", () => ({
  hydrateImageWorkflowSessionFromArtifacts: vi.fn(async value => value),
}));
vi.mock("../imageWorkflowAgentBridge", () => ({
  syncStepJobFailedToAgent: vi.fn(), syncStepJobQueuedToAgent: vi.fn(),
  syncStepJobRunningToAgent: vi.fn(), syncStepJobWaitingHumanToAgent: vi.fn(),
  ensureImageWorkflowAgentRun: vi.fn(), imageWorkflowSkillNodeId: vi.fn(),
}));
vi.mock("../../knowledge/claimLedgerService", () => ({ resolveWorkflowGuidance: vi.fn() }));
vi.mock("../expressionLinkageService", () => ({ getConfirmedCompositeContext: vi.fn(async () => null) }));
vi.mock("./imageWorkflowVersionPolicy", () => ({
  captureImageWorkflowWorkerFence: vi.fn(), verifyImageWorkflowWorkerFence: io.verify,
  invalidateImageWorkflowStages: io.invalidate,
  projectCurrentImageWorkflowSnapshotsToSession: vi.fn(({ session }) => session),
}));
import { runImageStepGenerationJob } from "./stepGenerationJob";

const candidate = { outline: "complete synthetic candidate; no model is called" };
function fixture() {
  return { runId: "legacy-step2-run", kind: "image.step2.generation", projectId: 51, workspaceId: 42, userId: 7, attempt: 1,
    input: { projectId: 51, sessionId: 90, step: 2, actorRole: "user", scopeRevision: 8, upstreamDigest: "a".repeat(64) },
  } as unknown as AiJobSnapshot;
}
const context = () => ({ signal: new AbortController().signal } as AiJobHandlerContext);
beforeEach(() => {
  vi.clearAllMocks(); io.project.mockResolvedValue({ id: 51, workspaceId: 42, name: "synthetic" });
  io.session.mockResolvedValue({ id: 90, projectId: 51, step1Confirmed: 1, step2Confirmed: 0, step1AiResult: "{}" });
  io.listJobs.mockResolvedValue([fixture()]); io.verify.mockResolvedValue([]);
  io.callSkill.mockResolvedValue(candidate); io.invalidate.mockResolvedValue({ scopeRevision: 9, invalidatedSteps: [] });
});
describe("legacy image draft publication shares the version CAS transaction", () => {
  it("sends the frozen fence and actual draft to the atomic existing invalidation writer", async () => {
    await expect(runImageStepGenerationJob(fixture(), context())).resolves.toEqual(candidate);
    expect(io.verify).toHaveBeenCalledOnce(); // admission before the model only
    expect(io.invalidate).toHaveBeenCalledOnce();
    expect(io.invalidate).toHaveBeenCalledWith({ workspaceId: 42, projectId: 51, sessionId: 90,
      actorId: 7, actorRole: "user", fromStep: 2, targetStep: 2,
      fence: { scopeRevision: 8, upstreamDigest: "a".repeat(64) },
      legacyPatch: { step2AiResult: JSON.stringify(candidate) } });
    expect(io.directUpdate).not.toHaveBeenCalled();
  });
  it("does not fall back to an unguarded projection when a newer human apply wins the CAS", async () => {
    const changed = new Error("scope revision changed by newer human apply"); io.invalidate.mockRejectedValue(changed);
    await expect(runImageStepGenerationJob(fixture(), context())).rejects.toBe(changed);
    expect(io.directUpdate).not.toHaveBeenCalled(); expect(io.callSkill).toHaveBeenCalledOnce();
  });
  it("does not invalidate or project if the session has been confirmed during inference", async () => {
    io.session.mockResolvedValueOnce({ id: 90, projectId: 51, step1Confirmed: 1, step2Confirmed: 0 })
      .mockResolvedValueOnce({ id: 90, projectId: 51, step2Confirmed: 1 });
    await expect(runImageStepGenerationJob(fixture(), context())).resolves.toMatchObject({ skipped: true });
    expect(io.invalidate).not.toHaveBeenCalled(); expect(io.directUpdate).not.toHaveBeenCalled();
  });
});
