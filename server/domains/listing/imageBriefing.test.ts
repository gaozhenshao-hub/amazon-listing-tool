import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  data: {} as any,
  locked: false,
  jobs: new Map<string, any>(),
  handler: null as any,
  run: vi.fn(),
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: async () => ({ data: f.data }),
}));
vi.mock("./researchManagedStore", () => ({
  mutateResearchManaged: async (
    _scope: any,
    _page: any,
    change: any,
    options: any
  ) => {
    if (f.locked) throw new Error("已锁定");
    const next = structuredClone(f.data),
      result = await change(next);
    if (!options?.readOnly) f.data = next;
    return { result, revision: 1 };
  },
}));
vi.mock("./imagePlanningSources", () => ({
  imagePlanningSources: async () => ({ input: { facts: "六个口袋" } }),
  planningVisuals: async () => ({ attachments: [], images: [] }),
}));
vi.mock("./imagePlanningContext", () => ({
  planningModelSources: (x: any) => x,
}));
vi.mock("./researchAgent", () => ({
  ensureResearchAgent: async () => ({
    agentRunId: "real-agent",
    agentNodeId: "planning",
  }),
  researchAgentContext: async () => ({
    runId: "real-agent",
    nodeId: "planning",
  }),
}));
vi.mock("../ai_os/services/assistantConfigurations", () => ({
  assistantConfigurationService: {
    get: async () => ({
      status: "configured",
      record: { config: { enabled: true, modelSlug: "configured-model" } },
    }),
  },
}));
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: f.run }));
vi.mock("../ai_os/services/skillRunner", () => ({
  safeParseSkillJSON: JSON.parse,
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: (h: any) => {
    f.handler = h.handler;
  },
  startRegisteredAiJob: async (input: any) => {
    const job = { ...input, status: "queued", attempt: 1 };
    f.jobs.set(job.runId, job);
    return job;
  },
  getAiJobRun: async (id: string) => f.jobs.get(id),
}));
vi.mock("../ai_os/services/businessManagedAgent", () => ({
  markBusinessManagedNodeRunning: vi.fn(),
  markBusinessManagedNodeConfirmed: vi.fn(),
  markBusinessManagedNodeFailed: vi.fn().mockResolvedValue(undefined),
}));
import { startBriefing, clearBriefing, briefingStatus } from "./imageBriefing";
const scope = { projectId: 11, workspaceId: 3, userId: 7 },
  signal = new AbortController().signal;
beforeEach(() => {
  f.data = {};
  f.locked = false;
  f.jobs.clear();
  f.run
    .mockReset()
    .mockResolvedValue({
      parsed: { reply: "先突出核心保护，再展示舒适与选码。" },
    });
});
it("opens once, binds a real project job and persists every turn", async () => {
  const started = await startBriefing(scope, "", true);
  await startBriefing(scope, "", true);
  expect(f.jobs.size).toBe(1);
  const job = f.jobs.get(started.result.runId!);
  expect(job.input).toMatchObject({
    agentRunId: "real-agent",
    agentNodeId: "planning",
    projectId: 11,
  });
  await f.handler(job, { signal });
  job.status = "succeeded";
  expect(f.data.planningConversation.messages).toHaveLength(1);
  await startBriefing(scope, "希望以绿色为主色");
  expect(f.data.planningConversation.messages[1]).toMatchObject({
    role: "user",
    text: "希望以绿色为主色",
  });
  expect((await briefingStatus(scope)).messages).toHaveLength(2);
});
it("never restores a cleared conversation when an old model response arrives late", async () => {
  const started = await startBriefing(scope, "讨论重点"),
    job = f.jobs.get(started.result.runId!);
  let finish!: (v: any) => void;
  f.run.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const pending = f.handler(job, { signal });
  await vi.waitFor(() => expect(f.run).toHaveBeenCalled());
  const oldEpoch = f.data.planningConversation.epoch;
  await clearBriefing(scope);
  finish({ parsed: { reply: "旧回复" } });
  await expect(pending).rejects.toThrow("对话已变化");
  expect(f.data.planningConversation.epoch).not.toBe(oldEpoch);
  expect(f.data.planningConversation.messages).toEqual([]);
});
it("blocks writes and automatic openers while the page is locked", async () => {
  f.locked = true;
  await expect(startBriefing(scope, "", true)).rejects.toThrow("已锁定");
  expect(f.jobs.size).toBe(0);
  await expect(clearBriefing(scope)).rejects.toThrow("已锁定");
});
