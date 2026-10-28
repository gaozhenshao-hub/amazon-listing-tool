import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  options: vi.fn(),
  snapshot: vi.fn(),
  row: vi.fn(),
  execute: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../ai_os/services/assistantConfigurations", () => ({
  assistantConfigurationService: { get: mocks.get, options: mocks.options },
}));
vi.mock("../../services/emperorSkillRunner", () => ({
  getEmperorSkillRuntimeSnapshot: mocks.snapshot,
  runEmperorSkill: vi.fn(),
}));
vi.mock("./videoLibrary", () => ({
  requireVideo: mocks.row,
  videoObjectAllowed: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({ execute: mocks.execute }),
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: vi.fn(),
  getAiJobRun: vi.fn(),
  startRegisteredAiJob: mocks.start,
}));
import { enqueueVideoTags } from "./videoTagging";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row.mockResolvedValue({
    id: 1,
    labelRevision: 0,
    labelStatus: "unlabeled",
    labelRunId: null,
  });
  mocks.get.mockResolvedValue({
    status: "configured",
    record: {
      config: {
        enabled: true,
        modelSlug: "vision",
        skills: [
          {
            slug: "knowledge.videos.tag",
            version: 1,
            enabled: true,
            manifestSha256: "canonical-hash",
          },
        ],
      },
    },
  });
  mocks.options.mockResolvedValue({
    skills: [
      {
        slug: "knowledge.videos.tag",
        version: 1,
        manifestSha256: "canonical-hash",
      },
    ],
  });
  mocks.snapshot.mockResolvedValue({
    version: "1",
    manifestHash: "stored-order-hash",
  });
  mocks.execute.mockResolvedValue([{ affectedRows: 1 }]);
  mocks.start.mockResolvedValue({});
});
it("accepts the configured skill while pinning the runner's own fingerprint", async () => {
  await enqueueVideoTags({ workspaceId: 1, userId: 2 }, 1, 0);
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({
      skillSlug: "knowledge.videos.tag",
      input: expect.objectContaining({
        skillVersion: "1",
        skillHash: "stored-order-hash",
        videoId: 1,
      }),
    })
  );
});
it("rejects changed or disabled bindings before starting a paid job", async () => {
  mocks.options.mockResolvedValue({
    skills: [
      { slug: "knowledge.videos.tag", version: 1, manifestSha256: "changed" },
    ],
  });
  await expect(
    enqueueVideoTags({ workspaceId: 1, userId: 2 }, 1, 0)
  ).rejects.toThrow("配置");
  expect(mocks.start).not.toHaveBeenCalled();
});
