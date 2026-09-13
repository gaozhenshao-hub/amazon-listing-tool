import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRegisteredAiJob: vi.fn(),
  registerAiJobHandler: vi.fn(),
  startLegacyConsumerAgentRun: vi.fn(),
}));

vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: mocks.registerAiJobHandler,
  startRegisteredAiJob: mocks.startRegisteredAiJob,
  updateAiJobProgress: vi.fn(),
}));
vi.mock("./legacyConsumerAgent", () => ({
  legacyConsumerAgentConfig: (type: string) => ({ skillSlug: type === "kb_product" ? "analysis.competitor.single" : "listing.competitor.analyze" }),
  startLegacyConsumerAgentRun: mocks.startLegacyConsumerAgentRun,
  markLegacyConsumerAgentRunning: vi.fn(),
  markLegacyConsumerAgentWaitingHuman: vi.fn(),
  markLegacyConsumerAgentFailed: vi.fn(),
}));
vi.mock("../ai_os/services/skillRunner", () => ({ runEmperorSkill: vi.fn(), safeParseSkillJSON: vi.fn() }));
vi.mock("../ai_os/services/businessArtifactRegistry", () => ({ registerCompetitorAnalysisArtifact: vi.fn() }));
vi.mock("../../repositories", () => ({ upsertCompetitorAnalysis: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: vi.fn() }));

import { startLegacyConsumerAnalysisJob } from "./legacyConsumerAnalysisJob";

describe("legacy confirmed snapshot analysis job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startLegacyConsumerAgentRun.mockResolvedValue({ agentRunId: "agent-1", agentNodeId: "analysis" });
    mocks.startRegisteredAiJob.mockResolvedValue({ runId: "job-1", status: "queued" });
  });

  it.each([
    ["kb_listing", "listing", "listing.competitor.analyze"],
    ["kb_product", "productDevelopment", "analysis.competitor.single"],
    ["project_competitor", "listing", "listing.competitor.analyze"],
  ] as const)("binds %s to an Agent node and governed Skill", async (consumerType, module, skillSlug) => {
    const projection = consumerType === "project_competitor"
      ? { consumerType, projectId: 21, workspaceId: 4, userId: 7, asin: "B012345678", confirmedSnapshotId: 9 }
      : { consumerType, recordId: 21, workspaceId: 4, userId: 7, asin: "B012345678", confirmedSnapshotId: 9 };
    await startLegacyConsumerAnalysisJob(projection as any);
    expect(mocks.startLegacyConsumerAgentRun).toHaveBeenCalledWith(expect.objectContaining({ consumerType, businessId: 21, confirmedSnapshotId: 9 }));
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith(expect.objectContaining({
      module,
      skillSlug,
      input: expect.objectContaining({ agentRunId: "agent-1", agentNodeId: "analysis", confirmedSnapshotId: 9 }),
    }));
  });

  it("does not run an AI job for the conversion collector", async () => {
    const result = await startLegacyConsumerAnalysisJob({
      consumerType: "conversion_collector", workspaceId: 4, userId: 7,
      asin: "B012345678", confirmedSnapshotId: 9,
    });
    expect(result).toBeNull();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });
});
