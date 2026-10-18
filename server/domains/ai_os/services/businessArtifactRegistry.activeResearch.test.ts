import { beforeEach, describe, expect, it, vi } from "vitest";

// This unit covers the registry's scope propagation after the independent
// provenance loader has issued a proof; it does not mock a proof acceptance test.
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), analysis: vi.fn(), active: vi.fn(), render: vi.fn(), register: vi.fn() }));
vi.mock("../../../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../../../repositories/project/projectAssetRepository", () => ({ getCompetitorAnalysisById: mocks.analysis }));
vi.mock("../../../services/competitorActiveResearch", () => ({ readActiveCompetitorResearch: mocks.active,
  renderActiveCompetitorResearchContext: mocks.render }));
vi.mock("./artifactLifecycle", () => ({ registerUnifiedArtifact: mocks.register }));
import { registerCompetitorAnalysisArtifact } from "./businessArtifactRegistry";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ workspaceId: null, userId: 3 }] }) }) }) });
  mocks.analysis.mockResolvedValue({ id: 21, projectId: 11, asin: "B000000021", summaryConfirmedBy: 3,
    summaryStatus: "confirmed", summaryVersion: 2 });
  mocks.active.mockReturnValue({ status: "adopted_deep", identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: null,
    projectId: 11, analysisId: 21, asin: "B000000021" }, ref: { version: 1 }, currentRevision: "a".repeat(64) });
  mocks.render.mockReturnValue("Scoped private research"); mocks.register.mockResolvedValue({ ref: "synthetic-ref" });
});
describe("adopted competitor business artifact retains its exact private scope", () => {
  it("registers workspace-7 research under workspace 7, never under its legacy NULL parent", async () => {
    await registerCompetitorAnalysisArtifact(21, "user_edit");
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 7, userId: 3, projectId: 11,
      content: expect.objectContaining({ identity: expect.objectContaining({ workspaceId: 7 }), context: "Scoped private research" }) }));
  });
  it("uses the proof's owner rather than a later unrelated row confirmation actor", async () => {
    mocks.analysis.mockResolvedValue({ ...(await mocks.analysis()), summaryConfirmedBy: 4 });
    await registerCompetitorAnalysisArtifact(21);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 7, userId: 3 }));
  });
  it("keeps legacy NULL scope behavior unchanged", async () => {
    mocks.active.mockReturnValue({ status: "legacy" });
    await registerCompetitorAnalysisArtifact(21);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: null, userId: 3 }));
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("does not register invalid or unadopted deep candidates", async () => {
    mocks.active.mockReturnValue({ status: "unavailable", reasonCode: "DEEP_ADOPTION_NOT_CURRENT_OR_UNVERIFIED" });
    expect(await registerCompetitorAnalysisArtifact(21)).toBeNull();
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
});
